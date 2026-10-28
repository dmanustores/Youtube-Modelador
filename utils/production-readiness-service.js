const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { AITextService } = require('./ai-text-service');
const { AIVideoGenerator } = require('./ai-video-generator');
const { checkFFmpeg, runFFmpeg } = require('./ffmpeg');
const { validateYouTubeMetadata } = require('./youtube-metadata-validator');
const { Logger } = require('./logger');
const { MediaGenerationService } = require('./media-generation-service');

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

class ProductionReadinessService {
  constructor(db, credentialManager, options = {}) {
    this.db = db;
    this.credentialManager = credentialManager;
    this.logger = options.logger || new Logger('ProductionReadiness');
    this.probes = options.probes || {};
    this.now = options.now || (() => new Date());
    this.activeRun = null;
  }

  async getSummary() {
    const latest = await this.db.getLatestReadinessRun();
    if (!latest) {
      return {
        status: 'unverified',
        stale: false,
        blockingFailures: [],
        checks: [],
        message: 'Run the verified readiness check before relying on autonomous production.'
      };
    }
    const age = this.now().getTime() - new Date(latest.completed_at || latest.created_at).getTime();
    return {
      ...latest,
      stale: age > STALE_AFTER_MS,
      blockingFailures: latest.checks.filter(check => check.blocking && check.status === 'failed').map(check => check.id)
    };
  }

  async assertReady(action) {
    const summary = await this.getSummary();
    if (summary.status === 'failed') {
      const error = new Error(`${action} is blocked by the production readiness gate. Fix ${summary.blockingFailures.join(', ')} and run the check again.`);
      error.status = 409;
      error.readiness = summary;
      throw error;
    }
    return summary;
  }

  async run(options = {}) {
    if (this.activeRun) {
      const error = new Error('A production readiness check is already running');
      error.status = 409;
      throw error;
    }

    this.activeRun = this.executeRun(options).finally(() => {
      this.activeRun = null;
    });
    return this.activeRun;
  }

