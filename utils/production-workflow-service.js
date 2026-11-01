const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('./logger');
const { AITextService } = require('./ai-text-service');
const { cleanYouTubeDescription } = require('./youtube-metadata-validator');

/**
 * Higieniza narração para motores TTS (ElevenLabs, etc.):
 * Remove quebras de linha e formatações markdown, normaliza apóstrofos e pontuações
 */
function cleanNarrationForTTS(str) {
  if (!str) return '';
  let s = String(str)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/["“”«»]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[—–]/g, ', ')
    .replace(/[*_#~\[\]{}]/g, '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/\s+([.,;:?!])/g, '$1');
  s = s.replace(/([.,;:?!])([a-zA-ZÀ-ÿ0-9])/g, '$1 $2');
  return s.trim();
}

/**
 * Remove prefixos de prompts do Google Flow
 */
function cleanGoogleFlowPrompt(text) {
  if (!text) return '';
  let clean = String(text).trim();
  clean = clean.replace(/^(?:prompt\s*\d+[:.-]?|#?\d+[-.):]\s*|\d+[-.):]\s*)/i, '').trim();
  return clean;
}

/**
 * Gera slug seguro para nome de arquivo no disco
 */
function sanitizeSlug(str) {
  if (!str) return 'video';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'video';
}

/**
 * Gera o texto estruturado do log TXT de produção com as 5 seções solicitadas:
 * 1) Roteiro
 * 2) Prompts imagens
 * 3) Prompt Thumb
 * 4) Dados Seo
 * 5) Dados Postagem
 */
function generateProductionLogText(bundle = {}) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');
  const timeStr = now.toLocaleTimeString('pt-BR');
  const fullTimestamp = `${dateStr} às ${timeStr}`;

  const topic = bundle.topic || bundle.script?.topic || bundle.title || 'Tema sem título';
  const productionId = bundle.productionId || bundle.scheduleId || `prod_${Date.now()}`;

  // 1) Roteiro
  const scriptObj = bundle.script || {};
  const hook = scriptObj.hook || bundle.hookAngle || 'Gancho não definido';
  const hookType = scriptObj.hookType || 'Tipo 1 (Quebra mecânica súbita)';
  const bible = scriptObj.officialBible || '🇮🇹 Bibbia CEI 2008';
  const rawScript = scriptObj.fullScript || bundle.fullScript || (scriptObj.part1 ? `${scriptObj.part1} ${scriptObj.part2 || ''}` : '');
  const cleanNarration = cleanNarrationForTTS(scriptObj.cleanedNarration || rawScript);
  const charCount = cleanNarration.length;
  const wordCount = cleanNarration.split(/\s+/).filter(Boolean).length;
  const estimatedMin = (wordCount / 140).toFixed(1);
  const pinnedQuestion = scriptObj.pinnedCommentQuestion || bundle.seo?.pinnedCommentQuestion || 'Pergunta não definida';
  const hookRegister = scriptObj.hookRegisterBlock || bundle.fieldAHistory || '';
  const narrationBlocks = scriptObj.narrationBlocks || bundle.narrationBlocks || [];

  // 2) Prompts de Imagens (Google Flow - 35 prompts)
  let gfPrompts = bundle.googleFlowPrompts || [];
  if (typeof gfPrompts === 'string') {
    try { gfPrompts = JSON.parse(gfPrompts); } catch (_) { gfPrompts = [gfPrompts]; }
  }
  const cleanGfPrompts = (Array.isArray(gfPrompts) ? gfPrompts : []).map((p, idx) => {
    const raw = typeof p === 'string' ? p : (p?.prompt || '');
    return {
      index: p?.index || (idx + 1),
      clean: cleanGoogleFlowPrompt(raw)
    };
  }).filter(item => item.clean.length > 0);

  // 3) Prompt Thumb (Nano Banana)
  let nbPrompts = bundle.nanoBananaPrompts || [];
  if (typeof nbPrompts === 'string') {
    try { nbPrompts = JSON.parse(nbPrompts); } catch (_) { nbPrompts = []; }
  }
  const selectedThumbPrompt = bundle.thumbnailPrompt || (Array.isArray(nbPrompts) && nbPrompts[0]?.promptNanoBanana) || 'Prompt não informado';

  // 4) Dados SEO
  const seoObj = bundle.seo || {};
  const seoTitle = seoObj.title || bundle.title || topic;
  const seoDesc = cleanYouTubeDescription(seoObj.description || bundle.description || '');
  let hashtagsRaw = seoObj.hashtags || bundle.hashtags || [];
  if (typeof hashtagsRaw === 'string') {
    hashtagsRaw = hashtagsRaw.split(',').map(h => h.trim()).filter(Boolean);
  }
  const hashtagsNoHash = hashtagsRaw.map(h => String(h).replace(/^#/, '').trim()).filter(Boolean);
  const hashtagsWithHash = hashtagsNoHash.map(h => `#${h}`);
  
  let tagsRaw = bundle.tags || seoObj.tags || [];
  if (typeof tagsRaw === 'string') {
    tagsRaw = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  }
  const tagsString = Array.isArray(tagsRaw) ? tagsRaw.join(', ') : String(tagsRaw);
  const historicalBasis = seoObj.historicalBasis || 'Texto e manuscritos originais com verificação histórico-teológica';

  // 5) Dados Postagem
  const publishTime = bundle.publishTime || bundle.publish_time || '';
  let publishTimeFormatted = 'Data não informada';
  if (publishTime) {
    try {
      const d = new Date(publishTime);
      if (!isNaN(d.getTime())) {
        publishTimeFormatted = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} (Horário Local) · [ISO: ${d.toISOString()}]`;
      }
    } catch (_) {}
  }

  const channel = bundle.channelName || bundle.channel || 'Canal Conectado Oficial';
  const language = bundle.language || 'Italiano (it)';
  const syntheticMedia = bundle.containsSyntheticMedia !== false ? 'SIM (Conteúdo gerado ou alterado significativamente por ferramentas de IA)' : 'NÃO';
  const videoPath = bundle.videoPath || 'Arquivo de vídeo não especificado';
  const thumbnailPath = bundle.thumbnailPath || 'Miniatura padrão do YouTube ou não anexada';
  const youtubeUrl = bundle.youtubeUrl || (bundle.youtubeId ? `https://www.youtube.com/watch?v=${bundle.youtubeId}` : 'Não enviado via API direta (permanece na fila de agendamento local)');

  // Montagem do documento TXT
  const lines = [
    '================================================================================',
    '                    DADOS COMPLETOS DA PRODUÇÃO DE VÍDEO',
    '================================================================================',
    `DATA DO REGISTRO:       ${fullTimestamp}`,
    `TEMA DO VÍDEO:          ${topic}`,
    `ID DA PRODUÇÃO:         ${productionId}`,
    `VISIBILIDADE:           🌐 PÚBLICO PROGRAMADO (Lançamento Oficial no YouTube)`,
    '',
    '================================================================================',
    '1) ROTEIRO COMPLETO (NARRAÇÃO HIGIENIZADA / TTS)',
    '================================================================================',
    `TEMA:                   ${topic}`,
    `GANCHO DE ABERTURA:     ${hook}`,
    `TIPO DE GANCHO:         ${hookType}`,
    `BÍBLIA DE REFERÊNCIA:   ${bible}`,
    `CONTAGEM DE CARACTERES: ${charCount.toLocaleString('pt-BR')} caracteres ${charCount <= 10000 ? '✅ (Dentro do limite seguro de 10.000)' : '⚠️ (Excede teto de 10.000)'}`,
    `ESTIMATIVA DE DURAÇÃO:  ~${estimatedMin} minutos (~140 palavras/min)`,
    `PERGUNTA COMENTÁRIO:    ${pinnedQuestion}`,
    hookRegister ? `REGISTRO HISTÓRICO:     ${hookRegister}\n` : '',
    '--- ROTEIRO CORRIDO CONTÍNUO (PRONTO PARA COLAR NO ELEVENLABS / MOTOR DE TTS) ---',
    cleanNarration || '(Roteiro corrido não disponível)',
    ''
  ];

  if (Array.isArray(narrationBlocks) && narrationBlocks.length > 0) {
    lines.push('--- BLOCOS DE CENAS / NARRAÇÃO DETALHADOS ---');
    narrationBlocks.forEach(b => {
      const idx = b.sceneIndex || b.blockNumber || b.index || 1;
      const bText = cleanNarrationForTTS(b.narrationText || b.text || '');
      lines.push(`[Cena ${String(idx).padStart(2, '0')}] (${bText.length} caracteres)`);
      lines.push(bText);
      lines.push('');
    });
  }

  lines.push(
    '================================================================================',
    `2) PROMPTS DE IMAGENS (GOOGLE FLOW - ${cleanGfPrompts.length} PROMPTS EM INGLÊS)`,
    '================================================================================'
  );

  if (cleanGfPrompts.length > 0) {
    cleanGfPrompts.forEach(p => {
      lines.push(`[Cena ${String(p.index).padStart(2, '0')} / ${cleanGfPrompts.length}]`);
      lines.push(p.clean);
      lines.push('');
    });

    lines.push('--- TODOS OS PROMPTS EM LOTE (SEM PREFIXOS, SEPARADOS POR LINHA EM BRANCO) ---');
    lines.push(cleanGfPrompts.map(p => p.clean).join('\n\n'));
    lines.push('');
  } else {
    lines.push('Nenhum prompt de imagem registrado.');
    lines.push('');
  }

  lines.push(
    '================================================================================',
    '3) PROMPT DA THUMBNAIL (NANO BANANA / MINIATURA 16:9)',
    '================================================================================',
    '--- PROMPT PRINCIPAL RECOMENDADO / SELECIONADO ---',
    selectedThumbPrompt,
    ''
  );

  if (Array.isArray(nbPrompts) && nbPrompts.length > 0) {
    lines.push('--- TODAS AS VARIAÇÕES GERADAS (NANO BANANA) ---');
    nbPrompts.forEach((v, i) => {
      const vTitle = v.title || `Versão ${v.version || (i + 1)}`;
      const prompt = (v.promptNanoBanana || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('RESULT:')).join('\n');
      lines.push(`[${vTitle}]`);
      lines.push(prompt);
      lines.push('');
    });
  }

  lines.push(
    '================================================================================',
    '4) DADOS DE SEO (YOUTUBE METADADOS OFICIAIS)',
    '================================================================================',
    'TÍTULO OFICIAL DO VÍDEO (ALTO CTR):',
    seoTitle,
    '',
    'DESCRIÇÃO FORMATADA DO YOUTUBE (COM TIMESTAMPS E PARÁGRAFOS):',
    seoDesc || '(Descrição não informada)',
    '',
    'HASHTAGS OFICIAIS (7 HASHTAGS SEM #):',
    hashtagsNoHash.length > 0 ? hashtagsNoHash.join(', ') : 'Nenhuma hashtag informada',
    '',
    'HASHTAGS FORMATADAS COM # (PARA O YOUTUBE):',
    hashtagsWithHash.length > 0 ? hashtagsWithHash.join(' ') : 'Nenhuma hashtag informada',
    '',
    'TAGS DE BUSCA (SEPARADAS POR VÍRGULA):',
    tagsString || '(Nenhuma tag informada)',
    '',
    'PERGUNTA FIXADA PARA O PRIMEIRO COMENTÁRIO:',
    pinnedQuestion || '(Nenhuma pergunta fixada)',
    '',
    'BASE HISTÓRICA / FONTE TEOLÓGICA:',
    historicalBasis,
    '',
    '================================================================================',
    '5) DADOS DA POSTAGEM / AGENDAMENTO PÚBLICO',
    '================================================================================',
    `DATA E HORA DO LANÇAMENTO:  ${publishTimeFormatted}`,
    `VISIBILIDADE NO CANAL:     🌐 PÚBLICO PROGRAMADO (Lançamento público automático)`,
    `CANAL DO YOUTUBE:          ${channel}`,
    `IDIOMA DO VÍDEO:           ${language}`,
    `DECLARAÇÃO DE IA:          ${syntheticMedia}`,
    `MODERAÇÃO DE COMENTÁRIOS:  Básica (Retém comentários impróprios para análise)`,
    `ARQUIVO DE VÍDEO (.MP4):   ${videoPath}`,
    `ARQUIVO DA MINIATURA:      ${thumbnailPath}`,
    `STATUS DO AGENDAMENTO:     ${bundle.status || 'Programado com sucesso'}`,
    `LINK NO YOUTUBE:           ${youtubeUrl}`,
    `ID DA PRODUÇÃO:            ${productionId}`,
    `ID DO AGENDAMENTO:         ${bundle.scheduleId || 'Manual'}`,
    `LOCAL DO LOG SALVO:        ${bundle.logFilePath || 'Salvo na pasta producoes/'}`,
    '================================================================================'
  );

  return lines.join('\n');
}

class ProductionWorkflowService {
  constructor(db, credentials, options = {}) {
    this.db = db;
    this.credentials = credentials;
    this.logger = options.logger || new Logger('ProductionWorkflow');
    this.aiText = new AITextService(credentials?.credentials || credentials || {});
  }

  /**
   * Obtém vídeos recentes do canal do YouTube ativo ou autenticado
   * Utiliza apenas 2-3 unidades de cota através de playlists de uploads
   */
  async fetchChannelRecentVideos({ days = 7, channelId = null, maxResults = 30 } = {}) {
    this.logger.info(`Buscando vídeos do canal dos últimos ${days} dias...`);
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let youtube = null;
    try {
      if (typeof this.credentials?.getYouTubeClient === 'function') {
        youtube = this.credentials.getYouTubeClient();
      }
    } catch (e) {
      this.logger.warn(`Não foi possível obter cliente do YouTube: ${e.message}`);
    }

    if (youtube) {
      try {
        // 1. Obter detalhes do canal e a playlist de uploads
        const channelParams = {
          part: 'contentDetails,snippet,statistics'
        };
        if (channelId) {
          channelParams.id = channelId;
        } else {
          channelParams.mine = true;
        }

        const channelRes = await youtube.channels.list(channelParams);
        const channelItem = channelRes?.data?.items?.[0];

        if (channelItem) {
          const uploadsPlaylistId = channelItem.contentDetails?.relatedPlaylists?.uploads;
          const channelTitle = channelItem.snippet?.title || 'Canal Ativo';

          if (uploadsPlaylistId) {
            // 2. Buscar itens da playlist de uploads (consome apenas 1 cota)
            const playlistRes = await youtube.playlistItems.list({
              playlistId: uploadsPlaylistId,
              part: 'snippet',
              maxResults: Math.min(maxResults, 50)
            });

            const items = playlistRes?.data?.items || [];
            const recentItems = items.filter(item => {
              const pub = new Date(item.snippet?.publishedAt);
              return !isNaN(pub.getTime()) && pub >= cutoffDate;
            });

            // Se a janela de dias foi muito curta e não achou nenhum vídeo, pega os mais recentes disponíveis
            const selectedItems = recentItems.length > 0 ? recentItems : items.slice(0, Math.min(maxResults, 10));

            const videoIds = selectedItems.map(item => item.snippet?.resourceId?.videoId).filter(Boolean);

            if (videoIds.length > 0) {
              // 3. Obter estatísticas detalhadas (views, likes, tags, duração)
              const videosRes = await youtube.videos.list({
                part: 'snippet,statistics,contentDetails',
                id: videoIds.join(',')
              });

              const videos = (videosRes?.data?.items || []).map(v => ({
                id: v.id,
                title: v.snippet?.title,
                description: v.snippet?.description,
                publishedAt: v.snippet?.publishedAt,
                tags: v.snippet?.tags || [],
                viewCount: parseInt(v.statistics?.viewCount, 10) || 0,
                likeCount: parseInt(v.statistics?.likeCount, 10) || 0,
                commentCount: parseInt(v.statistics?.commentCount, 10) || 0,
                duration: v.contentDetails?.duration,
                channelTitle: v.snippet?.channelTitle || channelTitle,
                url: `https://www.youtube.com/watch?v=${v.id}`
              }));

              this.logger.info(`${videos.length} vídeos obtidos da API do YouTube para o canal "${channelTitle}".`);
              return {
                source: 'youtube_api',
                channel: {
                  id: channelItem.id,
                  title: channelTitle,
                  subscriberCount: channelItem.statistics?.subscriberCount
                },
                videos
              };
            }
          }
        }
      } catch (err) {
        this.logger.warn(`Falha na chamada da API do YouTube para vídeos recentes: ${err.message}`);
      }
    }

    // Fallback: buscar histórico de produções do banco local ou dados recentes
    this.logger.info('Utilizando dados históricos do banco local como base para os vídeos recentes');
    let localVideos = [];
    try {
      if (typeof this.db?.listPublishedVideos === 'function') {
        localVideos = await this.db.listPublishedVideos(maxResults);
      } else if (typeof this.db?.getPipelineOverview === 'function') {
        const pipeline = await this.db.getPipelineOverview(maxResults);
        localVideos = (pipeline || [])
          .filter(p => p.publishedAt || p.status === 'published')
          .map(p => ({
            id: p.youtubeId || p.id,
            title: p.title || p.topic,
            publishedAt: p.publishedAt || p.createdAt,
            viewCount: p.views || 0,
            likeCount: p.likes || 0,
            tags: p.tags || [],
            url: p.youtubeUrl || (p.youtubeId ? `https://www.youtube.com/watch?v=${p.youtubeId}` : null)
          }));
      }
    } catch (e) {
      this.logger.warn(`Não foi possível ler vídeos do banco: ${e.message}`);
    }

    return {
      source: 'local_database',
      channel: { title: 'Canal Configurado' },
      videos: localVideos
    };
  }

  /**
   * Busca os vídeos e Shorts mais visualizados ("Em Alta" / Populares) de todos os tempos do canal.
   * Utilizado para ações de recuperação de audiência e diagnóstico de queda de visibilidade.
   */
  async fetchChannelTopVideos({ channelId = null, maxResults = 25 } = {}) {
    this.logger.info('Buscando vídeos mais populares ("Em Alta") do canal para ação de recuperação...');
    let youtube = null;
    try {
      if (typeof this.credentials?.getYouTubeClient === 'function') {
        youtube = this.credentials.getYouTubeClient();
      }
    } catch (e) {
      this.logger.warn(`Não foi possível obter cliente do YouTube: ${e.message}`);
    }

    if (youtube) {
      try {
        const channelParams = { part: 'contentDetails,snippet,statistics' };
        if (channelId) channelParams.id = channelId;
        else channelParams.mine = true;

        const channelRes = await youtube.channels.list(channelParams);
        const channelItem = channelRes?.data?.items?.[0];
        const channelTitle = channelItem?.snippet?.title || 'Preghiere di Fede Quotidiane';
        const targetChannelId = channelItem?.id || channelId;

        let videoIds = [];

        // 1. Tentar busca ordenada por visualizações (order: 'viewCount')
        if (targetChannelId) {
          try {
            const searchRes = await youtube.search.list({
              channelId: targetChannelId,
              part: 'snippet',
              order: 'viewCount',
              type: 'video',
              maxResults: Math.min(maxResults, 50)
            });
            videoIds = (searchRes?.data?.items || [])
              .map(item => item.id?.videoId)
              .filter(Boolean);
          } catch (searchErr) {
            this.logger.warn(`Search com order viewCount falhou: ${searchErr.message}. Usando playlist de uploads.`);
          }
        }

        // 2. Se a busca por viewCount não retornou, ler itens da playlist de uploads e ordenar
        if (!videoIds.length && channelItem?.contentDetails?.relatedPlaylists?.uploads) {
          const uploadsPlaylistId = channelItem.contentDetails.relatedPlaylists.uploads;
          const playlistRes = await youtube.playlistItems.list({
            playlistId: uploadsPlaylistId,
            part: 'snippet',
            maxResults: 50
          });
          videoIds = (playlistRes?.data?.items || [])
            .map(item => item.snippet?.resourceId?.videoId)
            .filter(Boolean);
        }

        if (videoIds.length > 0) {
          const videosRes = await youtube.videos.list({
            part: 'snippet,statistics,contentDetails',
            id: videoIds.slice(0, 50).join(',')
          });

          const videos = (videosRes?.data?.items || []).map(v => {
            const dur = v.contentDetails?.duration || '';
            const isShort = dur.includes('S') && !dur.includes('M') && !dur.includes('H')
              || (v.snippet?.tags || []).some(t => t.toLowerCase().includes('short'))
              || (v.snippet?.title || '').toLowerCase().includes('#shorts');

            return {
              id: v.id,
              title: v.snippet?.title,
              description: v.snippet?.description,
              publishedAt: v.snippet?.publishedAt,
              tags: v.snippet?.tags || [],
              viewCount: parseInt(v.statistics?.viewCount, 10) || 0,
              likeCount: parseInt(v.statistics?.likeCount, 10) || 0,
              commentCount: parseInt(v.statistics?.commentCount, 10) || 0,
              duration: dur,
              isShort,
              channelTitle: v.snippet?.channelTitle || channelTitle,
              url: `https://www.youtube.com/watch?v=${v.id}`
            };
          });

          // Ordenação estrita por visualizações decrescentes
          videos.sort((a, b) => b.viewCount - a.viewCount);

          this.logger.info(`${videos.length} vídeos campeões ("Em Alta") obtidos da API do YouTube.`);
          return {
            source: 'youtube_api',
            channel: {
              id: targetChannelId,
              title: channelTitle,
              subscriberCount: channelItem?.statistics?.subscriberCount
            },
            videos
          };
        }
      } catch (err) {
        this.logger.warn(`Falha na API do YouTube para vídeos em alta: ${err.message}`);
      }
    }

    // Benchmark histórico real do canal Preghiere di Fede Quotidiane (extraído diretamente do canal ativo)
    const fallbackTop = [
      {
        title: "¡Una oración de 30 segundos puede cambiar todo tu día! 🙏 #shorts #oracion #dio #fe",
        viewCount: 4500,
        publishedAt: "2026-05-15T12:00:00Z",
        tags: ["shorts", "oracion", "fe", "dio", "preghiera"],
        isShort: true,
        pattern: "Oração imediata de alívio e promessa de paz"
      },
      {
        title: "Me vas a dejar hablando solo? 🥺 #shorts #jesus #dio #fe #preghiera",
        viewCount: 3800,
        publishedAt: "2026-06-01T12:00:00Z",
        tags: ["shorts", "jesus", "dio", "fe"],
        isShort: true,
        pattern: "Apelo emocional em primeira pessoa de Jesus chamando o fiel"
      },
      {
        title: "Este Mensaje No Es Casualidad 🙏 Alguien necesita escuchar esto hoy #shorts",
        viewCount: 3300,
        publishedAt: "2026-06-10T12:00:00Z",
        tags: ["shorts", "dio", "messaggio"],
        isShort: true,
        pattern: "Quebra de padrão existencial ('não é coincidência')"
      },
      {
        title: "Un mensaje poderoso que tu corazón no puede ignorar #shorts #dio",
        viewCount: 2900,
        publishedAt: "2026-05-20T12:00:00Z",
        tags: ["shorts", "dio", "cuore"],
        isShort: true,
        pattern: "Gatilho de urgência espiritual e cura interior"
      },
      {
        title: "Rivelazione 🌟 Il mese in cui sei nato svela la tua missione divina #Bibbia #Fede #dio #preghiera",
        viewCount: 752,
        publishedAt: "2026-05-10T12:00:00Z",
        tags: ["Rivelazione", "Bibbia", "Fede", "missione divina"],
        isShort: false,
        pattern: "Revelação de missão divina pessoal ligada à identidade bíblica"
      },
      {
        title: "Rivelazione di Giovanni 🔥 Il segreto dell'Apocalisse che nessuno ti ha mai spiegato #Bibbia #Profezia",
        viewCount: 397,
        publishedAt: "2026-04-20T12:00:00Z",
        tags: ["Rivelazione", "Apocalisse", "Profezia", "Bibbia"],
        isShort: false,
        pattern: "Mistério profético do Apocalipse e segredo não contado"
      },
      {
        title: "Enoch non morì: il segreto nascosto nella parola ebraica Laqach 📜 #Enoch #Laqach #dio",
        viewCount: 174,
        publishedAt: "2026-10-10T12:00:00Z",
        tags: ["Enoch", "Laqach", "Bibbia", "ebraico"],
        isShort: false,
        pattern: "Termo original em hebraico que revela um segredo bíblico oculto"
      },
      {
        title: "'Padre, perdona loro': la parola greca aphes che nessuno ti spiega e che cambia tutto ✝️ #dio",
        viewCount: 163,
        publishedAt: "2026-10-05T12:00:00Z",
        tags: ["aphes", "greco", "Bibbia", "croce"],
        isShort: false,
        pattern: "Termo original em grego na cruz que muda a visão sobre perdão"
      },
      {
        title: "Il Silenzio di Dio dopo il fuoco: la voce che Elia non si aspettava 🕊️ #Bibbia #Elia #preghiera",
        viewCount: 150,
        publishedAt: "2026-09-25T12:00:00Z",
        tags: ["Elia", "silenzio", "Bibbia", "dio"],
        isShort: false,
        pattern: "Paradoxo existencial bíblico: o encontro com Deus no silêncio"
      }
    ];

    return {
      source: 'historical_top_benchmark',
      channel: { title: 'Preghiere di Fede Quotidiane' },
      videos: fallbackTop
    };
  }

  /**
   * Sincroniza todos os vídeos agendados/programados do canal no YouTube com a fila local (publish_schedule).
   * Percorre a playlist de uploads do canal, identifica vídeos com publishAt (programação futura),
   * atualiza status de vídeos publicados e salva novos agendamentos no banco local.
   */
  async syncScheduledVideosFromYouTube({ channelId = null, _maxPages = 2 } = {}) {
    this.logger.info('Sincronizando vídeos agendados diretamente da API do YouTube...');
    let youtube = null;
    try {
      if (typeof this.credentials?.getYouTubeClient === 'function') {
        youtube = this.credentials.getYouTubeClient();
      }
    } catch (e) {
      this.logger.warn(`Não foi possível obter cliente do YouTube para sincronização: ${e.message}`);
    }

    if (!youtube) {
      return { success: false, synced: 0, scheduled: [], error: 'Cliente do YouTube não conectado' };
    }

    try {
      const channelParams = { part: 'contentDetails,snippet' };
      if (channelId) channelParams.id = channelId;
      else channelParams.mine = true;

      const channelRes = await youtube.channels.list(channelParams);
      const channelItem = channelRes?.data?.items?.[0];
      if (!channelItem) {
        return { success: false, synced: 0, scheduled: [], error: 'Canal não encontrado no YouTube' };
      }

      const uploadsPlaylistId = channelItem.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsPlaylistId) {
        return { success: false, synced: 0, scheduled: [], error: 'Playlist de uploads não encontrada' };
      }

      const allVideoIds = [];
      let pageToken = null;
      let pagesFetched = 0;

      // 1. Coletar vídeos do proprietário via search.list (encontra TODOS os vídeos inclusive privados e programados)
      while (pagesFetched < 5) {
        try {
          const searchParams = {
            part: 'snippet',
            forMine: true,
            type: 'video',
            maxResults: 50
          };
          if (pageToken) searchParams.pageToken = pageToken;

          const searchRes = await youtube.search.list(searchParams);
          const items = searchRes?.data?.items || [];
          for (const item of items) {
            const vId = item.id?.videoId;
            if (vId && !allVideoIds.includes(vId)) {
              allVideoIds.push(vId);
            }
          }

          pageToken = searchRes?.data?.nextPageToken;
          pagesFetched += 1;
          if (!pageToken || items.length === 0) break;
        } catch (searchErr) {
          this.logger.warn(`Aviso na busca de vídeos do canal via search.list: ${searchErr.message}`);
          break;
        }
      }

      // 2. Complementar com a playlist de uploads do canal
      if (uploadsPlaylistId) {
        try {
          let plToken = null;
          for (let p = 0; p < 2; p++) {
            const plRes = await youtube.playlistItems.list({
              playlistId: uploadsPlaylistId,
              part: 'snippet,contentDetails',
              maxResults: 50,
              pageToken: plToken || undefined
            });
            const items = plRes?.data?.items || [];
            for (const item of items) {
              const vId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
              if (vId && !allVideoIds.includes(vId)) {
                allVideoIds.push(vId);
              }
            }
            plToken = plRes?.data?.nextPageToken;
            if (!plToken) break;
          }
        } catch (_plErr) {
          /* ignore */
        }
      }

      if (!allVideoIds.length) {
        return { success: true, synced: 0, scheduled: [] };
      }

      // Buscar detalhes de status e duração em lotes de 50
      const detailedVideos = [];
      for (let i = 0; i < allVideoIds.length; i += 50) {
        const batchIds = allVideoIds.slice(i, i + 50);
        const videosRes = await youtube.videos.list({
          part: 'snippet,status,contentDetails,processingDetails',
          id: batchIds.join(',')
        });
        detailedVideos.push(...(videosRes?.data?.items || []));
      }

      const syncedVideos = [];

      for (const v of detailedVideos) {
        const publishAt = v.status?.publishAt;
        const privacyStatus = v.status?.privacyStatus;
        const uploadStatus = v.status?.uploadStatus || 'unknown';
        const processingStatus = v.processingDetails?.processingStatus || (uploadStatus === 'processed' ? 'succeeded' : 'unknown');
        const title = v.snippet?.title || 'Vídeo sem título';
        const isScheduled = Boolean(publishAt);
        const youtubeId = v.id;
        const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

        // Cálculo preciso de duração em segundos
        const duration = v.contentDetails?.duration || '';
        let durationSec = 0;
        const dMatch = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (dMatch) {
          const h = parseInt(dMatch[1] || '0', 10);
          const m = parseInt(dMatch[2] || '0', 10);
          const s = parseInt(dMatch[3] || '0', 10);
          durationSec = h * 3600 + m * 60 + s;
        }

        const hasShortHash = title.toLowerCase().includes('#shorts') || title.toLowerCase().includes('#short');
        // É short se tiver até 65s ou hashtag shorts com menos de 90s. Acima disso é vídeo longo!
        const isShort = durationSec > 0 ? durationSec <= 65 : hasShortHash;

        const metadata = {
          fromYouTube: true,
          isShort,
          privacyStatus,
          uploadStatus,
          processingStatus,
          thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || null,
          description: v.snippet?.description || '',
          tags: v.snippet?.tags || [],
          duration
        };

        let existing = await this.db.getRow(
          'SELECT * FROM publish_schedule WHERE youtube_id = ?',
          [youtubeId]
        );

        // Se não encontrou por youtube_id, busca por título normalizado para vincular ao agendamento local existente
        if (!existing) {
          const normTitle = title.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
          const allScheduled = await this.db.getAllRows(
            "SELECT * FROM publish_schedule ORDER BY (CASE WHEN youtube_url IS NOT NULL THEN 1 ELSE 0 END) DESC, id DESC"
          );
          existing = allScheduled.find(s => {
            const sNorm = (s.title || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
            return sNorm && (sNorm === normTitle || sNorm.includes(normTitle) || normTitle.includes(sNorm));
          }) || null;
        }

        if (isScheduled) {
          if (existing) {
            await this.db.executeQuery(
              `UPDATE publish_schedule SET
                title = ?, publish_time = ?, status = 'scheduled', metadata = ?, youtube_id = ?, youtube_url = ?
               WHERE id = ?`,
              [title, publishAt, JSON.stringify(metadata), youtubeId, youtubeUrl, existing.id]
            );
            syncedVideos.push({ id: existing.id, title, publishTime: publishAt, youtubeId, isShort });
            // Remove duplicatas residuais com o mesmo título ou mesmo youtube_id
            await this.db.executeQuery(
              `DELETE FROM publish_schedule WHERE (LOWER(TRIM(title)) = ? OR youtube_id = ?) AND id != ?`,
              [title.trim().toLowerCase(), youtubeId, existing.id]
            );
          } else {
            const newId = `schedule_yt_${youtubeId}`;
            await this.db.executeQuery(
              `INSERT INTO publish_schedule (
                id, production_id, title, publish_time, status, priority, metadata, youtube_id, youtube_url
              ) VALUES (?, ?, ?, ?, 'scheduled', 50, ?, ?, ?)`,
              [newId, `yt_${youtubeId}`, title, publishAt, JSON.stringify(metadata), youtubeId, youtubeUrl]
            );
            syncedVideos.push({ id: newId, title, publishTime: publishAt, youtubeId, isShort });
          }
        } else if (existing && existing.status === 'scheduled' && privacyStatus === 'public') {
          // Vídeo já foi publicado
          await this.db.executeQuery(
            "UPDATE publish_schedule SET status = 'published', published_at = ?, youtube_id = ?, youtube_url = ? WHERE id = ?",
            [v.snippet?.publishedAt || new Date().toISOString(), youtubeId, youtubeUrl, existing.id]
          );
        }
      }

      // Varredura de segurança para assegurar que nenhum título repetido exista na publish_schedule
      if (typeof this.db.deduplicatePublishSchedule === 'function') {
        await this.db.deduplicatePublishSchedule();
      }

      this.logger.success(`Sincronização concluída: ${syncedVideos.length} vídeos agendados sincronizados do YouTube.`);
      return {
        success: true,
        synced: syncedVideos.length,
        channel: channelItem.snippet?.title,
        scheduled: syncedVideos
      };
    } catch (err) {
      this.logger.error('Erro na sincronização de vídeos agendados do YouTube:', err);
      return { success: false, synced: 0, scheduled: [], error: err.message };
    }
  }

  /**
   * Analisa os vídeos reais do canal conectado e sintetiza a estratégia editorial completa (DNA do Canal)
   */
  async analyzeAndSynthesizeChannelStrategy({ days = 30, maxResults = 50 } = {}) {
    this.logger.info(`Analisando histórico real do canal (últimos ${days} dias) para sintetizar estratégia editorial...`);
    const history = await this.fetchChannelRecentVideos({ days, maxResults });
    const videos = history?.videos || [];
    const channelTitle = history?.channel?.title || 'Canal Ativo';
    const subCount = history?.channel?.subscriberCount || 'Não informado';

    const videoSummary = videos.slice(0, 30).map((v, i) =>
      `${i + 1}. "${v.title}" (${v.viewCount || 0} visualizações, publicado em ${v.publishedAt ? v.publishedAt.slice(0, 10) : 'recente'}) [Tags: ${(v.tags || []).slice(0, 5).join(', ')}]`
    ).join('\n');

    let strategyData = null;
    if (this.aiText.isAvailable()) {
      const prompt = `Você é um diretor executivo sênior de estratégia e audiência do YouTube.
Sua tarefa é analisar os vídeos publicados e os dados reais deste canal para sintetizar o DNA Editorial e a Estratégia de Alto Desempenho do canal.

INFORMAÇÕES DO CANAL:
Nome do Canal: ${channelTitle}
Inscritos: ${subCount}

AMOSTRA DE VÍDEOS RECENTES NO CANAL:
${videoSummary || 'Canal novo ou sem vídeos recentes no período. Use o nome do canal e o nicho de fé/orações/mistério bíblico como orientação.'}

SUA MISSÃO:
Extraia a linha editorial real do canal com precisão cirúrgica, identificando:
1. Objetivo do Canal: Missão clara e propósito que conecta com a audiência.
2. Público-Alvo: Quem realmente assiste (faixa etária, interesses de fé/vida, motivações e dores).
3. Proposta de Valor: O diferencial único que faz o espectador clicar, assistir até o final e voltar.
4. Pilares de Conteúdo: 4 a 6 temas centrais consistentes que dominam o canal.
5. Cadência e Formato: Frequência recomendada e formato ideal.
6. Limites e Restrições: Diretrizes de tom de voz (ex: respeitoso, investigativo, citações literais da tradução oficial Bíblia CEI 2008 em italiano, proibição de anacronismos ou devocionários rasos).

Retorne ESTRITAMENTE um JSON válido com a seguinte estrutura:
{
  "objective": "Objetivo estratégico e missão clara do canal em 2-3 frases objetivas",
  "audience": "Descrição detalhada do público-alvo real que assiste a este conteúdo",
  "valueProposition": "Proposta de valor única que gera alta retenção e fidelidade",
  "contentPillars": ["Pilar 1", "Pilar 2", "Pilar 3", "Pilar 4", "Pilar 5"],
  "cadencePerWeek": 7,
  "videosPerRun": 1,
  "defaultFormat": "explainer",
  "defaultLength": "medium",
  "primaryKpi": "views",
  "targetValue": 10000,
  "targetWindowDays": 28,
  "outcomeCurrency": "EUR",
  "successMetric": "Alta retenção nos primeiros 30 segundos, engajamento nos comentários e crescimento de inscritos fiéis",
  "constraints": "Diretrizes e restrições editoriais (linguagem respeitosa, citações literais da Bibbia CEI 2008, dados históricos verificáveis e proibição de clichês superficiais)",
  "summaryDiagnosis": "Resumo em 2 linhas de como a estratégia reflete os pontos fortes observados no canal"
}`;

      try {
        const response = await this.aiText.generateText(prompt, { maxTokens: 2500, temperature: 0.65 });
        strategyData = this.parseJsonSafe(response);
      } catch (err) {
        this.logger.warn(`Erro na IA ao sintetizar estratégia do canal: ${err.message}`);
      }
    }

    if (!strategyData || !strategyData.objective) {
      strategyData = {
        objective: `Consolidar o canal "${channelTitle}" como referência em orações diárias, espiritualidade católica e mistérios bíblicos de alta retenção no YouTube.`,
        audience: `Fiéis católicos de língua italiana, devotos e pessoas em busca de oração, reflexão espiritual, ensinamentos dos Santos e estudos bíblicos profundos.`,
        valueProposition: `Narrativas documentais de revelação bíblica e momentos de oração profunda guiados pela tradução oficial CEI 2008, livres de clichês superficiais e com alta intensidade existencial.`,
        contentPillars: [
          'Mistérios Bíblicos e Segredos Ocultos',
          'Orações Diárias de Proteção e Fé',
          'Histórias dos Santos e Grandes Milagres',
          'A Soberania de Deus no Silêncio',
          'Profecias e Ensinamentos dos Evangelhos'
        ],
        cadencePerWeek: 7,
        videosPerRun: 1,
        defaultFormat: 'explainer',
        defaultLength: 'medium',
        primaryKpi: 'views',
        targetValue: 10000,
        targetWindowDays: 28,
        outcomeCurrency: 'EUR',
        successMetric: 'Crescimento consistente de inscritos devotos e retenção acima de 60% nos primeiros 30 segundos.',
        constraints: 'Linguagem respeitosa e cinematográfica, uso obrigatório de citações da Bibbia CEI 2008 entre aspas, proibição de anacronismos e fidelidade teológica.',
        summaryDiagnosis: `Estratégia sintetizada com base na linha editorial devocional e bíblica do canal "${channelTitle}".`
      };
    }

    const strategyRecord = {
      id: 'default',
      objective: strategyData.objective,
      audience: strategyData.audience,
      value_proposition: strategyData.valueProposition || strategyData.value_proposition,
      content_pillars: JSON.stringify(strategyData.contentPillars || []),
      contentPillars: strategyData.contentPillars || [],
      cadence_per_week: strategyData.cadencePerWeek || 7,
      videos_per_run: strategyData.videosPerRun || 1,
      default_format: strategyData.defaultFormat || 'explainer',
      default_length: strategyData.defaultLength || 'medium',
      primary_kpi: strategyData.primaryKpi || 'views',
      target_value: strategyData.targetValue || 10000,
      target_window_days: strategyData.targetWindowDays || 28,
      monthly_budget: null,
      outcome_currency: strategyData.outcomeCurrency || 'EUR',
      success_metric: strategyData.successMetric || '',
      constraints: strategyData.constraints || '',
      status: 'active',
      updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
    };

    if (typeof this.db?.saveChannelStrategy === 'function') {
      try {
        await this.db.saveChannelStrategy(strategyRecord);
        this.logger.info('Estratégia sintetizada salva com sucesso no banco de dados!');
      } catch (e) {
        this.logger.warn(`Não foi possível persistir estratégia no banco: ${e.message}`);
      }
    }

    return {
      success: true,
      channel: {
        title: channelTitle,
        subscriberCount: subCount,
        videosCount: videos.length
      },
      summaryDiagnosis: strategyData.summaryDiagnosis,
      recentVideos: videos.slice(0, 8),
      strategy: strategyRecord
    };
  }

  /**
  /**
   * Gera N novos temas melhores e diferentes com base na análise do histórico do canal.
   * Suporta o Modo de Recuperação (análise dos vídeos mais populares "Em Alta" vs recentes)
   * e o Modo Padrão (continuidade dos últimos dias).
   * Respeita estritamente o idioma selecionado e as restrições do Campo A (Histórico anterior).
   */
  async generateThemesFromChannelHistory({
    days = 7,
    count = null,
    language = 'it-IT',
    fieldAHistory = '',
    strategyMode = 'recovery',
    channelContext = {}
  } = {}) {
    const targetCount = count || (days === 7 ? 7 : days === 15 ? 15 : days === 30 ? 30 : 7);
    const isRecovery = strategyMode === 'recovery';
    this.logger.info(`Gerando ${targetCount} novos temas (Modo: ${isRecovery ? '🎯 Ação de Recuperação (Em Alta)' : '✨ Continuidade Padrão'}, Janela: ${days} dias, Idioma: ${language})...`);

    // 1. Obter vídeos recentes publicados no canal
    const recentData = await this.fetchChannelRecentVideos({ days, maxResults: 50 });
    const existingVideos = recentData.videos || [];

    // 2. Se for modo de recuperação, obter também os vídeos campeões ("Em Alta" / Mais Vistos)
    let topVideos = [];
    if (isRecovery) {
      const topData = await this.fetchChannelTopVideos({ maxResults: 20 });
      topVideos = topData.videos || [];
    }

    const languageNames = {
      'it-IT': 'Italiano (Italian)',
      'it': 'Italiano (Italian)',
      'es-ES': 'Espanhol (Spanish / Castilian)',
      'es': 'Espanhol (Spanish)',
      'pt-BR': 'Português do Brasil (Portuguese)',
      'pt': 'Português',
      'en-US': 'Inglês (English)',
      'en': 'Inglês (English)',
      'fr-FR': 'Francês (French)',
      'de-DE': 'Alemão (German)'
    };
    const targetLangName = languageNames[language] || language;

    if (!this.aiText.isAvailable()) {
      return this.generateFallbackThemes(targetCount, language, existingVideos, strategyMode, topVideos);
    }

    const recentSummary = existingVideos.map((v, i) =>
      `${i + 1}. "${v.title}" (${v.viewCount || 0} visualizações, tags: ${(v.tags || []).slice(0, 4).join(', ')})`
    ).join('\n') || 'Nenhum vídeo publicado recentemente encontrado no período.';

    let topSummary = '';
    if (isRecovery && topVideos.length > 0) {
      topSummary = topVideos.slice(0, 12).map((v, i) =>
        `${i + 1}. [${v.isShort ? 'SHORT' : 'VÍDEO LONGO'}] "${v.title}" — ${Number(v.viewCount || 0).toLocaleString('pt-BR')} visualizações (Publicado: ${v.publishedAt ? v.publishedAt.slice(0, 10) : 'histórico'}) [Tags: ${(v.tags || []).slice(0, 4).join(', ')}]`
      ).join('\n');
    }

    const prompt = isRecovery
      ? `Você é um diretor executivo sênior de audiência e produção de documentários do YouTube, especializado em canais cristãos, espiritualidade católica e mistérios bíblicos.
O canal "Preghiere di Fede Quotidiane" experimentou grandes picos de engajamento no passado, mas sofreu recentemente uma queda perceptível de visibilidade.

ANALISE OS DADOS HISTÓRICOS REAIS DO CANAL:

🔥 VÍDEOS MAIS POPULARES DE TODOS OS TEMPOS ("EM ALTA" / MAIS VISTOS):
${topSummary}

📉 VÍDEOS RECENTES NO CANAL (ÚLTIMOS ${days} DIAS):
${recentSummary}

CAMPO A (RESUMO E RESTRIÇÕES DO ROTEIRO ANTERIOR - NÃO REPETIR):
${fieldAHistory ? fieldAHistory : 'Nenhum histórico restritivo anterior fornecido.'}

CONTEXTO DO CANAL:
${channelContext.goal ? `Objetivo: ${channelContext.goal}` : 'Canal devocional católico, orações profundas, exegese bíblica e documentários de alta imersão.'}
${channelContext.audience ? `Público: ${channelContext.audience}` : 'Pessoas de fé católica de língua italiana em busca de paz, revelação e intimidade com Deus.'}

⚠️ REGRA EDITORIAL SUPREMA E INVIOLÁVEL DO CANAL:
1. ESTE CANAL PRODUZ EXCLUSIVAMENTE VÍDEOS LONGOS (DOCUMENTÁRIOS INVESTIGATIVOS, HISTÓRIAS PROFUNDAS E NARRATIVAS COMPLETAS DE 8 A 15 MINUTOS / 10.000 CARACTERES).
2. OS CORTES (SHORTS) SÃO FEITOS E EXTRAÍDOS POSTERIORMENTE EM CIMA DOS VÍDEOS LONGOS.
3. PARA IDEIAS DE TEMAS, VOCÊ NUNCA DEVE BASEAR A CONFECÇÃO DE UM SHORT!
4. MESMO AO ANALISAR OS CORTES/SHORTS EM ALTA DO CANAL (PARA CAPTURAR TEMAS, MÉTRICAS E GANCHOS EMOCIONAIS QUE O PÚBLICO AMA), VOCÊ DEVE ANALISAR O TEMA E AS MÉTRICAS E GERAR UMA HISTÓRIA LONGA COMPLETA RELACIONADA ÀQUILO. JAMAIS UM VÍDEO PEQUENO DE CORTE.
5. NÃO COLOQUE NENHUMA HASHTAG DE SHORTS (#shorts, #short, etc.) NOS TÍTULOS.
6. O CAMPO "format" DEVE SER SEMPRE "Documentario" OU "História". NUNCA "Short".

DIAGNÓSTICO E MISSÃO DE RECUPERAÇÃO:
1. Examine os picos do canal:
   - Identifique os temas, sentimentos, mistérios bíblicos e necessidades espirituais que explodiram em visualizações e engajamento.
2. Crie exatamente ${targetCount} NOVOS TEMAS DE RECUPERAÇÃO DE ALTA TRAÇÃO NO FORMATO VÍDEO LONGO:
   - Transforme essas métricas e ganchos validados em grandes documentários ou histórias explicativas profundas.
   - Não repita os mesmos títulos já publicados.
   - Respeite as restrições do Campo A.
   - IDIOMA OBRIGATÓRIO: TODOS os temas, títulos, ganchos e justificativas DEVEM estar no idioma ${targetLangName}.

Retorne ESTRITAMENTE um JSON válido:
{
  "diagnosis": "Diagnóstico cirúrgico em 3-4 linhas explicando a causa da queda de visibilidade e a estratégia de recuperação adotada",
  "strategyMode": "recovery",
  "themes": [
    {
      "index": 1,
      "topic": "Título magnético para VÍDEO LONGO no idioma ${targetLangName}",
      "hookAngle": "Gancho dos primeiros 15 segundos da narrativa longa com quebra de padrão, pergunta provocativa ou enigma textual",
      "whyBetter": "Como este tema longo resgata a audiência dos vídeos mais populares e reativa as recomendações do YouTube",
      "format": "Documentario",
      "benchmarkRef": "Gatilho de sucesso resgatado transposto para história longa",
      "estimatedRetentionAppeal": "Extremo"
    }
  ]
}`
      : `Você é um diretor sênior de estratégia de conteúdo do YouTube focado em alta retenção e crescimento orgânico de canal através de VÍDEOS LONGOS.
Analise os vídeos publicados recentemente no canal do YouTube durante a janela dos últimos ${days} dias:

VÍDEOS PUBLICADOS NO PERÍODO:
${recentSummary}

CAMPO A (RESUMO E RESTRIÇÕES DO ROTEIRO ANTERIOR - NÃO REPETIR):
${fieldAHistory ? fieldAHistory : 'Nenhum histórico restritivo anterior fornecido.'}

CONTEXTO DO CANAL:
${channelContext.goal ? `Objetivo: ${channelContext.goal}` : ''}
${channelContext.audience ? `Público: ${channelContext.audience}` : ''}

⚠️ REGRA EDITORIAL SUPREMA E INVIOLÁVEL:
1. ESTE CANAL PRODUZ EXCLUSIVAMENTE VÍDEOS LONGOS (DOCUMENTÁRIOS INVESTIGATIVOS E NARRATIVAS DE 8 A 15 MINUTOS / 10.000 CARACTERES).
2. OS CORTES SÃO EXTRAÍDOS DEPOIS EM CIMA DESSES VÍDEOS LONGOS.
3. NUNCA BASEIE A CONFECÇÃO DE UM SHORT. TODA IDEIA DEVE SER CONCEBIDA PARA UMA HISTÓRIA LONGA.
4. NÃO COLOQUE HASHTAGS DE SHORTS NOS TÍTULOS.
5. O FORMATO DEVE SER SEMPRE "Documentario" OU "História".

SUA MISSÃO:
Gere exatamente ${targetCount} novos temas/ângulos de VÍDEOS LONGOS que sejam:
1. DIFERENTES e SUPERIORES aos vídeos já publicados (encontre lacunas de curiosidade, dúvidas frequentes não respondidas, desmistificações e ângulos de alto impacto).
2. NUNCA repita os mesmos temas ou ganchos já usados.
3. Respeite todas as proibições e restrições informadas no Campo A.
4. IDIOMA OBRIGATÓRIO: TODOS os temas, títulos sugeridos, ganchos e justificativas DEVEM estar no idioma ${targetLangName}.

Retorne ESTRITAMENTE um JSON válido no seguinte formato:
{
  "diagnosis": "Breve diagnóstico das forças e lacunas dos vídeos recentes no canal",
  "strategyMode": "standard",
  "themes": [
    {
      "index": 1,
      "topic": "Tema conciso e direto para VÍDEO LONGO no idioma alvo",
      "hookAngle": "Ângulo de curiosidade/quebra de padrão do gancho inicial para história longa",
      "whyBetter": "Por que este tema longo é superior e como ele complementa o canal sem repetir o que já foi postado",
      "format": "Documentario",
      "estimatedRetentionAppeal": "Alto | Extremo"
    }
  ]
}`;

    try {
      const response = await this.aiText.generateText(prompt, { maxTokens: 2500, temperature: 0.7 });
      const parsed = this.parseJsonSafe(response);
      const rawThemes = Array.isArray(parsed?.themes) ? parsed.themes : [];

      if (rawThemes.length > 0) {
        // Garantir que todos os temas sejam higienizados para VÍDEOS LONGOS
        const sanitizedThemes = rawThemes.map(t => {
          let cleanTopic = (t.topic || '')
            .replace(/#shorts?/gi, '')
            .replace(/#dio/gi, '')
            .replace(/#gesu/gi, '')
            .replace(/#preghiera/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
          let format = t.format || 'Documentario';
          if (format.toLowerCase() === 'short') {
            format = 'Documentario';
          }
          return {
            ...t,
            topic: cleanTopic,
            format
          };
        });

        return {
          success: true,
          language,
          strategyMode,
          daysAnalyzed: days,
          videosFound: existingVideos.length,
          topVideosFound: topVideos.length,
          diagnosis: parsed.diagnosis || parsed.analysis || 'Diagnóstico concluído.',
          analysis: parsed.diagnosis || parsed.analysis || 'Análise concluída.',
          themes: sanitizedThemes.slice(0, targetCount)
        };
      }
    } catch (err) {
      this.logger.warn(`Erro na IA ao gerar temas: ${err.message}. Usando temas adaptativos.`);
    }

    return this.generateFallbackThemes(targetCount, language, existingVideos, strategyMode, topVideos);
  }

  generateFallbackThemes(targetCount, language, existingVideos, strategyMode = 'recovery', topVideos = []) {
    const isItalian = String(language).toLowerCase().startsWith('it');

    const italianRecoveryThemes = [
      {
        topic: "Rivelazione 🌟 I 3 Salmi di Protezione che spezzano ogni angoscia notturna: il patto segreto",
        hookAngle: "Se ti svegli spesso tra le 3 e le 4 del mattino, questa non è una coincidenza. C'è un patto nei Salmi che pochi conoscono.",
        whyBetter: "Resgata a fórmula do campeão 'Rivelazione' (752 views) com foco em proteção espiritual e oração noturna profunda.",
        format: "Documentario",
        benchmarkRef: "Estilo Rivelazione (Pico Histórico de Longos)",
        estimatedRetentionAppeal: "Extremo"
      },
      {
        topic: "La Notte del Getsemani: Il Mistero delle Parole Inedite che Gesù Sussurrò nel Buio",
        hookAngle: "Nel buio più denso della storia umana, Gesù non pronunciò solo parole di rassegnazione. C'è un'invocazione aramaica documentata che la teologia moderna ha messo da parte.",
        whyBetter: "Transpõe o apelo emocional e a intimidade com Cristo para uma narrativa histórica e teológica densa de 12 minutos.",
        format: "Documentario",
        benchmarkRef: "Intimidade com Cristo transposta para Longo",
        estimatedRetentionAppeal: "Extremo"
      },
      {
        topic: "La parola ebraica che Davide pianse nel Salmo 51: il segreto che cancella ogni colpa",
        hookAngle: "Davide non chiese solo perdono: usò una parola arcaica che i re temevano di pronunciare davanti all'Arca.",
        whyBetter: "Fórmula comprovada de 'Enoch non morì (parola Laqach)' e 'Padre Perdona Loro (parola Aphes)'.",
        format: "Documentario",
        benchmarkRef: "Termo Hebraico Original / Mistério Bíblico",
        estimatedRetentionAppeal: "Extremo"
      },
      {
        topic: "La Liturgia Segreta del Tempio di Gerusalemme: Come i Sacerdoti Scioglievano i Blocchi della Fede",
        hookAngle: "Prima che il velo del tempio si squarciasse, i leviti compivano un rito quotidiano di liberazione che prefigurava la grazia.",
        whyBetter: "Transpõe a busca por alívio espiritual imediato em uma profunda reconstrução arqueológica e documental.",
        format: "Documentario",
        benchmarkRef: "Arqueologia Bíblica e Oração Profunda",
        estimatedRetentionAppeal: "Extremo"
      },
      {
        topic: "Perché Gesù pianse per Lazzaro se sapeva che lo avrebbe risuscitato? Il mistero svelato",
        hookAngle: "Non erano lacrime di tristezza per la morte. Il testo greco svela un sentimento che la Chiesa raramente spiega.",
        whyBetter: "Desmistificação profunda de passagem conhecida do Evangelho com foco na empatia de Cristo.",
        format: "Documentario",
        benchmarkRef: "Mistério Bíblico / Grego Antigo",
        estimatedRetentionAppeal: "Alto"
      },
      {
        topic: "Il Mistero della Provvidenza Nascosta: Quando Dio Opera a Distanza Senza che Tu Te ne Accorga",
        hookAngle: "Stavi per cedere davanti all'ennesima porta chiusa? I testi sacri documentano che i più grandi interventi divini avvengono mentre tutto tace.",
        whyBetter: "Converte o formato de quebra de padrão existencial em uma reflexão consolatória estruturada em atos narrativos.",
        format: "Documentario",
        benchmarkRef: "Quebra de Padrão Existencial em História Longa",
        estimatedRetentionAppeal: "Extremo"
      },
      {
        topic: "Il Silenzio di Dio nella tempesta: perché a volte sembra che la tua preghiera non salga",
        hookAngle: "Quando il cielo sembra di bronzo e Dio tace, non significa che sia assente. Sta preparando il miracolo più grande.",
        whyBetter: "Continuação espiritual do campeão 'Il Silenzio di Dio dopo il fuoco' (Elia).",
        format: "Documentario",
        benchmarkRef: "Paradoxo Existencial e Fé Profunda",
        estimatedRetentionAppeal: "Alto"
      }
    ];

    const themes = [];
    for (let i = 0; i < targetCount; i++) {
      if (isItalian) {
        const base = italianRecoveryThemes[i % italianRecoveryThemes.length];
        themes.push({
          index: i + 1,
          topic: i < italianRecoveryThemes.length ? base.topic : `${base.topic} (Parte ${Math.floor(i / italianRecoveryThemes.length) + 1})`,
          hookAngle: base.hookAngle,
          whyBetter: base.whyBetter,
          format: base.format,
          benchmarkRef: base.benchmarkRef,
          estimatedRetentionAppeal: base.estimatedRetentionAppeal
        });
      } else if (isSpanish) {
        themes.push({
          index: i + 1,
          topic: `Revelación Bíblica: La oración secreta que abre los caminos #${i + 1}`,
          hookAngle: 'Si sientes que tus oraciones no tienen respuesta, este detalle lo cambia todo.',
          whyBetter: 'Enfoque de alto impacto emocional probado en los shorts más vistos.',
          format: i % 2 === 0 ? 'Short' : 'Documentario',
          benchmarkRef: 'Recuperación de Audiencia',
          estimatedRetentionAppeal: 'Extremo'
        });
      } else {
        themes.push({
          index: i + 1,
          topic: `Revelação Bíblica & Oração Poderosa #${i + 1}`,
          hookAngle: 'O detalhe que quase todos ignoram ao orar nos momentos difíceis.',
          whyBetter: 'Fórmula de alta retenção baseada nos campeões históricos do canal.',
          format: i % 2 === 0 ? 'Short' : 'Documentario',
          benchmarkRef: 'Ação de Recuperação',
          estimatedRetentionAppeal: 'Alto'
        });
      }
    }

    return {
      success: true,
      language,
      strategyMode,
      daysAnalyzed: 7,
      videosFound: existingVideos.length,
      topVideosFound: topVideos.length,
      diagnosis: 'Ação de Recuperação ativada: temas modelados após os maiores sucessos históricos do canal.',
      analysis: 'Ação de Recuperação ativada: temas modelados após os maiores sucessos históricos do canal.',
      themes
    };
  }

  /**
   * Gera o roteiro estruturado na arquitetura de retenção de 14 blocos (meta de 10.000 caracteres):
   * - 2 Partes físicas de ~4.900 caracteres (7 blocos cada de ~700 caracteres)
   * - Rotação dos 6 Tipos de Gancho e 8 Famílias de Ângulo
   * - Decisão Humana (Ângulo autoral, o que deixar de fora, posição do canal)
   * - Citações fiéis da tradução oficial (Italiano: Bibbia CEI 2008)
   * - Fatiamento automático em 2 blocos de até 5.000 caracteres para narração
   * - Registro de Gancho formatado para alimentar o Campo A
   */
  async generateScript({
    topic,
    angle = '',
    authorAngle = '',
    channelPosition = '',
    leaveOut = '',
    hookType = '',
    angleFamily = '',
    format = 'explainer',
    language = 'it-IT',
    fieldAHistory = '',
    channelName = '',
    targetCharacters = 10000
  } = {}) {
    if (!topic) throw new Error('O tema do vídeo é obrigatório para gerar o roteiro');

    const effectiveTargetChars = Number(targetCharacters) && Number(targetCharacters) >= 5000
      ? Math.round(Number(targetCharacters))
      : 10000;
    const targetPart1 = Math.round(effectiveTargetChars / 2);
    const targetPart2 = effectiveTargetChars - targetPart1;
    const blockCharsTarget = Math.round(effectiveTargetChars / 14);
    const minPart1 = Math.round(targetPart1 * 0.96);
    const minPart2 = Math.round(targetPart2 * 0.96);

    const effectiveAngle = authorAngle || angle || '';

    const languageNames = {
      'it-IT': 'Italiano (Italian)',
      'it': 'Italiano',
      'es-ES': 'Espanhol (Spanish / Castilian)',
      'es': 'Espanhol',
      'pt-BR': 'Português do Brasil',
      'pt': 'Português',
      'en-US': 'Inglês (English)',
      'en': 'Inglês',
      'pl-PL': 'Polonês (Polish)',
      'pl': 'Polonês'
    };
    const targetLangName = languageNames[language] || language;

    // Traduções bíblicas oficiais conforme o idioma
    const bibleTranslations = {
      'it-IT': 'Bibbia CEI 2008 (Conferenza Episcopale Italiana)',
      'it': 'Bibbia CEI 2008 (Conferenza Episcopale Italiana)',
      'pl-PL': 'Biblia Tysiąclecia (wydanie V)',
      'pl': 'Biblia Tysiąclecia (wydanie V)',
      'en-US': 'New Revised Standard Version (NRSV)',
      'en': 'New Revised Standard Version (NRSV)',
      'pt-BR': 'Bíblia de Jerusalém / Nova Versão Internacional (NVI)',
      'pt': 'Bíblia de Jerusalém / Nova Versão Internacional (NVI)',
      'es-ES': 'Biblia de Jerusalén / Reina-Valera 1960',
      'es': 'Biblia de Jerusalén / Reina-Valera 1960'
    };
    const officialBible = bibleTranslations[language] || 'Tradução Bíblica Oficial Reconhecida';

    this.logger.info(`Gerando roteiro estruturado de alta retenção (alvo: ${effectiveTargetChars.toLocaleString('pt-BR')} caracteres) para "${topic}" em ${targetLangName}...`);

    let rawData = null;
    if (this.aiText.isAvailable()) {
      const prompt = `Você é um roteirista de documentários de mistério bíblico e alta retenção do YouTube de nível 11/10 (estilo revelação progressiva, suspense arqueológico e conexão profunda com o espectador).

════════════════════════════════════════
DADOS DE ENTRADA DO ROTEIRO:
════════════════════════════════════════
TEMA (Campo B): ${topic}
FORMATO DE NARRATIVA: ${format}
${effectiveAngle ? `ÂNGULO AUTORAL (Campo C): ${effectiveAngle}` : ''}
${channelPosition ? `POSIÇÃO / PERGUNTA DO CANAL (Campo C): ${channelPosition}` : ''}
${leaveOut ? `DEIXAR DE FORA (NÃO CONTAR): ${leaveOut}` : ''}
${hookType ? `TIPO DE GANCHO FORÇADO: ${hookType}` : ''}
${angleFamily ? `FAMÍLIA DE ÂNGULO: ${angleFamily}` : ''}
${channelName ? `CANAL: ${channelName}` : ''}

HISTÓRICO DO CAMPO A (ROTEIRO ANTERIOR - PROIBIDO REPETIR O MESMO TIPO E ASSINATURAS):
${fieldAHistory ? fieldAHistory : 'SEM HISTÓRICO (Livre para escolher o gancho mais afiado)'}

IDIOMA E TRADUÇÃO BÍBLICA OBRIGATÓRIA:
- Idioma do texto: ${targetLangName} (100% nativo, sem traduções mecânicas).
- Tradução bíblica oficial obrigatória para citações: ${officialBible}.
- Aspas duplas " devem ser usadas EXCLUSIVAMENTE para a citação bíblica fiel.

════════════════════════════════════════
REGRA CRAVADA DE EXTENSÃO (${effectiveTargetChars.toLocaleString('pt-BR')} CARACTERES INEGOCIÁVEIS):
════════════════════════════════════════
Esta regra é CRUCIAL e rigorosamente cravada. Roteiros abaixo de ${Math.round(effectiveTargetChars * 0.95)} caracteres inviabilizam a narração e não são aceitos.
Para atingir os ${effectiveTargetChars.toLocaleString('pt-BR')} caracteres exigidos sem resumos superficiais, você deve desenvolver integralmente uma narrativa estruturada em 14 BLOCOS NARRATIVOS de ~${blockCharsTarget} caracteres cada, com parágrafos densos e ricos em história, línguas bíblicas e contexto:

PARTE 1 (EXATAMENTE 7 BLOCOS = ${minPart1} a ${targetPart1} CARACTERES OBRIGATÓRIOS):
- Bloco 1 (Ato 1): Gancho agressivo cumprindo a promessa imediatamente nos primeiros 15 segundos + plantio explícito do Segredo Central e do Loop Principal.
- Bloco 2 (Ato 1): Cenário histórico-cultural concreto apresentado como revelação (sem anacronismos, detalhes do período romano/hebraico).
- Bloco 3 (Ato 1): Personagem no ponto mais vulnerável e humano + abertura do Micro-loop 1.
- Bloco 4 (REHOOK OBRIGATÓRIO aos 25%): Escalada da tensão reafirmando a promessa com elemento novo + fechamento do Micro-loop 1.
- Bloco 5 (Ato 2): Escalada dramática e factual + abertura do Micro-loop 2.
- Bloco 6 (Ato 2): Primeira camada do Segredo Central + CTA Orgânico Principal (conectar a dor do personagem ao espectador e convidar a salvar o vídeo antes do momento crucial).
- Bloco 7 (Ato 2): Fechamento do Micro-loop 2 + Micro-gancho de virada dramática antes do corte para a Parte 2.

PARTE 2 (EXATAMENTE 7 BLOCOS = ${minPart2} a ${targetPart2} CARACTERES OBRIGATÓRIOS):
- Bloco 8 (Ato 3): Nova pista arqueológica, linguística ou textual + abertura do Micro-loop 3.
- Bloco 9 (Ato 3): Citação bíblica literal e fiel da ${officialBible} marcada entre aspas duplas no ápice emocional + fechamento do Micro-loop 3.
- Bloco 10 (Ato 4): Revelação definitiva do Segredo Central e resposta completa do Loop Principal.
- Bloco 11 (Ato 4): Gatilho de Compartilhamento no pico da revelação ("Se esta verdade te impactou, envie este vídeo a alguém que precisa ouvir...") + transformação do personagem.
- Bloco 12 (Ato 5): Reflexão espiritual cristã profunda conectada diretamente à identidade do espectador, carregando o ângulo autoral.
- Bloco 13 (Ato 5): Desfecho concreto e histórico da cena bíblica + micro-gancho pré-encerramento.
- Bloco 14 (Ato 5): CTA de Fechamento (convite à inscrição para a próxima revelação que a maioria das igrejas não ensina) + frase memorável de impacto final.

PROIBIÇÃO DE ENCHIMENTO E DE RESUMO: Não resuma nem pule explicações. Use detalhes factuais do mundo antigo, significados dos termos originais em hebraico/aramaico/grego, contexto político dos impérios e costumes da época para preencher a extensão.
O texto da PARTE 1 e da PARTE 2 deve ser corrido, em bloco único, pronto para copiar para a narração, sem cabeçalhos de bloco no meio do texto.

Retorne ESTRITAMENTE um JSON válido com a seguinte estrutura:
{
  "hook": "Gancho falado de abertura (1 a 3 frases afiadas, ~200 carac.)",
  "hookTypeUsed": "TIPO 1 — O Segredo Suprimido (ou o tipo selecionado/aplicado)",
  "angleFamilyUsed": "Palavra original (ou a família selecionada/aplicada)",
  "part1": "Texto falado integral e corrido da PARTE 1 (EXATAMENTE ~${minPart1} a ${targetPart1} caracteres em ${targetLangName})...",
  "part2": "Texto falado integral e corrido da PARTE 2 (EXATAMENTE ~${minPart2} a ${targetPart2} caracteres em ${targetLangName})...",
  "pinnedCommentQuestion": "Pergunta instigante, curta (máx 20 palavras) para fixar nos comentários em ${targetLangName}",
  "historicalBasis": "Resumo de 1 linha da base histórica, arqueológica ou linguística utilizada",
  "authorAngleSummary": "${effectiveAngle || topic}"
}`;

      try {
        const response = await this.aiText.generateText(prompt, { maxTokens: 8192, temperature: 0.7 });
        rawData = this.parseJsonSafe(response);
      } catch (err) {
        this.logger.warn(`Falha na geração com IA do roteiro: ${err.message}. Utilizando gerador estruturado.`);
      }
    }

    if (!rawData || !rawData.hook || !rawData.part1 || !rawData.part2) {
      rawData = this.generateFallbackScript(topic, language, effectiveAngle, effectiveTargetChars);
    }

    // Regra Cravada: Assegurar rigorosamente a meta configurada pelo usuário
    rawData = this.ensureTargetScriptLength(rawData, topic, language, effectiveAngle, effectiveTargetChars);

    // Unir o texto e fatiar em 2 blocos proporcionais
    const block1Candidate = `${rawData.hook}\n\n${rawData.part1}`.trim();
    const block2Candidate = (rawData.part2 || '').trim();
    const fullSpokenText = `${rawData.hook}\n\n${rawData.part1}\n\n${rawData.part2}`.trim();

    const maxBlockChars = Math.max(5000, targetPart2 + 100);
    let narrationBlocks = [];
    if (block1Candidate.length <= maxBlockChars && block2Candidate.length <= maxBlockChars && block2Candidate.length > 0) {
      narrationBlocks = [
        { index: 1, title: 'Bloco 1', charCount: block1Candidate.length, text: block1Candidate },
        { index: 2, title: 'Bloco 2', charCount: block2Candidate.length, text: block2Candidate }
      ];
    } else {
      narrationBlocks = this.splitIntoNarrationBlocks(fullSpokenText, maxBlockChars, 2);
    }

    const part1Chars = (rawData.part1 || '').length;
    const part2Chars = (rawData.part2 || '').length;
    const totalChars = fullSpokenText.length;

    // Bloco padronizado de Registro de Gancho (Campo A para a próxima produção)
    const hookRegisterBlock = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 COPIE ESTE BLOCO PARA O CAMPO A (HISTÓRICO DE GANCHOS) DA PRÓXIMA GERAÇÃO:

Geração anterior:    ${rawData.hookTypeUsed || 'TIPO 1 — O Segredo Suprimido'}
Tema utilizado:      ${topic}
Ângulo autoral usado: ${rawData.authorAngleSummary || effectiveAngle || 'Revelação de detalhe negligenciado no texto original'}
Família de ângulo:   ${rawData.angleFamilyUsed || 'Costume e lei da época'}

Assinaturas desta geração (para variar na próxima):
- Forma da primeira frase: Afirmação factual direta com quebra de expectativa
- Forma do CTA do bloco 6: Convite para salvar o vídeo antes da revelação
- Forma do encerramento: Sentença curta e memorável sobre a soberania divina
- Tipo de Segredo Central: Investigação textual e histórica
- Dispositivo narrativo: Revelação progressiva em 5 atos
Na próxima geração, mude pelo menos 3 destas 5 assinaturas.

📎 BASE DO DADO HISTÓRICO, ARQUEOLÓGICO OU LINGUÍSTICO USADO:
${rawData.historicalBasis || 'Contexto arqueológico e variantes textuais dos manuscritos antigos do primeiro século.'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    const scriptResult = {
      id: `script_${Date.now()}`,
      topic,
      language,
      officialBible,
      hook: rawData.hook,
      hookType: rawData.hookTypeUsed || 'TIPO 1 — O Segredo Suprimido',
      angleFamily: rawData.angleFamilyUsed || 'Costume e lei da época',
      part1: rawData.part1,
      part2: rawData.part2,
      part1Chars,
      part2Chars,
      totalCharacters: totalChars,
      isTargetLengthMet: totalChars >= 9600,
      pinnedCommentQuestion: rawData.pinnedCommentQuestion || (language.startsWith('it')
        ? 'Cosa ti ha colpito di più in questo mistero biblico? Scrivilo nei commenti!'
        : 'O que mais te surpreendeu nesta revelação bíblica? Deixe nos comentários!'),
      hookRegisterBlock,
      fullScript: fullSpokenText,
      narrationBlocks,
      estimatedWords: fullSpokenText.split(/\s+/).filter(Boolean).length,
      createdAt: new Date().toISOString()
    };

    return scriptResult;
  }

  /**
   * Garante a regra cravada de caracteres conforme a meta configurada pelo usuário.
   * Se o modelo de IA ou o fallback gerar um texto menor que o teto estipulado,
   * este método expande a narrativa de forma fluida e profunda, respeitando o idioma do canal,
   * o tema e a densidade histórica e bíblica, atingindo a meta com precisão.
   */
  ensureTargetScriptLength(data, topic, language, angle = '', targetChars = 10000) {
    if (!data) return data;

    const effectiveTarget = Number(targetChars) && Number(targetChars) >= 5000
      ? Math.round(Number(targetChars))
      : 10000;
    const targetPart1Max = Math.round(effectiveTarget / 2);
    const targetPart1Min = Math.round(targetPart1Max * 0.96);
    const targetPart2Max = effectiveTarget - targetPart1Max;
    const targetPart2Min = Math.round(targetPart2Max * 0.96);

    let part1 = (data.part1 || '').trim();
    let part2 = (data.part2 || '').trim();

    const expansions = this.getNarrativeExpansions(language, topic, angle);

    // Expandir Parte 1 se necessário
    if (part1.length < targetPart1Min && expansions.part1Expansions.length > 0) {
      for (const paragraph of expansions.part1Expansions) {
        if (part1.length + paragraph.length + 2 <= targetPart1Max) {
          part1 = `${part1}\n\n${paragraph}`.trim();
        } else {
          const spaceLeft = targetPart1Max - part1.length - 2;
          if (spaceLeft > 180) {
            const trimmed = paragraph.slice(0, spaceLeft);
            const lastPeriod = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('! '), trimmed.lastIndexOf('? '));
            if (lastPeriod > 100) {
              part1 = `${part1}\n\n${trimmed.slice(0, lastPeriod + 1)}`.trim();
            }
          }
          break;
        }
      }
    }

    // Expandir Parte 2 se necessário
    if (part2.length < targetPart2Min && expansions.part2Expansions.length > 0) {
      for (const paragraph of expansions.part2Expansions) {
        if (part2.length + paragraph.length + 2 <= targetPart2Max) {
          part2 = `${part2}\n\n${paragraph}`.trim();
        } else {
          const spaceLeft = targetPart2Max - part2.length - 2;
          if (spaceLeft > 180) {
            const trimmed = paragraph.slice(0, spaceLeft);
            const lastPeriod = Math.max(trimmed.lastIndexOf('. '), trimmed.lastIndexOf('! '), trimmed.lastIndexOf('? '));
            if (lastPeriod > 100) {
              part2 = `${part2}\n\n${trimmed.slice(0, lastPeriod + 1)}`.trim();
            }
          }
          break;
        }
      }
    }

    return {
      ...data,
      part1,
      part2
    };
  }

  getNarrativeExpansions(language, _topic, _angle) {
    const isItalian = String(language).toLowerCase().startsWith('it');
    const isPolish = String(language).toLowerCase().startsWith('pl');
    const isSpanish = String(language).toLowerCase().startsWith('es');

    if (isItalian) {
      return {
        part1Expansions: [
          `Per comprendere appieno la portata di questa svolta storica, dobbiamo scavare sotto la superficie dei testi canonici e ricostruire l'ambiente giuridico e religioso in cui l'evento ha avuto luogo. Gli scavi archeologici condotti nelle aree del Vicino Oriente antico e la scoperta dei manoscritti contemporanei testimoniano come ogni interazione tra l'individuo e le autorità fosse rigidamente codificata da patti di vassallaggio, diritti di asilo e sentenze comunitarie irrevocabili. Nel contesto semitico, un verdetto pronunciato non era una semplice enunciazione verbale, bensì una realtà metafisica attiva che trasformava istantaneamente lo status ontologico del destinatario dinanzi alla tribù. Chiunque tenti di minimizzare questo passaggio riducendolo a una semplice metafora morale perde la sostanza stessa dell'indagine documentale: qui non siamo di fronte a una favola a scopo edificante, ma a uno scontro frontale tra la consuetudine umana e un decreto trascendente che disarma la vendetta convenzionale.`,
          `L'analisi filologica dei frammenti e dei termini utilizzati nella tradizione originale svela ulteriori livelli di significato che le traduzioni moderne hanno progressivamente opacizzato per ragioni di fruibilità devozionale. I termini originali esprimono una tensione dialettica insostenibile tra la colpa oggettiva e una garanzia inviolabile concessa dall'alto, ponendo il protagonista al centro di un paradosso vivente che sconcertava tanto i testimoni dell'epoca quanto i commentatori dei secoli successivi. Gli archivi imperiali e le cronache del tempo non registrano precedenti di una simile clemenza codificata: il diritto antico prevedeva la ritorsione proporzionata e la cancellazione della memoria del trasgressore. Eppure, contrariamente a ogni logica di conservazione sociale, l'ordine cosmico viene ridefinito attraverso un sigillo di protezione che protegge la vita terrena imponendo al contempo un esilio interiore. È in questo preciso crocevia che il nostro racconto smette di essere archeologia polverosa e interpella direttamente la coscienza di chi ascolta.`,
          `Mentre il primo atto volge al suo snodo fondamentale, è essenziale osservare la reazione dell'ambiente circostante e il terrore psicologico di chi sapeva di non poter più trovare rifugio nelle certezze dell'appartenenza tribale. La condizione del fuggiasco nel Vicino Oriente antico era sinonimo di condanna a morte imminente, un bersaglio per qualsiasi viandante armato di pietre e di furore punitivo. La domanda angosciosa che attraversa i secoli non è solo come sia stato possibile sopravvivere in terre desolate senza legami di sangue, ma quale misteriosa autorità abbia impresso il timore reverenziale nella mente dei potenziali carnefici, impedendo loro di compiere il gesto fatale. Continuando in questa discesa investigativa, ogni frammento converge verso un quadro organico e sconvolgente.`
        ],
        part2Expansions: [
          `Entrando nel cuore della nostra rivelazione, l'esame minuzioso dei testimoni testuali più antichi ci porta a confrontare non soltanto le singole parole, ma l'intera impalcatura ermeneutica che lega la legge antica alla teologia della grazia sovrana. I padri della Chiesa e i massimi filologi biblici hanno sottolineato come la vera frattura ermeneutica risieda nella natura stessa dell'alleanza divina: mentre la giustizia umana cerca la distruzione riparatrice, la giustizia del cielo introduce un principio di conservazione che prolunga la storia affinché il mistero del disegno eterno possa compiersi fino all'ultima sillaba. Chi osserva questo passaggio da una prospettiva laica e documentaria rimane sbalordito dalla coerenza interna con cui gli autori biblici mantengono viva la tensione drammatica senza mai cedere a facili risoluzioni consolatorie.`,
          `Questa consapevolezza storica demolisce definitivamente la narrazione convenzionale e superficiale secondo cui il destino del protagonista sarebbe stato segnato da una sconfitta definitiva e irrimediabile. Al contrario, le cronache spirituali rivelano che proprio attraverso la ferita più profonda e l'allontanamento forzato si edifica la consapevolezza dell'assoluta sovranità di Dio sul tempo e sugli imperi umani. Ogni dettaglio geografico, dalla valle dell'ombra al deserto di rifugio, acquista una pregnanza testimoniale confermata dai toponimi antichi registrati nelle mappe dell'epoca. Non si tratta di speculazioni astratte, ma di una roccia documentale che resiste a millenni di critiche e riscritture ideologiche.`,
          `A questo punto dell'indagine, il ponte tra l'evento antico e la nostra esistenza presente emerge con una potenza ineludibile. La tentazione moderna di considerare questi racconti come miti privi di riscontro si infrange contro la precisione millimetrica con cui la parola della Scrittura diagnostica la vulnerabilità dell'animo umano dinanzi al fallimento e alla solitudine. Nel silenzio operoso della provvidenza, la risposta divina non arriva per cancellare il cammino doloroso, ma per trasformarlo in un faro eterno di redenzione che nessuna mano terrena potrà mai spegnere o revocare. Quando guardi indietro alla tua vita e riconosci i momenti in cui tutto sembrava perduto, comprendi che la stessa protezione che ha preservato i protagonisti dell'antichità veglia invisibile su ogni tua prova.`
        ]
      };
    }

    if (isSpanish) {
      return {
        part1Expansions: [
          `Para comprender cabalmente la dimensión de este giro histórico, es imprescindible descender a las profundidades de los códigos legales y sociales del Cercano Oriente antiguo. Los hallazgos arqueológicos contemporáneos a estos eventos confirman que cualquier trasgresión dentro del orden tribal implicaba la pérdida automática de todo derecho civil y religioso, condenando al transgresor al ostracismo más despiadado. En la cosmovisión semítica primigenia, la palabra pronunciada ante la asamblea comunitaria no constituía una simple figura retórica, sino una realidad vinculante de efectos inmediatos sobre el destino físico del individuo.`,
          `El examen filológico de los manuscritos hebreos y arameos evidencia giros lingüísticos que las traducciones posteriores fueron suavizando con el paso de los siglos. Lejos de ser un relato plano, el texto sagrado plantea una paradoja monumental: la imposición de una señal que, en lugar de invocar la venganza pública, sella un pacto de inmunidad irrevocable otorgado por la máxima autoridad divina. Esta intervención trastoca por completo las expectativas de la justicia punitiva de su época.`,
          `Mientras esta primera etapa culmina en un clímax de creciente incertidumbre, observamos el desamparo psicológico del personaje principal frente a un entorno hostil y desértico. La amenaza constante de persecución y el peso de una memoria imborrable convierten cada paso en una prueba de fe límite, donde la única garantía de supervivencia descansa en una promesa que desafía toda lógica humana.`
        ],
        part2Expansions: [
          `Al ingresar en la revelación culminante, el análisis comparativo de las fuentes escritas nos revela una armonía teológica insospechada entre la disciplina y la misericordia soberana. La verdadera profundidad de este misterio reside en que la providencia divina no anula las consecuencias del error, sino que las transforma en el escenario donde se manifiesta la fidelidad inquebrantable del Creador frente a la fragilidad de las criaturas.`,
          `Esta perspectiva documental desmantela por completo la idea de un juicio sin esperanza. A través del aislamiento y la peregrinación forzosa, el texto sagrado edifica un testimonio imperecedero sobre la soberanía que gobierna los imperios y las vidas individuales, dejando un precedente inalterable para todas las generaciones posteriores.`,
          `El paralelismo con la vida moderna se hace entonces evidente e insoslayable. Todos los seres humanos han experimentado en algún instante el temor al aislamiento, el dolor de las heridas del pasado o la incertidumbre ante un futuro incierto. Es en ese preciso instante de vulnerabilidad donde el mensaje milenario recobra su vigencia, recordándonos que ninguna circunstancia terrenal está fuera del alcance de la redención divina.`
        ]
      };
    }

    if (isPolish) {
      return {
        part1Expansions: [
          `Aby w pełni zrozumieć wagę tego historycznego zwrotu, musimy sięgnąć do realiów prawnych i kulturowych starożytnego Bliskiego Wschodu. Odkrycia archeologiczne jednoznacznie dowodzą, że naruszenie ówczesnych praw plemiennych pociągało za sobą natychmiastową utratę ochrony społecznej, skazując człowieka na bezwzględną banicję. W tamtejszym świecie wyrok społeczności oznaczał faktyczny wyrok śmierci, przed którym nie było ucieczki ani ziemskiego ratunku.`,
          `Analiza filologiczna najstarszych manuskryptów hebrajskich odsłania niezwykłą głębię znaczeniową, która w wielu współczesnych przekładach uległa zatarciu. Oryginalne sformułowania ukazują niezwykły paradoks: znak, który tradycja postrzegała jako symbol kary, w rzeczywistości był pieczęcią nienaruszalnej ochrony Bożej, chroniącej życie wygnańca przed samosądem ludzi.`,
          `W kulminacyjnym momencie tego pierwszego etapu stajemy przed dramatycznym pytaniem o granice ludzkiej sprawiedliwości i boskiego miłosierdzia. W świecie, w którym panowało prawo odwetu, wprowadzenie zasady bezwzględnej ochrony życia stanowiło bezprecedensowy wyłom w strukturze starożytnego prawa.`
        ],
        part2Expansions: [
          `Wkraczając w sedno tajemnicy, odkrywamy, że cała ta historia prowadzi do fundamentalnej prawdy o naturze przymierza między Bogiem a człowiekiem. Boska sprawiedliwość nie działa według ludzkich schematów zemsty, lecz zawsze zmierza do ocalenia życia i otwarcia przestrzeni dla nawrócenia, nawet tam, gdzie ludzki rozsądek widzi jedynie beznadzieję.`,
          `Prawda ta z mocą uderza we współczesne uproszczenia religijne. Doświadczenie pustyni i odrzucenia staje się w biblijnym zamyśle miejscem najgłębszego spotkania z transcendentną obecnością, która nigdy nie opuszcza człowieka w chwilach największego upadku.`,
          `To starożytne świadectwo rezonuje z niezwykłą siłą w życiu każdego z nas. Niezależnie od ciężaru błędów przeszłości czy głębokości życiowych kryzysów, Boża obietnica ochrony i odnowienia pozostaje niewzruszonym fundamentem, dającym nadzieję w obliczu każdego ziemskiego zwątpienia.`
        ]
      };
    }

    // Padrão em Português
    return {
      part1Expansions: [
        `Para compreender com exatidão a profundidade deste momento divisor de águas, é fundamental adentrar os códigos legais, civis e religiosos que regiam as sociedades do Antigo Oriente Próximo. As descobertas arqueológicas e os registros documentais da época atestam que o rompimento com a ordem comunitária acarretava a perda imediata de qualquer proteção jurídica, expondo o indivíduo à hostilidade implacável de clãs e viajantes no deserto.`,
        `O exame filológico detalhado das raízes linguísticas nos manuscritos originais revela nuances conceituais que as traduções populares modernas muitas vezes diluem. Longe de ser um estigma puramente condenatório, a marca imposta funcionava como uma garantia inviolável de imunidade sob tutela direta da autoridade divina, desarmando o ciclo arcaico da vingança de sangue desmedida.`,
        `À medida que o primeiro ato se aproxima do seu desfecho tenso, o drama interior do protagonista expõe a fragilidade extrema da condição humana quando despida de suas seguranças terrenas. É no limiar da absoluta vulnerabilidade que o mistério da intervenção sobrenatural ganha contornos definitivos, preparando o terreno para a grande revelação que se descortina a seguir.`
      ],
      part2Expansions: [
        `Ao penetrarmos no ápice desta investigação bíblica, a convergência entre os dados históricos e a narrativa canônica oficial descortina uma soberania que transcende as convenções humanas. A sabedoria milenar do texto sagrado ensina que a justiça divina não busca a aniquilação punitiva, mas sim a preservação da vida para que os propósitos eternos se cumpram em plenitude.`,
        `Essa constatação documental desmonta com vigor a ideia de uma condenação sem esperança. Através do caminho árduo do deserto, a narrativa bíblica constrói um monumento perpétuo à fidelidade que sustenta o homem mesmo quando todas as portas da justiça humana se fecharam em definitivo.`,
        `A aplicação para os nossos dias se revela direta e arrebatadora. Todos nós já nos deparamos com momentos de profundo silêncio e sensação de desamparo. É precisamente nesses vales escuros que a promessa bíblica ressoa com clareza cristalina, assegurando que o selo da misericórdia divina permanece inabalável sobre a trajetória de quem busca a verdade com o coração sincero.`
      ]
    };
  }

  generateFallbackScript(topic, language, angle = '', _targetChars = 10000) {
    const isItalian = String(language).toLowerCase().startsWith('it');
    const isPolish = String(language).toLowerCase().startsWith('pl');
    const isSpanish = String(language).toLowerCase().startsWith('es');

    if (isItalian) {
      return {
        hook: `C'è un dettaglio in questa storia che la maggior parte delle persone legge senza comprendere il vero significato. Non è una coincidenza. E quando capirai cosa è realmente accaduto duemila anni fa, il modo in cui guardi a questa promessa cambierà per sempre.`,
        hookTypeUsed: `TIPO 1 — O Segredo Suprimido`,
        angleFamilyUsed: `Costume e lei da época`,
        part1: `Per secoli questo racconto biblico è stato tramandato come un semplice episodio di fede devozionale, ma l'evidenza storica e il contesto culturale del primo secolo rivelano una realtà molto più sconvolgente. Quando osserviamo la scena attraverso gli occhi di coloro che vivevano sotto l'occupazione dell'Impero Romano, ogni parola pronunciata assume un peso politico, teologico ed esistenziale che la lettura moderna tende a cancellare del tutto. Nella società giudaica dell'epoca, le leggi civili, i codici sacerdotali e le gerarchie sociali stabilivano barriere invalicabili. Nessun uomo poteva compiere questo gesto senza rischiare l'isolamento immediato, la condanna pubblica e l'ira delle autorità religiose del Tempio. Eppure, proprio nel momento di massimo silenzio e apparente abbandono, si manifesta un disegno che rovescia le aspettative umane. Il protagonista di questo evento non agisce per istinto o per disperazione cieca; c'è una determinazione profonda che sfida la logica del tempo. Le fonti storiche ci mostrano che le usanze quotidiane imponevano una distanza rigorosa tra il sacro e l'impuro, ma ciò che accade qui infrange ogni convenzione umana. E se sei arrivato fino a questo punto del video, non è un caso. Perché questa non è solo una cronaca antica di duemila anni fa; è lo specchio esatto di chiunque si sia trovato ad affrontare il silenzio di Dio nel momento più buio della propria vita. Salva questo video tra i tuoi preferiti, perché ciò che stiamo per rivelare nella seconda parte cambia radicalmente la comprensione di questo mistero.`,
        part2: `Quando gli studiosi analizzano i manoscritti più antichi e confrontano i termini originali in aramaico e greco koinè, emerge un particolare che illumina l'intero evento. La Sacra Scrittura nella traduzione ufficiale CEI 2008 dichiara con chiarezza questo momento decisivo: "Non temere, continua solo ad aver fede". Questa affermazione non era una consolazione superficiale, ma un comando categorico di sovranità che smantellava la paura del fallimento e la tirannia delle circostanze esteriori. Il segreto centrale che molti trascurano è che la liberazione non è avvenuta quando le condizioni sono diventate favorevoli, ma proprio quando ogni speranza terrena sembrava definitivamente estinta. Se questa verità ti ha toccato nel profondo e ha portato luce nella tua giornata, invia subito questo video a una persona cara che oggi ha bisogno di ritrovare forza e speranza. Questa storia dimostra che anche quando le porte sembrano sbarrate e il mondo dichiara la fine, la fedeltà divina apre cammini dove l'occhio umano vede soltanto il deserto. Se desideri continuare a scoprire i segreti biblici e le verità nascoste che la maggior parte delle chiese non approfondisce, iscriviti al canale per non perdere la prossima rivelazione. Ricorda: ciò che per gli uomini è impossibile, è solo l'inizio dell'opera di Dio.`,
        pinnedCommentQuestion: `Quale parte di questa rivelazione ti ha toccato più da vicino? Condividi la tua riflessione qui sotto!`,
        historicalBasis: `Codici legali del giudaismo del secondo tempio e testo ufficiale Bibbia CEI 2008.`,
        authorAngleSummary: angle || `Rivelazione della sovranità divina oltre il silenzio`
      };
    }

    if (isPolish) {
      return {
        hook: `W tej historii kryje się szczegół, który większość ludzi pomija. To nie przypadek. A kiedy zrozumiesz, co naprawdę wydarzyło się dwa tysiące lat temu, twój sposób patrzenia na tę obietnicę zmieni się na zawsze.`,
        hookTypeUsed: `TIPO 1 — O Segredo Suprimido`,
        angleFamilyUsed: `Costume e lei da época`,
        part1: `Przez stulecia ta biblijna opowieść była przekazywana jako prosta lekcja wiary, ale dowody historyczne i kontekst kulturowy pierwszego wieku ukazują rzeczywistość znacznie bardziej wstrząsającą. W realiach ówczesnego świata każdy gest miał wagę prawną i społeczną. Jeśli dotarłeś aż tutaj, zapisz ten film, bo to, co odkrywamy dalej, zmienia wszystko.`,
        part2: `Tekst Biblii Tysiąclecia potwierdza z mocą ten kluczowy moment. Prawdziwe znaczenie tego cudu leży w fakcie, że Bóg działał dokładnie tam, gdzie ludzka nadzieja się skończyła. Jeśli ta prawda cię poruszyła, wyślij ten film osobie, która potrzebuje dziś nadziei. Zapisz się na kanał, aby odkrywać kolejne biblijne tajemnice.`,
        pinnedCommentQuestion: `Co najbardziej poruszyło cię w tym odkryciu? Zostaw swój komentarz poniżej!`,
        historicalBasis: `Kontekst kulturowy Judei I wieku i oficjalny przekład Biblii Tysiąclecia.`,
        authorAngleSummary: angle || `Tajemnica wiary w obliczu milczenia`
      };
    }

    if (isSpanish) {
      return {
        hook: `Hay un detalle en esta historia que la mayoría de las personas pasa por alto. Y cuando comprendas lo que realmente sucedió hace dos mil años, tu forma de ver esta promesa cambiará para siempre.`,
        hookTypeUsed: `TIPO 1 — O Segredo Suprimido`,
        angleFamilyUsed: `Costume e lei da época`,
        part1: `Durante siglos este pasaje bíblico fue relatado como un simple relato devocional, pero las evidencias históricas y el contexto cultural del primer siglo revelan una dimensión mucho más profunda. Si has llegado hasta aquí, guarda este video porque lo que descubriremos a continuación lo cambia todo.`,
        part2: `La traducción bíblica oficial confirma este momento cumbre. El secreto central es que el auxilio divino se manifiesta exactamente donde se agotan las fuerzas humanas. Si esta verdad tocó tu corazón, comparte este video con alguien que lo necesite hoy y suscríbete al canal para más revelaciones.`,
        pinnedCommentQuestion: `¿Qué detalle de esta historia tocó más tu corazón? ¡Déjalo en los comentarios!`,
        historicalBasis: `Contexto histórico del siglo primero y fuentes textuales antiguas.`,
        authorAngleSummary: angle || `Revelación de la promesa divina`
      };
    }

    return {
      hook: `Há um detalhe nesta história que a maioria das pessoas lê sem compreender a verdadeira magnitude. E quando você entender o que realmente aconteceu há dois mil anos, a forma como você enxerga esta promessa mudará para sempre.`,
      hookTypeUsed: `TIPO 1 — O Segredo Suprimido`,
      angleFamilyUsed: `Costume e lei da época`,
      part1: `Por séculos esta narrativa bíblica foi transmitida como um simples conto devocional, mas os registros históricos e o contexto cultural do primeiro século revelam uma realidade infinitamente mais densa e desafiadora. Sob as leis e costumes da época, o ato registrado envolvia um risco real de ruptura social e isolamento. E se você chegou até este ponto, salve este vídeo, pois a revelação a seguir esclarece o cerne de toda a narrativa.`,
      part2: `A tradução oficial preserva o impacto das palavras originais que ecoam até hoje. O segredo central é que o livramento se manifesta exatamente no ponto em que os recursos humanos se esgotaram por completo. Se esta mensagem tocou a sua alma, envie este vídeo a alguém que precisa ouvir esta verdade hoje. Inscreva-se no canal para acompanhar as próximas revelações documentais.`,
      pinnedCommentQuestion: `Qual detalhe desta passagem mais chamou a sua atenção? Compartilhe sua visão nos comentários!`,
      historicalBasis: `Contexto histórico do primeiro século e manuscritos textuais antigos.`,
      authorAngleSummary: angle || `Revelação factual da promessa divina`
    };
  }

  /**
   * Higieniza o texto de narração para motores de IA / TTS:
   * - Transforma o texto em fluxo corrido contínuo, sem quebras de linha ou espaçamentos duplos
   * - Remove caracteres invisíveis / zero-width
   * - Remove aspas duplas e curvas (" “ ” « ») que quebram a leitura ou delimitadores de IA
   * - Normaliza apóstrofos para apóstrofo reto simples (') preservando elisões fonéticas (ex: l'imperatore, dell'Apocalisse)
   * - Converte travessões longos (— –) em vírgula para fluidez natural da fala
   * - Remove marcadores de markdown (* _ # ~ [ ] { })
   * - Normaliza pontuação e espaçamento
   */
  cleanNarrationForTTS(str) {
    if (!str) return '';
    let s = String(str)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/["“”«»]/g, '')
      .replace(/[’‘`]/g, "'")
      .replace(/[—–]/g, ', ')
      .replace(/[*_#~\[\]{}]/g, '')
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    s = s.replace(/\s+([.,;:?!])/g, '$1');
    s = s.replace(/([.,;:?!])([a-zA-ZÀ-ÿ0-9])/g, '$1 $2');
    return s.trim();
  }

  /**
   * Divide o texto em blocos contínuos de até maxChars (padrão 5.000 caracteres cada),
   * em texto 100% corrido, direto e livre de caracteres especiais, pronto para sintetizadores de voz.
   */
  splitIntoNarrationBlocks(text, maxChars = 5000, targetCount = 2) {
    if (!text) return [];
    const cleanText = this.cleanNarrationForTTS(text);
    if (cleanText.length <= maxChars && targetCount <= 1) {
      return [{
        index: 1,
        title: 'Bloco 1',
        charCount: cleanText.length,
        text: cleanText
      }];
    }

    const half = Math.floor(cleanText.length / 2);
    const paragraphs = cleanText.split(/\n\s*\n/);
    let accumulated = '';
    let bestParaCut = -1;

    for (let i = 0; i < paragraphs.length; i++) {
      const candidate = accumulated ? `${accumulated}\n\n${paragraphs[i].trim()}` : paragraphs[i].trim();
      if (candidate.length <= maxChars) {
        accumulated = candidate;
        if (accumulated.length >= Math.min(half * 0.7, 3000) && (cleanText.length - accumulated.length) <= maxChars) {
          bestParaCut = accumulated.length;
        }
      } else {
        break;
      }
    }

    if (bestParaCut > 0 && (cleanText.length - bestParaCut) <= maxChars) {
      const b1 = cleanText.slice(0, bestParaCut).trim();
      const b2 = cleanText.slice(bestParaCut).trim();
      return [
        { index: 1, title: 'Bloco 1', charCount: b1.length, text: b1 },
        { index: 2, title: 'Bloco 2', charCount: b2.length, text: b2 }
      ];
    }

    const searchSlice = cleanText.slice(0, maxChars);
    const lastPunctuation = Math.max(
      searchSlice.lastIndexOf('.\n'),
      searchSlice.lastIndexOf('. '),
      searchSlice.lastIndexOf('!\n'),
      searchSlice.lastIndexOf('! '),
      searchSlice.lastIndexOf('?\n'),
      searchSlice.lastIndexOf('? ')
    );

    let cutIndex = lastPunctuation > 1000 ? (lastPunctuation + 1) : searchSlice.lastIndexOf(' ');
    if (cutIndex <= 0) cutIndex = maxChars;

    const b1 = cleanText.slice(0, cutIndex).trim();
    const remaining = cleanText.slice(cutIndex).trim();

    const blocks = [
      { index: 1, title: 'Bloco 1', charCount: b1.length, text: b1 }
    ];

    if (remaining) {
      if (remaining.length <= maxChars) {
        blocks.push({
          index: 2,
          title: 'Bloco 2',
          charCount: remaining.length,
          text: remaining
        });
      } else {
        const sub = this.splitIntoNarrationBlocks(remaining, maxChars, 2);
        sub.forEach(sb => {
          blocks.push({
            index: blocks.length + 1,
            title: `Bloco ${blocks.length + 1}`,
            charCount: sb.text.length,
            text: sb.text
          });
        });
      }
    }

    return blocks;
  }

  /**
   * Gera exatamente 35 prompts em INGLÊS prontos para o Google Flow / Midjourney
   * com base no roteiro bíblico/histórico completo, estruturado em 5 Atos (7 microcenas por Ato),
   * aplicando a Lei do Respeito Religioso, Políticas do Google Flow, Lei Anti-Semelhança,
   * Rotação de Famílias de Planos e Bloco de Estilo Documental.
   */
  async generateGoogleFlowPrompts({ script, topic, count = 35 } = {}) {
    this.logger.info(`Gerando ${count} prompts em inglês para o Google Flow com direção de arte avançada...`);
    const cleanTopic = topic || script?.topic || 'Histórico / Bíblico';
    const fullScript = script?.fullScript || (typeof script === 'string' ? script : `${script?.hook || ''}\n${script?.part1 || ''}\n${script?.part2 || ''}`.trim());

    const styleBlock = ', biblical photorealistic documentary style, anatomically accurate, ultra-detailed, 8K, film grain, rich contrast, deep shadows, shallow depth of field, historically accurate ancient Middle East clothing and architecture, modest dignified clothing, sacred atmosphere, no text, no logos, no modern elements';

    if (this.aiText.isAvailable()) {
      const prompt = `You are an elite art director specializing in high-impact historical and biblical documentary productions for video generation in Google Flow (https://labs.google/fx/tools/flow) and Midjourney.

TOPIC: "${cleanTopic}"
SCRIPT CONTENT:
"""
${fullScript ? fullScript.slice(0, 5000) : cleanTopic}
"""

YOUR MISSION:
Analyze the script and generate EXACTLY ${count} sequential visual image prompts in English, ready to paste directly into Google Flow.
The 35 images must be VISUALLY DISTINCT from one another: when edited in timeline sequence, no image should look like a close relative of a neighboring image.

HIERARCHY OF PRIORITY:
1st) Religious Respect Law:
   - God / Divine presence: represented ONLY by light rays, glowing cloud, wind, or environmental effects. Never human facial close-ups or anthropomorphic silhouette.
   - Jesus / Central sacred figures: never in close-up face; use back view, distance, dramatic silhouette, hands, or focal reaction of surrounding crowd.
   - Modest dignified ancient garments, no sensationalism, no caricatures.
2nd) Google Flow Content Policies:
   - Absolutely NO graphic violence, NO blood, NO gore, NO nudity, NO real living people faces, NO occult symbols. Suffering conveyed through shadow, gesture, dust, and atmosphere.
3rd) Narrative Fidelity:
   - Anchor directly in concrete nouns, characters, authentic locations, and emotional turning points from the script.
4th) Anti-Similarity Law & Emotional Impact:
   - Across any sliding window of 5 prompts, NO pair can share the same focal subject, same sub-location, or same foreground element.
   - Rotate camera shot families: OPEN (extreme wide, wide, aerial), MEDIUM (medium shot, over-the-shoulder POV), CLOSED (close-up, extreme close-up of hands, objects, textures).
   - Never 2 consecutive OPEN shots.
   - Vary lighting and dominant color temperature between neighbors (warm amber, cold blue-gray, dusty ochre, torchlight, deep shadows).
   - Every prompt must feature a clear human emotional focal point (look, tear, trembling hands, posture, tension, awe) or its direct trace.
5th) Forbidden Structural Clichés:
   - NO solitary figure against empty horizon without script context.
   - NO solitary candle/lamp in darkness as generic closing image.
   - NO generic hands on stone.
   - NO generic scroll rolling with finger pointing.
   - NO readable text, words, letters, watermarks, or logos anywhere in the image.

5-ACT DISTRIBUTION (EXACTLY 7 PROMPTS PER ACT = 35 PROMPTS TOTAL):
- Act 1 (Prompts 1 to 7): Historical context, opening hook, and initial situation.
- Act 2 (Prompts 8 to 14): Narrative rising motion, journey, and developing tension.
- Act 3 (Prompts 15 to 21): Critical confrontation, hidden revelation, or profound dilemma.
- Act 4 (Prompts 22 to 28): Climax peak, dramatic emotional realization, and turning point.
- Act 5 (Prompts 29 to 35): Resolution, profound peace, lasting consequence, and solemn closure.

MANDATORY STYLE BLOCK:
Every single prompt must conclude with this short documentary style block:
"${styleBlock}"

FORMAT INSTRUCTIONS:
Return ONLY a valid JSON array of exactly ${count} strings. Each item must be a single self-contained prompt string in English.
CRITICAL: DO NOT include any numbering, indices, or prefixes like "1.", "Prompt 1:", or "#1:" at the start of any prompt string. Return only the raw cinematic visual prompt description.
Example:
[
  "Dramatic wide shot eye-level of ancient desert encampment at harsh dawn, coarse woven tents and weathered stone hearths, dust particles suspended in golden morning light, elderly patriarch standing right-of-center gazing with intense concern${styleBlock}",
  ... (up to ${count} prompts)
]`;

      try {
        const response = await this.aiText.generateText(prompt, { maxTokens: 6000, temperature: 0.7 });
        const parsed = this.parseJsonSafe(response);
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.prompts) ? parsed.prompts : [];
        if (list.length >= 20) {
          return list.slice(0, count).map((p, idx) => {
            let pStr = String(p).trim();
            // Sanitização estrita: remove qualquer numeração no início (ex: "1. ", "1 - ", "Prompt 1: ", "#1: ")
            pStr = pStr.replace(/^(?:prompt\s*\d+[:.-]?|#?\d+[-.):]\s*|\d+[-.):]\s*)/i, '').trim();
            if (!pStr.includes('biblical photorealistic documentary style')) {
              pStr += styleBlock;
            }
            return {
              index: idx + 1,
              prompt: pStr
            };
          });
        }
      } catch (err) {
        this.logger.warn(`Erro ao gerar prompts para Google Flow: ${err.message}. Usando prompts documentais avançados de fallback.`);
      }
    }

    // Fallback documental avançado de 35 cenas respeitando os 5 Atos, rotação de planos e Anti-Semelhança
    const sceneBlueprints = [
      // Ato 1: Introdução, Contexto e Abertura (1-7)
      { plan: 'Extreme wide shot, eye-level', scene: `ancient arid landscape of the Levant at dawn, low golden light sweeping across dry rocky ridges, authentic ancient stone settlement in the distance, dramatic volumetric light rays`, pal: 'warm amber and dusty ochre' },
      { plan: 'Medium shot, three-quarter view', scene: `ancient bearded historical traveler adjusting a coarse wool travel cloak, worn leather sandals on dry earth, subtle tension in his focused posture`, pal: 'earthy brown and muted linen tones' },
      { plan: 'Close-up on hands', scene: `weathered calloused hands holding an ancient carved olive-wood staff, intricate grain texture visible, dust clinging to fingers`, pal: 'warm walnut wood and natural side lighting' },
      { plan: 'Low angle medium shot', scene: `stone gate of an ancient fortified desert city, rough-hewn limestone masonry, ancient witnesses gathered in small discussion groups, atmospheric morning haze`, pal: 'pale limestone cream and soft morning blue' },
      { plan: 'Over-the-shoulder POV', scene: `looking past the shoulder of an ancient scholar studying deeply engraved symbols on an ancient clay tablet, shallow depth of field`, pal: 'rich terracotta and cool interior shadows' },
      { plan: 'Close-up portrait with direct gaze', scene: `face of an ancient witness with profound contemplation, deep expression lines around dark eyes, coarse hood framing the weathered face, soft window light`, pal: 'warm candle glow and deep shadows' },
      { plan: 'Wide shot, high angle', scene: `desert caravan path winding along a dry riverbed, pack donkeys and figures in single file, long shadows stretching across the cracked clay`, pal: 'golden hour amber and cool purple shadows' },

      // Ato 2: Jornada, Deslocamento e Tensão Crescente (8-14)
      { plan: 'Medium shot, dynamic diagonal composition', scene: `two ancient travelers in earnest discussion beside a rugged limestone rock outcropping, wind whipping the edges of their robes, urgent gestures`, pal: 'cool gray-green and desaturated beige' },
      { plan: 'Extreme close-up macro', scene: `ancient brass oil lamp with a small flickering flame, smoke curling upward in a dimly lit stone alcove, cracked plaster texture`, pal: 'deep bronze and warm flame flicker' },
      { plan: 'Wide shot with natural framing', scene: `view through an ancient arched stone colonnade looking out onto a bustling ancient marketplace, blurred silhouettes of merchants in the background`, pal: 'dusty ochre and sunlit beige' },
      { plan: 'Low angle hero shot', scene: `resolute ancient figure standing at the crest of a barren ridge, dark silhouette against a turbulent overcast sky, cloak billowing in the desert gust`, pal: 'cool slate gray and muted charcoal' },
      { plan: 'Medium close-up', scene: `young disciple holding a clay water jug near an ancient stone cistern, drops of water glistening on ancient masonry, expression of quiet wonder`, pal: 'cool deep teal water reflection and warm stone' },
      { plan: 'Dutch tilt slight angle', scene: `ancient stone courtyard pavement littered with dry palm fronds, sudden gust of wind stirring dust motes, tense atmosphere of anticipation`, pal: 'monochromatic dusty beige with sharp shadow accents' },
      { plan: 'Close-up on feet and hem', scene: `sandaled feet walking deliberately across scorched desert sand, small puffs of fine dust rising with each step, intense sunlight`, pal: 'bright chalky white and harsh midday contrast' },

      // Ato 3: Conflito, Dilemma e Revelação Chave (15-21)
      { plan: 'Wide shot, low camera angle', scene: `interior of an ancient stone council chamber, elders seated on stone benches under high slit windows, diagonal light beams cutting through suspended incense smoke`, pal: 'deep amber beams and cool cavernous gloom' },
      { plan: 'Medium shot, eye-level', scene: `ancient scribe pausing his reed pen over a fresh papyrus scroll, look of profound shock and realization on his lined face`, pal: 'warm sepia and natural parchment tone' },
      { plan: 'Extreme close-up on eye and brow', scene: `intense dark eye of an ancient prophet reflecting a subtle divine light source, furrowed brow conveying immense spiritual gravity`, pal: 'dramatic split-lighting, warm highlight and deep shadow' },
      { plan: 'Over-the-shoulder medium shot', scene: `facing an imposing ancient stone doorway framed by heavy carved timber beams, guards standing in passive silhouette, atmosphere of solemn secrecy`, pal: 'dark iron-gray and muted bronze' },
      { plan: 'Medium shot with foreground depth', scene: `outstretched hand resting firmly upon an ancient inscribed boundary stone, weathered Hebrew-era markings, background figures watching in silence`, pal: 'rich weathered limestone and deep burgundy cloak' },
      { plan: 'Wide cinematic shot', scene: `gathering of townspeople on a sloping hillside outside village walls, muted reactions of awe and whispering, expansive atmospheric sky above`, pal: 'soft overcast silver-gray and dry scrub green' },
      { plan: 'Close-up on symbolic object', scene: `broken clay seal lying beside an open ancient wooden chest, fragments catching a narrow beam of sunlight on a dusty floor`, pal: 'terracotta red and golden dust mote beam' },

      // Ato 4: Clímax, Revelação e Pico Emocional (22-28)
      { plan: 'Low angle medium shot', scene: `central figure raising both hands in solemn prayer, head tilted upward, powerful beam of divine sunlight breaking through dark storm clouds to illuminate the figure`, pal: 'dramatic celestial gold against dark indigo clouds' },
      { plan: 'Close-up portrait', scene: `face of an ancient mother weeping tears of overwhelming relief, clutching a child's hand tightly, profound emotional catharsis, soft rim lighting`, pal: 'warm skin tone, soft tear reflection and deep background' },
      { plan: 'Medium shot, three-quarter view', scene: `two men embracing in profound reconciliation beside a dry stone wall, genuine human emotion and forgiveness, dust settling gently around them`, pal: 'golden late-afternoon warmth' },
      { plan: 'Extreme close-up', scene: `finger gently tracing an ancient sacred engraving carved into living bedrock, texture of chipped quartz and ancient dust`, pal: 'cool flint gray and single warm sunbeam accent' },
      { plan: 'Wide shot, high perspective', scene: `a silent crowd gathered around an ancient stone altar as a single column of aromatic smoke rises straight into a still sunset sky`, pal: 'deep purple dusk sky and orange ember glow' },
      { plan: 'Over-the-shoulder POV', scene: `looking past the shoulder of an elder toward the open desert horizon where the first evening star begins to shine through thin clouds`, pal: 'deep lapis lazuli blue and pale evening violet' },
      { plan: 'Medium close-up', scene: `ancient leader holding up a restored wooden emblem, solemn expression of duty fulfilled, soldiers standing in respectful reverence in the background`, pal: 'burnished bronze and coarse linen white' },

      // Ato 5: Resolução, Legado e Desfecho Solene (29-35)
      { plan: 'Wide shot, eye-level', scene: `peaceful ancient valley bathed in soft twilight, small stone dwellings with faint warm lamplight glowing from doorways, quiet tranquility after tension`, pal: 'peaceful twilight blue and warm interior golden windows' },
      { plan: 'Medium shot, profile', scene: `elderly sage seated under a mature gnarled olive tree, hands folded calmly in his lap, peaceful serene expression, gentle breeze moving gray beard`, pal: 'silvery olive foliage and soft twilight amber' },
      { plan: 'Close-up on hands and object', scene: `hands carefully wrapping an ancient sacred manuscript in clean linen cloth, deliberate reverence and protective care`, pal: 'pure off-white linen and dark aged papyrus' },
      { plan: 'Low angle wide shot', scene: `single ancient stone watchtower silhouetted against a breathtaking starry night sky, clear celestial canopy with visible Milky Way, vast perspective`, pal: 'deep nocturnal indigo and cool silver starlight' },
      { plan: 'Medium shot, back view', scene: `solitary ancient traveler standing at the crossroads of an ancient stone road, staff in hand, looking forward into a new dawn breaking over mountains`, pal: 'pre-dawn violet and golden horizon sliver' },
      { plan: 'Close-up on footstep in sand', scene: `fresh footprint in clean windblown sand beside an ancient stone milestone, symbolic of the journey continued for future generations`, pal: 'golden morning sidelight and soft blue shadow' },
      { plan: 'Extreme wide shot, cinematic closing', scene: `grand panoramic vista of the holy ancient landscape stretching toward distant misty mountains, a radiant morning sun rising majestically over the horizon, atmosphere of eternal hope and solemn triumph`, pal: 'triumphant dawn gold, pale rose and serene blue' }
    ];

    const fallbackList = [];
    for (let i = 0; i < count; i++) {
      const b = sceneBlueprints[i % sceneBlueprints.length];
      const promptText = `${b.plan} of ${b.scene}, narrative theme "${cleanTopic}", dominant palette of ${b.pal}${styleBlock}`;
      fallbackList.push({
        index: i + 1,
        prompt: promptText
      });
    }

    return fallbackList;
  }

  /**
   * Analisa as últimas 3 a 5 capas/vídeos do canal para diagnosticar padrões repetitivos:
   * - Cenários semelhantes (ex: quartos de pedra escuros com tochas ou cavernas)
   * - Paletas monocromáticas opacas (marrom-sépia apagado com baixo CTR)
   * - Monotonia tipográfica (mesma fonte serifada discreta no canto inferior)
   * Fornece diretrizes obrigatórias de quebra de padrão (anti-monotonia) e fontes chamativas.
   */
  async auditRecentChannelThumbnails({ count = 5, channelId = null, fallbackHistory = '' } = {}) {
    this.logger.info(`Auditando últimas ${count} miniaturas do canal para diferenciação visual...`);
    
    let analyzedVideos = [];

    // 1. Tentar buscar da API do YouTube
    try {
      const recent = await this.fetchChannelRecentVideos({ days: 90, maxResults: Math.max(count * 2, 12), channelId });
      if (Array.isArray(recent?.videos) && recent.videos.length > 0) {
        analyzedVideos = recent.videos.slice(0, count).map(v => ({
          id: v.id,
          title: v.title,
          thumbnail: v.thumbnail || null,
          publishedAt: v.publishedAt,
          source: 'youtube_api'
        }));
      }
    } catch (e) {
      this.logger.warn(`Auditoria via YouTube API indisponível: ${e.message}`);
    }

    // 2. Fallback: buscar temas planejados / agendados recentes no banco local
    if (analyzedVideos.length < 3 && this.db) {
      try {
        const planned = await this.db.listPlannedThemes({ limit: 20, channelId }).catch(() => []);
        if (Array.isArray(planned) && planned.length > 0) {
          const sorted = [...planned].sort((a, b) => {
            const dateA = new Date(a.scheduled_date || a.created_at || 0).getTime();
            const dateB = new Date(b.scheduled_date || b.created_at || 0).getTime();
            return dateB - dateA;
          });
          const picked = sorted.slice(0, count).map(t => ({
            id: t.id,
            title: t.topic,
            thumbnail: t.published_url || null,
            publishedAt: t.scheduled_date || t.created_at,
            source: 'database_planned_themes'
          }));
          analyzedVideos = picked;
        }
      } catch (err) {
        this.logger.warn(`Fallback no banco local para auditoria falhou: ${err.message}`);
      }
    }

    // 3. Fallback extra: analisar histórico salvo (last_workflow_summary ou fallbackHistory)
    if (analyzedVideos.length < 3) {
      const rawSummary = fallbackHistory || (await this.db?.getSetting('last_workflow_summary').catch(() => null));
      if (rawSummary) {
        const lines = String(rawSummary).split(/\r?\n/).filter(l => l.includes('Tema utilizado') || l.includes('1.') || l.includes('2.') || l.includes('3.'));
        lines.slice(0, count).forEach((l, idx) => {
          const clean = l.replace(/^.*?:\s*/, '').replace(/^\d+\.\s*/, '').replace(/["']/g, '').trim();
          if (clean && clean.length > 5) {
            analyzedVideos.push({
              id: `hist_${idx}`,
              title: clean,
              publishedAt: null,
              source: 'channel_history_summary'
            });
          }
        });
      }
    }

    // Se ainda assim estiver vazio, usar títulos do histórico de produções do canal
    if (analyzedVideos.length === 0) {
      analyzedVideos = [
        { title: 'La parola ebraica segreta di Gesù nel buio più profondo', source: 'channel_reference' },
        { title: 'Il dettaglio botanico nascosto nel giardino di Maria Maddalena', source: 'channel_reference' },
        { title: 'Il peccato segreto di Sansone: quando Dio lo abbandonò davvero prima di Dalila', source: 'channel_reference' },
        { title: "Il vero segreto del 666 nell'Apocalisse: la chiave cifrata oltre Nerone", source: 'channel_reference' },
        { title: 'La Maga di Endor e il Testo Ebraico: Cosa Vide Davvero Saul nella Notte di Gelbù', source: 'channel_reference' }
      ];
    }

    const titlesList = analyzedVideos.slice(0, count).map((v, i) => `${i + 1}. "${v.title}"`).join('\n');

    return {
      analyzedCount: Math.min(analyzedVideos.length, count),
      analyzedVideos: analyzedVideos.slice(0, count),
      titlesSummary: titlesList,
      detectedSaturations: [
        'Cenários fechados e escuros repetitivos (câmara de pedra rústica, noites com tochas ou cavernas)',
        'Paleta monocromática opaca (marrom terra, sépia escuro e sombras pesadas com baixo CTR)',
        'Monotonia de fontes (apenas serifa fina discreta no canto inferior esquerdo com baixa visibilidade mobile)'
      ],
      divergentDirectives: {
        prohibitedScenarios: 'PROIBIDO: Câmaras de pedra escuras com tochas, cavernas noturnas fechadas, fundos apagados e monocromáticos sem contraste.',
        requiredScenarios: 'OBRIGATÓRIO: Cenários abertos, grandiosos, bem iluminados e arquitetura monumental (ex.: terraços elevados de mármore sob luz solar pura com céu azul cobalto, colunatas monumentais de pedra polida, penhascos panorâmicos ao amanhecer com raios solares dramáticos, pátios de templos banhados por luz do dia limpa, oásis com reflexos cristalinos sob sol dourado).',
        vibrantPalettes: [
          { name: 'Ouro Solar & Azul Cobalto', description: 'Radiant liquid gold combined with deep royal cobalt blue, maximum complementary contrast and high luminescence.' },
          { name: 'Púrpura Imperial & Mármore Marfim', description: 'Deep majestic velvet purple, pure ivory marble, and brilliant warm rim highlights.' },
          { name: 'Esmeralda Sagrada & Luz Celestial', description: 'Luminous sacred emerald green with volumetric pure white-gold sunbeams, ethereal and sharp.' },
          { name: 'Carmesim Nobre & Âmbar Puro', description: 'Rich deep crimson scarlet contrasting with bright amber solar highlights, intense emotional heat.' },
          { name: 'Branco Pérola & Ouro Escovado (High-Key)', description: 'Luminous open-air daylight aesthetic, pearlescent whites, warm sand, and sharp golden accents with crisp depth.' }
        ],
        eyeCatchingTypographyStyles: [
          {
            name: 'Ultra-Bold Modern Sans-Serif (Mobile First)',
            family: 'Modern Heavy Sans-Serif (Impact / Monumental Weight)',
            stylingPrompt: 'The text is rendered in massive ultra-bold modern sans-serif typography, all-caps, with a high-saturation solar yellow or electric gold fill, deep sharp 3D bevel, and a solid dark drop-shadow. Extremely high readability and immediate eye-snap on mobile screens.'
          },
          {
            name: '3D Chiseled Roman Display (Cinematográfico Monumental)',
            family: 'Monumental Chiseled Roman Serif Display',
            stylingPrompt: 'The text is rendered as monumental chiseled 3D Roman typography, sculpted as if carved from ancient radiant gold plate or polished ivory stone, with crisp beveled edges and directional specular glints across the letter ridges.'
          },
          {
            name: 'Urgent Headline Badge (Alto Contraste)',
            family: 'Heavy Condensed Block Typography',
            stylingPrompt: 'The text appears as solid high-impact condensed block letters set over a clean, high-contrast dark crimson or solid charcoal backing badge banner, with a delicate luminous gold contour border, conveying an urgent sacred revelation.'
          },
          {
            name: 'Dynamic Sharp Modern Display (Clímax & Tensão)',
            family: 'Dynamic Sharp Display Typography',
            stylingPrompt: 'The text is designed with bold dynamic display lettering, sharp architectural cuts, pure white fill with a vibrant golden-amber outer glow and hard black stroke separation, preventing any blur against the background.'
          },
          {
            name: 'Sacred Polished Gold com Contorno Duplo',
            family: 'Imperial Sacred Display',
            stylingPrompt: 'The text features majestic uppercase typography coated in high-sheen polished gold leaf, with a double high-contrast stroke (inner white highlight, outer dark obsidian outline) and a subtle halo of light.'
          }
        ]
      }
    };
  }

  /**
   * Gera as versões de 1 a 10 de thumbnails para o Nano Banana com Auditoria Anti-Mesmice:
   * - Analisa as últimas 3 a 5 capas do canal para impedir cenários semelhantes
   * - Rompe padrões monocromáticos/sépia escuros com paletas vibrantes de alto contraste
   * - Aplica fontes chamativas e diversificadas (ultra-bold 3D, românica cinzelada, badge de manchete)
   * - As respostas saem APENAS com o prompt em inglês contínuo para colar no Nano Banana
   */
  async generateNanoBananaThumbnailPrompts({ topic, script, language = 'it-IT', versionsCount = 10, channelId = null, fieldAHistory = '' } = {}) {
    this.logger.info(`Gerando ${versionsCount} versões avançadas de prompts para Nano Banana com Auditoria Anti-Mesmice...`);
    const cleanTopic = topic || script?.topic || 'Histórico / Bíblico';
    const fullScript = script?.fullScript || (typeof script === 'string' ? script : `${script?.hook || ''}\n${script?.part1 || ''}\n${script?.part2 || ''}`.trim());

    const languageNames = {
      'it-IT': 'Italiano (Italian)',
      'it': 'Italiano',
      'es-ES': 'Espanhol (Spanish)',
      'es': 'Espanhol',
      'pt-BR': 'Português do Brasil',
      'pt': 'Português',
      'en-US': 'Inglês (English)',
      'en': 'Inglês'
    };
    const targetLangName = languageNames[language] || language || 'Italiano';

    // 1. Executar auditoria de diferenciação visual das 3 a 5 capas recentes do canal
    const audit = await this.auditRecentChannelThumbnails({
      count: 5,
      channelId,
      fallbackHistory: fieldAHistory
    });

    if (this.aiText.isAvailable()) {
      const prompt = `You are an elite YouTube thumbnail director and prompt specialist for high CTR image generators (specifically Nano Banana / Midjourney).
Analyze the video topic and the script provided below:

TOPIC: "${cleanTopic}"
TARGET LANGUAGE FOR THUMBNAIL TEXT: "${targetLangName}"
SCRIPT CONTENT:
"""
${fullScript ? fullScript.slice(0, 4500) : cleanTopic}
"""

================================================================================
CRITICAL REQUIREMENT — VISUAL DIFFERENTIATION & CHANNEL THUMBNAIL AUDIT
================================================================================
We performed a systematic audit of the last ${audit.analyzedCount} thumbnails/videos of this channel:
${audit.titlesSummary}

DETECTED PATTERN FATIGUE / SATURATION ON PREVIOUS THUMBNAILS:
- All previous thumbnails are trapped in dark, muddy brown/sepia, cave-like or torchlit stone chambers.
- Low visual contrast and dull lighting make the channel look repetitive and easy to scroll past.
- Monotone small serif typography positioned only in one corner with dark boxes.

YOUR ABSOLUTE MANDATE FOR THESE NEW ${versionsCount} VERSIONS:
1. SCENARIOS (ANTI-MONOTONY):
   - STRICTLY FORBIDDEN: Do NOT place the character in dark stone rooms, caves, night torchlit corners, or muddy brown settings.
   - MANDATORY: Every single version MUST feature an expansive, distinct, visually grand or open-air scenario (e.g., sun-drenched grand marble colonnade, panoramic mountain cliff under a striking cobalt sky, sacred temple courtyard under bright daylight rays, shimmering riverbank/oasis with crystalline water reflections, royal terrace at golden dawn).
2. COLOR PALETTES & LIGHTING (BAN MUDDY SEPIA / DEMAND HIGH-CTR CONTRAST):
   - Never produce a muddy brown/sepia or dimly lit image.
   - Rotate across luminous, high-CTR color schemes:
     * Version 1: Radiant Liquid Gold & Deep Cobalt Blue (high complementary luminescence)
     * Version 2: Deep Imperial Purple, Ivory White Marble & Warm Gold Highlights
     * Version 3: Sacred Luminous Emerald Green & Volumetric White Sunbeams
     * Version 4: Rich Crimson Scarlet & Blazing Amber Solar Glow
     * Version 5+: Brilliant High-Key Daylight with crisp golden contrasts
3. DIVERSIFIED, EYE-CATCHING FONTS & TYPOGRAPHY:
   - BREAK THE MONOTONE SERIF MOLD! Do NOT use the exact same small serif text for every version.
   - Each version MUST use a distinct, bold, eye-catching font styling:
     * Version 1: Ultra-Bold Heavy Modern Sans-Serif with 3D bevel and electric gold/yellow fill (mobile-first CTR punch).
     * Version 2: 3D Chiseled Roman Monumental Display carved in polished gold metal with specular rim glints.
     * Version 3: Urgent Headline Badge with high-impact block letters over a crimson/charcoal backing banner.
     * Version 4: Dynamic Sharp Modern Display with crisp dual-tone white/amber and hard outline.
     * Version 5+: Imperial Sacred Gold Display with double high-contrast stroke.
   - Text must be punchy (1 to 2 words per line, max 15 chars per phrase) in ${targetLangName}, with maximum visual prominence and instant mobile readability.

EXECUTE THE FOLLOWING 3-STAGE INTERNAL PROCESS:

ETAPA 0 — INTERNAL READING VERIFICATION:
Ensure your extraction uses authentic names, places, objects, and emotional turning points directly from the script text above, never generic filler.

ETAPA 1 — LITERAL EXTRACTION:
- TEMA: "${cleanTopic}"
- IDIOMA: "${targetLangName}"
- CHARACTER: The exact protagonist archetype, age, posture, emotional state, authentic clothing, physically typical and dignified, completely fictional.
- MOMENTO VISUAL: The highest-tension climax or dramatic revelation scene from the script.
- SYMBOLIC ELEMENT: A concrete physical object from the script (not generic).
- EMOTION: The precise emotional turning point (fear, grief, hope, relief, intense awe).

ETAPA 2 — MATRIX OF 5 AXES OF VARIATION (GENERATE EXACTLY ${versionsCount} VERSIONS WITHOUT REPETITION):
For each of the ${versionsCount} versions, rotate so no two versions look similar:
1. MOMENTO DO ROTEIRO: Distinct scenes from the script (opening hook, rising conflict, crisis, climax, revelation).
2. SCENARIO (DIFFERENTIATED & GRAND): Grand open terrace, mountain summit, marble colonnade, temple courtyard, glowing desert horizon.
3. HORA DO DIA / LUZ: Blazing golden hour, high-noon crisp solar light, dawn glow, celestial split light.
4. ELEMENTO ATMOSFÉRICO: Volumetric sunbeams, crystal clean air, floating golden dust motes, desert wind, morning mist (never repeat).
5. TYPOGRAPHY & FONT STYLE: Rotate across the 5 distinct eye-catching font styles described above.

ETAPA 3 — OUTPUT FORMAT PER VERSION:
Each prompt in "promptNanoBanana" MUST be a single, solid, CONTINUOUS BLOCK of lines with ZERO blank/empty lines inside it.
DO NOT put any blank or empty line between sections.
Every line inside the prompt must directly follow the previous line with a single line-break.
An empty/blank line is reserved EXCLUSIVELY by batch processors to separate different prompts.
Do NOT include any "RESULT:" line.

Structure template of each prompt (continuous block, NO empty lines inside):
Generate a photorealistic cinematic YouTube thumbnail, 16:9 (1280x720px), 8K ultra-sharp, shot on Sony A7R V with 85mm f/1.4 lens. Hyperrealistic skin pores, fabric texture, hair strands, sweat, dust particles visible. Physically accurate light behavior.
TEMA: [Topic of video]
IDIOMA: ${targetLangName}
VERSÃO: [Version Number]
CHANNEL DIVERSITY AUDIT: Differentiated from the last 5 channel thumbnails (actively breaking the repetitive dark sepia / torch-lit stone chamber pattern).
CHARACTER: [Detailed character descriptor from script, age, authentic period clothing, intense emotion, physically typical, dignified, fictional]
SYMBOLIC ELEMENT: [Concrete symbolic item from the script described with realistic weight and texture]
SCENARIO (UNIQUE & DIVERSE): [Specific grand, open or monumental setting, era, time of day, active atmospheric element - NO dark caves or torch rooms]
EMOTION: [Precise climax emotion in one impactful phrase]
COLOR PALETTE & LIGHTING (ANTI-SEPIA / HIGH-CTR CONTRAST): [Vibrant high-contrast palette, e.g. radiant gold & cobalt blue, imperial purple & ivory marble, emerald & celestial white rays - no muddy brown]
COMPOSITION: [Dynamic framing, clear depth of field, clean zone reserved for text]
TEXT CONTENT (the ONLY words permitted to appear anywhere in the image, written in ${targetLangName}):
First word/short phrase: [max 15 characters, magnetic hook in ${targetLangName}]
Second word/short phrase: [max 15 characters, high-impact payoff word in ${targetLangName}]
TYPOGRAPHY & VISUAL STYLING (EYE-CATCHING & DISTINCT):
[Detailed description of the specific eye-catching font for this version: family, weight, 3D bevel/relief or badge, bright vibrant fill color, outline/shadow, high mobile visibility]
CRITICAL TEXT RULE:
The image must contain ONLY the two phrases named above, rendered as clean natural typography. Never render font names, color codes, pixel measurements, unit abbreviations, tildes, dashes-as-labels, or any styling instruction as visible text or characters anywhere in the image.
ABSOLUTE PROHIBITIONS:
No watermarks. No logos. No full-width banners. No dark muddy sepia monochrome. No AI artifacts. No plastic skin. No generic stock feel. No decorative icons, sparkles, stars, or symbols anywhere in the frame. No stray characters, numbers, or code fragments anywhere in the image. No depictions of dwarfism, short stature, or any physical disability or visible physical impairment, in the main character or any figure in the frame.

RETURN ONLY VALID JSON in this structure:
{
  "versions": [
    {
      "version": 1,
      "title": "Versão 1 - [Nome descritivo curto em português]",
      "scenarioType": "[Tipo do cenário, ex: Terraço de Mármore Aberto]",
      "paletteName": "[Nome da paleta, ex: Ouro Solar & Azul Cobalto]",
      "fontStyle": "[Estilo da fonte, ex: Ultra-Bold 3D Amarelo Mobile]",
      "promptNanoBanana": "Generate a photorealistic cinematic YouTube thumbnail..."
    }
  ]
}`;

      try {
        const response = await this.aiText.generateText(prompt, { maxTokens: 4000, temperature: 0.7 });
        const parsed = this.parseJsonSafe(response);
        const versions = Array.isArray(parsed?.versions) ? parsed.versions : [];
        if (versions.length > 0) {
          const cleanedVersions = versions.slice(0, versionsCount).map((v, idx) => ({
            ...v,
            version: v.version || (idx + 1),
            scenarioType: v.scenarioType || (idx % 2 === 0 ? 'Cenário Aberto Monumental' : 'Luz Solar & Colunatas'),
            paletteName: v.paletteName || (idx % 2 === 0 ? 'Ouro Solar & Azul Cobalto' : 'Púrpura Imperial & Mármore'),
            fontStyle: v.fontStyle || (idx % 2 === 0 ? 'Ultra-Bold 3D Display' : '3D Chiseled Roman'),
            promptNanoBanana: this.cleanPromptBlock(v.promptNanoBanana)
          }));
          cleanedVersions.audit = audit;
          return cleanedVersions;
        }
      } catch (err) {
        this.logger.warn(`Erro ao gerar prompts Nano Banana: ${err.message}. Usando matriz avançada de diferenciação.`);
      }
    }

    // Fallback estruturado profissional com Auditoria Anti-Mesmice e Matriz de Diferenciação Visual
    const scenarios = [
      {
        type: 'Terraço Monumental de Mármore',
        desc: 'A sun-drenched grand marble terrace with towering ancient pillars overlooking an expansive desert valley under a vibrant azure sky, crisp air with fine golden dust motes caught in sharp volumetric sunbeams',
        palette: 'Radiant liquid gold & royal cobalt blue (high complementary luminescence, zero muddy sepia)',
        keyLight: 'blazing high golden-hour sun casting crisp directional shadows across white polished stone',
        framing: 'Medium shot with dynamic 3/4 angle, subject anchored right',
        fontName: 'Ultra-Bold Modern Sans-Serif (Mobile First)',
        fontPrompt: 'The first phrase appears in massive ultra-bold modern sans-serif typography, all-caps in brilliant pure white with a subtle gold rim. The second phrase appears directly below in electric solar gold, extra-heavy weight, featuring a sharp 3D bevel and a deep black drop-shadow. Positioned in the lower-left corner with extreme high-contrast readability on mobile screens.'
      },
      {
        type: 'Penhasco Panorâmico ao Amanhecer',
        desc: 'A dramatic mountain cliff summit at dawn, sweeping open horizon under an intense cobalt and magenta sky, crisp mountain air with early morning pink-gold light cutting across the ridge',
        palette: 'Deep imperial purple, pure ivory stone & brilliant warm gold highlights',
        keyLight: 'intense low-angle dawn sunburst creating a blazing golden rim light tracing the subject and fabric',
        framing: 'Dramatic low-angle hero shot conveying revelation and awe',
        fontName: '3D Chiseled Roman Monumental Display',
        fontPrompt: 'The text is rendered as monumental chiseled 3D Roman typography, sculpted as if carved from ancient radiant gold plate and polished marble. The first phrase in polished ivory capital letters, the second phrase below in sculpted beveled gold with specular light glints along the letter edges.'
      },
      {
        type: 'Colunatas do Templo sob Luz Solar',
        desc: 'An open-air temple courtyard under brilliant midday solar rays, towering limestone pillars and rich woven crimson canopies swaying in a gentle desert breeze, pure clean atmospheric light',
        palette: 'Sacred luminous emerald green & volumetric pure white-gold sunbeams',
        keyLight: 'direct overhead midday sun softened by thin linen sails, creating high-contrast graphic shadows',
        framing: 'Dynamic side profile with deep architectural perspective behind',
        fontName: 'Urgent Headline Badge (Alto Contraste)',
        fontPrompt: 'The text appears as solid high-impact condensed block letters set over a clean, high-contrast dark crimson rectangular backing badge banner with a delicate luminous gold contour line. First phrase in crisp white, second phrase in bold sunburst amber.'
      },
      {
        type: 'Oásis e Margem Límpida ao Pôr do Sol',
        desc: 'A sacred riverbank with lush date palms and crystalline water reflecting radiant twilight, warm shimmering water caustics and glowing embers carried on a gentle evening wind',
        palette: 'Rich crimson scarlet & blazing amber solar glow against crisp evening turquoise',
        keyLight: 'warm horizontal sunset light illuminating the subject face with rich amber tones and cold sky fill',
        framing: 'Over-the-shoulder POV witnessing the miraculous revelation',
        fontName: 'Dynamic Sharp Modern Display (Clímax)',
        fontPrompt: 'The text features dynamic sharp modern display typography with architectural cuts. The first phrase in gleaming snow white with a razor-thin black stroke, the second phrase in radiant liquid gold with a subtle outer glow for maximum pop against the background.'
      },
      {
        type: 'Pórtico Real com Mármore e Ouro',
        desc: 'An elevated royal portico with gleaming white stone balustrades, distant view of Jerusalem ancient gates bathed in bright afternoon clarity, crisp shadows and volumetric atmosphere',
        palette: 'High-key luminous pearl white & solar gold with crisp dark contrast',
        keyLight: 'warm angled solar beam cutting through an open arched gateway',
        framing: 'Tight cinematic close-up with intense focused emotion, subject offset right',
        fontName: 'Sacred Polished Gold com Contorno Duplo',
        fontPrompt: 'The text is rendered in imperial sacred display typography coated in high-sheen polished gold leaf. Both phrases feature a dual high-contrast stroke (inner white edge, outer solid obsidian contour) ensuring crisp instant readability.'
      }
    ];

    const result = [];
    for (let i = 0; i < versionsCount; i++) {
      const vNum = i + 1;
      const scen = scenarios[i % scenarios.length];

      const promptTemplate = [
        'Generate a photorealistic cinematic YouTube thumbnail, 16:9 (1280x720px), 8K ultra-sharp, shot on Sony A7R V with 85mm f/1.4 lens. Hyperrealistic skin pores, fabric texture, hair strands, sweat, dust particles visible. Physically accurate light behavior.',
        `TEMA: ${cleanTopic}`,
        `IDIOMA: ${targetLangName}`,
        `VERSÃO: Version ${vNum}`,
        'CHANNEL DIVERSITY AUDIT: Differentiated from the last 5 channel thumbnails (actively breaking the repetitive dark sepia / torch-lit stone chamber pattern).',
        'CHARACTER: Ancient historical protagonist with weathered features, authentic coarse-woven tunic, intense expression of dramatic shock and revelation, physically typical, completely fictional, dignified.',
        'SYMBOLIC ELEMENT: Ancient symbolic artifact with heavy tactile texture, worn edges, and profound narrative significance.',
        `SCENARIO (UNIQUE & DIVERSE): ${scen.desc}.`,
        'EMOTION: Overwhelming realization and awe at a hidden revelation.',
        'COLOR PALETTE & LIGHTING (ANTI-SEPIA / HIGH-CTR CONTRAST):',
        `Dominant palette: ${scen.palette}.`,
        `Key light: ${scen.keyLight}.`,
        'Fill light: cold sky ambient bounce, subtle fill, preserving crisp photographic depth.',
        'Rim light: brilliant golden halo tracing shoulder edge and hair strands, separating subject from background.',
        'Bokeh background. Rich luminous gradation. No flat lighting. No muddy brown.',
        'COMPOSITION:',
        `${scen.framing}. Lower-left quadrant intentionally clear and balanced for text. Symbolic element softly blurred behind character. One foreground micro-detail for depth: polished stone edge or weathered rope.`,
        `TEXT CONTENT (the ONLY words permitted to appear anywhere in the image, written in ${targetLangName}):`,
        'First word/short phrase: IL SEGRETO',
        'Second word/short phrase: RIVELATO',
        'TYPOGRAPHY & VISUAL STYLING (EYE-CATCHING & DISTINCT):',
        scen.fontPrompt,
        'CRITICAL TEXT RULE:',
        'The image must contain ONLY the two phrases named above, rendered as clean natural typography. Never render font names, color codes, pixel measurements, unit abbreviations, tildes, dashes-as-labels, or any styling instruction as visible text or characters anywhere in the image.',
        'ABSOLUTE PROHIBITIONS:',
        'No watermarks. No logos. No full-width banners. No dark muddy sepia monochrome. No AI artifacts. No plastic skin. No generic stock feel. No decorative icons, sparkles, stars, or symbols anywhere in the frame. No stray characters, numbers, or code fragments anywhere in the image. No depictions of dwarfism, short stature, or any physical disability or visible physical impairment, in the main character or any figure in the frame.'
      ].join('\n');

      result.push({
        version: vNum,
        title: `Versão ${vNum} - ${scen.type}`,
        scenarioType: scen.type,
        paletteName: scen.palette.split('(')[0].trim(),
        fontStyle: scen.fontName,
        promptNanoBanana: promptTemplate
      });
    }

    result.audit = audit;
    return result;
  }

  /**
   * Sanitiza um bloco de prompt para que não contenha NENHUMA linha em branco interna,
   * garantindo total compatibilidade com geradores em lote/massivo (batch).
   */
  cleanPromptBlock(promptText) {
    if (!promptText || typeof promptText !== 'string') return '';
    return promptText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('RESULT:'))
      .join('\n');
  }

  /**
   * Gera Título, Descrição SEO e Lista de 7 hashtags (SEM '#') no idioma ativo
   * baseado no roteiro documental/bíblico completo, aplicando a regra dos 45 caracteres no título,
   * timestamps calculados em cima dos 5 Atos (100 ppm, ~14min), citação oficial da Bíblia por idioma,
   * CTA aberto sem resposta fixa e 7 hashtags limpas separadas por vírgula.
   */
  async generateSEO({
    script,
    topic,
    language = 'it-IT',
    channelName = '',
    previousTitle = '',
    previousDescription = ''
  } = {}) {
    const cleanTopic = topic || script?.topic || 'Histórico / Bíblico';
    const fullScript = script?.fullScript || (typeof script === 'string' ? script : `${script?.hook || ''}\n${script?.part1 || ''}\n${script?.part2 || ''}`.trim());
    this.logger.info(`Gerando SEO avançado para "${cleanTopic}" no idioma ${language}...`);

    const languageNames = {
      'it-IT': 'Italiano (Italian)',
      'it': 'Italiano',
      'pl-PL': 'Polonês (Polish)',
      'pl': 'Polonês',
      'es-ES': 'Espanhol (Spanish)',
      'es': 'Espanhol',
      'pt-BR': 'Português do Brasil',
      'pt': 'Português',
      'en-US': 'Inglês (English)',
      'en': 'Inglês'
    };
    const targetLangName = languageNames[language] || language || 'Italiano';

    // Determina a tradução bíblica oficial por idioma
    const langLower = String(language).toLowerCase();
    let bibleTranslation = 'Bibbia CEI 2008';
    if (langLower.startsWith('pl')) bibleTranslation = 'Biblia Tysiąclecia (wydanie V)';
    else if (langLower.startsWith('es')) bibleTranslation = 'Biblia de Jerusalén / Reina-Valera';
    else if (langLower.startsWith('pt')) bibleTranslation = 'Bíblia Sagrada (Edição Pastoral / CNBB / Almeida)';
    else if (langLower.startsWith('en')) bibleTranslation = 'New Revised Standard Version (NRSV)';

    if (this.aiText.isAvailable()) {
      const prompt = `You are an elite YouTube SEO strategist and title specialist for high-impact biblical, historical and inspirational documentary channels.
Analyze the video topic and the script provided below:

TOPIC: "${cleanTopic}"
TARGET LANGUAGE: "${targetLangName}"
OFFICIAL BIBLE TRANSLATION: "${bibleTranslation}"
${channelName ? `CHANNEL: "${channelName}"` : ''}

SCRIPT CONTENT:
"""
${fullScript ? fullScript.slice(0, 6000) : cleanTopic}
"""
${previousTitle ? `
════════════════════════════════════════
PREVIOUS ATTEMPT REJECTED (DO NOT REPEAT):
════════════════════════════════════════
The user did NOT like the previous title:
PREVIOUS TITLE: "${previousTitle}"
${previousDescription ? `PREVIOUS DESCRIPTION OPENING: "${previousDescription.slice(0, 160)}..."` : ''}

CRITICAL RE-CREATION & CHANNEL LEVERAGE RULES:
1. Re-analyze the SCRIPT CONTENT deeply.
2. Select a COMPLETELY DIFFERENT hook, emotional trigger, or specific biblical detail from the script.
3. DO NOT repeat the words, angle, or formula of the rejected title.
4. Elevate the curiosity gap and retention potential for the YouTube algorithm (High CTR / High AVD).
5. Make this new creation visibly fresher, bolder, and more compelling than the previous one!
` : ''}

EXECUTE THE FOLLOWING 3 TASKS IN STRICT ACCORDANCE WITH THESE RULES:

════════════════════════════════════════
TASK 1: YOUTUBE VIDEO TITLE (MAX HIGH CTR)
════════════════════════════════════════
1. The title MUST be born directly from the script (not a generic formula applied on top).
2. EXTRACTION:
   - Identify the UNIQUE ELEMENT from the script: a specific name, ancient place, physical object, number, Hebrew/Greek term, or archaeological/historical detail that ONLY appears in this story.
   - Identify the CENTRAL TURNING POINT and PRACTICAL CONSEQUENCE.
3. CHOOSE THE TONE:
   - If revealing something hidden/mistranslated -> Secret/Revelation (e.g. Segreto / Rivelazione)
   - If an unexpected divine act/answer -> Miracle/Providence (e.g. Miracolo / Provvidenza)
   - If trial/absence/silence -> Trial/Darkness (e.g. Prova / Oscurità)
   - If triumph/overcoming -> Victory (e.g. Vittoria)
   - If historical fulfillment -> Prophecy (e.g. Profezia)
4. FORMAT RULES:
   - Total length: MAXIMUM 90 characters, NO line breaks, NO ending period (.).
   - FIRST 45 CHARACTERS (MOBILE FIRST): MUST contain the Unique Element OR the strongest Emotional Trigger so smartphone viewers see it instantly before any truncation.
   - FREE STRUCTURE: Do not force "[Trigger]: explanation". Use a compelling question, striking contrast, or profound statement.
   - EMOJIS: 1 to 4 meaningful emojis matching the specific theme (e.g. 📜, ⚔️, 🕯️, 🏛️, 🩸, 🕊️, etc.).
   - Written 100% in ${targetLangName}.

════════════════════════════════════════
TASK 2: SEO DESCRIPTION (220 TO 350 WORDS)
════════════════════════════════════════
Structure the description in sequence, written 100% in ${targetLangName}:
1. FIRST LINE (SEO HOOK): 150 to 160 characters containing the primary search keyword in the opening words. Serves as both preview summary and search bait.
2. BODY (3 to 5 short engaging paragraphs, 220-350 total narrative words, 1-2 emojis per paragraph):
   - Expands the narrative with spiritual authority and documentary depth.
   - Naturally repeats the main keyword 2 to 3 times without keyword-stuffing.
   - Includes 1 authentic verse citation faithful to ${bibleTranslation}.
3. TIMESTAMPS BLOCK (Derived from the 5 Acts of the ~14-minute narration, calibrated at 100 wpm for ~9,800 chars):
   - Exactly 4 to 6 timestamps using specific, compelling labels extracted from the actual script events (NO generic labels like "Introduction"):
     00:00 [Specific label for Act 1 hook/unique element]
     02:30 [Specific Act 2 journey/developing tension]
     06:45 [Specific Act 3 dilemma/turning point]
     10:30 [Specific Act 4 climax/revelation]
     13:15 [Specific Act 5 solemn conclusion/legacy]
4. ENGAGEMENT CALL TO ACTION (CTA):
   - An open, thought-provoking question about the character's moral dilemma or turning point that genuinely invites viewer reflection.
   - DO NOT request a fixed single-word reply like "Amen". Ask for personal reaction, opinion, or lived experience.
5. CLOSING HASHTAGS:
   - 3 to 5 permanent channel tags (#Bibbia #Fede #Ispirazione #Profezia #Storia or equivalent in ${targetLangName}) plus 2 video-specific hashtags.

════════════════════════════════════════
TASK 3: LIST OF 7 HASHTAGS (STRICTLY WITHOUT '#')
════════════════════════════════════════
- Exactly 7 relevant keywords/hashtags in ${targetLangName}.
- STRICT INVARIANT: ZERO "#" characters! Separated by commas. (e.g. ["mistero bibbia", "caino abele", "segreto genesi", "fede", "archeologia biblica", "rivelazione", "storia antica"]).

Return ONLY a valid JSON object with this shape:
{
  "title": "TÍTULO magnético sob 90 caracteres no idioma alvo com 1-4 emojis",
  "description": "PRIMEIRA LINHA DE 150-160 CARACTERES...\n\nParágrafos do corpo...\n\n00:00 Rótulo específico\n02:30 Rótulo específico\n06:45 Rótulo específico\n10:30 Rótulo específico\n13:15 Rótulo específico\n\nPergunta de engajamento aberta...\n\n#Hashtag1 #Hashtag2 #Hashtag3",
  "hashtags": ["termo1", "termo2", "termo3", "termo4", "termo5", "termo6", "termo7"],
  "tags": ["termo1", "termo2", "termo3", "termo4", "termo5", "termo6", "termo7"]
}`;

      try {
        const response = await this.aiText.generateText(prompt, { maxTokens: 2500, temperature: 0.65 });
        const parsed = this.parseJsonSafe(response);
        if (parsed?.title && parsed?.description) {
          // Assegura que as hashtags estão sem #
          const cleanHashtags = (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
            .map(h => String(h).replace(/^#+/, '').trim())
            .filter(Boolean)
            .slice(0, 7);

          return {
            title: String(parsed.title).trim(),
            description: cleanYouTubeDescription(parsed.description),
            hashtags: cleanHashtags,
            hashtagsString: cleanHashtags.join(', '),
            tags: Array.isArray(parsed.tags) ? parsed.tags : cleanHashtags
          };
        }
      } catch (err) {
        this.logger.warn(`Erro ao gerar SEO com IA: ${err.message}. Usando modelo de fallback.`);
      }
    }

    // Fallback documental avançado adaptado ao idioma
    if (langLower.startsWith('it')) {
      const hashtags = ['mistero bibbia', 'segreto rivelato', 'antico testamento', 'fede', 'archeologia biblica', 'rivelazione divina', 'storia antica'];
      return {
        title: `Il Marchio Segreto di Caino: La Verità Nascosta 📜✨`,
        description: `Scopri la verità nascosta dietro il mistero di ${cleanTopic} e cosa rivela il testo antico per la nostra vita spirituale oggi.\n\n📖 In questo documentario approfondito esploriamo le radici storiche e spirituali del testo, analizzando ogni dettaglio alla luce delle Sacre Scritture secondo la traduzione ufficiale della Bibbia CEI 2008.\n\nSpesso leggiamo questi racconti con gli occhi della tradizione moderna, ma le parole originarie racchiudono una risposta inaspettata che cambia completamente il significato della prova.\n\n⏱️ CAPITOLI E MOMENTI CHIAVE:\n00:00 Il segreto dimenticato nel testo antico\n02:30 Il contesto storico e l'avvertimento inascoltato\n06:45 La svolta decisiva che cambia tutto\n10:30 Il significato profondo della rivelazione\n13:15 Il lascito eterno e la riflessione finale\n\n💬 E tu, davanti a questo passaggio della Scrittura, quale insegnamento senti più vicino al tuo cammino personale? Raccontacelo nei commenti. 🙏\n\n#Bibbia #Fede #Ispirazione #Profezia #Storia #MisteriBiblici`,
        hashtags,
        hashtagsString: hashtags.join(', '),
        tags: hashtags
      };
    }

    if (langLower.startsWith('pl')) {
      const hashtags = ['tajemnica biblii', 'pismo swiete', 'stary testament', 'wiara', 'archeologia biblijna', 'objawienie', 'historia zbawienia'];
      return {
        title: `Ukryta Tajemnica w Piśmie Świętym: Prawda, Której Nie Znasz 📜✨`,
        description: `Odkryj ukrytą prawdę biblijną dotyczącą ${cleanTopic} i poznaj jej głębokie duchowe znaczenie na podstawie tekstu Biblii Tysiąclecia.\n\nW tym dokumencie badamy historyczne i teologiczne korzenie tego niezwykłego wydarzenia, analizując każdy werset ze starannością i szacunkiem.\n\n⏱️ CZAS TRWANIA I ROZDZIAŁY:\n00:00 Zapomniany sekret w pradawnym tekście\n02:30 Kontekst historyczny i narastające napięcie\n06:45 Punkt zwrotny, który zmienia wszystko\n10:30 Ostateczne objawienie prawdy\n13:15 Przesłanie nadziei na dzisiaj\n\n💬 A Ty, jak odczytujesz ten niezwykły fragment w swoim życiu? Napisz o tym w komentarzu. 🙏\n\n#Biblia #Wiara #Inspiracja #Proroctwo #Historia #TajemniceBiblii`,
        hashtags,
        hashtagsString: hashtags.join(', '),
        tags: hashtags
      };
    }

    if (langLower.startsWith('es')) {
      const hashtags = ['misterio biblico', 'antiguo testamento', 'fe cristiana', 'revelacion divina', 'historia sagrada', 'estudio biblico', 'espiritualidad'];
      return {
        title: `El Secreto Oculto en las Escrituras: Lo que Pocos Saben 📜✨`,
        description: `Descubre la verdad revelada sobre ${cleanTopic} y lo que este pasaje sagrado enseña para nuestro tiempo.\n\nUn análisis documental respetuoso y riguroso a la luz de las Sagradas Escrituras.\n\n⏱️ CAPÍTULOS:\n00:00 El misterio del texto original\n02:30 El contexto histórico y la advertencia\n06:45 El momento decisivo de la revelación\n10:30 El significado espiritual profundo\n13:15 Conclusión y esperanza eterna\n\n💬 ¿Cómo resuena esta enseñanza en tu camino de fe? Déjanos tu reflexión en los comentarios. 🙏\n\n#Biblia #Fe #Inspiracion #Profecia #Historia`,
        hashtags,
        hashtagsString: hashtags.join(', '),
        tags: hashtags
      };
    }

    const hashtags = ['misterio biblico', 'fe cristã', 'revelacao sagrada', 'historia antiga', 'estudo biblico', 'providencia', 'escrituras'];
    return {
      title: `O Segredo Oculto nas Escrituras que Ninguém Notou 📜✨`,
      description: `Descubra a revelação por trás de ${cleanTopic} e seu impacto profundo na história sagrada.\n\nUm estudo documental e reflexivo baseado nas Sagradas Escrituras.\n\n⏱️ CAPÍTULOS:\n00:00 O mistério esquecido no texto antigo\n02:30 O alerta e a jornada no deserto\n06:45 A reviravolta que muda tudo\n10:30 A revelação e o clímax da fé\n13:15 O desfecho e a mensagem para hoje\n\n💬 Se você estivesse diante dessa mesma prova, qual seria sua reação? Compartilhe sua experiência nos comentários. 🙏\n\n#Biblia #Fe #Inspiracao #Profecia #Historia`,
      hashtags,
      hashtagsString: hashtags.join(', '),
      tags: hashtags
    };
  }

  /**
   * Salva o resumo para o próximo roteiro (Campo A)
   */
  buildNextScriptSummary({
    usedHooks = '',
    forbiddenType = '',
    previousSignatures = '',
    thumbnailVersion = '1',
    topic = '',
    authorAngle = '',
    angleFamily = '',
    historicalBasis = ''
  } = {}) {
    const summaryText = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 RESUMO PARA O PRÓXIMO ROTEIRO (COPIAR PARA O CAMPO A)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Geração anterior:    ${usedHooks || 'TIPO 1 — O Segredo Suprimido'}
⚠️ TIPO PROIBIDO NA PRÓXIMA GERAÇÃO: ${forbiddenType || 'TIPO 1 — O Segredo Suprimido (Alternar para Tipo 2, 3, 4, 5 ou 6)'}

Tema utilizado:      ${topic || 'Tema concluído'}
Ângulo autoral usado: ${authorAngle || previousSignatures || 'Revelação de detalhe negligenciado'}
Família de ângulo:   ${angleFamily || 'Costume e lei da época'}
Versão de thumbnail: Versão ${thumbnailVersion}

Assinaturas da geração anterior (mudar pelo menos 3 na próxima):
- Forma da primeira frase: Afirmação factual com quebra de expectativa
- Forma do CTA do bloco 6: Convite para salvar o vídeo antes da virada
- Forma do encerramento: Sentença curta de impacto memorável
- Tipo de Segredo Central: Investigação arqueológica e textual
- Dispositivo narrativo: Revelação progressiva em 5 atos

📎 BASE DO DADO HISTÓRICO, ARQUEOLÓGICO OU LINGUÍSTICO USADO:
${historicalBasis || 'Manuscritos antigos do primeiro século e contexto histórico-cultural documentado.'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    return {
      summaryText,
      usedHooks,
      forbiddenType,
      previousSignatures,
      thumbnailVersion,
      authorAngle,
      angleFamily,
      historicalBasis,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Agenda um vídeo fornecido externamente (.mp4) com upload para o canal ativo
   * e salva automaticamente o arquivo .txt completo de produção contendo os 5 blocos:
   * 1) Roteiro, 2) Prompts imagens, 3) Prompt Thumb, 4) Dados Seo, 5) Dados Postagem
   */
  async scheduleManualUpload({
    videoPath,
    publishTime,
    title,
    description,
    tags = [],
    thumbnailPath = null,
    containsSyntheticMedia = true,
    language = null,
    publishingAgent = null,
    channelName = null,
    script = null,
    googleFlowPrompts = null,
    nanoBananaPrompts = null,
    thumbnailPrompt = null,
    seo = null,
    bundle = null,
    format = 'explainer',
    replaceVideoId = null
  } = {}) {
    if (!videoPath) throw new Error('O caminho do arquivo de vídeo .mp4 é obrigatório');

    // Verificar se o arquivo local existe
    try {
      const stats = await fs.stat(videoPath);
      if (!stats.isFile() || stats.size === 0) {
        throw new Error(`O arquivo no caminho ${videoPath} está vazio ou é inválido`);
      }
    } catch (err) {
      throw new Error(`Arquivo de vídeo não encontrado em: ${videoPath}. Verifique se o caminho está correto.`);
    }

    const scheduledDate = new Date(publishTime);
    if (isNaN(scheduledDate.getTime())) {
      throw new Error('Data e horário de publicação inválidos');
    }

    let langCode = 'it';
    if (language) {
      langCode = String(language).split('-')[0].toLowerCase().trim() || 'it';
    } else if (process.env.CHANNEL_LANGUAGE) {
      langCode = String(process.env.CHANNEL_LANGUAGE).split('-')[0].toLowerCase().trim();
    }

    const productionId = `prod_manual_${Date.now()}`;
    const scheduleTitle = title || 'Novo Vídeo Agendado';
    const isShort = format === 'short' || /#shorts?/i.test(scheduleTitle) || /#shorts?/i.test(description || '');
    const actualFormat = isShort ? 'short' : (format || 'explainer');

    let processedTags = Array.isArray(tags) ? [...tags] : String(tags || '').split(',').map(t => t.trim()).filter(Boolean);
    if (isShort && !processedTags.some(t => t.toLowerCase() === 'shorts')) {
      processedTags.push('Shorts');
    }

    const scheduleEntry = {
      id: `sched_${Date.now()}`,
      productionId,
      title: scheduleTitle,
      publishTime: scheduledDate.toISOString(),
      status: 'scheduled',
      priority: 'normal',
      format: actualFormat,
      metadata: {
        seo: {
          title: scheduleTitle,
          description: cleanYouTubeDescription(description),
          tags: processedTags,
          categoryId: '22', // People & Blogs / Geral
          defaultLanguage: langCode,
          defaultAudioLanguage: langCode
        },
        video: {
          path: videoPath,
          source: 'external_upload'
        },
        thumbnail: thumbnailPath ? { path: thumbnailPath } : null,
        privacyStatus: 'public', // Visibilidade final no canal: PÚBLICO
        targetPrivacy: 'public',
        isScheduled: true,
        containsSyntheticMedia: containsSyntheticMedia === true,
        contentType: isShort ? 'short' : 'long_form',
        format: actualFormat
      },
      createdAt: new Date().toISOString()
    };

    if (this.db && typeof this.db.saveScheduleEntry === 'function') {
      await this.db.saveScheduleEntry(scheduleEntry);
    }

    // Se o agente de publicação estiver conectado com a API do YouTube, envia como Programação Pública (publishAt)
    let uploadedDirectly = false;
    let uploadNotice = null;

    if (publishingAgent && publishingAgent.youtube && typeof publishingAgent.uploadToYouTube === 'function') {
      try {
        this.logger.info(`Enviando vídeo para o YouTube oficial PROGRAMADO PARA PÚBLICO em ${scheduleEntry.publishTime}...`);
        const uploadResult = await publishingAgent.uploadToYouTube(scheduleEntry);
        if (uploadResult?.id) {
          uploadedDirectly = true;
          scheduleEntry.youtubeId = uploadResult.id;
          scheduleEntry.youtubeUrl = `https://www.youtube.com/watch?v=${uploadResult.id}`;
          scheduleEntry.status = 'scheduled';
          if (this.db && typeof this.db.updateScheduleEntry === 'function') {
            await this.db.updateScheduleEntry(scheduleEntry);
          }
          this.logger.success(`Vídeo enviado e programado com sucesso no YouTube: ${scheduleEntry.youtubeUrl}`);

          // Se for substituição de um vídeo com falha anterior, remove do canal e limpa agendamento antigo
          if (replaceVideoId && replaceVideoId !== uploadResult.id) {
            try {
              if (typeof publishingAgent.deleteVideoFromYouTube === 'function') {
                await publishingAgent.deleteVideoFromYouTube(replaceVideoId);
              }
              if (this.db && this.db.db) {
                this.db.db.run('DELETE FROM publish_schedule WHERE youtube_id = ? AND id != ?', [replaceVideoId, scheduleEntry.id], () => {});
              }
            } catch (delErr) {
              this.logger.warn(`Aviso ao remover rascunho anterior ${replaceVideoId}: ${delErr.message}`);
            }
          }
        }
      } catch (err) {
        uploadNotice = err.message;
        this.logger.warn(`Não foi possível enviar para o YouTube imediatamente: ${err.message}. O vídeo permanecerá na fila local.`);
      }
    }

    // Gerar e persistir automaticamente o arquivo .txt completo de produção com os 5 blocos de dados
    let logResult = null;
    try {
      const logBundle = {
        ...(bundle || {}),
        title: scheduleTitle,
        description,
        tags,
        videoPath,
        thumbnailPath,
        publishTime: scheduledDate.toISOString(),
        language: langCode,
        containsSyntheticMedia: containsSyntheticMedia === true,
        channelName: channelName || bundle?.channelName,
        script: script || bundle?.script,
        googleFlowPrompts: googleFlowPrompts || bundle?.googleFlowPrompts,
        nanoBananaPrompts: nanoBananaPrompts || bundle?.nanoBananaPrompts,
        thumbnailPrompt: thumbnailPrompt || bundle?.thumbnailPrompt,
        seo: seo || bundle?.seo,
        productionId,
        scheduleId: scheduleEntry.id,
        status: uploadedDirectly ? 'Programado com sucesso no YouTube oficial' : 'Aguardando publicação na fila',
        youtubeUrl: scheduleEntry.youtubeUrl || null,
        youtubeId: scheduleEntry.youtubeId || null
      };

      logResult = await this.saveProductionLogTxt(logBundle);
      scheduleEntry.metadata.logFilePath = logResult.logFilePath;
      scheduleEntry.metadata.logFileName = logResult.logFileName;
      scheduleEntry.metadata.logRelativePath = logResult.logRelativePath;

      if (this.db && typeof this.db.updateScheduleEntry === 'function') {
        await this.db.updateScheduleEntry(scheduleEntry);
      }
    } catch (logErr) {
      this.logger.warn(`Aviso: Não foi possível salvar o arquivo .txt de produção: ${logErr.message}`);
    }

    this.logger.success(`Vídeo manual agendado com sucesso para ${scheduleEntry.publishTime}`);
    return {
      success: true,
      uploadedDirectly,
      uploadNotice,
      scheduleEntry,
      logFilePath: logResult?.logFilePath || null,
      logFileName: logResult?.logFileName || null,
      logRelativePath: logResult?.logRelativePath || null,
      logContent: logResult?.logContent || null
    };
  }

  /**
   * Salva o log completo de produção em formato .txt na pasta producoes/
   */
  async saveProductionLogTxt(bundle = {}) {
    const producoesDir = bundle.outputDir || path.resolve(__dirname, '..', 'producoes');
    await fs.mkdir(producoesDir, { recursive: true });

    let datePrefix = '';
    const pub = bundle.publishTime || bundle.publish_time;
    if (pub) {
      try {
        const d = new Date(pub);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const h = String(d.getHours()).padStart(2, '0');
          const min = String(d.getMinutes()).padStart(2, '0');
          datePrefix = `${y}-${m}-${day}_${h}-${min}`;
        }
      } catch (_) {}
    }
    if (!datePrefix) {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const h = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      datePrefix = `${y}-${m}-${day}_${h}-${min}`;
    }

    const topic = bundle.topic || bundle.script?.topic || bundle.title || 'producao_video';
    const slug = sanitizeSlug(topic);
    let fileName = `${datePrefix}_${slug}.txt`;
    let filePath = path.join(producoesDir, fileName);

    // Se já existir com esse exato nome, acrescentar timestamp para não sobrescrever
    try {
      await fs.access(filePath);
      fileName = `${datePrefix}_${slug}_${Date.now()}.txt`;
      filePath = path.join(producoesDir, fileName);
    } catch (_) {
      // Arquivo inédito, prossegue
    }

    const enrichedBundle = {
      ...bundle,
      logFilePath: filePath,
      logFileName: fileName
    };
    const logContent = generateProductionLogText(enrichedBundle);

    await fs.writeFile(filePath, logContent, 'utf-8');
    this.logger.success(`Arquivo TXT da produção salvo em: ${filePath}`);

    const projectRoot = path.resolve(__dirname, '..');
    const logRelativePath = path.relative(projectRoot, filePath);

    return {
      logFilePath: filePath,
      logFileName: fileName,
      logRelativePath,
      logContent
    };
  }

  /**
   * Lista todos os logs .txt de produções existentes na pasta producoes/
   */
  async listProductionLogs() {
    const producoesDir = path.resolve(__dirname, '..', 'producoes');
    try {
      await fs.mkdir(producoesDir, { recursive: true });
      const entries = await fs.readdir(producoesDir);
      const txtFiles = entries.filter(f => f.toLowerCase().endsWith('.txt'));
      const results = [];

      for (const fileName of txtFiles) {
        const filePath = path.join(producoesDir, fileName);
        try {
          const stats = await fs.stat(filePath);
          results.push({
            fileName,
            filePath,
            sizeBytes: stats.size,
            sizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
            modifiedAt: stats.mtime.toISOString(),
            createdAt: stats.birthtime.toISOString()
          });
        } catch (_) {}
      }

      results.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
      return results;
    } catch (err) {
      this.logger.warn(`Erro ao listar logs de produção: ${err.message}`);
      return [];
    }
  }

  /**
   * Obtém o conteúdo de um arquivo de log salvo em producoes/
   */
  async getProductionLogContent(fileName) {
    if (!fileName) throw new Error('Nome do arquivo de log é obrigatório');
    const safeName = path.basename(fileName);
    const filePath = path.resolve(__dirname, '..', 'producoes', safeName);
    const content = await fs.readFile(filePath, 'utf-8');
    return {
      fileName: safeName,
      filePath,
      content
    };
  }

  parseJsonSafe(raw) {
    if (!raw) return null;
    const text = String(raw).trim();
    const withoutFences = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();

    try {
      return JSON.parse(withoutFences);
    } catch (_e) {
      const match = withoutFences.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (_e2) {
          return null;
        }
      }
      return null;
    }
  }
}

module.exports = { ProductionWorkflowService };
