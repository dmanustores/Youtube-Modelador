const fs = require('fs').promises;
const axios = require('axios');
const { Logger } = require('./logger');

class OperatorService {
  constructor(db) {
    this.db = db;
    this.logger = new Logger('OperatorService');
  }

  async runQualityChecks(production, profile = {}) {
    const title = String(production.seo?.title || production.script?.title || '').trim();
    const description = String(production.seo?.description || '').trim();
    const tags = Array.isArray(production.seo?.tags) ? production.seo.tags : [];
    const script = String(production.script?.fullScript || '').trim();
    const finalVideo = production.assets?.finalVideo;
    const thumbnail = production.assets?.thumbnail;
    const bannedTopics = Array.isArray(profile.bannedTopics) ? profile.bannedTopics : [];
    const combinedText = `${title}\n${description}\n${script}`.toLowerCase();

    const checks = [
      this.check('title', title.length > 0 && title.length <= 100,
        title ? `Título tem ${title.length}/100 caracteres` : 'Um título é obrigatório'),
      this.check('description', description.length >= 50,
        description.length >= 50 ? 'Descrição detalhada o suficiente' : 'A descrição deve ter pelo menos 50 caracteres'),
      this.check('tags', tags.length >= 3,
        tags.length >= 3 ? `${tags.length} tags fornecidas` : 'Adicione pelo menos 3 tags relevantes', false),
      this.check('script', script.length >= 200,
        script.length >= 200 ? 'Conteúdo do roteiro está presente' : 'O roteiro está ausente ou muito curto'),
      this.check('thumbnail', Boolean(thumbnail?.path),
        thumbnail?.path ? 'Recurso de miniatura presente' : 'Miniatura ausente', false),
      this.check('video', Boolean(finalVideo?.path && !finalVideo?.simulated),
        finalVideo?.simulated
          ? 'Apenas vídeo simulado gerado (necessário áudio para gerar o MP4 real)'
          : finalVideo?.path ? 'Vídeo MP4 final está pronto' : 'Arquivo MP4 final ausente')
    ];

    const topic = String(production.strategy?.topic || '').trim();
    if (topic) {
      const duplicates = await this.db.getRow(
        `SELECT COUNT(*) AS count FROM content_strategies
         WHERE lower(trim(topic)) = lower(trim(?))
         AND created_at >= datetime('now', '-90 days')`,
        [topic]
      );
      const unique = Number(duplicates?.count || 0) <= 1;
      checks.push(this.check('duplicate_topic', unique,
        unique
          ? 'Nenhum tópico duplicado detectado nos últimos 90 dias'
          : 'Este tema exato já foi gerado recentemente', false));
    }

    if (finalVideo?.path && !finalVideo?.simulated) {
      checks.push(this.check('video_file', await this.fileExists(finalVideo.path),
        'Arquivo de vídeo final existe no disco'));
    }

    const audio = production.assets?.audio || {};
    const intentionalSilence = audio.intentionalSilence === true &&
      String(audio.silenceReason || '').trim().length >= 10 &&
      Boolean(audio.silenceConfirmedAt);
    const productionAudioReady = !audio.simulated && await this.fileExists(audio.path);
    const scenes = production.scenes || [];
    let sceneAudioReady = false;
    if (scenes.length) {
      const readiness = [];
      for (const scene of scenes) {
        readiness.push(scene.narrationStatus === 'intentional_silence' || (
          scene.narrationStatus === 'current' && await this.fileExists(scene.audioPath)
        ));
      }
      sceneAudioReady = readiness.every(Boolean);
    }
    const narrationReady = intentionalSilence || productionAudioReady || sceneAudioReady;
    checks.push(this.check('narration', narrationReady,
      intentionalSilence
        ? `Silêncio intencional confirmado: ${audio.silenceReason}`
        : narrationReady
          ? `Narração pronta${audio.provider ? ` via ${audio.provider}` : ''}`
          : audio.intentionalSilence
            ? 'O silêncio intencional requer confirmação e motivo com no mínimo 10 caracteres'
            : 'Narração ausente ou inutilizável (clique em regenerar narração nas cenas abaixo)'));

    const matchedBannedTopics = bannedTopics.filter(topic =>
      topic && combinedText.includes(String(topic).toLowerCase())
    );
    checks.push(this.check('brand_policy', matchedBannedTopics.length === 0,
      matchedBannedTopics.length
        ? `Conteúdo contém termos bloqueados: ${matchedBannedTopics.join(', ')}`
        : 'Nenhum termo de marca bloqueado detectado'));

    const provenance = production.provenance || {};
    const provenancePassed = ['verified', 'not_required'].includes(provenance.status || 'not_required');
    const unresolved = Number(provenance.summary?.unresolvedClaims || 0);
    checks.push(this.check('provenance', provenancePassed,
      provenance.status === 'verified'
        ? `${provenance.summary?.resolvedClaims || 0} afirmações factuais verificadas com evidências`
        : provenance.status === 'not_required'
          ? 'Nenhuma afirmação factual externa declarada'
          : `${unresolved} afirmação(ões) factual(is) requer(em) checagem (mude para "Verificado" abaixo)`));

    const discoverability = production.discoverability;
    if (discoverability) {
      const actionable = (discoverability.findings || []).filter(finding =>
        ['CRITICAL', 'HIGH'].includes(finding.severity) && finding.reviewStatus !== 'dismissed'
      );
      const available = discoverability.status !== 'unavailable';
      checks.push(this.check(
        'discoverability',
        available && actionable.length === 0,
        !available
          ? `Auditoria de SEO indisponível${discoverability.error ? `: ${discoverability.error}` : ''}`
          : actionable.length
            ? `${actionable.length} apontamento(s) de SEO requer(em) atenção ou dispensa`
            : `${discoverability.findings?.length || 0} apontamento(s) de SEO registrados; nenhum de alta prioridade pendente`,
        false
      ));
    }

    if (scenes.length) {
      const invalidScenes = scenes.filter(scene =>
        !scene.assetPath || ['missing_asset', 'failed', 'generating', 'needs_rebuild', 'visual_stale'].includes(scene.status) ||
        !['current', 'intentional_silence'].includes(scene.narrationStatus)
      );
      const unlicensedUploads = scenes.filter(scene => scene.assetOrigin === 'uploaded' && !scene.rightsConfirmed);
      checks.push(this.check('scene_integrity', invalidScenes.length === 0,
        invalidScenes.length === 0
          ? `${scenes.length} cena(s) reconstruída(s) e atualizada(s)`
          : `${invalidScenes.length} cena(s) ainda precisa(m) de reparo ou recompilação (clique em "Recompilar vídeo final" abaixo)`));
      checks.push(this.check('scene_rights', unlicensedUploads.length === 0,
        unlicensedUploads.length === 0
          ? 'Ativos de cenas substituídas possuem confirmação de direitos'
          : `${unlicensedUploads.length} ativo(s) de cena enviado(s) não possui(em) confirmação de direitos`));
    }

    const blockingFailures = checks.filter(check => check.blocking && !check.passed);
    return {
      passed: blockingFailures.length === 0,
      score: Math.round((checks.filter(check => check.passed).length / checks.length) * 100),
      blockingFailures: blockingFailures.map(check => check.id),
      checks
    };
  }

  check(id, passed, message, blocking = true) {
    return { id, passed: Boolean(passed), blocking, message };
  }

  async fileExists(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile() && stats.size > 0;
    } catch (_error) {
      return false;
    }
  }

  async notify(notification) {
    const enabled = await this.db.getSetting('notification_enabled');
    if (enabled === 'false') return null;

    const id = await this.db.createNotification(notification);
    const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, {
          text: `${notification.title}: ${notification.message}`,
          content: `${notification.title}: ${notification.message}`,
          ...notification
        }, { timeout: 5000 });
      } catch (error) {
        this.logger.warn(`Notification webhook failed: ${error.message}`);
      }
    }
    return id;
  }
}

module.exports = { OperatorService };