  async executeRun(options) {
    const startedAt = this.now().toISOString();
    const id = this.db.generateId ? this.db.generateId('readiness') : `readiness_${Date.now()}`;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaa-readiness-'));
    const checks = [];

    try {
      const manualMode = options.videoMode === 'manual' || (this.db?.getSetting && (await this.db.getSetting('video_creation_mode')) === 'manual');

      checks.push(await this.executeCheck('text_provider', 'Provedor de texto IA', true, () => this.probeText()));
      checks.push(await this.executeCheck('image_provider', 'Provedor de imagem IA', false, () => this.probeImage(tempDir, Boolean(options.includePaidMedia))));
      checks.push(await this.executeCheck('video_provider', 'Geração de vídeo IA', !manualMode, () => {
        if (manualMode) return { status: 'skipped', message: 'Criação automática desativada (fluxo manual de vídeo .mp4 ativo)' };
        return this.probeVideoProvider(tempDir, Boolean(options.includePaidVideo));
      }));
      checks.push(await this.executeCheck('voice_narration', 'Narração de voz', !manualMode, () => {
        if (manualMode) return { status: 'skipped', message: 'Narração externa ativa (fatiamento em 2 blocos de 5.000 caracteres)' };
        return this.probeNarration(tempDir);
      }));
      checks.push(await this.executeCheck('video_assembly', 'Montagem de áudio e vídeo', !manualMode, () => {
        if (manualMode) return { status: 'skipped', message: 'Montagem externa ativa (upload manual de arquivo .mp4)' };
        return this.probeVideoAssembly(tempDir);
      }));
      checks.push(await this.executeCheck('youtube_access', 'Acesso ao canal do YouTube', true, () => this.probeYouTube()));
      checks.push(await this.executeCheck('upload_metadata', 'Metadados de envio', true, () => this.probeMetadata()));

      const blockingFailures = checks.filter(check => check.blocking && check.status === 'failed');
      const warnings = checks.filter(check =>
        ['warning', 'skipped'].includes(check.status) || (!check.blocking && check.status === 'failed')
      );
      const status = blockingFailures.length ? 'failed' : warnings.length ? 'warning' : 'passed';
      const completedAt = this.now().toISOString();
      const result = {
        id,
        status,
        checks,
        summary: {
          passed: checks.filter(check => check.status === 'passed').length,
          warnings: warnings.length,
          failed: checks.filter(check => check.status === 'failed').length,
          blockingFailures: blockingFailures.map(check => check.id)
        },
        startedAt,
        completedAt
      };
      await this.db.saveReadinessRun(result);
      return { ...result, stale: false, blockingFailures: result.summary.blockingFailures };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async executeCheck(id, label, blocking, probe) {
    const started = Date.now();
    try {
      const result = await probe();
      return {
        id,
        label,
        blocking,
        status: result.status || 'passed',
        message: result.message,
        remediation: result.remediation || null,
        details: result.details || {},
        durationMs: Date.now() - started
      };
    } catch (error) {
      const safeMessage = this.safeError(error);
      this.logger.warn(`${label} readiness probe failed: ${safeMessage}`);
      return {
        id,
        label,
        blocking,
        status: 'failed',
        message: safeMessage,
        remediation: this.remediationFor(id),
        details: {},
        durationMs: Date.now() - started
      };
    }
  }

  async probeText() {
    if (this.probes.text) return this.probes.text();
    const service = new AITextService(this.credentialManager.credentials || {});
    if (!service.isAvailable()) throw new Error('Nenhum provedor de texto IA está configurado');
    const response = await service.generateText('Reply with exactly READY.', { maxTokens: 16, temperature: 0 });
    return { message: `${service.providerName} respondeu com sucesso ao teste ao vivo.`, details: { provider: service.providerName, responseReceived: Boolean(response) } };
  }

  async probeImage(tempDir, includePaidMedia) {
    if (this.probes.image) return this.probes.image({ tempDir, includePaidMedia });
    const generator = new AIVideoGenerator(this.credentialManager.credentials || {});
    if (!generator.openai && !generator.gemini) {
      return { status: 'warning', message: 'Nenhum provedor de imagem configurado; serão usados recursos visuais e gradientes.', remediation: 'Configure acesso ao OpenAI ou Gemini se imagens geradas forem necessárias.' };
    }
    if (!includePaidMedia) {
      return { status: 'skipped', message: 'Provedor configurado; o teste pago de imagem não foi solicitado.', remediation: 'Ative “Incluir teste de imagem IA” na próxima verificação para testar a geração de imagem.' };
    }
    const outputPath = path.join(tempDir, 'readiness-image.png');
    await generator.generateImage('Simple red circle centered on a plain dark background, no text', outputPath);
    const stats = await fs.stat(outputPath);
    if (stats.size < 100) throw new Error('O provedor de imagem retornou um arquivo vazio ou inválido');
    return { message: 'O provedor de imagem gerou um arquivo de teste com sucesso.', details: { bytes: stats.size } };
  }

  async probeNarration(tempDir) {
    if (this.probes.narration) return this.probes.narration({ tempDir });
    const generator = new AIVideoGenerator(this.credentialManager.credentials || {});
    const outputPath = path.join(tempDir, 'readiness-narration.mp3');
    const resultPath = await generator.generateTTSAudio('Production readiness audio check.', outputPath);
    if (path.extname(resultPath).toLowerCase() === '.info') throw new Error('Nenhum provedor de voz disponível; o pipeline retornou uma simulação');
    const stats = await fs.stat(resultPath);
    if (stats.size < 100) throw new Error('O provedor de narração retornou um arquivo de áudio vazio');
    return { message: 'Uma amostra de áudio e voz foi gerada e validada com sucesso.', details: { bytes: stats.size } };
  }

  async probeVideoProvider(tempDir, includePaidVideo) {
    if (this.probes.videoProvider) return this.probes.videoProvider({ tempDir, includePaidVideo });
    const service = new MediaGenerationService(this.db, this.credentialManager.credentials || {});
    const settings = await service.settings();
    const requested = settings.provider;
    const configured = requested === 'auto' ? service.registry.select('auto', settings.order) : service.registry.get(requested);
    if (!configured || !configured.isAvailable()) {
      if (requested === 'slideshow') {
        return { message: 'Geração local por apresentação de slides selecionada; nenhum provedor pago de vídeo é necessário.', details: { provider: 'slideshow' } };
      }
      throw new Error(`${requested} foi selecionado, mas suas credenciais não estão configuradas`);
    }
    if (configured.id === 'slideshow') {
      return { message: 'Geração local por apresentação de slides selecionada; nenhum provedor pago de vídeo é necessário.', details: { provider: 'slideshow' } };
    }
    if (!includePaidVideo) {
      return {
        status: 'skipped',
        message: `${configured.id} está configurado; o teste pago de vídeo não foi solicitado.`,
        remediation: 'Ative “Incluir teste de vídeo IA” na próxima verificação para validar o modelo selecionado.',
        details: { provider: configured.id, model: configured.model }
      };
    }
    const outputPath = path.join(tempDir, 'readiness-provider.mp4');
    const result = await service.generateClip({
      jobId: null,
      productionId: `readiness_${Date.now()}`,
      scene: { index: Date.now() },
      provider: configured,
      outputPath,
      request: {
        prompt: 'A small red ball rolls slowly across a plain dark studio floor, static camera, no text.',
        duration: configured.capabilities.minDuration || 4,
        resolution: settings.resolution,
        aspectRatio: settings.aspectRatio,
        generateAudio: false
      }
    });
    const stats = await fs.stat(result.outputPath);
    return {
      message: `${configured.id} gerou e retornou um vídeo MP4 reproduzível com sucesso.`,
      details: { provider: configured.id, model: configured.model, bytes: stats.size, taskId: result.task.external_task_id }
    };
  }

  async probeVideoAssembly(tempDir) {
    if (this.probes.videoAssembly) return this.probes.videoAssembly({ tempDir });
    if (!await checkFFmpeg()) throw new Error('FFmpeg não está disponível no sistema');
    const outputPath = path.join(tempDir, 'readiness-av.mp4');
    await runFFmpeg([
      '-y', '-f', 'lavfi', '-i', 'color=c=0x111827:s=320x180:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', outputPath
    ]);
    const buffer = await fs.readFile(outputPath);
    if (buffer.length < 1000 || buffer.subarray(4, 12).toString('ascii').indexOf('ftyp') === -1) {
      throw new Error('O FFmpeg não produziu um contêiner MP4 válido');
    }
    await runFFmpeg(['-v', 'error', '-i', outputPath, '-f', 'null', '-']);
    return { message: 'O FFmpeg criou e decodificou um vídeo MP4 local contendo áudio e vídeo com sucesso.', details: { bytes: buffer.length } };
  }

  async probeYouTube() {
    if (this.probes.youtube) return this.probes.youtube();
    const youtube = this.credentialManager.getYouTubeClient();
    const response = await youtube.channels.list({ part: 'snippet,status', mine: true, maxResults: 1 });
    const channel = response.data?.items?.[0];
    if (!channel) throw new Error('A conta Google autorizada não possui um canal do YouTube');
    return {
      message: `Acesso autorizado ao canal verificado com sucesso para ${channel.snippet?.title || 'o canal conectado'}.`,
      details: { channelId: channel.id, channelTitle: channel.snippet?.title || null }
    };
  }

  async probeMetadata() {
    if (this.probes.metadata) return this.probes.metadata();
    const queue = await this.db.getPublishQueue();
    const candidates = queue.length ? queue : [{ title: 'Production readiness test', metadata: { seo: { title: 'Production readiness test', description: 'A safe local metadata validation sample for YouTube upload readiness.', tags: ['readiness', 'youtube', 'automation'], metadata: { category: 22, language: 'en' } } } }];
    const invalid = [];
    let warnings = 0;
    for (const item of candidates) {
      const result = validateYouTubeMetadata(item.metadata?.seo || item.metadata || { title: item.title });
      warnings += result.warnings.length;
      if (!result.valid) invalid.push({ productionId: item.productionId || null, title: item.title, errors: result.errors });
    }
    if (invalid.length) {
      const error = new Error(`${invalid.length} upload(s) na fila possuem metadados inválidos para o YouTube`);
      error.invalid = invalid;
      throw error;
    }
    return {
      status: warnings ? 'warning' : 'passed',
      message: queue.length ? `${queue.length} upload(s) na fila passaram na validação de metadados.` : 'Regras de metadados validadas com sucesso com amostra segura.',
      remediation: warnings ? 'Revise os títulos, descrições e tags antes de publicar.' : null,
      details: { validated: candidates.length, queued: queue.length, warnings }
    };
  }

  safeError(error) {
    return String(error?.message || 'A verificação falhou')
      .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
      .replace(/AIza[A-Za-z0-9_-]+/g, '[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
      .replace(/(access_token|refresh_token|api[_-]?key|token)=([^\s&]+)/gi, '$1=[redacted]')
      .slice(0, 500);
  }

  remediationFor(id) {
    const messages = {
      text_provider: 'Execute npm run walkthrough, verifique o modelo selecionado e confirme os créditos ou cota da API.',
      image_provider: 'Verifique o acesso a imagens pagas ou utilize a alternativa em gradiente integrada.',
      video_provider: 'Configure as credenciais do provedor selecionado, escolha apresentação local de slides ou reexecute com o teste pago de vídeo.',
      voice_narration: 'Configure OpenAI, Gemini TTS, ElevenLabs ou Azure Speech, ou utilize o Edge TTS integrado.',
      video_assembly: 'Execute npm install para restaurar o ffmpeg-static ou configure FFMPEG_PATH para um executável válido.',
      youtube_access: 'Reconecte o YouTube em npm run walkthrough e certifique-se de que a conta Google possui um canal.',
      upload_metadata: 'Edite o título, descrição, categoria, idioma e tags antes de publicar.'
    };
    return messages[id] || 'Corrija as configurações e execute novamente o teste de prontidão.';
  }
}

module.exports = { ProductionReadinessService, STALE_AFTER_MS };
