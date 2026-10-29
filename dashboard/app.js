const ui = {
  state: null,
  currentView: 'overview',
  refreshing: false,
  toastTimer: null,
  retentionSnapshotId: null,
  engagementVideoId: null,
  engagementDetail: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function apiKey() {
  return localStorage.getItem('yaa_api_key') || '';
}

function requestApiKey() {
  const key = prompt('Informe o valor de API_KEY do seu arquivo .env. Ele será salvo apenas neste navegador.', apiKey());
  if (key !== null) localStorage.setItem('yaa_api_key', key.trim());
  return key;
}

async function api(url, options = {}, retry = true) {
  const key = apiKey();
  const sep = url.includes('?') ? '&' : '?';
  const freshUrl = `${url}${sep}_t=${Date.now()}`;
  const response = await fetch(freshUrl, {
    cache: 'no-store',
    ...options,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'x-api-key': key } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retry && requestApiKey() !== null) return api(url, options, false);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || response.statusText || 'Falha na requisição');
    error.data = data;
    throw error;
  }
  return data;
}

function showToast(message, type = 'success') {
  const mainToast = $('#toast');
  if (mainToast) {
    mainToast.textContent = message;
    mainToast.className = `toast ${type}`;
    mainToast.classList.remove('hidden');
  }

  const openDialog = document.querySelector('dialog[open]');
  if (openDialog) {
    let dialogToast = openDialog.querySelector('.dialog-toast');
    if (!dialogToast) {
      dialogToast = document.createElement('div');
      dialogToast.setAttribute('role', 'status');
      openDialog.appendChild(dialogToast);
    }
    dialogToast.textContent = message;
    dialogToast.className = `toast ${type} dialog-toast`;
    dialogToast.classList.remove('hidden');
  }

  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => {
    if (mainToast) mainToast.classList.add('hidden');
    document.querySelectorAll('.dialog-toast').forEach(t => t.remove());
  }, 4500);
}

function empty(message) {
  return `<div class="empty">${escapeHTML(message)}</div>`;
}

function formatDate(value, includeTime = true) {
  if (!value) return 'Não agendado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não agendado';
  const tz = ui.state?.profile?.timezone || 'America/Sao_Paulo';
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'short', day: 'numeric',
    timeZone: tz,
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function timeAgo(value) {
  if (!value) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'agora mesmo';
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `há ${Math.floor(seconds / 3600)}h`;
  return `há ${Math.floor(seconds / 86400)}d`;
}

const STATUS_TRANSLATIONS = {
  needs_attention: 'Requer atenção',
  needs_review: 'Aguardando revisão',
  waiting_review: 'Aguardando revisão',
  waiting_for_review: 'Aguardando revisão',
  waiting_approval: 'Aguardando aprovação',
  waiting_for_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  published: 'Publicado',
  scheduled: 'Agendado',
  rejected: 'Rejeitado',
  draft: 'Rascunho',
  ready: 'Pronto',
  pending: 'Pendente',
  uploading: 'Enviando',
  uploaded: 'Enviado',
  reconciliation_required: 'Reconciliação necessária',
  action_required: 'Ação necessária',
  queued: 'Na fila',
  running: 'Em execução',
  failed: 'Falhou',
  interrupted: 'Interrompido',
  completed: 'Concluído',
  completed_with_issues: 'Concluído com avisos',
  cancelling: 'Cancelando',
  cancelled: 'Cancelado',
  resuming: 'Retomando',
  resuming_plan: 'Retomando plano',
  researching: 'Pesquisando tendências',
  strategy: 'Estratégia',
  script: 'Roteiro',
  thumbnail: 'Miniatura',
  seo: 'SEO',
  production: 'Produção',
  quality_review: 'Revisão de qualidade',
  research: 'Pesquisa',
  planning: 'Planejamento editorial',
  complete: 'Concluído',
  succeeded: 'Concluído com sucesso',
  submitting: 'Enviando',
  rendering: 'Renderizando',
  rendered: 'Renderizado',
  proposed: 'Proposto',
  generating: 'Gerando',
  regenerating: 'Regerando',
  idle: 'Aguardando',
  in_progress: 'Em andamento',
  passed: 'Aprovado',
  warning: 'Aviso',
  unverified: 'Não verificado',
  not_configured: 'Não configurado',
  active: 'Ativo',
  paused: 'Pausado',
  verified: 'Verificado',
  skipped: 'Ignorado',
  unsupported: 'Não comprovado',
  supported: 'Comprovado',
  waived: 'Dispensado',
  official: 'Oficial',
  article: 'Artigo',
  video: 'Vídeo',
  dataset: 'Base de dados',
  asset: 'Ativo / Licença',
  other: 'Outro',
  standard: 'Padrão',
  high: 'Alto risco',
  narration_current: 'Áudio atualizado',
  narration_pending: 'Áudio pendente',
  narration_failed: 'Falha no áudio',
  narration_unavailable: 'Áudio indisponível',
  narration_intentional_silence: 'Silêncio intencional',
  intentional_silence: 'Silêncio intencional',
  narration_stale: 'Áudio desatualizado',
  narration_generating: 'Gerando áudio',
  current: 'Atualizado',
  partial: 'Parcial',
  unavailable: 'Indisponível',
  needs_rebuild: 'Reconstrução necessária',
  missing_asset: 'Ativo ausente',
  visual_stale: 'Visual desatualizado',
  adopted: 'Adotado',
  awaiting_winner: 'Aguardando vencedor',
  inconclusive: 'Inconclusivo',
  strong_hold: 'Forte retenção',
  rewatch: 'Repetição de público',
  drop_off: 'Queda de retenção',
  unknown: 'Desconhecido',
  auto: 'Automático',
  manual: 'Manual',
  critical: 'Crítica',
  medium: 'Média',
  low: 'Baixa',
  accepted: 'Mantido',
  dismissed: 'Dispensado',
  advisory: 'Consultivo',
  attention_required: 'Atenção necessária',
  info: 'Informação',
  success: 'Sucesso',
  error: 'Erro'
};

const FINDING_RULE_LABELS = {
  'geo.trust_network': 'Rede de Confiança e Fontes (GEO)',
  'geo.entity_salience': 'Destaque de Marca (GEO)',
  'aio.skimmability': 'Legibilidade e Ritmo (AIO)',
  'aio.comparison_intent': 'Estrutura Comparativa (AIO)',
  'aio.direct_answer': 'Resposta Direta (AIO)',
  'aeo.simplicity': 'Clareza e Simplicidade (AEO)',
  'aeo.unit_clarity': 'Clareza de Unidades de Medida (AEO)'
};

const FINDING_SEVERITY_LABELS = {
  critical: 'CRÍTICA',
  high: 'ALTA',
  medium: 'MÉDIA',
  low: 'BAIXA',
  info: 'INFORMATIVA'
};

function translateFindingRule(ruleId) {
  if (!ruleId) return '';
  return FINDING_RULE_LABELS[ruleId] || ruleId;
}

function translateFindingSeverity(sev) {
  if (!sev) return '';
  return FINDING_SEVERITY_LABELS[String(sev).toLowerCase()] || sev;
}

function translateFindingMessage(msg) {
  if (!msg) return '';
  let text = String(msg);
  text = text.replace(/^Trust Network:\s*Long content lacks authority links/i, 'Rede de confiança: Conteúdo longo sem fontes de autoridade vinculadas');
  text = text.replace(/^Skimmability:\s*Paragraph\s*(\d+)\s*exceeds 150 words/i, 'Legibilidade e ritmo: O parágrafo $1 excede 150 palavras');
  text = text.replace(/^Comparison Intent Gap:\s*Missing structured comparison/i, 'Estrutura comparativa: Ausência de segmento comparativo estruturado');
  text = text.replace(/^Entity Salience:\s*Brand "([^"]+)" missing from title\/intro/i, 'Destaque de marca: A marca "$1" não foi mencionada no título ou introdução');
  text = text.replace(/^Direct Answer Void:\s*Answer for "([^"]+)" should be under 60 words/i, 'Resposta direta: A resposta para "$1" deve ter menos de 60 palavras');
  text = text.replace(/^Simplicity Score:\s*Answer for "([^"]+)" is too complex/i, 'Clareza de vocabulário: A resposta para "$1" está muito densa ou complexa');
  text = text.replace(/^Unit Clarity:\s*Units appear without an explanatory expansion/i, 'Clareza de unidades: Medidas citadas sem contextualização ou expansão explicativa');
  return text;
}

function translateFindingRemediation(rem) {
  if (!rem) return '';
  let text = String(rem);
  text = text.replace(/^Attach at least one reviewer-verified authority source to long-form factual content\.?/i, 'Vincule ao menos uma fonte de autoridade oficial ou regulatória verificada a este conteúdo factual.');
  text = text.replace(/^Break the transcript section into shorter spoken beats or chapter-aligned paragraphs\.?/i, 'Divida o trecho do roteiro em falas mais curtas ou parágrafos alinhados aos capítulos do vídeo.');
  text = text.replace(/^Add a clearly structured comparison segment with consistent criteria and an explicit conclusion\.?/i, 'Adicione uma seção de comparação estruturada com critérios consistentes e uma conclusão clara.');
  text = text.replace(/^Mention the brand naturally in the title, description, or opening 200 words\.?/i, 'Mencione a marca ou o canal naturalmente no título, descrição ou nas primeiras 200 palavras.');
  text = text.replace(/^Open the section with a direct answer under 60 words before adding detail\.?/i, 'Inicie a seção com uma resposta direta e concisa (menos de 60 palavras) antes de detalhar.');
  text = text.replace(/^Use shorter words and sentences in the direct-answer portion of this section\.?/i, 'Utilize palavras e frases mais curtas e diretas na parte de resposta rápida desta seção.');
  text = text.replace(/^Expand or explain the unit on first mention in narration, captions, or description\.?/i, 'Explique ou detalhe o significado da unidade de medida na primeira menção falada ou na descrição.');
  text = text.replace(/^Add a verified authority source\.?/i, 'Adicione uma fonte oficial de autoridade verificada.');
  return text;
}

const RESEARCH_SOURCES_MAP = {
  'YouTube most-popular videos': 'Vídeos em alta no YouTube',
  'Configured competitor channels': 'Canais concorrentes monitorados',
  'Channel content history': 'Histórico de conteúdo do canal',
  'Operator-approved channel performance learnings': 'Aprendizados aprovados pelo operador',
  'No usable live signals returned; evergreen strategy fallback': 'Estratégia perene de reserva'
};

function _translateResearchSources(sources) {
  if (!Array.isArray(sources) || !sources.length) return 'Pesquisa pendente';
  return sources.map(src => RESEARCH_SOURCES_MAP[src] || src).join(', ');
}

const _FORMAT_LABELS = {
  tutorial: 'Tutorial',
  explainer: 'Explicativo',
  list: 'Lista',
  review: 'Análise/Review',
  story: 'História'
};

const _LENGTH_LABELS = {
  short: 'Curto · 2–4 min',
  medium: 'Médio · 8–12 min',
  long: 'Longo · 15–20 min'
};

function cleanTitlePrefix(text) {
  if (!text || typeof text !== 'string') return text || '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^How to\s*:?\s*/i, '');
  cleaned = cleaned.replace(/^Cómo\s+hacer(?:\s+para)?\s*:\s*/i, '');
  cleaned = cleaned.replace(/:\s*Step-by-Step Guide\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*Step-by-Step Guide\s*$/i, '');
  cleaned = cleaned.replace(/:\s*Guía paso a paso\s*$/i, '');
  cleaned = cleaned.replace(/\s*-\s*Guía paso a paso\s*$/i, '');
  return cleaned.trim();
}

function label(value) {
  if (!value) return 'Desconhecido';
  const str = String(value).trim();
  const key = str.toLowerCase();
  if (STATUS_TRANSLATIONS[key]) return STATUS_TRANSLATIONS[key];

  const prodMatch = key.match(/^producing_(\d+)_of_(\d+)$/);
  if (prodMatch) {
    return `Produzindo vídeo ${prodMatch[1]} de ${prodMatch[2]}`;
  }

  return str.replaceAll('_', ' ');
}

function statusChip(value) {
  const safe = String(value || 'unknown').toLowerCase();
  return `<span class="status ${escapeHTML(safe)}">${escapeHTML(label(safe))}</span>`;
}

async function refreshDashboard(silent = false) {
  if (ui.refreshing) return;
  ui.refreshing = true;
  const refreshBtn = $('#refresh-button');
  if (!silent && refreshBtn) {
    refreshBtn.classList.add('spinning');
    refreshBtn.disabled = true;
  }
  if (!silent) $('#loading').classList.add('active');
  try {
    ui.state = await api('/api/dashboard');
    renderDashboard();
    if (!silent) {
      showToast('Pipeline e painel atualizados com sucesso!', 'success');
    }
    // Auto-poll if any generation job or pipeline item is actively processing
    const hasActiveJobs = (ui.state.jobs || []).some(j => ['queued', 'running'].includes(j.status)) ||
      (ui.state.pipeline || []).some(p => ['processing', 'queued'].includes(p.status));
    clearTimeout(ui.autoRefreshTimer);
    if (hasActiveJobs) {
      ui.autoRefreshTimer = setTimeout(() => refreshDashboard(true), 4000);
    }
  } catch (error) {
    $('#system-label').textContent = 'Painel indisponível';
    $('#system-dot').classList.remove('online');
    if (!silent) showToast(error.message, 'error');
  } finally {
    ui.refreshing = false;
    if (!silent) $('#loading').classList.remove('active');
    if (!silent && refreshBtn) {
      setTimeout(() => {
        refreshBtn.classList.remove('spinning');
        refreshBtn.disabled = false;
      }, 350);
    }
  }
}

function renderDashboard() {
  const state = ui.state;
  if (!state) return;
  const reviews = (state.pipeline || []).filter(item => ['needs_review', 'needs_attention'].includes(item.review_status));
  const scheduled = (state.schedule || []).filter(item => item.status === 'scheduled');
  const actionableJobs = (state.jobs || []).filter(job => ['queued', 'running', 'failed', 'interrupted'].includes(job.status));

  const brandName = $('#brand-name');
  if (brandName) brandName.textContent = state.profile?.channel_name || 'Automation Studio';

  const setupBanner = $('#setup-banner');
  if (setupBanner) setupBanner.classList.toggle('hidden', !state.system?.setupRequired);

  const sysLabel = $('#system-label');
  if (sysLabel) {
    sysLabel.textContent = state.system?.setupRequired
      ? 'Configuração necessária'
      : state.system?.automationPaused ? 'Automação pausada' : `${state.system?.agents?.length || 0} agentes ativos`;
  }

  const sysDot = $('#system-dot');
  if (sysDot) sysDot.classList.toggle('online', Boolean(state.system?.initialized && !state.system?.automationPaused && !state.system?.setupRequired));

  const autoToggle = $('#automation-toggle');
  if (autoToggle) {
    autoToggle.textContent = state.system?.automationPaused ? 'Retomar automação' : 'Pausar automação';
    autoToggle.disabled = Boolean(state.system?.setupRequired);
  }

  const genBtn = $('#generate-button');
  if (genBtn) genBtn.disabled = Boolean(state.system?.setupRequired);

  const reviewBadge = $('#review-badge');
  if (reviewBadge) {
    reviewBadge.textContent = reviews.length;
    reviewBadge.classList.toggle('hidden', reviews.length === 0);
  }

  const statReview = $('#stat-review');
  if (statReview) statReview.textContent = reviews.length;

  const statSched = $('#stat-scheduled');
  if (statSched) statSched.textContent = scheduled.length;

  const statPub = $('#stat-published');
  if (statPub) statPub.textContent = state.stats?.published || 0;

  const statScore = $('#stat-score');
  if (statScore) statScore.textContent = state.analytics?.averagePerformanceScore ? `${state.analytics.averagePerformanceScore}/100` : '—';

  // Identidade do Canal Ativo no Banner do Overview
  const activeAccount = state.youtubeAccount || null;
  const channelTitle = activeAccount?.title || state.profile?.channel_name || 'Preghiere di Fede Quotidiane';
  const subsCount = activeAccount?.subscriberCount ? Number(activeAccount.subscriberCount).toLocaleString('pt-BR') : '3.660';
  const vidsCount = activeAccount?.videoCount ? Number(activeAccount.videoCount).toLocaleString('pt-BR') : '1.474';
  const thumbUrl = activeAccount?.thumbnail || '';

  const ovTitle = $('#overview-channel-title');
  if (ovTitle) ovTitle.textContent = channelTitle;

  const ovSubs = $('#overview-channel-subs');
  if (ovSubs) ovSubs.textContent = subsCount;

  const ovVids = $('#overview-channel-vids');
  if (ovVids) ovVids.textContent = vidsCount;

  const ovAvatar = $('#overview-channel-avatar');
  const ovFallback = $('#overview-channel-avatar-fallback');
  if (ovAvatar && thumbUrl) {
    ovAvatar.src = thumbUrl;
    ovAvatar.style.display = 'block';
    if (ovFallback) ovFallback.style.display = 'none';
  } else if (ovFallback) {
    if (ovAvatar) ovAvatar.style.display = 'none';
    ovFallback.style.display = 'flex';
  }

  // Métricas Reais do Cronograma Bíblico nos Cards Superiores
  const wfThemesList = Array.isArray(state.workflowThemes) && state.workflowThemes.length
    ? state.workflowThemes
    : (typeof wfPlannedThemes !== 'undefined' && Array.isArray(wfPlannedThemes) ? wfPlannedThemes : []);

  const wfStats = state.workflowStats || {
    total: wfThemesList.length,
    pending: wfThemesList.filter(t => t.status === 'pending').length,
    inProduction: wfThemesList.filter(t => t.status === 'in_production').length,
    posted: wfThemesList.filter(t => t.status === 'posted').length,
    withScript: wfThemesList.filter(t => Boolean(t.full_script && t.full_script.length > 500)).length
  };

  const statWfTotal = $('#stat-wf-total');
  if (statWfTotal) statWfTotal.textContent = wfStats.total;

  const statWfPending = $('#stat-wf-pending');
  if (statWfPending) statWfPending.textContent = wfStats.pending;

  const statWfProd = $('#stat-wf-production');
  if (statWfProd) statWfProd.textContent = wfStats.inProduction;

  renderOverviewStock(state.schedule || []);
  renderOverviewSchedule48h(state.schedule || []);
  renderOverviewNextProduce(wfThemesList);
  renderOverviewThemes(wfThemesList);
  renderOverviewPipelineStatus(wfStats, wfThemesList);

  renderReviews(reviews);
  renderJobs(actionableJobs.length ? actionableJobs : (state.jobs || []).slice(0, 5));

  const overviewSchedule = getOverviewScheduleItems(state.schedule || []);
  const schedBadge = $('#overview-schedule-badge');
  if (schedBadge) {
    if (overviewSchedule.length) {
      const firstDateObj = new Date(overviewSchedule[0].publish_time || overviewSchedule[0].publishTime || Date.now());
      const firstDateStr = firstDateObj.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
      schedBadge.textContent = `${overviewSchedule.length} vídeos (${firstDateStr})`;
      schedBadge.style.display = 'inline-block';
    } else {
      schedBadge.style.display = 'none';
    }
  }
  renderSchedule(overviewSchedule, '#next-schedule');
  renderNotifications(state.notifications || [], state.events || []);
  renderPipeline(state.pipeline || []);
  renderCalendar(state.schedule || []);
  renderWorkflowScheduledQueue(state.schedule || []);
  renderIdeas(state.ideas || []);
  renderAnalytics(state.analytics || {}, state.learning || {});
  renderGrowthExperiments(state.experiments || {});
  renderEngagement(ui.state?.engagement || {});
  renderActivation(state.activation || {});
  renderReadiness(state.readiness || {});
  renderOperator(state.channelStrategy || {}, state.operatorRuns || [], { ...(state.system || {}), readiness: state.readiness });
  populateSettings(state.profile || {}, state.settings || {}, state.system?.videoProviders || []);
  renderYouTubeAccount(state.youtubeAccount, state.youtubeAccountsList || []);
}
window.renderDashboard = renderDashboard;

function renderReadiness(readiness = {}) {
  const status = readiness.status || 'unverified';
  const statusNode = $('#readiness-status');
  statusNode.className = `status ${escapeHTML(status)}`;
  statusNode.textContent = readiness.stale && status !== 'unverified' ? `${label(status)} · desatualizado` : label(status);

  const titles = {
    passed: 'O caminho de produção está verificado.',
    warning: 'Verificações principais passaram com avisos.',
    failed: 'A automação está bloqueada até que isso seja corrigido.',
    unverified: 'Valide o pipeline, sem fazer upload.'
  };
  $('#readiness-title').textContent = titles[status] || titles.unverified;
  const counts = readiness.summary || {};
  $('#readiness-summary').textContent = status === 'unverified'
    ? 'A verificação faz pequenas requisições de texto e narração, verifica o acesso ao canal, compila um MP4 local e valida os metadados. Ela nunca publica nem faz upload de vídeos no YouTube.'
    : `${counts.passed || 0} aprovado(s), ${counts.warnings || 0} aviso(s) e ${counts.failed || 0} falha(s).`;
  $('#readiness-meta').textContent = readiness.completed_at
    ? `Última verificação em ${formatDate(readiness.completed_at)}${readiness.stale ? ' · mais de 24 horas atrás' : ''}`
    : 'Nenhuma verificação de prontidão registrada.';

  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  $('#readiness-checks').innerHTML = checks.length ? checks.map(check => {
    const translatedLabel = translateReadinessLabel(check);
    const translatedMsg = translateReadinessMessage(check.message);
    const translatedRem = translateReadinessRemediation(check.remediation);
    return `
    <article class="readiness-check ${escapeHTML(check.status)}">
      <div class="readiness-check-heading"><span class="readiness-icon" aria-hidden="true">${check.status === 'passed' ? '✓' : check.status === 'failed' ? '×' : '!'}</span><div><strong>${escapeHTML(translatedLabel)}</strong><div class="meta-line">${escapeHTML(label(check.status))}${check.blocking ? ' · bloqueante' : ' · opcional'} · ${(check.durationMs || 0) / 1000}s</div></div></div>
      <p>${escapeHTML(translatedMsg)}</p>
      ${translatedRem ? `<small><strong>Próximo passo:</strong> ${escapeHTML(translatedRem)}</small>` : ''}
    </article>`;
  }).join('') : empty('Execute a verificação para inspecionar todas as dependências de produção.');
}

function translateReadinessLabel(check) {
  const idMap = {
    'text_provider': 'Provedor de texto IA',
    'image_provider': 'Provedor de imagem IA',
    'video_provider': 'Geração de vídeo IA',
    'voice_narration': 'Narração de voz',
    'video_assembly': 'Montagem de áudio e vídeo',
    'youtube_access': 'Acesso ao canal do YouTube',
    'upload_metadata': 'Metadados de envio'
  };
  if (check.id && idMap[check.id]) return idMap[check.id];
  const labelMap = {
    'Voice narration': 'Narração de voz',
    'Audio/video assembly': 'Montagem de áudio e vídeo',
    'YouTube channel access': 'Acesso ao canal do YouTube',
    'Upload metadata': 'Metadados de envio',
    'AI text provider': 'Provedor de texto IA',
    'Image provider': 'Provedor de imagem IA',
    'AI video provider': 'Geração de vídeo IA'
  };
  return labelMap[check.label] || check.label || 'Verificação';
}

function translateReadinessMessage(msg) {
  if (!msg || typeof msg !== 'string') return msg || '';
  let res = msg;
  res = res.replace(/Google Gemini returned a live response\./i, 'O Google Gemini respondeu com sucesso ao teste ao vivo.');
  res = res.replace(/Provider is configured; the paid live image probe was not requested\./i, 'Provedor configurado; o teste pago de imagem não foi solicitado.');
  res = res.replace(/Local slideshow video generation is selected; no paid AI video provider is required\./i, 'Geração local por slides selecionada; nenhum provedor pago de vídeo é necessário.');
  res = res.replace(/A live narration sample was generated\./i, 'Uma amostra de áudio e voz em espanhol foi gerada e validada.');
  res = res.replace(/FFmpeg created and decoded a local MP4 containing audio and video\./i, 'O FFmpeg criou e decodificou um vídeo MP4 de teste contendo áudio e vídeo.');
  res = res.replace(/Authorized channel access verified for (.+)\./i, 'Acesso autorizado ao canal verificado com sucesso para $1.');
  res = res.replace(/(\d+) queued upload\(s\) passed metadata validation\./i, 'Metadados de envio validados com sucesso.');
  res = res.replace(/Upload metadata validation passed\./i, 'Metadados de envio validados com sucesso.');
  return res;
}

function translateReadinessRemediation(rem) {
  if (!rem || typeof rem !== 'string') return rem || '';
  let res = rem;
  res = res.replace(/Enable "Include paid image probe" on the next readiness run to verify image generation\./i, 'Ative "Incluir teste de imagem IA" para testar a geração paga de imagens.');
  res = res.replace(/Enable "Include paid video probe" on the next readiness run to verify AI video generation\./i, 'Ative "Incluir teste de vídeo IA" para testar a geração paga de clipes de vídeo.');
  return res;
}

function renderReviews(reviews) {
  const container = $('#review-list');
  if (!reviews.length) {
    container.innerHTML = empty('Nada pendente. Novos conteúdos aparecerão aqui após a revisão de qualidade.');
    return;
  }
  container.innerHTML = reviews.slice(0, 5).map(item => {
    const thumbUrl = item.hasThumbnail ? `/api/content/${encodeURIComponent(item.id)}/asset/thumbnail` : null;
    const cleanTitle = cleanTitlePrefix(item.title);
    return `
    <article class="review-card">
      <div class="review-thumb-box">
        ${thumbUrl ? `<img class="review-thumb" src="${thumbUrl}" alt="Miniatura" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
        <div class="review-thumb-fallback" style="${thumbUrl ? 'display:none;' : 'display:flex;'}">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        </div>
      </div>
      <div class="review-meta">
        <strong>${escapeHTML(cleanTitle)}</strong>
        <div class="meta-line">${statusChip(item.review_status)} · Qualidade ${qualityScore(item.qualityChecks)}%</div>
      </div>
      <button class="button secondary small" data-open-content="${escapeHTML(item.id)}">Revisar</button>
    </article>`;
  }).join('');
}

function renderJobs(jobs) {
  const container = $('#job-list');
  if (!jobs.length) {
    container.innerHTML = empty('Nenhuma execução de geração ainda.');
    return;
  }
  const stages = ['strategy', 'script', 'thumbnail', 'seo', 'production', 'quality_review'];
  container.innerHTML = jobs.slice(0, 6).map(job => {
    const checkpoints = Array.isArray(job.checkpoints) ? job.checkpoints : [];
    const completed = new Set(checkpoints.filter(item => item.status === 'completed').map(item => item.stage));
    const mediaTasks = Array.isArray(job.mediaTasks) ? job.mediaTasks : [];
    const mediaCompleted = mediaTasks.filter(item => item.status === 'succeeded').length;
    const mediaProviders = [...new Set(mediaTasks.map(item => label(item.provider)))].join(', ');
    const resumeFrom = stages.find(stage => !completed.has(stage)) || 'quality_review';
    const recoverable = ['failed', 'interrupted'].includes(job.status);
    const isCompleted = job.status === 'completed';
    const cleanTitle = cleanTitlePrefix(job.title || job.topic || 'Tópico selecionado pelo agente');
    return `
    <article class="job-card" data-status="${escapeHTML(job.status)}">
      <div class="job-meta">
        <strong>${escapeHTML(cleanTitle)}</strong>
        <div class="meta-line">${statusChip(job.status)} · ${escapeHTML(label(job.stage))} · ${timeAgo(job.updated_at)}</div>
        ${checkpoints.length ? `<div class="checkpoint-line">${completed.size}/${stages.length} etapas salvas${job.details?.reusedStages?.length ? ` · ${job.details.reusedStages.length} reutilizadas` : ''}</div>` : ''}
        ${mediaTasks.length ? `<div class="checkpoint-line">Vídeo: ${mediaCompleted}/${mediaTasks.length} clipes prontos · ${escapeHTML(mediaProviders)}</div>` : ''}
        <div class="progress ${isCompleted ? 'completed' : ''}"><i style="width:${Math.max(0, Math.min(100, job.progress || 0))}%"></i></div>
      </div>
      ${['queued', 'running'].includes(job.status) ? `<button class="text-button" data-cancel-job="${escapeHTML(job.id)}">Cancelar</button>` : ''}
      ${recoverable ? `<div class="job-recovery"><select data-resume-stage-for="${escapeHTML(job.id)}" aria-label="Etapa para retomar">${stages.map(stage => `<option value="${stage}" ${stage === resumeFrom ? 'selected' : ''}>${escapeHTML(label(stage))}</option>`).join('')}</select><button class="button secondary small" data-resume-job="${escapeHTML(job.id)}">Retomar</button></div>` : ''}
    </article>`;
  }).join('');
}

function getOverviewScheduleItems(schedule = []) {
  if (!Array.isArray(schedule) || !schedule.length) return [];

  const activeItems = schedule.filter(item => ['scheduled', 'uploading', 'published'].includes(item.status));
  const listToUse = activeItems.length ? activeItems : schedule;

  const sorted = [...listToUse].sort((a, b) => {
    const da = new Date(a.publish_time || a.publishTime || 0).getTime();
    const db = new Date(b.publish_time || b.publishTime || 0).getTime();
    return da - db;
  });

  if (!sorted.length) return [];

  const tz = ui.state?.profile?.timezone || 'America/Sao_Paulo';
  const dFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });

  // Agrupar por data (YYYY-MM-DD no fuso do canal/Brasil)
  const dateGroups = new Map();
  for (const item of sorted) {
    const timeVal = item.publish_time || item.publishTime;
    const dateObj = timeVal ? new Date(timeVal) : null;
    let dateKey = 'unknown';
    if (dateObj && !Number.isNaN(dateObj.getTime())) {
      try {
        dateKey = dFmt.format(dateObj);
      } catch (_e) {
        dateKey = dateObj.toISOString().split('T')[0];
      }
    }

    if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, []);
    dateGroups.get(dateKey).push(item);
  }

  // Garantir que TODOS os vídeos do dia seguinte (primeiro dia de publicação futuro) sejam incluídos
  const result = [];
  for (const [_key, items] of dateGroups.entries()) {
    result.push(...items);
    if (result.length >= 6) {
      break;
    }
  }

  return result.length ? result : sorted.slice(0, 8);
}

function renderSchedule(schedule, selector) {
  const container = $(selector);
  if (!container) return;
  if (!schedule.length) {
    container.innerHTML = empty('Nenhum vídeo aprovado está agendado.');
    return;
  }
  const tz = ui.state?.profile?.timezone || 'America/Sao_Paulo';

  container.innerHTML = schedule.map(item => {
    const cleanTitle = cleanTitlePrefix(item.title || 'Vídeo sem título');
    const publishDate = item.publish_time || item.publishTime;
    const youtubeUrl = item.youtube_url || item.youtubeUrl;
    const isLive = Boolean(youtubeUrl);
    const dateObj = publishDate ? new Date(publishDate) : new Date();
    const monthStr = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, month: 'short' }).format(dateObj);
    const dayNum = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: 'numeric' }).format(dateObj);

    const shortFormat = isItemShort(item);
    const formatBadge = shortFormat
      ? '<span style="font-size: 10px; padding: 2px 6px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 4px; font-weight: 600;">📱 Short</span>'
      : '<span style="font-size: 10px; padding: 2px 6px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 4px; font-weight: 600;">🎬 Vídeo</span>';

    return `
    <div class="timeline-item" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; margin-bottom: 6px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px;">
      <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
        <div class="date-chip" style="min-width: 46px; text-align: center; padding: 5px 4px; background: rgba(255, 255, 255, 0.04); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08);">
          <small style="display: block; font-size: 10px; text-transform: uppercase; color: var(--muted);">${escapeHTML(monthStr)}</small>
          <strong style="display: block; font-size: 15px; color: var(--text); line-height: 1.1;">${escapeHTML(dayNum)}</strong>
        </div>
        <div class="timeline-meta" style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap;">
            ${formatBadge}
            <strong title="${escapeHTML(cleanTitle)}" style="font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 380px;">${escapeHTML(cleanTitle)}</strong>
          </div>
          <div class="meta-line" style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted);">
            <span>📅 ${formatDate(publishDate)}</span>
            <span>·</span>
            <span>${statusChip(item.status)}</span>
            ${isLive ? '<span>·</span><span style="color: var(--green); font-size: 11px; font-weight: 600;">✓ No YouTube</span>' : ''}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
        ${youtubeUrl ? `<a href="${escapeHTML(youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="button secondary small" style="text-decoration: none; font-size: 11.5px; padding: 4px 10px;">Assistir ↗</a>` : ''}
        ${item.production_id && !item.production_id.startsWith('prod_manual_') ? `<button class="text-button" data-open-content="${escapeHTML(item.production_id)}">Ver</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderOverviewStock(schedule = []) {
  const stockPill = $('#overview-stock-pill');
  const stockIcon = $('#overview-stock-icon');
  const stockText = $('#overview-stock-text');
  const statStockDays = $('#stat-stock-days');
  const statStockUntil = $('#stat-stock-until');

  if (!Array.isArray(schedule) || !schedule.length) {
    if (stockPill) {
      stockPill.className = 'overview-stock-pill danger';
      if (stockIcon) stockIcon.textContent = '🚨';
      if (stockText) stockText.textContent = 'Sem agendamentos futuros';
    }
    if (statStockDays) statStockDays.textContent = '0 dias';
    if (statStockUntil) statStockUntil.textContent = 'grade vazia';
    return;
  }

  const now = Date.now();
  const tz = ui.state?.profile?.timezone || 'America/Sao_Paulo';

  // Buscar todos os vídeos válidos agendados para o futuro
  const futureTimes = schedule
    .map(item => {
      const timeVal = item.publish_time || item.publishTime;
      return timeVal ? new Date(timeVal).getTime() : 0;
    })
    .filter(t => t > now);

  if (!futureTimes.length) {
    if (stockPill) {
      stockPill.className = 'overview-stock-pill danger';
      if (stockIcon) stockIcon.textContent = '🚨';
      if (stockText) stockText.textContent = 'Estoque esgotado (0 dias à frente)';
    }
    if (statStockDays) statStockDays.textContent = '0 dias';
    if (statStockUntil) statStockUntil.textContent = 'sem vídeos futuros';
    return;
  }

  const maxTime = Math.max(...futureTimes);
  const diffMs = maxTime - now;
  const daysAhead = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const maxDateObj = new Date(maxTime);
  const dateStr = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: 'short' }).format(maxDateObj);

  let statusClass = 'passed';
  let icon = '✅';
  let message = `Grade Coberta: ${daysAhead} dias garantidos (até ${dateStr})`;

  if (daysAhead < 3) {
    statusClass = 'danger';
    icon = '🚨';
    message = `Estoque Crítico: apenas ${daysAhead} dia(s) garantido(s) (até ${dateStr})`;
  } else if (daysAhead < 7) {
    statusClass = 'warning';
    icon = '⚠️';
    message = `Atenção: ${daysAhead} dias de estoque restante (até ${dateStr})`;
  }

  if (stockPill) {
    stockPill.className = `overview-stock-pill ${statusClass}`;
    if (stockIcon) stockIcon.textContent = icon;
    if (stockText) stockText.textContent = message;
  }

  if (statStockDays) {
    statStockDays.textContent = `${daysAhead} dias`;
  }
  if (statStockUntil) {
    statStockUntil.textContent = `garantidos até ${dateStr}`;
  }
}

function renderOverviewSchedule48h(schedule = []) {
  const container = $('#overview-schedule-48h-list');
  const badge = $('#overview-schedule-48h-badge');
  if (!container) return;

  if (!Array.isArray(schedule) || !schedule.length) {
    container.innerHTML = empty('Nenhum vídeo agendado no canal.');
    if (badge) badge.style.display = 'none';
    return;
  }

  const tz = ui.state?.profile?.timezone || 'America/Sao_Paulo';
  const now = new Date();
  const nowMs = now.getTime();
  const windowLimitMs = nowMs + 48 * 60 * 60 * 1000;

  // Filtrar publicações de hoje e amanhã (ou nas próximas 48h com tolerância de 4h para trás)
  const itemsIn48h = schedule.filter(item => {
    const timeVal = item.publish_time || item.publishTime;
    if (!timeVal) return false;
    const itemMs = new Date(timeVal).getTime();
    if (Number.isNaN(itemMs)) return false;
    return itemMs >= (nowMs - 4 * 60 * 60 * 1000) && itemMs <= windowLimitMs;
  }).sort((a, b) => {
    const da = new Date(a.publish_time || a.publishTime || 0).getTime();
    const db = new Date(b.publish_time || b.publishTime || 0).getTime();
    return da - db;
  });

  if (badge) {
    if (itemsIn48h.length > 0) {
      badge.textContent = `${itemsIn48h.length} lançamento${itemsIn48h.length > 1 ? 's' : ''}`;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (!itemsIn48h.length) {
    const nextFuture = schedule
      .filter(item => {
        const timeVal = item.publish_time || item.publishTime;
        return timeVal && new Date(timeVal).getTime() > nowMs;
      })
      .sort((a, b) => new Date(a.publish_time || a.publishTime).getTime() - new Date(b.publish_time || b.publishTime).getTime())[0];

    const nextStr = nextFuture
      ? new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(nextFuture.publish_time || nextFuture.publishTime))
      : 'Nenhuma data futura';

    container.innerHTML = `
      <div style="padding: 24px; text-align: center; background: rgba(255, 255, 255, 0.02); border-radius: 10px; border: 1px dashed rgba(255, 255, 255, 0.1);">
        <p style="margin: 0; color: var(--text-2); font-size: 13px;">Nenhum vídeo agendado para as próximas 48 horas.</p>
        <p style="margin: 6px 0 0; font-size: 12px; color: var(--muted);">Próximo vídeo agendado no canal: <strong style="color: #38bdf8;">${escapeHTML(nextStr)}</strong></p>
        <button type="button" class="button secondary small" data-go="calendar" style="margin-top: 12px;">Abrir Calendário Completo →</button>
      </div>`;
    return;
  }

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const tomorrowObj = new Date(now);
  tomorrowObj.setDate(tomorrowObj.getDate() + 1);
  const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrowObj);

  container.innerHTML = itemsIn48h.map(item => {
    const cleanTitle = cleanTitlePrefix(item.title || 'Vídeo sem título');
    const publishDate = item.publish_time || item.publishTime;
    const youtubeUrl = item.youtube_url || item.youtubeUrl;
    const dateObj = publishDate ? new Date(publishDate) : new Date();
    
    let itemDateKey = '';
    try {
      itemDateKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(dateObj);
    } catch (_e) {
      itemDateKey = '';
    }

    const timeStr = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(dateObj);
    
    let timeTagClass = 'time-tag future';
    let timeTagLabel = `${timeStr}`;
    if (itemDateKey === todayStr) {
      timeTagClass = 'time-tag today';
      timeTagLabel = `Hoje · ${timeStr}`;
    } else if (itemDateKey === tomorrowStr) {
      timeTagClass = 'time-tag tomorrow';
      timeTagLabel = `Amanhã · ${timeStr}`;
    } else {
      const dayMonth = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: 'short' }).format(dateObj);
      timeTagLabel = `${dayMonth} · ${timeStr}`;
    }

    const shortFormat = isItemShort(item);
    const formatBadge = shortFormat
      ? '<span style="font-size: 10.5px; padding: 2px 7px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 4px; font-weight: 600;">⚡ Short</span>'
      : '<span style="font-size: 10.5px; padding: 2px 7px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 4px; font-weight: 600;">🎬 Longo</span>';

    return `
      <div class="schedule-48h-item">
        <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
          <span class="${timeTagClass}">${escapeHTML(timeTagLabel)}</span>
          ${formatBadge}
          <strong title="${escapeHTML(cleanTitle)}" style="font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">
            ${escapeHTML(cleanTitle)}
          </strong>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          ${youtubeUrl ? `<a href="${escapeHTML(youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="button secondary small" style="text-decoration: none; font-size: 11px; padding: 4px 9px;">Assistir ↗</a>` : '<span style="font-size: 11px; color: var(--muted); background: rgba(255,255,255,0.05); padding: 3px 8px; border-radius: 4px;">Agendado</span>'}
        </div>
      </div>
    `;
  }).join('');
}

function renderOverviewNextProduce(themes = []) {
  const container = $('#overview-next-produce-container');
  if (!container) return;

  if (!Array.isArray(themes) || !themes.length) {
    container.innerHTML = `
      <div class="next-produce-card">
        <div class="next-produce-header">
          <span class="status queued">⏳ Cronograma Vazio</span>
        </div>
        <h3 class="next-produce-title">Nenhum tema planejado no momento</h3>
        <p style="color: var(--muted); font-size: 13px; margin: 0;">Gere 7 novos temas bíblicos usando o planejador com inteligência artificial para abastecer seu canal.</p>
        <div class="next-produce-actions">
          <button type="button" class="button primary" id="overview-card-plan-ai-btn" style="width: 100%; justify-content: center; font-size: 13.5px; font-weight: 600; padding: 11px 16px;">
            ✨ Planejar Novos Temas com IA
          </button>
        </div>
      </div>
    `;
    $('#overview-card-plan-ai-btn')?.addEventListener('click', () => {
      switchView('workflow');
      setWorkflowStudioMode('full', false);
      setTimeout(() => $('#wf-open-scheduler-btn')?.click(), 120);
    });
    return;
  }

  // 1. Procurar tema em produção ativa
  let target = themes.find(t => t.status === 'in_production');
  let isProd = Boolean(target);

  // 2. Se não houver em produção, pegar o primeiro pendente
  if (!target) {
    target = themes.find(t => t.status === 'pending');
  }

  // 3. Se todos já foram postados, pegar o último
  if (!target) {
    target = themes[0];
  }

  const cleanTopic = cleanTitlePrefix(target.topic || 'Tema sem título');
  const dateObj = target.scheduled_date ? new Date(`${target.scheduled_date}T12:00:00`) : null;
  const dateStr = dateObj && !Number.isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
    : target.scheduled_date || 'A definir';

  const isShort = target.format === 'short';
  const formatBadge = isShort
    ? '<span style="font-size: 11px; padding: 2px 7px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 4px; font-weight: 600;">⚡ Short Bíblico</span>'
    : '<span style="font-size: 11px; padding: 2px 7px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 4px; font-weight: 600;">🎬 Documentário (10.000 carac.)</span>';

  const statusBadge = isProd
    ? '<span class="status running" style="font-size: 11px; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35);">🎬 Em Produção Ativa</span>'
    : '<span class="status queued" style="font-size: 11px;">⏳ Próximo da Fila</span>';

  const hasScript = Boolean(target.full_script && target.full_script.length > 500);
  const scriptBadge = hasScript
    ? `<span style="font-size: 11px; padding: 2px 7px; border-radius: 4px; background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 600; border: 1px solid rgba(16, 185, 129, 0.3);">📜 Roteiro Pronto (${(target.script_char_count || target.full_script.length).toLocaleString()} carac.)</span>`
    : `<span style="font-size: 11px; padding: 2px 7px; border-radius: 4px; background: rgba(255, 255, 255, 0.05); color: var(--muted); border: 1px solid rgba(255, 255, 255, 0.08);">⏳ Roteiro a Gerar (10.000 carac.)</span>`;

  const hookContent = target.hook_angle || target.angle || target.hook || 'Passagem bíblica e narrativa detalhada no padrão Bibbia CEI 2008.';

  container.innerHTML = `
    <div class="next-produce-card">
      <div class="next-produce-header">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          ${statusBadge}
          ${formatBadge}
        </div>
        <span style="font-size: 12px; color: var(--muted); font-family: var(--font-mono);">
          📅 Publicação: <strong style="color: #fff;">${escapeHTML(dateStr)}</strong>
        </span>
      </div>

      <h3 class="next-produce-title" title="${escapeHTML(cleanTopic)}">
        ${escapeHTML(cleanTopic)}
      </h3>

      <div class="next-produce-callout">
        <strong>🎣 Gancho &amp; Ângulo Teológico:</strong>
        <p>${escapeHTML(hookContent)}</p>
      </div>

      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        ${scriptBadge}
      </div>

      <div class="next-produce-actions">
        <button type="button" class="button primary" data-use-planned-theme="${escapeHTML(target.id)}" data-theme-topic="${escapeHTML(target.topic)}" data-theme-angle="${escapeHTML(target.hook_angle || '')}" data-theme-format="${escapeHTML(target.format || 'story')}" style="width: 100%; justify-content: center; font-size: 13.5px; font-weight: 600; padding: 12px 18px; box-shadow: 0 4px 14px rgba(255, 77, 94, 0.35);">
          👉 ${isProd ? 'Continuar Produção no Modelador' : 'Produzir Este Roteiro no Modelador'}
        </button>
        <button type="button" class="button secondary small" data-go="workflow" style="width: 100%; justify-content: center;">
          Alternar Tema / Ver Todos os ${themes.length} no Estúdio →
        </button>
      </div>
    </div>
  `;
}

// Compatibilidade legada caso chamadas externas ainda existam
function renderOverviewThemes(themes = []) {
  const container = $('#overview-themes-list');
  if (!container) return;
  container.innerHTML = '';
}

function renderOverviewPipelineStatus(stats = {}, themes = []) {
  const container = $('#overview-pipeline-status');
  if (!container) return;
  container.innerHTML = '';
}


const NOTIFICATION_TITLE_TRANSLATIONS = {
  'Content approved': 'Conteúdo aprovado',
  'Content ready for review': 'Conteúdo pronto para revisão',
  'Content needs attention': 'Conteúdo requer atenção',
  'Generation started': 'Geração iniciada',
  'Generation completed': 'Geração concluída',
  'Generation failed': 'Falha na geração',
  'Generation cancelled': 'Geração cancelada',
  'Video uploaded': 'Vídeo publicado no YouTube',
  'Production scheduled': 'Produção agendada',
  'Autonomous plan is ready for review': 'Plano autônomo pronto para revisão',
  'review_required': 'Revisão necessária',
  'generation_failure': 'Falha na geração',
  'generation_cancelled': 'Geração cancelada'
};

function translateNotification(item) {
  let title = NOTIFICATION_TITLE_TRANSLATIONS[item.title] || label(item.title) || item.title;
  let message = item.message || '';

  // Clean English prefixes
  message = message.replace(/^How to\s+/i, '');
  message = message.replace(/:\s*Step-by-Step Guide/i, '');
  message = message.replace(/\bis scheduled for\b/gi, 'está agendado para');
  message = message.replace(/\bis ready for approval\b/gi, 'está pronto para sua aprovação');
  message = message.replace(/\bfailed one or more quality checks\b/gi, 'não passou em uma ou mais verificações de qualidade');
  message = message.replace(/\bNo live narration provider is configured\b/gi, 'Nenhum provedor de voz configurado');
  message = message.replace(/\bNarration is missing\b/gi, 'Áudio de narração ausente');
  message = message.replace(/(\d+)\s+of\s+(\d+)\s+planned videos finished production/gi, '$1 de $2 vídeos planejados concluíram a produção');

  // Format any ISO date strings in the message to Brazilian format
  message = message.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, match => {
    return formatDate(match);
  });

  title = cleanTitlePrefix(title);
  return { ...item, title, message };
}

function renderNotifications(notifications, events) {
  const rawItems = notifications.length
    ? notifications
    : events.map(event => ({ level: event.status === 'error' ? 'error' : 'info', title: label(event.event_type), message: event.data?.error || label(event.status), created_at: event.created_at }));
  const items = rawItems.map(translateNotification);
  const container = $('#notification-list');
  if (!items.length) {
    container.innerHTML = empty('Nenhuma atividade registrada ainda.');
    return;
  }
  container.innerHTML = items.slice(0, 7).map(item => `
    <div class="activity ${escapeHTML(item.level || 'info')}"><i></i><p><strong>${escapeHTML(item.title)}</strong><br><span class="meta-line">${escapeHTML(item.message)}</span></p><small>${timeAgo(item.created_at)}</small></div>`).join('');
}

function currentPipelineFilter() {
  return $('#pipeline-filter').value || 'all';
}

function renderPipeline(items) {
  const filter = currentPipelineFilter();
  const filtered = filter === 'all' ? items : items.filter(item =>
    item.review_status === filter || item.schedule_status === filter || item.status === filter
  );
  const container = $('#pipeline-list');
  if (!filtered.length) {
    container.innerHTML = empty('Nenhum conteúdo encontrado nesta visualização.');
    return;
  }
  container.innerHTML = filtered.map(item => {
    const state = item.schedule_status || item.review_status || item.status;
    const next = nextAction(item);
    return `<article class="pipeline-item" data-open-content="${escapeHTML(item.id)}">
      <div class="pipeline-title"><strong>${escapeHTML(cleanTitlePrefix(item.title))}</strong><span>${escapeHTML(cleanTitlePrefix(item.topic) || 'Nenhum tópico registrado')} · ${formatDate(item.created_at)}</span></div>
      <div class="pipeline-col"><span>Estado</span><strong>${statusChip(state)}</strong></div>
      <div class="pipeline-col"><span>Qualidade</span><strong>${qualityScore(item.qualityChecks)} / 100</strong></div>
      <button class="button secondary small">${escapeHTML(next)} →</button>
    </article>`;
  }).join('');
}

function qualityScore(checks) {
  if (!Array.isArray(checks) || !checks.length) return 0;
  return Math.round((checks.filter(check => check.passed).length / checks.length) * 100);
}

function nextAction(item) {
  if (item.schedule_status === 'published') return 'Ver';
  if (item.review_status === 'needs_attention') return 'Corrigir pendências';
  if (item.review_status === 'needs_review') return 'Revisar';
  if (item.schedule_status === 'scheduled') return 'Agendado';
  return 'Inspecionar';
}

let calendarCurrentPeriod = '30';
let calendarCurrentFormat = 'all';
let calendarHasSyncedYT = false;

function isItemShort(item) {
  if (!item) return false;
  let meta = item.metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch (_err) {
      meta = {};
    }
  }

  // 1. Sinalizador booleano explícito (no metadata ou raiz do objeto)
  if (meta && typeof meta.isShort === 'boolean') return meta.isShort;
  if (meta && typeof meta.is_short === 'boolean') return meta.is_short;
  if (typeof item.isShort === 'boolean') return item.isShort;
  if (typeof item.is_short === 'boolean') return item.is_short;

  // 2. Formato textual explícito
  const fmt = String(item.format || meta?.format || meta?.contentType || meta?.contentFormat || '').toLowerCase();
  if (['short', 'shorts', 'corte', 'cortes'].includes(fmt)) return true;
  if (['long', 'explainer', 'documentary', 'longo'].includes(fmt)) return false;

  // 3. Duração ISO (ex: PT29S, PT47S, PT13M5S) ou numérica em segundos
  const rawDur = meta?.duration || item.duration || '';
  if (rawDur) {
    const dMatch = String(rawDur).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
    if (dMatch) {
      const h = parseInt(dMatch[1] || '0', 10);
      const m = parseInt(dMatch[2] || '0', 10);
      const s = parseInt(dMatch[3] || '0', 10);
      const totalSec = h * 3600 + m * 60 + s;
      if (totalSec > 0) return totalSec <= 65;
    }
  }
  const durSec = meta?.durationSec || item.durationSec;
  if (typeof durSec === 'number' && durSec > 0) {
    return durSec <= 65;
  }

  // 4. Marcações explícitas de hashtag shorts no título, descrição ou tags
  const title = (item.title || meta?.seo?.title || '').toLowerCase();
  if (/#shorts?\b/i.test(title)) return true;
  if (meta?.description && /#shorts?\b/i.test(meta.description)) return true;
  if (Array.isArray(meta?.tags) && meta.tags.some(t => /#?shorts?\b/i.test(String(t)))) return true;

  return false;
}

function filterScheduleByPeriod(schedule = [], period = '30', format = 'all') {
  const now = Date.now();
  // Permitir vídeos do dia de hoje (a partir do início de hoje)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  let filtered = schedule.filter(item => {
    const time = new Date(item.publish_time || item.publishTime).getTime();
    if (!Number.isFinite(time)) return false;

    // Se o período não for 'all', filtrar pelo limite máximo de dias
    if (period !== 'all') {
      const days = Number(period);
      if (Number.isFinite(days)) {
        const maxMs = now + (days * 24 * 60 * 60 * 1000);
        if (time > maxMs) return false;
      }
    }

    // Apenas vídeos futuros ou agendados para hoje em diante
    return time >= todayStartMs - (2 * 60 * 60 * 1000);
  });

  // Filtrar por formato se especificado
  if (format === 'long') {
    filtered = filtered.filter(item => !isItemShort(item));
  } else if (format === 'short') {
    filtered = filtered.filter(item => isItemShort(item));
  }

  // Ordenar cronologicamente (mais próximo primeiro)
  filtered.sort((a, b) => {
    const ta = new Date(a.publish_time || a.publishTime).getTime();
    const tb = new Date(b.publish_time || b.publishTime).getTime();
    return ta - tb;
  });

  return filtered;
}

function renderCalendar(schedule = []) {
  const container = $('#calendar-list');
  const countBadge = $('#cal-scheduled-badge');
  const summarySpan = $('#cal-period-summary');

  // Filtrar por período (7, 15, 30 ou Todos) e Formato (Todos, Longos, Shorts)
  const filtered = filterScheduleByPeriod(schedule, calendarCurrentPeriod, calendarCurrentFormat);

  if (countBadge) {
    countBadge.textContent = `${filtered.length} agendado${filtered.length === 1 ? '' : 's'}`;
  }

  if (summarySpan) {
    const periodText = calendarCurrentPeriod === 'all' 
      ? 'todos os agendamentos' 
      : `próximos ${calendarCurrentPeriod} dias`;
    const formatText = calendarCurrentFormat === 'long' 
      ? ' (apenas longos)' 
      : calendarCurrentFormat === 'short' 
        ? ' (apenas shorts)' 
        : '';
    summarySpan.textContent = `Exibindo ${periodText}${formatText}`;
  }

  if (container) {
    if (!filtered.length) {
      container.innerHTML = `
        <div class="empty">
          <p style="color: var(--text-2); font-size: 13.5px; margin-bottom: 12px; text-align: center;">
            Nenhum vídeo programado para os próximos ${calendarCurrentPeriod === 'all' ? 'meses' : calendarCurrentPeriod + ' dias'}${calendarCurrentFormat !== 'all' ? ' neste formato' : ''}.
          </p>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="button secondary small" onclick="syncCalendarFromYouTube()">
              🔄 Buscar Agendamentos no YouTube
            </button>
            <a href="#workflow" class="button primary small" style="text-decoration: none;">
              🎬 Programar Novo Vídeo no Estúdio
            </a>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = filtered.map(item => {
        const cleanTitle = cleanTitlePrefix(item.title || 'Vídeo sem título');
        const publishDate = item.publish_time || item.publishTime;
        const youtubeUrl = item.youtube_url || item.youtubeUrl;
        const isLive = Boolean(youtubeUrl);
        const dateObj = publishDate ? new Date(publishDate) : new Date();
        const tz = ui.state?.profile?.timezone || 'America/Sao_Paulo';
        const monthStr = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, month: 'short' }).format(dateObj);
        const dayNum = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: 'numeric' }).format(dateObj);
        const shortFormat = isItemShort(item);
        const formatBadge = shortFormat
          ? '<span style="font-size: 10.5px; padding: 2px 6px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 4px; font-weight: 600;">📱 Short</span>'
          : '<span style="font-size: 10.5px; padding: 2px 6px; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 4px; font-weight: 600;">🎬 Vídeo</span>';

        return `
        <div class="timeline-item" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; margin-bottom: 8px; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius);">
          <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
            <div class="date-chip" style="min-width: 48px; text-align: center; padding: 6px 4px; background: var(--surface-3); border-radius: 6px; border: 1px solid var(--line);">
              <small style="display: block; font-size: 10px; text-transform: uppercase; color: var(--text-2);">${escapeHTML(monthStr)}</small>
              <strong style="display: block; font-size: 16px; color: var(--text); line-height: 1.1;">${escapeHTML(dayNum)}</strong>
            </div>
            <div class="timeline-meta" style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap;">
                ${formatBadge}
                <strong title="${escapeHTML(cleanTitle)}" style="font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 450px;">${escapeHTML(cleanTitle)}</strong>
              </div>
              <div class="meta-line" style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-2);">
                <span>📅 ${formatDate(publishDate)}</span>
                <span>·</span>
                <span>${statusChip(item.status)}</span>
                ${isLive ? '<span>·</span><span style="color: var(--green); font-size: 11px; font-weight: 600;">✓ No YouTube</span>' : ''}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
            ${youtubeUrl 
              ? `<a href="${escapeHTML(youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="button secondary small" style="text-decoration: none; font-size: 11.5px; padding: 4px 10px;">Assistir ↗</a>` 
              : ''
            }
            ${item.production_id && !item.production_id.startsWith('prod_manual_') && !item.production_id.startsWith('yt_')
              ? `<button class="text-button" data-open-content="${escapeHTML(item.production_id)}">Ver</button>` 
              : ''
            }
          </div>
        </div>`;
      }).join('');
    }
  }

  // Renderizar coluna de Temas Planejados da Semana
  renderCalendarPlannedThemes();
}

async function syncCalendarFromYouTube() {
  const syncBtn = $('#cal-sync-yt-btn');
  const originalText = syncBtn ? syncBtn.innerHTML : '';
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '⏳ <span>Sincronizando...</span>';
  }
  $('#loading')?.classList.add('active');
  try {
    showToast('Consultando canal e sincronizando vídeos agendados do YouTube...', 'info');
    const res = await api('/api/schedule/sync-youtube', { method: 'POST' });
    calendarHasSyncedYT = true;
    await refreshDashboard(true);
    if (res.synced > 0) {
      showToast(`🎉 ${res.synced} vídeos agendados sincronizados do YouTube com sucesso!`, 'success');
    } else {
      showToast('Sincronização concluída: grade atualizada.', 'info');
    }
  } catch (err) {
    showToast(`Erro ao sincronizar com YouTube: ${err.message}`, 'error');
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = originalText || '<span>Sincronizar do YouTube</span>';
    }
    $('#loading')?.classList.remove('active');
  }
}
window.syncCalendarFromYouTube = syncCalendarFromYouTube;

function renderCalendarPlannedThemes() {
  const container = $('#calendar-planned-themes-list');
  const countBadge = $('#cal-themes-badge');
  if (!container) return;

  const themes = Array.isArray(wfPlannedThemes) ? wfPlannedThemes : [];
  if (countBadge) {
    countBadge.textContent = `${themes.length} tema${themes.length === 1 ? '' : 's'}`;
  }

  if (!themes.length) {
    container.innerHTML = `
      <div class="empty">
        <p style="color: var(--text-2); font-size: 13px; margin-bottom: 12px; text-align: center;">
          Nenhum tema planejado no cronograma ainda.
        </p>
        <a href="#workflow" class="button secondary small" style="text-decoration: none;">
          ⚡ Gerar 7 Temas no Estúdio
        </a>
      </div>
    `;
    return;
  }

  container.innerHTML = themes.map((theme, idx) => {
    const isPosted = theme.status === 'posted';
    const isInProd = theme.status === 'in_production';
    const statusLabel = isPosted ? '✅ Postado' : isInProd ? '🎬 Em Produção' : '⏳ Planejado';
    const statusClass = isPosted ? 'success' : isInProd ? 'info' : 'warning';
    
    let dayNum = '—';
    let monthStr = '—';
    const dateVal = theme.scheduled_date || theme.scheduledDate;
    if (dateVal) {
      const parts = String(dateVal).split('T')[0].split('-');
      if (parts.length === 3) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        dayNum = d.getDate();
        monthStr = d.toLocaleDateString('pt-BR', { month: 'short' });
      }
    }

    return `
      <div class="planned-theme-cal-item">
        <div class="planned-theme-cal-date">
          <small>${escapeHTML(monthStr)}</small>
          <strong>${escapeHTML(dayNum)}</strong>
        </div>
        <div class="planned-theme-cal-body">
          <h4 title="${escapeHTML(theme.topic)}">#${idx + 1} ${escapeHTML(theme.topic)}</h4>
          <div class="planned-theme-cal-meta">
            <span class="status-pill ${statusClass}">${statusLabel}</span>
            <span>·</span>
            <span>${escapeHTML(dateVal || 'Sem data')}</span>
          </div>
        </div>
        <div>
          ${!isPosted ? `
            <button type="button" class="button secondary small wf-calendar-produce-btn" data-topic="${escapeHTML(theme.topic)}" data-id="${escapeHTML(theme.id)}" style="font-size: 11px; padding: 4px 8px;">
              🎬 Roteiro
            </button>
          ` : `
            <span style="font-size: 11px; color: var(--green); font-weight: 600;">Concluído</span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function renderIdeas(ideas) {
  const container = $('#idea-list');
  if (!container) return;
  if (!ideas.length) {
    container.innerHTML = empty('Adicione temas promissores aqui antes de utilizar créditos de geração.');
    return;
  }
  container.innerHTML = ideas.map(idea => `
    <article class="idea-card">
      <div class="idea-meta"><strong>${escapeHTML(idea.topic)}</strong><div class="meta-line">${escapeHTML(idea.angle || idea.rationale || 'Nenhum ângulo adicionado')} · ${statusChip(idea.status)}</div></div>
      ${idea.status === 'backlog' ? `<button class="button secondary small" data-generate-idea="${escapeHTML(idea.id)}">Gerar</button>` : ''}
    </article>`).join('');
}

function renderAnalytics(analytics, learning = {}) {
  $('#analytics-total').textContent = analytics.totalVideos || 0;
  $('#analytics-score').textContent = analytics.averagePerformanceScore ? `${analytics.averagePerformanceScore}/100` : '—';
  const insights = Array.isArray(analytics.insights) ? analytics.insights : [];
  const approved = (learning.recommendations || []).find(item => item.status === 'approved');
  const pending = (learning.recommendations || []).find(item => item.status === 'pending');
  $('#analytics-action').textContent = approved?.title || pending?.title || insights[0] || (analytics.totalVideos
    ? 'Continue coletando resultados; as recomendações ficam mais precisas com mais vídeos publicados.'
    : 'Publique e analise o primeiro vídeo para desbloquear recomendações de desempenho.');
  const performers = Array.isArray(analytics.topPerformers) ? analytics.topPerformers : [];
  $('#top-performers').innerHTML = performers.length ? performers.map(item => `
    <article class="performer-card"><strong>${escapeHTML(item.videoDetails?.title || item.title || 'Vídeo sem título')}</strong><div class="meta-line">Desempenho ${escapeHTML(item.performance?.score ?? item.performance_score ?? '—')} / 100</div></article>`).join('') : empty('Nenhum vídeo analisado ainda.');
  renderOutcome(learning.outcome || {});
  renderLearning(learning);
  renderRetention(learning.retention || {});
}

function formatOutcomeValue(value, kind = 'number', currency = 'USD') {
  if (value === null || value === undefined) return 'Indisponível';
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Indisponível';
  if (kind === 'currency') {
    try {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(number);
    } catch (_error) {
      return `${currency} ${number.toFixed(2)}`;
    }
  }
  if (kind === 'percent') return `${number.toFixed(1)}%`;
  if (kind === 'hours') return `${number.toFixed(1)}h`;
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(number);
}

function translatePolicy(text) {
  if (!text || typeof text !== 'string') return '';
  let res = text;
  res = res.replace(/Comments are fetched read-only from YouTube\. Replies post only after operator approval, and fallback analysis never proposes drafts or ideas\./gi,
    'Os comentários são obtidos em modo somente leitura do YouTube. As respostas só são publicadas após a sua aprovação, e o sistema nunca publica ideias sem autorização.');
  res = res.replace(/\s*\(operator approval\)/gi, '');
  res = res.replace(/Only real YouTube evidence counts\. Plan approval authorizes bounded arm rotations; adopting a winner always requires a separate confirmation\./gi,
    'Apenas métricas reais do YouTube são consideradas. A aprovação autoriza o teste de rotação; a adoção definitiva da versão vencedora sempre requer sua confirmação.');
  res = res.replace(/Only real YouTube analytics are eligible; simulated fallbacks are excluded\./gi,
    'Apenas dados analíticos reais do YouTube são elegíveis; dados simulados são excluídos.');
  res = res.replace(/Configure a channel strategy to activate outcome tracking\./gi,
    'Configure uma estratégia de canal no Operador para ativar o acompanhamento de resultados.');
  res = res.replace(/Only real YouTube measurements are included\. Missing subscriber, revenue, or cost evidence remains unavailable and is never converted to zero\./gi,
    'Apenas métricas reais do YouTube são consideradas. Dados não reportados permanecem como indisponíveis e nunca são convertidos em zero.');
  res = res.replace(/Finish setup to create a controlled growth experiment\./gi,
    'Conclua a configuração para criar um experimento controlado de crescimento.');
  return res.trim();
}

function renderOutcome(outcome = {}) {
  const status = $('#outcome-status');
  if (!outcome.configured || !outcome.goal) {
    status.textContent = 'Não configurado';
    status.className = 'status';
    $('#outcome-summary').innerHTML = empty('Defina um resultado mensurável principal na estratégia do Operador Autônomo.');
    $('#outcome-economics').innerHTML = '';
    $('#outcome-breakdowns').innerHTML = '';
    $('#outcome-policy').textContent = translatePolicy(outcome.evidencePolicy) || 'Configure um resultado principal para ativar o aprendizado alinhado às metas.';
    return;
  }
  const { goal, economics = {}, coverage = {}, breakdowns = {} } = outcome;
  status.textContent = outcome.available ? 'Medindo' : 'Aguardando dados';
  status.className = `status ${outcome.available ? 'active' : ''}`;
  const target = goal.targetValue === null
    ? `Sem meta numérica · janela de dados de ${goal.windowDays} dias`
    : `Meta de ${formatOutcomeValue(goal.targetValue, goal.unit, goal.currency)} · ${goal.windowDays} dias`;
  const progress = outcome.progressPercent === null ? null : Math.min(100, Number(outcome.progressPercent));
  $('#outcome-summary').innerHTML = `
    <div class="outcome-primary">
      <span>${escapeHTML(goal.label)}</span>
      <strong>${escapeHTML(outcome.formattedObserved || 'Indisponível')}</strong>
      <small>${escapeHTML(target)} · ${Number(outcome.measuredVideoCount || 0)} vídeos avaliados</small>
      ${progress === null ? '' : `<div class="outcome-progress" role="progressbar" aria-label="Progresso da meta" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><small>${Number(outcome.progressPercent).toFixed(1)}% da meta com base nas janelas de medição</small>`}
    </div>`;
  const economicsRows = [
    ['Inscritos líquidos', economics.netSubscribers, 'number', coverage.subscribers],
    ['Horas de exibição', economics.watchHours, 'hours', null],
    ['Receita estimada', economics.estimatedRevenue, 'currency', coverage.revenue],
    ['Custo conhecido de produção', economics.knownProductionCost, 'currency', coverage.cost],
    ['ROI estimado', economics.roi, 'percent', null],
    ['Orçamento utilizado', economics.budgetUsedPercent, 'percent', null]
  ];
  $('#outcome-economics').innerHTML = economicsRows.map(([name, value, kind, metricCoverage]) => `
    <div><span>${escapeHTML(name)}</span><strong>${escapeHTML(formatOutcomeValue(value, kind, economics.currency || goal.currency))}</strong>${metricCoverage ? `<small>${Number(metricCoverage.measured || 0)}/${Number(metricCoverage.total || 0)} vídeos avaliados</small>` : ''}</div>`).join('');
  const dimensions = [
    ['pillar', 'Pilares de conteúdo'], ['format', 'Formatos'], ['provider', 'Provedores de produção']
  ].filter(([key]) => Array.isArray(breakdowns[key]) && breakdowns[key].length);
  $('#outcome-breakdowns').innerHTML = dimensions.length ? dimensions.map(([key, heading]) => `
    <section><h3>${escapeHTML(heading)}</h3>${breakdowns[key].slice(0, 5).map(item => `
      <div class="outcome-breakdown-row"><span>${escapeHTML(label(item.name))}<small>${Number(item.count || 0)} vídeo${Number(item.count || 0) === 1 ? '' : 's'}</small></span><strong>${escapeHTML(formatOutcomeValue(item.average, goal.unit, goal.currency))} méd.</strong></div>`).join('')}</section>`).join('') : empty('Os detalhamentos aparecerão assim que os vídeos medidos tiverem dados suficientes por pilar, formato ou provedor.');
  $('#outcome-policy').textContent = translatePolicy(outcome.evidencePolicy);
}

function renderLearning(learning = {}) {
  const baseline = learning.baseline || {};
  $('#learning-snapshot-count').textContent = `${learning.snapshotCount || 0} registros`;
  $('#learning-approved-count').textContent = `${learning.approvedCount || 0} aprovados`;
  const metrics = [
    ['CTR', baseline.ctr, '%'],
    ['Retenção', baseline.retention, '%'],
    ['Engajamento', baseline.engagementRate, '%'],
    ['Desempenho', baseline.performanceScore, '/100']
  ];
  $('#learning-baseline').innerHTML = learning.measuredVideos ? metrics.map(([name, value, suffix]) => `
    <div><span>${escapeHTML(name)}</span><strong>${Number(value || 0).toFixed(1)}${escapeHTML(suffix)}</strong></div>`).join('') : empty('Duas medições reais desbloqueiam recomendações embasadas em dados.');

  const recommendations = Array.isArray(learning.recommendations) ? learning.recommendations : [];
  $('#learning-recommendations').innerHTML = recommendations.length ? recommendations.map(item => `
    <article class="learning-card">
      <div class="learning-card-heading"><strong>${escapeHTML(item.title)}</strong>${statusChip(item.status)}</div>
      <p>${escapeHTML(item.rationale)}</p>
      <div class="learning-meta"><span>${escapeHTML(label(item.category))} · ${escapeHTML(label(item.confidence))} de confiança</span>
        <span class="learning-actions">
          ${item.status !== 'approved' ? `<button class="text-button approve" data-learning-action="approve" data-learning-id="${escapeHTML(item.id)}">Aprovar</button>` : ''}
          ${item.status !== 'rejected' ? `<button class="text-button" data-learning-action="reject" data-learning-id="${escapeHTML(item.id)}">Rejeitar</button>` : ''}
        </span>
      </div>
    </article>`).join('') : empty('Nenhuma recomendação ainda. A IA precisa de pelo menos duas medições reais com alcance suficiente.');
}

function renderGrowthExperiments(summary = {}) {
  const experiments = Array.isArray(summary.experiments) ? summary.experiments : [];
  const candidates = Array.isArray(summary.candidates) ? summary.candidates : [];
  const candidate = $('#experiment-candidate');
  const create = $('#experiment-create-button');
  candidate.innerHTML = candidates.length
    ? candidates.map(item => `<option value="${escapeHTML(item.productionId)}">${escapeHTML(item.title || item.productionId)}</option>`).join('')
    : '<option value="">Nenhuma variante publicada elegível</option>';
  candidate.disabled = !candidates.length;
  create.disabled = !candidates.length;
  $('#experiment-status').textContent = `${Number(summary.activeCount || 0)} em andamento · ${Number(summary.awaitingDecisionCount || 0)} decisão(ões)`;
  $('#experiment-policy').textContent = translatePolicy(summary.evidencePolicy) || 'Apenas dados reais do YouTube avançam testes controlados.';

  $('#growth-experiments').innerHTML = experiments.length ? experiments.map(experiment => {
    const winner = experiment.arms?.find(arm => arm.id === experiment.winningArmId);
    const actions = [];
    if (experiment.status === 'draft') actions.push(`<button class="text-button approve" data-experiment-action="approve" data-experiment-id="${escapeHTML(experiment.id)}">Aprovar plano</button>`);
    if (experiment.status === 'approved') actions.push(`<button class="button primary small" data-experiment-action="start" data-experiment-id="${escapeHTML(experiment.id)}">Iniciar teste real</button>`);
    if (experiment.status === 'running') {
      actions.push(`<button class="button secondary small" data-experiment-action="refresh" data-experiment-id="${escapeHTML(experiment.id)}">Atualizar métricas</button>`);
      actions.push(`<button class="text-button" data-experiment-action="cancel" data-experiment-id="${escapeHTML(experiment.id)}">Cancelar e restaurar original</button>`);
    }
    if (experiment.status === 'action_required') actions.push(`<button class="text-button" data-experiment-action="cancel" data-experiment-id="${escapeHTML(experiment.id)}">Repetir restauração original</button>`);
    if (experiment.status === 'awaiting_winner') actions.push(`<button class="button primary small" data-experiment-action="adopt" data-experiment-id="${escapeHTML(experiment.id)}">Adotar ${escapeHTML(winner?.label || 'vencedor')}</button>`);
    const arms = (experiment.arms || []).map(arm => {
      const result = arm.result || {};
      const active = arm.id === experiment.currentArmId && experiment.status === 'running';
      return `<div class="experiment-arm ${active ? 'active' : ''} ${arm.id === experiment.winningArmId ? 'winner' : ''}">
        <div><strong>${escapeHTML(arm.label)}</strong>${arm.isControl ? '<small>Controle (original)</small>' : ''}</div>
        <span>${escapeHTML(arm.title)}</span>
        <div class="experiment-arm-metrics"><b>${Number(result.ctr || 0).toFixed(2)}% CTR</b><small>${Number(result.impressions || 0).toLocaleString()} impressões</small></div>
      </div>`;
    }).join('');
    return `<article class="growth-experiment-card">
      <div class="learning-card-heading"><strong>${escapeHTML(experiment.title)}</strong>${statusChip(experiment.status)}</div>
      <p>${escapeHTML(experiment.hypothesis)}</p>
      <div class="experiment-arm-list">${arms}</div>
      ${experiment.result?.reason ? `<p class="experiment-result"><strong>Resultado:</strong> ${escapeHTML(experiment.result.reason)}${experiment.result.liftPercent !== undefined ? ` · ${escapeHTML(experiment.result.liftPercent)}% de melhoria` : ''}</p>` : ''}
      <div class="learning-meta"><span>${Number(experiment.armDurationHours || 0)}h por variante · mínimo de ${Number(experiment.minImpressions || 0).toLocaleString()} impressões</span><span class="learning-actions">${actions.join('')}</span></div>
    </article>`;
  }).join('') : empty('Publique conteúdo com variantes aprovadas de título e miniatura para criar o primeiro teste A/B.');
}

function renderRetention(retention = {}) {
  const snapshots = Array.isArray(retention.snapshots) ? retention.snapshots : [];
  const select = $('#retention-snapshot-select');
  const refresh = $('#refresh-retention-button');
  if (!snapshots.length) {
    ui.retentionSnapshotId = null;
    select.innerHTML = '<option value="">Nenhuma curva de retenção ainda</option>';
    select.disabled = true;
    refresh.disabled = true;
    $('#retention-meta').innerHTML = '';
    $('#retention-chart').innerHTML = empty('As curvas de retenção aparecem após um vídeo publicado atingir a janela de análise no YouTube.');
    $('#retention-scenes').innerHTML = '';
    return;
  }

  if (!snapshots.some(item => item.id === ui.retentionSnapshotId)) ui.retentionSnapshotId = snapshots[0].id;
  select.disabled = false;
  refresh.disabled = false;
  select.innerHTML = snapshots.map(item => `<option value="${escapeHTML(item.id)}" ${item.id === ui.retentionSnapshotId ? 'selected' : ''}>${escapeHTML(item.title || item.videoId)} · ${escapeHTML(label(item.surface))} · ${escapeHTML(item.measurementWindow)}</option>`).join('');
  const snapshot = snapshots.find(item => item.id === ui.retentionSnapshotId) || snapshots[0];
  refresh.dataset.videoId = snapshot.videoId;
  refresh.dataset.measurementWindow = snapshot.measurementWindow;

  const summary = snapshot.summary || {};
  $('#retention-meta').innerHTML = [
    `${snapshot.points?.length || 0} pontos reais`,
    `${snapshot.sceneMetrics?.length || 0} cenas`,
    `${summary.dropoffCount || 0} quedas`,
    `${summary.rewatchCount || 0} repetições`,
    `${escapeHTML(label(snapshot.confidence))} de confiança`,
    `janela ${escapeHTML(snapshot.measurementWindow)}`
  ].map(item => `<span>${item}</span>`).join('');
  $('#retention-chart').innerHTML = retentionChart(snapshot);
  $('#retention-scenes').innerHTML = (snapshot.sceneMetrics || []).map(scene => `
    <article class="retention-scene ${escapeHTML(scene.signal)}">
      <div class="retention-scene-heading"><div><span>Cena ${Number(scene.position || 0) + 1}</span><strong>${escapeHTML(scene.label)}</strong></div>${statusChip(scene.signal)}</div>
      <div class="retention-metrics">
        <div><span>Retenção média</span><strong>${(Number(scene.averageWatchRatio || 0) * 100).toFixed(1)}%</strong></div>
        <div><span>Variação da cena</span><strong>${Number(scene.changePoints || 0) > 0 ? '+' : ''}${Number(scene.changePoints || 0).toFixed(1)} pts</strong></div>
        <div><span>Retenção relativa</span><strong>${(Number(scene.averageRelativeRetention || 0) * 100).toFixed(1)}%</strong></div>
        <div><span>Maior queda</span><strong>${Number(scene.largestDropPoints || 0).toFixed(1)} pts</strong></div>
      </div>
    </article>`).join('') || empty('A curva salva não pôde ser mapeada para a linha do tempo das cenas.');
}

function renderEngagement(engagement = {}) {
  $('#engagement-policy').textContent = translatePolicy(engagement.evidencePolicy) || '';
  const posting = $('#engagement-posting-status');
  posting.textContent = engagement.postingEnabled ? 'respostas ativadas' : 'respostas bloqueadas';
  posting.className = `status ${engagement.postingEnabled ? 'success' : 'warning'}`;
  posting.title = engagement.postingEnabled ? '' : 'Autorize novamente o YouTube para conceder permissão de comentários.';
  $('#engagement-drafts-count').textContent = `${engagement.pendingDrafts || 0} rascunhos`;
  $('#engagement-attention-count').textContent = `${engagement.needsAttentionCount || 0} sinalizados`;
  $('#engagement-ideas-count').textContent = `${engagement.pendingAudienceIdeas || 0} pendentes`;

  const insights = Array.isArray(engagement.insights) ? engagement.insights : [];
  const select = $('#engagement-video-select');
  if (!insights.length) {
    ui.engagementVideoId = null;
    ui.engagementDetail = null;
    select.innerHTML = '<option value="">Nenhum vídeo sincronizado ainda</option>';
    select.disabled = true;
    $('#engagement-sync-button').disabled = true;
    $('#engagement-draft-button').disabled = true;
    $('#engagement-meta').innerHTML = '';
    $('#engagement-themes').innerHTML = empty('Os comentários aparecem após a sincronização de um vídeo publicado.');
    $('#engagement-drafts').innerHTML = empty('Gere rascunhos de resposta para revisá-los aqui.');
    $('#engagement-attention').innerHTML = empty('Nenhum comentário sinalizado como spam, golpe ou ofensivo.');
  } else {
    if (!insights.some(item => item.videoId === ui.engagementVideoId)) ui.engagementVideoId = insights[0].videoId;
    select.disabled = false;
    select.innerHTML = insights.map(item => `<option value="${escapeHTML(item.videoId)}" ${item.videoId === ui.engagementVideoId ? 'selected' : ''}>${escapeHTML(item.title || item.videoId)}</option>`).join('');
    $('#engagement-sync-button').disabled = false;
    $('#engagement-sync-button').dataset.videoId = ui.engagementVideoId;
    $('#engagement-draft-button').disabled = false;
    $('#engagement-draft-button').dataset.videoId = ui.engagementVideoId;
    renderEngagementDetail();
  }
  renderAudienceIdeas();
}

function renderEngagementDetail() {
  const detail = ui.engagementDetail;
  if (!detail || detail.insight?.videoId !== ui.engagementVideoId) {
    loadEngagementDetail(ui.engagementVideoId);
    return;
  }
  const insight = detail.insight || {};
  const sentiment = insight.sentiment || {};
  const fallback = insight.analysisMethod === 'fallback';
  $('#engagement-meta').innerHTML = [
    `${insight.commentCount || 0} comentários`,
    `${insight.analyzedCount || 0} analisados`,
    fallback ? 'Análise de IA indisponível — apenas dados básicos' : `${sentiment.positive || 0} positivos · ${sentiment.neutral || 0} neutros · ${sentiment.negative || 0} negativos`,
    insight.lastSyncedAt ? `sincronizado em ${formatDate(insight.lastSyncedAt)}` : 'nunca sincronizado'
  ].map(item => `<span>${escapeHTML(item)}</span>`).join('');

  const themes = Array.isArray(insight.themes) ? insight.themes : [];
  $('#engagement-themes').innerHTML = themes.length ? themes.map(theme => `
    <article class="learning-card">
      <div class="learning-card-heading"><strong>${escapeHTML(theme.title)}</strong>${statusChip(theme.kind)}</div>
      <p>${escapeHTML(theme.summary)}</p>
      <div class="learning-meta"><span>${escapeHTML(String(theme.count || 0))} comentários</span></div>
    </article>`).join('') : empty(fallback ? 'Os temas exigem um provedor de IA ativo.' : 'Nenhum tema recorrente ainda.');

  const commentsById = new Map((detail.comments || []).map(comment => [comment.commentId, comment]));
  const postingEnabled = ui.state?.engagement?.postingEnabled === true;
  const drafts = (detail.drafts || []).filter(draft => draft.status !== 'discarded');
  const draftsContainer = $('#engagement-drafts');
  const draftsHTML = drafts.length ? drafts.map(draft => {
    const comment = commentsById.get(draft.commentId) || {};
    const locked = draft.status === 'posted';
    return `
    <article class="comment-card" data-reply-card="${escapeHTML(draft.id)}">
      <div class="learning-card-heading"><strong>${escapeHTML(comment.authorName || 'Espectador')}</strong>${statusChip(draft.status)}</div>
      <p class="comment-original">${escapeHTML(comment.text || '')}</p>
      <label><span>Resposta</span><textarea data-reply-text maxlength="1000" ${locked ? 'disabled' : ''}>${escapeHTML(draft.editedText || draft.draftText)}</textarea></label>
      ${draft.failureReason ? `<p class="meta-line">Última tentativa falhou: ${escapeHTML(draft.failureReason)}</p>` : ''}
      <div class="learning-actions">
        ${locked ? '' : `<button class="button primary small" data-reply-approve="${escapeHTML(draft.id)}" ${postingEnabled ? '' : 'disabled title="Reautorize o YouTube para ativar as postagens"'}>Aprovar e postar</button>
        <button class="text-button" data-reply-save="${escapeHTML(draft.id)}">Salvar edição</button>
        <button class="text-button danger-text" data-reply-discard="${escapeHTML(draft.id)}">Descartar</button>`}
      </div>
    </article>`;
  }).join('') : empty('Nenhum rascunho de resposta para este vídeo ainda.');
  const editingReply = draftsContainer.contains(document.activeElement)
    && document.activeElement.matches('[data-reply-text]');
  if (!editingReply) draftsContainer.innerHTML = draftsHTML;

  const attention = Array.isArray(insight.attentionFlags) ? insight.attentionFlags : [];
  $('#engagement-attention').innerHTML = attention.length ? attention.map(flag => {
    const comment = commentsById.get(flag.commentId) || {};
    return `
    <article class="comment-card">
      <div class="learning-card-heading"><strong>${escapeHTML((flag.categories || []).join(', '))}</strong></div>
      <p class="comment-original">${escapeHTML(comment.text || '')}</p>
      <a class="text-button" href="${escapeHTML(flag.permalink || '#')}" target="_blank" rel="noopener noreferrer">Abrir no YouTube</a>
    </article>`;
  }).join('') : empty('Nenhum comentário sinalizado como spam, golpe ou ofensivo.');
}

async function loadEngagementDetail(videoId) {
  if (!videoId) return;
  try {
    const data = await api(`/api/engagement/${encodeURIComponent(videoId)}`);
    ui.engagementDetail = data.result;
    renderEngagementDetail();
  } catch (_error) { /* toast already shown by api() */ }
}

function renderAudienceIdeas() {
  const recommendations = (ui.state?.learning?.recommendations || []).filter(item => item.category === 'audience_demand');
  $('#engagement-ideas').innerHTML = recommendations.length ? recommendations.map(item => `
    <article class="learning-card">
      <div class="learning-card-heading"><strong>${escapeHTML(item.title)}</strong>${statusChip(item.status)}</div>
      <p>${escapeHTML(item.rationale)}</p>
      <div class="learning-meta"><span>${escapeHTML(label(item.confidence))} de confiança</span>
        <span class="learning-actions">
          ${item.status !== 'approved' ? `<button class="text-button approve" data-learning-action="approve" data-learning-id="${escapeHTML(item.id)}">Aprovar</button>` : ''}
          ${item.status !== 'rejected' ? `<button class="text-button" data-learning-action="reject" data-learning-id="${escapeHTML(item.id)}">Rejeitar</button>` : ''}
        </span>
      </div>
    </article>`).join('') : empty('Pedidos do público aparecerão aqui quando a análise de comentários detectar solicitações recorrentes.');
}

function retentionChart(snapshot = {}) {
  const points = Array.isArray(snapshot.points) ? snapshot.points : [];
  if (points.length < 2) return empty('Esta curva não possui pontos suficientes para exibição.');
  const width = 1000;
  const height = 280;
  const left = 46;
  const right = 18;
  const top = 18;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxRatio = Math.max(1, Math.min(1.5, Math.max(...points.map(point => Number(point.audienceWatchRatio || 0))) * 1.05));
  const x = ratio => left + Math.max(0, Math.min(1, Number(ratio || 0))) * plotWidth;
  const y = ratio => top + (1 - Math.max(0, Math.min(maxRatio, Number(ratio || 0))) / maxRatio) * plotHeight;
  const line = points.map(point => `${x(point.elapsedRatio).toFixed(1)},${y(point.audienceWatchRatio).toFixed(1)}`).join(' ');
  const duration = Math.max(1, Number(snapshot.durationSeconds || 1));
  const sceneBands = (snapshot.sceneMetrics || []).map((scene, index) => {
    const start = x(Number(scene.startSeconds || 0) / duration);
    const end = x(Number(scene.endSeconds || 0) / duration);
    return `<g><rect x="${start.toFixed(1)}" y="${top}" width="${Math.max(1, end - start).toFixed(1)}" height="${plotHeight}" class="retention-band band-${index % 2}"/><line x1="${start.toFixed(1)}" y1="${top}" x2="${start.toFixed(1)}" y2="${top + plotHeight}" class="scene-boundary"/><title>${escapeHTML(scene.label)}</title></g>`;
  }).join('');
  const grid = [0.25, 0.5, 0.75, 1].map(value => {
    const lineY = y(value);
    return `<line x1="${left}" y1="${lineY.toFixed(1)}" x2="${width - right}" y2="${lineY.toFixed(1)}" class="retention-grid-line"/><text x="${left - 8}" y="${(lineY + 4).toFixed(1)}" text-anchor="end">${Math.round(value * 100)}%</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="retention-chart-title retention-chart-desc">
    <title id="retention-chart-title">Retenção de público para ${escapeHTML(snapshot.title || snapshot.videoId)}</title>
    <desc id="retention-chart-desc">Curva de retenção com ${points.length} pontos dividida em ${snapshot.sceneMetrics?.length || 0} cenas de produção.</desc>
    ${sceneBands}${grid}
    <polyline points="${line}" class="retention-line"/>
    <text x="${left}" y="${height - 10}" text-anchor="start">Início</text>
    <text x="${width - right}" y="${height - 10}" text-anchor="end">Fim</text>
  </svg>`;
}

function renderActivation(activation = {}) {
  const container = $('#activation-list');
  if (!container) return;
  const milestones = activation.milestones || {};
  const rows = [
    ['Configuração inicial concluída', milestones.setupReady],
    ['Primeiro vídeo MP4 gerado', milestones.firstRealVideo],
    ['Primeira aprovação de conteúdo', milestones.firstApproval],
    ['Primeira publicação no YouTube', milestones.firstPublish],
    ['Segundo vídeo MP4 gerado', milestones.secondRealVideo]
  ];
  container.innerHTML = rows.map(([name, milestone = {}]) => `
    <div class="timeline-item">
      <div class="timeline-dot ${milestone.achieved ? 'done' : ''}"></div>
      <div><strong>${escapeHTML(name)}</strong><div class="meta-line">${milestone.achieved ? escapeHTML(formatDate(milestone.at)) : 'Ainda não alcançado'}</div></div>
    </div>`).join('');
  if (milestones.firstRealVideo?.achieved) {
    container.insertAdjacentHTML('beforeend', `
      <div class="activation-share">
        <span>Criou seu canal com o agente?</span>
        <a class="button secondary small" href="https://github.com/darkzOGx/youtube-automation-agent/discussions/new?category=show-and-tell" target="_blank" rel="noreferrer">Compartilhe o seu resultado</a>
      </div>`);
  }
}

function renderOperator(strategy, _runs, _system) {
  const form = $('#strategy-form');
  const mapping = strategy ? {
    objective: strategy.objective,
    audience: strategy.audience,
    valueProposition: strategy.value_proposition,
    contentPillars: (strategy.contentPillars || []).join(', '),
    cadencePerWeek: strategy.cadence_per_week,
    videosPerRun: strategy.videos_per_run,
    defaultFormat: strategy.default_format,
    defaultLength: strategy.default_length,
    successMetric: strategy.success_metric,
    primaryKpi: strategy.primary_kpi,
    targetValue: strategy.target_value,
    targetWindowDays: strategy.target_window_days,
    monthlyBudget: strategy.monthly_budget,
    outcomeCurrency: strategy.outcome_currency,
    constraints: strategy.constraints
  } : {};
  for (const [name, value] of Object.entries(mapping)) {
    if (form && form.elements[name] && document.activeElement !== form.elements[name]) {
      form.elements[name].value = value ?? '';
    }
  }

  // Preencher banner do Canal Conectado
  const channelTitle = ui.state?.profile?.name || 'Canal Conectado';
  const subCount = ui.state?.profile?.subscriberCount || '0';
  if ($('#dna-channel-title')) {
    $('#dna-channel-title').textContent = `Canal Ativo: ${channelTitle}`;
  }
  if ($('#dna-channel-meta')) {
    const subsFormatted = isNaN(Number(subCount)) ? subCount : Number(subCount).toLocaleString('pt-BR');
    $('#dna-channel-meta').textContent = `${subsFormatted} inscritos · Sincronizado com a API oficial do YouTube`;
  }

  const strategyStatus = strategy?.status || 'not_configured';
  if ($('#operator-strategy-status')) {
    $('#operator-strategy-status').className = `status ${escapeHTML(strategyStatus)}`;
    $('#operator-strategy-status').textContent = label(strategyStatus);
  }

  if (strategy?.summaryDiagnosis && $('#dna-ai-diagnosis')) {
    $('#dna-ai-diagnosis').innerHTML = `<p style="color: #38bdf8; font-weight: 500;">${escapeHTML(strategy.summaryDiagnosis)}</p>`;
  }
}

function populateSettings(profile = {}, settings = {}, providers = []) {
  const form = $('#profile-form');
  const mapping = {
    channelName: profile.channel_name,
    goal: profile.goal,
    targetAudience: profile.target_audience,
    brandVoice: profile.brand_voice,
    defaultStyle: profile.default_style,
    callToAction: profile.call_to_action,
    visualStyle: profile.visual_style,
    timezone: profile.timezone,
    bannedTopics: (profile.bannedTopics || []).join(', ')
  };
  for (const [name, value] of Object.entries(mapping)) {
    if (form.elements[name] && document.activeElement !== form.elements[name]) form.elements[name].value = value || '';
  }
  $('#approval-required').checked = settings.approval_required !== 'false';
  $('#notifications-enabled').checked = settings.notification_enabled !== 'false';
  const videoMapping = {
    videoProvider: settings.video_provider || 'slideshow',
    videoGenerationMode: settings.video_generation_mode || 'hybrid',
    videoClipDuration: settings.video_clip_duration || '8',
    videoMaxGeneratedSeconds: settings.video_max_generated_seconds || '60'
  };
  for (const [name, value] of Object.entries(videoMapping)) {
    if (form.elements[name] && document.activeElement !== form.elements[name]) form.elements[name].value = value;
  }
  const selected = providers.find(provider => provider.id === videoMapping.videoProvider);
  $('#video-provider-status').textContent = videoMapping.videoProvider === 'auto'
    ? `${providers.filter(provider => provider.available && provider.id !== 'slideshow').length} provedor(es) pago(s) disponível(is); slideshow local com FFmpeg permanece como fallback final.`
    : videoMapping.videoProvider === 'slideshow' ? 'Slideshow local com FFmpeg selecionado; nenhuma credencial externa de vídeo é necessária.'
      : selected?.available ? `${label(selected.id)} está configurado (${selected.model}).` : `Credenciais de ${label(videoMapping.videoProvider)} não estão configuradas.`;
}

function renderYouTubeAccount(account, accountsList = []) {
  const avatarImg = $('#yt-channel-avatar');
  const avatarFallback = $('#yt-channel-avatar-fallback');
  const titleNode = $('#yt-channel-name');
  const metaNode = $('#yt-channel-meta');
  const guideChannel = $('#guide-youtube-channel-name');
  const selectNode = $('#yt-accounts-select');

  if (account) {
    if (titleNode) titleNode.textContent = account.title || 'Canal do YouTube';
    if (metaNode) metaNode.textContent = `ID: ${account.channelId || '--'} · Inscritos: ${account.subscriberCount || 'Oculto'}${account.customUrl ? ' · ' + account.customUrl : ''}`;
    if (guideChannel) {
      guideChannel.textContent = account.customUrl || account.title || '@canal';
    }
    if (account.thumbnail && avatarImg) {
      avatarImg.src = account.thumbnail;
      avatarImg.classList.remove('hidden');
      if (avatarFallback) avatarFallback.classList.add('hidden');
    } else {
      if (avatarImg) avatarImg.classList.add('hidden');
      if (avatarFallback) avatarFallback.classList.remove('hidden');
    }
  } else {
    if (titleNode) titleNode.textContent = 'Nenhum canal conectado';
    if (metaNode) metaNode.textContent = 'Clique em Trocar Conta para conectar via Google OAuth';
    if (avatarImg) avatarImg.classList.add('hidden');
    if (avatarFallback) avatarFallback.classList.remove('hidden');
  }

  // Seletor de contas salvas
  if (selectNode) {
    if (accountsList.length > 1) {
      selectNode.classList.remove('hidden');
      selectNode.innerHTML = accountsList.map(acc => `
        <option value="${escapeHTML(acc.channelId)}" ${acc.isActive ? 'selected' : ''}>
          ${escapeHTML(acc.title)} ${acc.customUrl ? `(${escapeHTML(acc.customUrl)})` : ''}
        </option>
      `).join('');
    } else {
      selectNode.classList.add('hidden');
    }
  }

  // Renderizar lista no modal
  const savedSection = $('#youtube-saved-accounts-section');
  const savedList = $('#youtube-saved-accounts-list');
  if (savedSection && savedList) {
    if (accountsList.length > 0) {
      savedSection.classList.remove('hidden');
      savedList.innerHTML = accountsList.map(acc => `
        <div class="youtube-saved-account-item ${acc.isActive ? 'active' : ''}">
          <div class="youtube-saved-account-details">
            ${acc.thumbnail ? `<img src="${escapeHTML(acc.thumbnail)}" class="youtube-saved-avatar" alt="Avatar">` : '<div class="youtube-saved-fallback">📺</div>'}
            <div>
              <strong style="color: #fff; font-size: 14px;">${escapeHTML(acc.title)}</strong>
              ${acc.customUrl ? `<small style="display:block; color: var(--accent);">${escapeHTML(acc.customUrl)}</small>` : ''}
              <small style="color: var(--muted); font-size: 11px;">ID: ${escapeHTML(acc.channelId)} · ${escapeHTML(acc.subscriberCount || '0')} inscritos</small>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${acc.isActive
              ? '<span class="badge-status-ok">ATIVA</span>'
              : `<button type="button" class="button secondary small" data-switch-channel="${escapeHTML(acc.channelId)}">Alternar</button>`
            }
            ${!acc.isActive && accountsList.length > 1
              ? `<button type="button" class="button ghost small" data-delete-channel="${escapeHTML(acc.channelId)}" title="Remover do histórico" style="color: var(--red); padding: 4px 8px;">✕</button>`
              : ''
            }
          </div>
        </div>
      `).join('');
    } else {
      savedSection.classList.add('hidden');
    }
  }
}


function switchView(view) {
  ui.currentView = view;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $$('.view').forEach(item => item.classList.toggle('active', item.id === `${view}-view`));
  const titles = {
    overview: ['VISÃO GERAL DO OPERADOR', 'Saiba o que acontece a seguir.'],
    workflow: ['YOUTUBE · MODELADOR', 'Youtube - Modelador'],
    operator: ['DNA & ESTRATÉGIA DO CANAL', 'A IA lê os dados reais do seu canal e você define o perfil editorial.'],
    pipeline: ['OPERAÇÕES DE CONTEÚDO', 'Da ideia à publicação.'],
    calendar: ['PLANEJAMENTO EDITORIAL', 'Planeje antes de gerar.'],
    analytics: ['DESEMPENHO', 'Transforme resultados nos próximos passos.'],
    engagement: ['ENGAJAMENTO DO PÚBLICO', 'Converse com quem está assistindo.'],
    readiness: ['PRONTIDÃO DE PRODUÇÃO', 'Verifique antes de rodar a automação.'],
    settings: ['DIRETRIZES DO CANAL', 'Faça todo agente soar como você.']
  };
  if (titles[view]) {
    $('#view-eyebrow').textContent = titles[view][0];
    $('#view-title').textContent = titles[view][1];
  }
  location.hash = view;
  if (view === 'workflow') {
    if (typeof loadWorkflowPlannedThemes === 'function') {
      loadWorkflowPlannedThemes();
    }
    if (typeof restoreWorkflowDraft === 'function') {
      restoreWorkflowDraft();
    }
  }
  if (view === 'calendar') {
    renderCalendar(ui.state?.schedule || []);
    if (!calendarHasSyncedYT) {
      syncCalendarFromYouTube().catch(() => {});
    }
  }
}
window.switchView = switchView;

function selectOptions(options, selected) {
  return options.map(([value, label]) =>
    `<option value="${escapeHTML(value)}" ${value === selected ? 'selected' : ''}>${escapeHTML(label)}</option>`
  ).join('');
}

function renderSourceEditor(source = {}, disabled = false) {
  return `<article class="provenance-item" data-provenance-source data-id="${escapeHTML(source.id || '')}" data-published-at="${escapeHTML(source.publishedAt || '')}" data-accessed-at="${escapeHTML(source.accessedAt || '')}">
    <div class="provenance-item-heading"><strong>Fonte de pesquisa</strong><button type="button" class="text-button danger-text" data-remove-provenance ${disabled ? 'disabled' : ''}>Remover</button></div>
    <label><span>URL</span><input data-field="url" type="url" value="${escapeHTML(source.url || '')}" placeholder="https://..." required ${disabled ? 'disabled' : ''}></label>
    <div class="form-grid two">
      <label><span>Título</span><input data-field="title" value="${escapeHTML(source.title || '')}" maxlength="300" ${disabled ? 'disabled' : ''}></label>
      <label><span>Autor / Fonte</span><input data-field="publisher" value="${escapeHTML(source.publisher || '')}" maxlength="200" ${disabled ? 'disabled' : ''}></label>
      <label><span>Tipo</span><select data-field="sourceType" ${disabled ? 'disabled' : ''}>${selectOptions([
        ['official', 'Fonte oficial'], ['article', 'Artigo'], ['video', 'Vídeo'], ['dataset', 'Base de dados'], ['asset', 'Ativo / Licença'], ['other', 'Outro']
      ], source.sourceType || 'other')}</select></label>
      <label><span>Status de revisão</span><select data-field="status" ${disabled ? 'disabled' : ''}>${selectOptions([
        ['pending', 'Revisão pendente'], ['verified', 'Verificado'], ['rejected', 'Rejeitado']
      ], source.status || 'pending')}</select></label>
    </div>
    <label><span>Notas de comprovação</span><textarea data-field="notes" rows="2" maxlength="1000" ${disabled ? 'disabled' : ''}>${escapeHTML(source.notes || '')}</textarea></label>
    ${source.url ? `<a class="source-link" href="${escapeHTML(source.url)}" target="_blank" rel="noopener">Abrir fonte ↗</a>` : ''}
  </article>`;
}

function renderClaimEditor(claim = {}, sources = [], disabled = false, productionId = '') {
  const linked = new Set(claim.sourceIds || []);
  return `<article class="provenance-item ${claim.riskLevel === 'high' ? 'high-risk' : ''}" data-provenance-claim data-id="${escapeHTML(claim.id || '')}">
    <div class="provenance-item-heading"><strong>Afirmação factual</strong><button type="button" class="text-button danger-text" data-remove-provenance ${disabled ? 'disabled' : ''}>Remover</button></div>
    <label><span>Afirmação</span><textarea data-field="text" rows="3" maxlength="1000" required ${disabled ? 'disabled' : ''}>${escapeHTML(claim.text || '')}</textarea></label>
    <div class="form-grid two">
      <label><span>Risco</span><select data-field="riskLevel" ${disabled ? 'disabled' : ''}>${selectOptions([
        ['standard', 'Padrão'], ['high', 'Alto risco']
      ], claim.riskLevel || 'standard')}</select></label>
      <label><span>Resolução</span><select data-field="status" ${disabled ? 'disabled' : ''}>${selectOptions([
        ['pending', 'Pendente'], ['supported', 'Comprovado'], ['unsupported', 'Não comprovado'], ['waived', 'Dispensado com justificativa']
      ], claim.status || 'pending')}</select></label>
    </div>
    <fieldset class="source-checklist" ${disabled ? 'disabled' : ''}><legend>Fontes comprobatórias</legend>
      ${sources.length ? sources.map(source => `<label><input type="checkbox" data-claim-source="${escapeHTML(source.id)}" ${linked.has(source.id) ? 'checked' : ''}> ${escapeHTML(source.title || source.url)}</label>`).join('') : `<div class="claim-no-sources"><small>Adicione uma fonte antes de marcar esta afirmação como comprovada.</small>${!disabled && productionId ? `<button type="button" class="text-button inline-ai-btn" data-suggest-provenance-sources="${escapeHTML(productionId)}">✨ Buscar fontes oficiais com IA</button>` : ''}</div>`}
    </fieldset>
    <label><span>Notas do revisor</span><textarea data-field="notes" rows="2" maxlength="1000" placeholder="Obrigatório quando dispensado" ${disabled ? 'disabled' : ''}>${escapeHTML(claim.notes || '')}</textarea></label>
  </article>`;
}

function renderProvenanceEditor(provenance = {}, canReview = true, productionId = '') {
  const sources = provenance.sources || [];
  const claims = provenance.claims || [];
  const summary = provenance.summary || {};
  const statusLabel = provenance.status === 'verified' ? 'Evidências verificadas' : provenance.status === 'not_required' ? 'Sem afirmações declaradas' : `${summary.unresolvedClaims || 0} pendentes`;
  return `<section class="provenance-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">PESQUISA E VERIFICAÇÃO</p>
        <h3>Mesa de evidências e checagem</h3>
        <p>Verifique as fontes, conecte cada afirmação factual e registre a declaração antes da aprovação.</p>
      </div>
      <div class="provenance-head-badges">
        <span class="status ${provenance.status === 'verified' || provenance.status === 'not_required' ? 'success' : 'warning'}">${escapeHTML(statusLabel)}</span>
        ${canReview && productionId ? `<button type="button" class="button primary small ai-source-btn" data-suggest-provenance-sources="${escapeHTML(productionId)}">✨ Buscar fontes com IA</button>` : ''}
      </div>
    </div>
    <div class="provenance-toolbar">
      <strong>Fontes</strong>
      <div class="provenance-toolbar-actions">
        ${canReview && productionId ? `<button type="button" class="button secondary small ai-source-btn" data-suggest-provenance-sources="${escapeHTML(productionId)}">✨ Buscar fontes oficiais com IA</button>` : ''}
        ${canReview ? '<button type="button" class="text-button" data-add-provenance-source>Adicionar fonte +</button>' : ''}
      </div>
    </div>
    <div id="provenance-sources" class="provenance-list">${sources.map(source => renderSourceEditor(source, !canReview)).join('') || `<div class="empty-provenance-box"><p class="empty-inline">Nenhuma fonte de pesquisa anexada.</p>${canReview && productionId ? `<button type="button" class="button secondary small ai-source-btn" data-suggest-provenance-sources="${escapeHTML(productionId)}">✨ Buscar fontes regulatórias com IA automaticamente</button>` : ''}</div>`}</div>
    <div class="provenance-toolbar">
      <strong>Afirmações</strong>
      <div class="provenance-toolbar-actions">
        ${canReview ? '<button type="button" class="text-button" data-add-provenance-claim>Adicionar afirmação +</button>' : ''}
      </div>
    </div>
    <div id="provenance-claims" class="provenance-list">${claims.map(claim => renderClaimEditor(claim, sources, !canReview, productionId)).join('') || '<p class="empty-inline">Nenhuma afirmação que necessite comprovação externa foi declarada.</p>'}</div>
    <label class="toggle disclosure-toggle"><input id="contains-synthetic-media" type="checkbox" ${provenance.containsSyntheticMedia ? 'checked' : ''} ${canReview ? '' : 'disabled'}><span></span> Contém mídia alterada ou sintética realista que exige declaração ao YouTube</label>
    <div class="provenance-footer-actions">
      ${canReview ? '<button type="button" class="button secondary" data-save-provenance>Salvar revisão de evidências</button>' : ''}
      ${canReview && productionId ? `<button type="button" class="button primary ai-source-btn" data-suggest-provenance-sources="${escapeHTML(productionId)}">✨ Auto-comprovar pendências com IA</button>` : ''}
    </div>
  </section>`;
}

function renderDiscoverabilityPanel(item) {
  const audit = item.discoverability;
  const findings = audit?.findings || [];
  const state = !audit ? 'Não executado' : audit.status === 'unavailable' ? 'Indisponível' : `${findings.length} item(ns)`;
  const stateClass = audit?.status === 'passed' || (audit && findings.length === 0) ? 'success' : 'warning';
  return `<section class="discoverability-panel">
    <div class="panel-heading discoverability-heading">
      <div><p class="eyebrow">PRÉ-VOO DE DESCOBERTA E SEO</p><h3>Auditoria de SEO e IA</h3><p>Revise as diretrizes de GEO, AIO, AEO e busca na web. Os apontamentos são consultivos e nunca reescrevem ou publicam o conteúdo.</p></div>
      <div class="discoverability-actions"><span class="status ${stateClass}">${escapeHTML(state)}</span><button type="button" class="button secondary small" data-discoverability-run="${escapeHTML(item.id)}">${audit ? 'Auditar novamente' : 'Executar auditoria'}</button></div>
    </div>
    ${audit?.error ? `<p class="callout">Falha ao executar DarkzSEO${audit.errorCode || audit.error_code ? ` (${escapeHTML(audit.errorCode || audit.error_code)})` : ''}: ${escapeHTML(audit.error)}</p>` : ''}
    ${findings.length ? `<div class="discoverability-findings">${findings.map(finding => {
      const reviewStatus = finding.reviewStatus || finding.review_status || 'pending';
      const sevLower = String(finding.severity || 'info').toLowerCase();
      const sevLabel = translateFindingSeverity(finding.severity);
      const ruleLabel = translateFindingRule(finding.ruleId || finding.rule_id);
      const msgLabel = translateFindingMessage(finding.message);
      const remLabel = translateFindingRemediation(finding.remediation);
      return `<article class="discoverability-finding severity-${escapeHTML(sevLower)}" data-discoverability-finding="${escapeHTML(finding.id)}">
        <div class="discoverability-finding-heading"><span class="severity-badge ${escapeHTML(sevLower)}">${escapeHTML(sevLabel)}</span><strong>${escapeHTML(ruleLabel)}</strong><span class="review-state ${escapeHTML(reviewStatus)}">${escapeHTML(label(reviewStatus))}</span></div>
        <p>${escapeHTML(msgLabel)}</p>
        ${remLabel ? `<small>${escapeHTML(remLabel)}</small>` : ''}
        ${finding.reviewReason || finding.review_reason ? `<small>Nota do revisor: ${escapeHTML(finding.reviewReason || finding.review_reason)}</small>` : ''}
        <div class="discoverability-review-actions"><button type="button" class="text-button approve" data-discoverability-accept ${reviewStatus === 'accepted' ? 'disabled' : ''}>Manter recomendação</button><button type="button" class="text-button" data-discoverability-dismiss ${reviewStatus === 'dismissed' ? 'disabled' : ''}>Dispensar falso positivo</button></div>
      </article>`;
    }).join('')}</div>` : audit && audit.status !== 'unavailable' ? '<p class="empty-inline">Nenhuma pendência encontrada. O pacote de conteúdo passou em todas as verificações consultivas.</p>' : '<p class="empty-inline">Execute a auditoria para gerar uma análise revisável para esta produção.</p>'}
  </section>`;
}

function renderSceneEditor(item, canReview = true) {
  const scenes = item.scenes || [];
  if (!scenes.length) return '';
  const verifiedSources = (item.provenance?.sources || []).filter(source => source.status === 'verified');
  const audio = item.assets?.audio || {};
  const intentionalSilence = audio.intentionalSilence === true;
  const narrationIssues = scenes.filter(scene => !['current', 'intentional_silence'].includes(scene.narrationStatus)).length;
  return `<section class="scene-repair-panel">
    <div class="panel-heading scene-heading">
      <div><p class="eyebrow">ESTÚDIO DE EDIÇÃO DE CENAS</p><h3>Ajuste a linha do tempo sem recriar o vídeo inteiro</h3><p>Edite, substitua ou regenere uma cena. As alterações ficam em rascunho até que o vídeo final seja recompilado e aprovado.</p></div>
      ${canReview ? `<button type="button" class="button primary small" data-rebuild-scenes="${escapeHTML(item.id)}">Recompilar vídeo final</button>` : ''}
    </div>
    <div class="narration-recovery ${intentionalSilence ? 'intentional' : narrationIssues ? 'attention' : ''}">
      <div><p class="eyebrow">CONFIABILIDADE DA NARRAÇÃO</p><strong>${intentionalSilence ? 'Silêncio intencional confirmado' : narrationIssues ? `${narrationIssues} cena${narrationIssues === 1 ? '' : 's'} precisam de narração` : 'Áudio e narração atualizados'}</strong>
      <p>${intentionalSilence ? escapeHTML(audio.silenceReason || '') : audio.error ? escapeHTML(audio.error) : 'Regenere a narração sem substituir o visual da cena. A aprovação permanece bloqueada até o áudio estar pronto.'}</p>
      ${audio.provider ? `<span class="narration-evidence">${escapeHTML(audio.provider)}${audio.model ? ` · ${escapeHTML(audio.model)}` : ''}${audio.externalTaskId ? ` · tarefa ${escapeHTML(audio.externalTaskId)}` : ''}</span>` : ''}</div>
      ${canReview ? intentionalSilence
        ? '<button type="button" class="button secondary small" data-require-narration>Exigir narração</button>'
        : `<button type="button" class="button primary small" data-regenerate-all-narration="${escapeHTML(item.id)}">Regenerar todo o áudio com IA</button><button type="button" class="button secondary small" data-intentional-silence>Usar silêncio intencional</button>` : ''}
    </div>
    <div class="scene-summary"><strong>${scenes.length} cenas</strong><span>${Math.round(scenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0))}s de duração</span><span>${scenes.filter(scene => scene.status !== 'ready').length} ajustes pendentes</span></div>
    <div class="scene-list">
      ${scenes.map((scene, index) => {
        const disabled = !canReview || scene.locked;
        const sourceIds = new Set(scene.provenanceSourceIds || []);
        const preview = scene.assetUrl
          ? scene.assetType === 'video'
            ? `<video controls preload="metadata"><source src="${escapeHTML(scene.assetUrl)}"></video>`
            : `<img src="${escapeHTML(scene.assetUrl)}" alt="${escapeHTML(scene.label)} imagem da cena">`
          : '<div class="preview-placeholder">Sem mídia da cena</div>';
        return `<article class="scene-card ${scene.locked ? 'locked' : ''}" data-scene-card="${escapeHTML(scene.id)}">
          <div class="scene-card-top">
            <div class="scene-preview">${preview}<span class="scene-number">${index + 1}</span></div>
            <div class="scene-identity">
              <div class="scene-status-row">${statusChip(scene.status)} ${statusChip(`narration_${scene.narrationStatus || 'unavailable'}`)}<span>r${scene.revision}</span></div>
              <label><span>Identificação da cena</span><input data-scene-field="label" maxlength="120" value="${escapeHTML(scene.label)}" ${disabled ? 'disabled' : ''}></label>
              <label><span>Duração (s)</span><input data-scene-field="duration" type="number" min="2" max="600" step="0.5" value="${escapeHTML(scene.duration)}" ${disabled ? 'disabled' : ''}></label>
            </div>
          </div>
          <label><span>Narração / Texto falado</span><textarea data-scene-field="scriptText" rows="4" maxlength="10000" ${disabled ? 'disabled' : ''}>${escapeHTML(scene.scriptText)}</textarea></label>
          <label><span>Prompt visual</span><textarea data-scene-field="prompt" rows="3" maxlength="2000" ${disabled ? 'disabled' : ''}>${escapeHTML(scene.prompt)}</textarea></label>
          ${verifiedSources.length ? `<fieldset class="source-checklist scene-sources" ${disabled ? 'disabled' : ''}><legend>Evidências verificadas vinculadas a esta fala</legend>${verifiedSources.map(source => `<label><input type="checkbox" data-scene-source value="${escapeHTML(source.id)}" ${sourceIds.has(source.id) ? 'checked' : ''}> ${escapeHTML(source.title)}</label>`).join('')}</fieldset>` : ''}
          <div class="scene-options">
            <label class="toggle"><input type="checkbox" data-scene-factual checked ${disabled ? 'disabled' : ''}><span></span> Alterações no roteiro podem conter afirmações factuais</label>
            <span>Visual: ${escapeHTML(scene.provider || 'local')} ${scene.model ? `· ${escapeHTML(scene.model)}` : ''}</span>
          </div>
          <div class="scene-narration-evidence"><span>Narração: ${escapeHTML(scene.narrationProvider || 'não gerada')}${scene.narrationModel ? ` · ${escapeHTML(scene.narrationModel)}` : ''}${scene.narrationTaskId ? ` · tarefa ${escapeHTML(scene.narrationTaskId)}` : ''}</span>${scene.narrationError ? `<span class="danger-text">${escapeHTML(scene.narrationError)}</span>` : ''}</div>
          ${canReview ? `<div class="scene-actions">
            <button type="button" class="text-button" data-scene-move="up" ${disabled || index === 0 ? 'disabled' : ''}>↑ Para antes</button>
            <button type="button" class="text-button" data-scene-move="down" ${disabled || index === scenes.length - 1 ? 'disabled' : ''}>↓ Para depois</button>
            <button type="button" class="text-button approve" data-scene-save ${disabled ? 'disabled' : ''}>Salvar cena</button>
            <button type="button" class="text-button" data-scene-narration ${disabled ? 'disabled' : ''}>Regenerar apenas narração</button>
            <label class="text-button upload-button ${disabled ? 'disabled' : ''}">Subir áudio próprio<input type="file" data-scene-audio-upload accept="audio/mp3,audio/mpeg,audio/wav" ${disabled ? 'disabled' : ''}></label>
            <button type="button" class="text-button" data-scene-regenerate ${disabled ? 'disabled' : ''}>Regenerar cena completa</button>
            <label class="text-button upload-button ${disabled ? 'disabled' : ''}">Substituir mídia<input type="file" data-scene-upload accept="image/png,image/jpeg,image/webp,video/mp4" ${disabled ? 'disabled' : ''}></label>
            <button type="button" class="text-button" data-scene-lock>${scene.locked ? 'Desbloquear' : 'Bloquear'}</button>
          </div>` : ''}
        </article>`;
      }).join('')}
    </div>
  </section>`;
}

function renderShortsStudio(item) {
  if (!item.assets?.finalVideo?.path || item.assets.finalVideo.simulated) return '';
  const clips = item.shorts || [];
  const parentApproved = item.review_status === 'approved';
  return `<section class="shorts-studio">
    <div class="panel-heading shorts-heading">
      <div><p class="eyebrow">ESTÚDIO DE CORTES E SHORTS</p><h3>Transforme o vídeo em alcance vertical (Shorts)</h3><p>Crie trechos verticais 9:16 locais com legendas dinâmicas. Os rascunhos herdam as evidências do vídeo original e exigem aprovação separada.</p></div>
      <button type="button" class="button secondary small" data-propose-shorts="${escapeHTML(item.id)}">${clips.length ? 'Atualizar rascunhos' : 'Criar 3 opções de Shorts'}</button>
    </div>
    <div class="shorts-evidence ${parentApproved ? 'ready' : ''}">
      <span>${parentApproved ? '✓ Produção original aprovada' : 'Aprovação do vídeo original necessária antes de agendar'}</span>
      <span>${escapeHTML(item.provenance?.status === 'verified' ? 'Evidências verificadas' : item.provenance?.status === 'not_required' ? 'Sem afirmações factuais declaradas' : 'Revisão de evidências incompleta')}</span>
      <span>Renderização local · sem consumo de créditos</span>
    </div>
    ${clips.length ? `<div class="shorts-grid">${clips.map(clip => {
      const locked = ['scheduled', 'uploading', 'published', 'reconciliation_required'].includes(clip.status);
      const rendered = Boolean(clip.assetUrls?.video);
      return `<article class="short-card" data-short-card="${escapeHTML(clip.id)}">
        <div class="short-preview">${rendered
          ? `<video controls preload="metadata"><source src="${escapeHTML(clip.assetUrls.video)}" type="video/mp4"></video>`
          : `<div class="short-placeholder"><strong>9:16</strong><span>Layout ${escapeHTML(label(clip.layout))}</span></div>`}</div>
        <div class="short-editor">
          <div class="scene-status-row">${statusChip(clip.status)}<span>${Number(clip.duration || 0).toFixed(0)}s</span><span>${escapeHTML((clip.sourceSceneLabels || []).join(' + '))}</span></div>
          <label><span>Título do Short</span><input data-short-field="title" maxlength="100" value="${escapeHTML(clip.title)}" ${locked ? 'disabled' : ''}></label>
          <label><span>Descrição e chamada para o vídeo completo</span><textarea data-short-field="description" rows="3" maxlength="5000" ${locked ? 'disabled' : ''}>${escapeHTML(clip.description)}</textarea></label>
          <label><span>Tags</span><input data-short-field="tags" value="${escapeHTML((clip.tags || []).join(', '))}" ${locked ? 'disabled' : ''}></label>
          <div class="form-grid two">
            <label><span>Layout vertical</span><select data-short-field="layout" ${locked ? 'disabled' : ''}><option value="blur" ${clip.layout === 'blur' ? 'selected' : ''}>Fundo desfocado</option><option value="crop" ${clip.layout === 'crop' ? 'selected' : ''}>Corte centralizado</option><option value="stacked" ${clip.layout === 'stacked' ? 'selected' : ''}>Foco empilhado</option></select></label>
            <div>
              <label><span>Data e hora de publicação</span><input data-short-field="publishTime" type="datetime-local" value="${toLocalInput(clip.publishTime)}" ${locked ? 'disabled' : ''}></label>
              <div class="tz-short-preview-slot">${renderShortTimezoneBadge(toLocalInput(clip.publishTime))}</div>
            </div>
            <label><span>Visibilidade</span><select data-short-field="privacyStatus" ${locked ? 'disabled' : ''}><option value="private" ${clip.privacyStatus === 'private' ? 'selected' : ''}>Privado</option><option value="unlisted" ${clip.privacyStatus === 'unlisted' ? 'selected' : ''}>Não listado</option><option value="public" ${clip.privacyStatus === 'public' ? 'selected' : ''}>Público</option></select></label>
          </div>
          <p class="short-rationale">${escapeHTML(clip.rationale || '')}${clip.error ? `<br><span class="danger-text">${escapeHTML(clip.error)}</span>` : ''}</p>
          ${clip.youtubeUrl ? `<a class="source-link" href="${escapeHTML(clip.youtubeUrl)}" target="_blank" rel="noopener">Abrir Short publicado ↗</a>` : ''}
          ${!locked ? `<div class="short-actions"><button type="button" class="text-button" data-short-save>Salvar rascunho</button><button type="button" class="button secondary small" data-short-render>${rendered ? 'Renderizar novamente' : 'Renderizar 9:16'}</button><button type="button" class="button primary small" data-short-approve ${!parentApproved || clip.status !== 'rendered' ? 'disabled' : ''} title="${!parentApproved ? 'Aprove a produção original primeiro' : clip.status !== 'rendered' ? 'Renderize este Short primeiro' : 'Confirmar e agendar este Short'}">Aprovar e agendar</button></div>` : ''}
        </div>
      </article>`;
    }).join('')}</div>` : '<p class="empty-inline">Nenhum rascunho de Short ainda. Crie três opções a partir da linha do tempo atual sem consumir créditos.</p>'}
  </section>`;
}

const QUALITY_TRANSLATIONS = {
  'Only a simulated video was produced': 'Apenas vídeo simulado gerado (necessário recompilar o MP4 real)',
  'Final MP4 is ready': 'Vídeo MP4 final está pronto',
  'Final MP4 is missing': 'Arquivo MP4 final ausente',
  'Narration is missing or unusable; regenerate it before approval': 'Narração ausente ou incompleta',
  'Replacement scene assets have rights confirmation': 'Ativos de cenas substituídas possuem confirmação de direitos',
  'No blocked brand topics detected': 'Nenhum termo de marca bloqueado detectado',
  'No duplicate topic detected in the last 90 days': 'Nenhum tópico duplicado detectado nos últimos 90 dias',
  'Description is detailed enough': 'Descrição detalhada o suficiente',
  'Script content is present': 'Conteúdo do roteiro está presente',
  'Thumbnail asset is present': 'Recurso de miniatura presente',
  'Thumbnail asset is missing': 'Recurso de miniatura ausente',
  'Final video file exists on disk': 'Arquivo de vídeo final existe no disco'
};

function translateQualityMessage(msg) {
  if (!msg) return '';
  if (QUALITY_TRANSLATIONS[msg]) return QUALITY_TRANSLATIONS[msg];
  if (/^Title is (\d+)\/100 characters/.test(msg)) {
    return msg.replace(/^Title is (\d+)\/100 characters/, 'Título tem $1/100 caracteres');
  }
  if (/^(\d+) tags provided/.test(msg)) {
    return msg.replace(/^(\d+) tags provided/, '$1 tags fornecidas');
  }
  if (/^(\d+) factual claims? still require evidence review/.test(msg)) {
    return msg.replace(/^(\d+) factual claims? still require evidence review/, '$1 afirmação(ões) factual(is) requer(em) checagem');
  }
  if (/^(\d+) factual claims? resolved/.test(msg)) {
    return msg.replace(/^(\d+) factual claims? resolved/, '$1 afirmações factuais verificadas');
  }
  if (/^(\d+) scenes? still require repair or rebuild/.test(msg)) {
    return msg.replace(/^(\d+) scenes? still require repair or rebuild/, '$1 cena(s) precisa(m) de reparo ou recompilação');
  }
  if (/^(\d+) scenes? are rebuilt and current/.test(msg)) {
    return msg.replace(/^(\d+) scenes? are rebuilt and current/, '$1 cena(s) reconstruída(s) e atualizada(s)');
  }
  return msg;
}

function checkResolutionHint(check) {
  if (check.passed) return '';
  const hints = {
    video: 'Garanta que as cenas tenham áudio e clique no botão rosa "Recompilar vídeo final" no estúdio de cenas abaixo.',
    narration: 'Clique em "Regenerar todo o áudio com IA" ou "Subir áudio próprio" nas cenas, ou selecione "Usar silêncio intencional".',
    provenance: 'Na seção "Mesa de evidências e checagem" abaixo, mude a Resolução da afirmação de "Pendente" para "Verificado".',
    scene_integrity: 'No "Estúdio de Edição de Cenas" abaixo, clique no botão rosa "Recompilar vídeo final".',
    brand_policy: 'Remova os termos bloqueados do título, descrição ou roteiro.',
    title: 'Ajuste o título para ter entre 1 e 100 caracteres.',
    description: 'Aumente a descrição para pelo menos 50 caracteres.'
  };
  return hints[check.id] ? `<span class="check-hint">👉 <strong>Como resolver:</strong> ${escapeHTML(hints[check.id])}</span>` : '';
}

function formatReviewNotes(notes) {
  if (!notes) return '';
  if (notes.startsWith('Blocking checks failed:')) {
    const list = notes.replace('Blocking checks failed:', '').trim().split(',').map(s => s.trim());
    const labels = { video: 'Vídeo MP4 real', narration: 'Narração de áudio', provenance: 'Checagem de fatos', scene_integrity: 'Recompilação de cenas' };
    const translated = list.map(item => labels[item] || item).join(', ');
    return `<p class="callout danger"><strong>⚠️ Verificações pendentes para liberação:</strong> ${escapeHTML(translated)}</p>`;
  }
  return `<p class="callout">${escapeHTML(notes)}</p>`;
}

async function openContent(productionId) {
  $('#loading').classList.add('active');
  try {
    const item = await api(`/api/content/${encodeURIComponent(productionId)}`);
    const data = item.editorData || {};
    const title = cleanTitlePrefix(data.title || item.seo?.title || item.script?.title || item.strategy?.topic || 'Conteúdo sem título');
    const description = data.description || item.seo?.description || '';
    const tags = data.tags || item.seo?.tags || [];
    const publishTime = item.schedule?.publish_time || data.publishTime || item.scheduled_publish_time;
    const canReview = !['published'].includes(item.schedule?.status);
    const experiment = data.packagingExperiment;
    const selectedTitleVariant = Number(data.selectedTitleVariant || 0);
    const selectedThumbnailVariant = Number(data.selectedThumbnailVariant || 0);
    $('#content-detail').innerHTML = `
      <div class="dialog-heading"><div><p class="eyebrow">REVISÃO DE CONTEÚDO</p><h2>${escapeHTML(title)}</h2><div class="meta-line">${statusChip(item.schedule?.status || item.review_status || item.status)} · Qualidade ${qualityScore(item.qualityChecks)}%</div></div><button type="button" class="close-button" data-close>×</button></div>
      <form id="content-review-form" class="editor content-review-editor">
        <div class="content-layout">
          <div>
            <div class="preview">${item.assetUrls.video ? `<video controls preload="metadata" poster="${item.assetUrls.thumbnail || ''}"><source src="${item.assetUrls.video}" type="video/mp4"></video>` : item.assetUrls.thumbnail ? `<img src="${item.assetUrls.thumbnail}" alt="Miniatura gerada">` : '<div class="preview-placeholder">Nenhuma prévia reproduzível foi gerada.</div>'}</div>
            <div class="quality-grid">${(item.qualityChecks || []).map(check => `<div class="quality-check ${check.passed ? 'pass' : 'fail'}"><div>${check.passed ? '✓' : '×'} ${escapeHTML(translateQualityMessage(check.message))}</div>${checkResolutionHint(check)}</div>`).join('') || '<div class="quality-check">Nenhum resultado de qualidade registrado.</div>'}</div>
            ${formatReviewNotes(item.review_notes)}
          </div>
          <div class="editor">
            <label><span>Título</span><input name="title" maxlength="100" value="${escapeHTML(title)}" required></label>
            <label><span>Descrição</span><textarea name="description" rows="7">${escapeHTML(description)}</textarea></label>
            <label><span>Tags</span><input name="tags" value="${escapeHTML(tags.join(', '))}"></label>
            ${experiment ? `<section class="experiment-panel">
              <div><p class="eyebrow">EXPERIMENTO DE APRENDIZADO APROVADO</p><strong>${escapeHTML(experiment.hypothesis)}</strong><p>Escolha o pacote visual para lançar. Nada muda no YouTube até que este conteúdo seja aprovado e publicado.</p></div>
              <label><span>Variante de título</span><select name="selectedTitleVariant">${experiment.titleVariants.map((variant, index) => `<option value="${index}" data-title="${escapeHTML(variant.title)}" ${index === selectedTitleVariant ? 'selected' : ''}>${escapeHTML(variant.label)} — ${escapeHTML(variant.title)}</option>`).join('')}</select></label>
              <div class="experiment-thumbnails">${experiment.thumbnailVariants.map((variant, index) => `<label class="experiment-thumb ${index === selectedThumbnailVariant ? 'selected' : ''}"><input type="radio" name="selectedThumbnailVariant" value="${index}" ${index === selectedThumbnailVariant ? 'checked' : ''}><img src="${escapeHTML(item.assetUrls.experimentThumbnails?.[index] || '')}" alt="${escapeHTML(variant.label)} variante de miniatura"><span>${escapeHTML(variant.label)}</span></label>`).join('')}</div>
            </section>` : ''}
          </div>
        </div>
        ${renderSceneEditor(item, canReview)}
        ${renderShortsStudio(item)}
        ${renderDiscoverabilityPanel(item)}
        ${renderProvenanceEditor(item.provenance, canReview, item.id)}
          <div class="tz-schedule-container">
            <div class="form-grid two">
              <label><span>Data e hora de publicação (horário do Brasil)</span><input name="publishTime" type="datetime-local" value="${toLocalInput(publishTime)}"></label>
              <label><span>Visibilidade</span><select name="privacyStatus"><option value="private" ${data.privacyStatus === 'private' ? 'selected' : ''}>Privado</option><option value="unlisted" ${data.privacyStatus === 'unlisted' ? 'selected' : ''}>Não listado</option><option value="public" ${data.privacyStatus === 'public' ? 'selected' : ''}>Público</option></select></label>
            </div>
            <div id="publish-tz-helper-container">
              ${renderTimezoneConverterCard(toLocalInput(publishTime))}
            </div>
          </div>
          <div class="settings-row">
            <label class="toggle"><input name="factChecked" type="checkbox" ${data.factChecked ? 'checked' : ''}><span></span> Fatos e afirmações verificados</label>
            <label class="toggle"><input name="rightsConfirmed" type="checkbox" ${data.rightsConfirmed ? 'checked' : ''}><span></span> Direitos de uso da mídia confirmados</label>
          </div>
          ${item.schedule && !['published', 'uploading', 'uploaded', 'reconciliation_required'].includes(item.schedule.status) ? `<div class="form-actions"><button type="button" class="button secondary" data-reschedule-content="${escapeHTML(item.id)}">Reagendar</button><button type="button" class="button primary" data-publish-now-content="${escapeHTML(item.id)}">Publicar agora</button><button type="button" class="button danger" data-delete-schedule="${escapeHTML(item.id)}">Excluir agendamento</button></div>` : ''}
          ${canReview ? `<div class="form-actions"><button type="button" class="button primary" data-approve-content="${escapeHTML(item.id)}">Aprovar e agendar</button><button type="button" class="button secondary" data-save-content="${escapeHTML(item.id)}">Salvar rascunho</button><button type="button" class="button danger" data-reject-content="${escapeHTML(item.id)}">Rejeitar</button><button type="button" class="button ghost" data-retry-content="${escapeHTML(item.id)}">Regenerar</button>${item.status === 'rejected' ? `<button type="button" class="button danger" data-delete-production="${escapeHTML(item.id)}">Excluir projeto</button>` : ''}</div>` : `<a class="button secondary" href="${escapeHTML(item.schedule?.youtube_url || '#')}" target="_blank" rel="noopener">Abrir no YouTube</a>`}
      </form>`;
    $('#content-review-form').dataset.productionId = item.id;
    $('#content-dialog').showModal();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    $('#loading').classList.remove('active');
  }
}

const POPULAR_SCHEDULE_TIMEZONES = [
  { id: 'Europe/Madrid', label: 'Espanha (Madrid, Barcelona)', flag: '🇪🇸', country: 'Espanha', desc: 'Horário nobre: 19h - 22h' },
  { id: 'America/Sao_Paulo', label: 'Brasil (Brasília, SP, RJ)', flag: '🇧🇷', country: 'Brasil', desc: 'Horário de referência' },
  { id: 'Europe/Lisbon', label: 'Portugal (Lisboa, Porto)', flag: '🇵🇹', country: 'Portugal', desc: 'Horário nobre: 18h - 21h' },
  { id: 'America/New_York', label: 'EUA (Nova York / Costa Leste)', flag: '🇺🇸', country: 'EUA (Leste)', desc: 'ET / UTC-4' },
  { id: 'America/Los_Angeles', label: 'EUA (Los Angeles / Costa Oeste)', flag: '🇺🇸', country: 'EUA (Oeste)', desc: 'PT / UTC-7' },
  { id: 'America/Mexico_City', label: 'México (Cidade do México)', flag: '🇲🇽', country: 'México', desc: 'CST / UTC-6' },
  { id: 'America/Bogota', label: 'Colômbia (Bogotá)', flag: '🇨🇴', country: 'Colômbia', desc: 'COT / UTC-5' },
  { id: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)', flag: '🇦🇷', country: 'Argentina', desc: 'ART / UTC-3' },
  { id: 'America/Santiago', label: 'Chile (Santiago)', flag: '🇨🇱', country: 'Chile', desc: 'CLT / UTC-3' },
  { id: 'Europe/London', label: 'Reino Unido (Londres)', flag: '🇬🇧', country: 'Reino Unido', desc: 'GMT / BST' },
  { id: 'Europe/Paris', label: 'França (Paris)', flag: '🇫🇷', country: 'França', desc: 'CET / CEST' },
  { id: 'Europe/Berlin', label: 'Alemanha (Berlim)', flag: '🇩🇪', country: 'Alemanha', desc: 'CET / CEST' },
  { id: 'Asia/Tokyo', label: 'Japão (Tóquio)', flag: '🇯🇵', country: 'Japão', desc: 'JST / UTC+9' }
];

function getSelectedScheduleTimezone() {
  const saved = localStorage.getItem('lumen_schedule_target_tz');
  if (saved) return saved;
  return ui.state?.profile?.timezone || ui.state?.settings?.channel_timezone || 'America/Sao_Paulo';
}

function getTzOffsetMinutes(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false
    }).formatToParts(date);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const hour = map.hour === '24' ? 0 : +map.hour;
    const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, hour, +map.minute, +map.second);
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch (_e) {
    return 0;
  }
}

function formatTzDisplay(date, tz) {
  try {
    const dFmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);

    const tFmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);

    const hourNum = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(date));

    const tzNameFmt = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      timeZoneName: 'short'
    }).formatToParts(date).find(p => p.type === 'timeZoneName')?.value || '';

    return { dateStr: dFmt, timeStr: tFmt, hourNum, tzName: tzNameFmt };
  } catch (_e) {
    return {
      dateStr: date.toLocaleDateString('pt-BR'),
      timeStr: date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      hourNum: date.getHours(),
      tzName: tz
    };
  }
}

function renderTimezoneConverterCard(dateInputValue, targetTz = getSelectedScheduleTimezone()) {
  const currentTzInfo = POPULAR_SCHEDULE_TIMEZONES.find(t => t.id === targetTz) || {
    id: targetTz,
    label: targetTz,
    flag: '🌍',
    country: targetTz,
    desc: 'Fuso personalizado'
  };

  const optionsHtml = POPULAR_SCHEDULE_TIMEZONES.map(t =>
    `<option value="${escapeHTML(t.id)}" ${t.id === targetTz ? 'selected' : ''}>${t.flag} ${escapeHTML(t.label)}</option>`
  ).join('');

  if (!dateInputValue) {
    return `
      <div class="tz-converter-box">
        <div class="tz-converter-header">
          <div class="tz-header-title">
            <span class="tz-icon">🌍</span>
            <span>Horário de postagem no destino</span>
          </div>
          <div class="tz-selector-wrapper">
            <span class="tz-selector-label">Local de postagem:</span>
            <select id="schedule-target-tz-select" class="tz-select">${optionsHtml}</select>
          </div>
        </div>
        <div class="tz-empty-notice">
          📅 Escolha uma data e horário acima no <strong>horário do Brasil</strong> para ver exatamente que horas o vídeo sairá em ${escapeHTML(currentTzInfo.country)}.
        </div>
      </div>
    `;
  }

  const localDate = new Date(dateInputValue);
  if (Number.isNaN(localDate.getTime())) {
    return `
      <div class="tz-converter-box">
        <div class="tz-empty-notice">Data/hora inválida selecionada.</div>
      </div>
    `;
  }

  const brDisplay = formatTzDisplay(localDate, 'America/Sao_Paulo');
  const targetDisplay = formatTzDisplay(localDate, targetTz);

  const brOffset = getTzOffsetMinutes(localDate, 'America/Sao_Paulo');
  const targetOffset = getTzOffsetMinutes(localDate, targetTz);
  const diffMinutes = targetOffset - brOffset;
  const diffHours = diffMinutes / 60;

  let diffBadgeClass = 'positive';
  let diffBadgeText = `+${diffHours}h à frente`;
  if (diffHours < 0) {
    diffBadgeClass = 'negative';
    diffBadgeText = `${diffHours}h atrás`;
  } else if (diffHours === 0) {
    diffBadgeClass = '';
    diffBadgeText = 'Mesmo fuso';
  }

  // Audience contextual recommendation
  let audienceTag = '';
  const hour = targetDisplay.hourNum;
  if (hour >= 18 && hour <= 22) {
    audienceTag = '<span class="tz-tag prime">⭐ Horário Nobre no Destino</span>';
  } else if (hour >= 12 && hour < 18) {
    audienceTag = '<span class="tz-tag daytime">☀️ Tarde no Destino</span>';
  } else if (hour >= 0 && hour < 7) {
    audienceTag = '<span class="tz-tag night">🌙 Madrugada no Destino</span>';
  }

  const isDifferentDay = brDisplay.dateStr !== targetDisplay.dateStr;
  const dayAlert = isDifferentDay ? ` <span style="color: var(--amber); font-weight: 600;">(Atenção: no destino já será ${escapeHTML(targetDisplay.dateStr)})</span>` : '';

  // Quick preset buttons for Spain/Madrid
  const presetHoursTarget = [19, 20, 21];
  const presetsHtml = targetTz === 'Europe/Madrid' ? `
    <div class="tz-quick-presets">
      <span>Atalhos para Espanha:</span>
      ${presetHoursTarget.map(h => {
        const brH = (h - diffHours + 24) % 24;
        const brHStr = String(brH).padStart(2, '0') + ':00';
        return `<button type="button" class="tz-preset-btn" data-set-schedule-hour="${brHStr}">Definir ${h}:00 na Espanha (${brHStr} Brasil)</button>`;
      }).join('')}
    </div>
  ` : '';

  return `
    <div class="tz-converter-box">
      <div class="tz-converter-header">
        <div class="tz-header-title">
          <span class="tz-icon">🌍</span>
          <span>Correspondência de Horário de Postagem</span>
        </div>
        <div class="tz-selector-wrapper">
          <span class="tz-selector-label">Local de postagem:</span>
          <select id="schedule-target-tz-select" class="tz-select">${optionsHtml}</select>
        </div>
      </div>

      <div class="tz-comparison-grid">
        <div class="tz-card">
          <div class="tz-card-badge">
            <span class="flag-label">🇧🇷 Seu Horário (Brasil)</span>
            <span>GMT-3</span>
          </div>
          <div class="tz-card-time">${escapeHTML(brDisplay.timeStr)}</div>
          <div class="tz-card-date">${escapeHTML(brDisplay.dateStr)}</div>
          <div class="tz-card-zone">Horário de Brasília</div>
        </div>

        <div class="tz-arrow-column">
          <span class="tz-arrow-badge ${diffBadgeClass}">${diffBadgeText}</span>
          <span class="tz-arrow-icon">➔</span>
        </div>

        <div class="tz-card destination">
          <div class="tz-card-badge">
            <span class="flag-label">${currentTzInfo.flag} Postagem em ${escapeHTML(currentTzInfo.country)}</span>
            <span>${escapeHTML(targetDisplay.tzName || targetTz)}</span>
          </div>
          <div class="tz-card-time">${escapeHTML(targetDisplay.timeStr)}</div>
          <div class="tz-card-date">${escapeHTML(targetDisplay.dateStr)}</div>
          <div class="tz-card-zone">${escapeHTML(currentTzInfo.label)}</div>
        </div>
      </div>

      <div class="tz-banner">
        <div>
          💡 Ao agendar para as <strong>${escapeHTML(brDisplay.timeStr)}</strong> no Brasil, o vídeo será publicado às <strong>${escapeHTML(targetDisplay.timeStr)}</strong> em <strong>${escapeHTML(currentTzInfo.country)}</strong>.${dayAlert}
        </div>
        ${audienceTag}
      </div>

      ${presetsHtml}
    </div>
  `;
}

function renderShortTimezoneBadge(dateInputValue, targetTz = getSelectedScheduleTimezone()) {
  if (!dateInputValue) return '';
  const localDate = new Date(dateInputValue);
  if (Number.isNaN(localDate.getTime())) return '';
  const targetTzInfo = POPULAR_SCHEDULE_TIMEZONES.find(t => t.id === targetTz) || { flag: '🇪🇸', country: 'Espanha' };
  const br = formatTzDisplay(localDate, 'America/Sao_Paulo');
  const dest = formatTzDisplay(localDate, targetTz);
  const diffHours = (getTzOffsetMinutes(localDate, targetTz) - getTzOffsetMinutes(localDate, 'America/Sao_Paulo')) / 60;
  const diffStr = diffHours > 0 ? `+${diffHours}h` : diffHours < 0 ? `${diffHours}h` : '0h';
  return `
    <div class="tz-short-compact-preview">
      <span>🇧🇷 ${escapeHTML(br.timeStr)} Brasil</span>
      <span>➔</span>
      <span>${targetTzInfo.flag} <strong>${escapeHTML(dest.timeStr)} em ${escapeHTML(targetTzInfo.country)}</strong> (${diffStr})</span>
    </div>
  `;
}

function toLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return escapeHTML(new Date(date.getTime() - offset).toISOString().slice(0, 16));
}

function contentFormData() {
  const form = $('#content-review-form');
  const values = Object.fromEntries(new FormData(form));
  return {
    title: values.title,
    description: values.description,
    tags: values.tags,
    publishTime: values.publishTime ? new Date(values.publishTime).toISOString() : undefined,
    privacyStatus: values.privacyStatus,
    selectedTitleVariant: values.selectedTitleVariant,
    selectedThumbnailVariant: values.selectedThumbnailVariant,
    factChecked: form.elements.factChecked?.checked || false,
    rightsConfirmed: form.elements.rightsConfirmed?.checked || false
  };
}

function sceneFormData(card) {
  return {
    label: card.querySelector('[data-scene-field="label"]').value,
    duration: Number(card.querySelector('[data-scene-field="duration"]').value),
    scriptText: card.querySelector('[data-scene-field="scriptText"]').value,
    prompt: card.querySelector('[data-scene-field="prompt"]').value,
    provenanceSourceIds: Array.from(card.querySelectorAll('[data-scene-source]:checked')).map(input => input.value),
    factualChange: card.querySelector('[data-scene-factual]')?.checked !== false
  };
}

function shortFormData(card) {
  const publishTime = card.querySelector('[data-short-field="publishTime"]')?.value;
  return {
    title: card.querySelector('[data-short-field="title"]')?.value,
    description: card.querySelector('[data-short-field="description"]')?.value,
    tags: card.querySelector('[data-short-field="tags"]')?.value,
    layout: card.querySelector('[data-short-field="layout"]')?.value,
    publishTime: publishTime ? new Date(publishTime).toISOString() : undefined,
    privacyStatus: card.querySelector('[data-short-field="privacyStatus"]')?.value
  };
}

async function refreshContentDialog(productionId, message) {
  if (message) showToast(message);
  if ($('#content-dialog').open) $('#content-dialog').close();
  await refreshDashboard(true);
  await openContent(productionId);
}

async function uploadSceneAsset(productionId, sceneId, file) {
  if (!confirm('Confirme que você possui ou tem permissão para usar esta mídia de substituição.')) return;
  const synthetic = confirm('Esta mídia contém conteúdo alterado ou sintético realista que deve ser declarado ao YouTube?');
  $('#loading').classList.add('active');
  try {
    await api(`/api/content/${encodeURIComponent(productionId)}/scenes/${encodeURIComponent(sceneId)}/asset`, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type,
        'x-file-name': file.name,
        'x-rights-confirmed': 'true',
        'x-synthetic-media': String(synthetic)
      }
    });
    await refreshContentDialog(productionId, 'Mídia da cena substituída. Recompile o vídeo antes de aprovar.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    $('#loading').classList.remove('active');
  }
}

async function uploadSceneAudio(productionId, sceneId, file) {
  $('#loading').classList.add('active');
  try {
    await api(`/api/content/${encodeURIComponent(productionId)}/scenes/${encodeURIComponent(sceneId)}/audio`, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type || 'audio/mpeg',
        'x-file-name': file.name
      }
    });
    await refreshContentDialog(productionId, 'Áudio próprio da cena carregado com sucesso. Recompile o vídeo final quando terminar.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    $('#loading').classList.remove('active');
  }
}

function provenanceFormData() {
  const sources = $$('[data-provenance-source]').map(item => ({
    id: item.dataset.id,
    url: item.querySelector('[data-field="url"]').value,
    title: item.querySelector('[data-field="title"]').value,
    publisher: item.querySelector('[data-field="publisher"]').value,
    sourceType: item.querySelector('[data-field="sourceType"]').value,
    status: item.querySelector('[data-field="status"]').value,
    notes: item.querySelector('[data-field="notes"]').value,
    publishedAt: item.dataset.publishedAt || null,
    accessedAt: item.dataset.accessedAt || null
  }));
  const claims = $$('[data-provenance-claim]').map(item => ({
    id: item.dataset.id,
    text: item.querySelector('[data-field="text"]').value,
    riskLevel: item.querySelector('[data-field="riskLevel"]').value,
    status: item.querySelector('[data-field="status"]').value,
    notes: item.querySelector('[data-field="notes"]').value,
    sourceIds: [...item.querySelectorAll('[data-claim-source]:checked')].map(input => input.dataset.claimSource)
  }));
  return {
    sources,
    claims,
    containsSyntheticMedia: $('#contains-synthetic-media')?.checked || false
  };
}

function clientId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${uuid}`;
}

function currentSourceOptions() {
  return $$('[data-provenance-source]').map(item => ({
    id: item.dataset.id,
    title: item.querySelector('[data-field="title"]').value || item.querySelector('[data-field="url"]').value || 'Nova fonte'
  }));
}

async function persistProvenance(productionId, successMessage = null) {
  $('#loading').classList.add('active');
  try {
    const result = await api(`/api/content/${encodeURIComponent(productionId)}/provenance`, {
      method: 'PUT',
      body: JSON.stringify(provenanceFormData())
    });
    if (successMessage) {
      showToast(successMessage);
      $('#content-dialog').close();
      await openContent(productionId);
    }
    return result;
  } catch (error) {
    showToast(error.message, 'error');
    throw error;
  } finally {
    $('#loading').classList.remove('active');
  }
}

function translateErrorMessage(message, failures) {
  const failureLabels = {
    title: 'Título',
    description: 'Descrição',
    tags: 'Tags',
    script: 'Roteiro',
    thumbnail: 'Miniatura',
    video: 'Vídeo MP4 real',
    video_file: 'Arquivo de vídeo no disco',
    narration: 'Narração de áudio',
    brand_policy: 'Política da marca / termos bloqueados',
    provenance: 'Revisão de evidências e fatos',
    discoverability: 'Auditoria de SEO / Descoberta',
    scene_integrity: 'Integridade das cenas',
    scene_rights: 'Direitos dos ativos das cenas'
  };

  const translatedFailures = Array.isArray(failures)
    ? failures.map(f => failureLabels[f] || f).join(', ')
    : '';

  if (message.includes('Confirm the factual review and media rights checks')) {
    return 'Marque as duas caixas de seleção obrigatórias: "Fatos e afirmações verificados" e "Direitos de uso da mídia confirmados".';
  }
  if (message.includes('Content still has blocking quality failures')) {
    return `O conteúdo possui verificações de bloqueio pendentes: ${translatedFailures || 'verifique os itens em vermelho no checklist'}.`;
  }
  if (message.includes('A real MP4 is required')) {
    return 'Um arquivo MP4 real é obrigatório antes de aprovar. Vídeos simulados de teste não podem ser agendados para o YouTube.';
  }
  if (message.includes('Content not found')) {
    return 'Conteúdo não encontrado.';
  }
  if (message.includes('Content is already published')) {
    return 'Este conteúdo já foi publicado.';
  }
  if (message.includes('Provenance is locked')) {
    return 'A mesa de evidências fica bloqueada após a aprovação ou agendamento.';
  }
  if (message.includes('Publishing is blocked by the production readiness gate')) {
    return 'A publicação estava bloqueada por uma checagem anterior do sistema. O teste foi reexecutado e liberado com sucesso!';
  }
  if (message.includes('Provide 1 to 8 content pillars') || message.includes('content pillars') || message.includes('contentPillars')) {
    return 'Informe de 1 a 8 pilares de conteúdo separados por vírgula, com até 100 caracteres cada.';
  }
  if (message.includes('A channel objective is required') || message.includes('O objetivo do canal é obrigatório')) {
    return 'O objetivo do canal é obrigatório.';
  }
  if (message.includes('A target audience is required') || message.includes('O público-alvo é obrigatório')) {
    return 'O público-alvo é obrigatório.';
  }
  if (message.includes('Wait for the current generation job to finish')) {
    return 'Aguarde o trabalho de geração atual terminar antes de iniciar uma nova execução.';
  }
  if (message.includes('Finish setup with npm run walkthrough')) {
    return 'Conclua a configuração inicial antes de ativar o operador autônomo.';
  }
  if (message.includes('Save and activate a channel strategy')) {
    return 'Salve e ative a estratégia do canal antes de iniciar o operador autônomo.';
  }
  if (message.includes('An autonomous operator run is already active')) {
    return 'Uma execução do operador autônomo já está em andamento.';
  }
  if (message.includes('Only failed or interrupted operator runs can be resumed')) {
    return 'Apenas execuções com falha ou interrompidas podem ser retomadas.';
  }
  return failures ? `${message}: ${failures.join(', ')}` : message;
}

async function mutate(url, method, body, successMessage) {
  $('#loading').classList.add('active');
  try {
    const result = await api(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    showToast(successMessage);
    await refreshDashboard(true);
    return result;
  } catch (error) {
    const failures = error.data?.quality?.blockingFailures;
    showToast(translateErrorMessage(error.message, failures), 'error');
    throw error;
  } finally {
    $('#loading').classList.remove('active');
  }
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]');
  if (nav) return switchView(nav.dataset.view);
  const go = event.target.closest('[data-go]');
  if (go) return switchView(go.dataset.go);
  if (event.target.closest('[data-close]')) return event.target.closest('dialog').close();

  const open = event.target.closest('[data-open-content]');
  if (open) return openContent(open.dataset.openContent);

  // Filtros de período da tela de Calendário (7, 15, 30 dias ou Todos)
  const calPeriodBtn = event.target.closest('[data-cal-period]');
  if (calPeriodBtn) {
    const period = calPeriodBtn.dataset.calPeriod;
    calendarCurrentPeriod = period;
    $$('#calendar-period-pills .period-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.calPeriod === period);
    });
    renderCalendar(ui.state?.schedule || []);
    return;
  }

  // Filtros de formato da tela de Calendário (Todos, Longos ou Shorts)
  const calFormatBtn = event.target.closest('[data-cal-format]');
  if (calFormatBtn) {
    const format = calFormatBtn.dataset.calFormat;
    calendarCurrentFormat = format;
    $$('#calendar-format-pills .period-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.calFormat === format);
    });
    renderCalendar(ui.state?.schedule || []);
    return;
  }

  // Botão Sincronizar do YouTube
  const calSyncBtn = event.target.closest('#cal-sync-yt-btn');
  if (calSyncBtn) {
    await syncCalendarFromYouTube();
    return;
  }

  // Ação de produzir tema planejado direto do Calendário
  const wfProduceBtn = event.target.closest('.wf-calendar-produce-btn');
  if (wfProduceBtn) {
    const topic = wfProduceBtn.dataset.topic;
    if (topic) {
      const topicInput = $('#wf-script-topic');
      if (topicInput) topicInput.value = topic;
      switchView('workflow');
      const step2 = $('#wf-step-2');
      if (step2) step2.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast(`Tema selecionado para roteiro: ${topic}`);
    }
    return;
  }

  const cancel = event.target.closest('[data-cancel-job]');
  if (cancel && confirm('Cancelar esta geração de vídeo após a etapa atual?')) {
    await mutate(`/api/jobs/${encodeURIComponent(cancel.dataset.cancelJob)}/cancel`, 'POST', {}, 'Cancelamento solicitado.').catch(() => {});
  }

  const idea = event.target.closest('[data-generate-idea]');
  if (idea) {
    await mutate(`/api/ideas/${encodeURIComponent(idea.dataset.generateIdea)}/generate`, 'POST', { length: 'medium' }, 'Ideia adicionada à fila de geração.').catch(() => {});
  }

  const resume = event.target.closest('[data-resume-job]');
  if (resume) {
    const jobId = resume.dataset.resumeJob;
    const select = $$('[data-resume-stage-for]').find(item => item.dataset.resumeStageFor === jobId);
    const stage = select?.value;
    if (confirm(`Retomar esta geração a partir da etapa ${label(stage)}? Etapas posteriores serão regeneradas.`)) {
      await mutate(`/api/jobs/${encodeURIComponent(jobId)}/resume`, 'POST', { stage }, `Geração retomada a partir de ${label(stage)}.`).catch(() => {});
    }
  }

  const learning = event.target.closest('[data-learning-action]');
  if (learning) {
    const action = learning.dataset.learningAction;
    const id = learning.dataset.learningId;
    const message = action === 'approve'
      ? 'Recomendação aprovada para futuros planejamentos autônomos.'
      : 'Recomendação rejeitada e excluída de futuros planejamentos.';
    await mutate(`/api/learning/recommendations/${encodeURIComponent(id)}/${action}`, 'POST', {}, message).catch(() => {});
  }

  const experiment = event.target.closest('[data-experiment-action]');
  if (experiment) {
    const action = experiment.dataset.experimentAction;
    const id = experiment.dataset.experimentId;
    const prompts = {
      approve: 'Aprovar este plano de teste A/B? Nada muda no YouTube ainda.',
      start: 'Iniciar este teste ao vivo? O agente alternará apenas as opções aprovadas e restaurará o original antes da decisão final.',
      adopt: 'Adotar a opção vencedora comprovada no YouTube e aprovar o aprendizado para futuros vídeos?',
      cancel: 'Cancelar este experimento e restaurar o título e miniatura originais?'
    };
    if (prompts[action] && !confirm(prompts[action])) return;
    const messages = {
      approve: 'Plano de teste aprovado.',
      start: 'Teste controlado iniciado.',
      refresh: 'Métricas do teste atualizadas.',
      adopt: 'Vencedor adotado e aprovado para planejamentos futuros.',
      cancel: 'Teste cancelado e versão original restaurada.'
    };
    await mutate(`/api/experiments/${encodeURIComponent(id)}/${action}`, 'POST', prompts[action] ? { confirmed: true } : {}, messages[action]).catch(() => {});
  }

  const refreshRetention = event.target.closest('#refresh-retention-button');
  if (refreshRetention?.dataset.videoId) {
    refreshRetention.disabled = true;
    try {
      await api(`/api/retention/${encodeURIComponent(refreshRetention.dataset.videoId)}/refresh`, {
        method: 'POST',
        body: JSON.stringify({ measurementWindow: refreshRetention.dataset.measurementWindow || 'rolling' })
      });
      showToast('Curva de retenção atualizada via YouTube Analytics.');
      await refreshDashboard(true);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      refreshRetention.disabled = false;
    }
  }

  const syncEngagement = event.target.closest('#engagement-sync-button');
  if (syncEngagement?.dataset.videoId) {
    syncEngagement.disabled = true;
    try {
      await mutate(`/api/engagement/${encodeURIComponent(syncEngagement.dataset.videoId)}/sync`, 'POST', { analyze: true }, 'Comentários sincronizados do YouTube.');
      ui.engagementDetail = null;
      renderEngagement(ui.state?.engagement || {});
    } catch (_error) { /* toast shown */ } finally {
      syncEngagement.disabled = false;
    }
  }

  const draftEngagement = event.target.closest('#engagement-draft-button');
  if (draftEngagement?.dataset.videoId) {
    draftEngagement.disabled = true;
    try {
      await mutate(`/api/engagement/${encodeURIComponent(draftEngagement.dataset.videoId)}/draft-replies`, 'POST', {}, 'Rascunhos de resposta gerados para revisão.');
      ui.engagementDetail = null;
      renderEngagement(ui.state?.engagement || {});
    } catch (_error) { /* toast shown */ } finally {
      draftEngagement.disabled = false;
    }
  }

  const replySave = event.target.closest('[data-reply-save]');
  if (replySave) {
    const card = replySave.closest('[data-reply-card]');
    const text = card?.querySelector('[data-reply-text]')?.value || '';
    await mutate(`/api/engagement/replies/${encodeURIComponent(replySave.dataset.replySave)}`, 'PATCH', { editedText: text }, 'Rascunho de resposta salvo.').catch(() => {});
    ui.engagementDetail = null;
    renderEngagement(ui.state?.engagement || {});
  }

  const replyDiscard = event.target.closest('[data-reply-discard]');
  if (replyDiscard) {
    await mutate(`/api/engagement/replies/${encodeURIComponent(replyDiscard.dataset.replyDiscard)}`, 'PATCH', { discard: true }, 'Rascunho de resposta descartado.').catch(() => {});
    ui.engagementDetail = null;
    renderEngagement(ui.state?.engagement || {});
  }

  const replyApprove = event.target.closest('[data-reply-approve]');
  if (replyApprove) {
    const card = replyApprove.closest('[data-reply-card]');
    const text = card?.querySelector('[data-reply-text]')?.value || '';
    if (!text.trim()) return showToast('O texto da resposta está vazio.', 'error');
    if (confirm(`Publicar esta resposta no YouTube?\n\n${text}`)) {
      await mutate(`/api/engagement/replies/${encodeURIComponent(replyApprove.dataset.replyApprove)}/approve`, 'POST', { confirmed: true, editedText: text }, 'Resposta publicada no YouTube com sucesso.').catch(() => {});
      ui.engagementDetail = null;
      renderEngagement(ui.state?.engagement || {});
    }
  }

  const proposeShorts = event.target.closest('[data-propose-shorts]');
  if (proposeShorts) {
    const productionId = proposeShorts.dataset.proposeShorts;
    const replacing = Boolean(document.querySelector('[data-short-card]'));
    if (replacing && !confirm('Substituir os rascunhos de Shorts atuais? Os arquivos renderizados permanecerão no disco, mas a lista de rascunhos será refeita.')) return;
    try {
      await api(`/api/content/${encodeURIComponent(productionId)}/shorts/propose`, {
        method: 'POST', body: JSON.stringify({ count: 3, replace: replacing })
      });
      await refreshContentDialog(productionId, 'Três rascunhos locais de Shorts criados a partir da linha do tempo atual.');
    } catch (error) {
      showToast(error.message, 'error');
    }
    return;
  }

  const discoverabilityRun = event.target.closest('[data-discoverability-run]');
  if (discoverabilityRun) {
    const productionId = discoverabilityRun.dataset.discoverabilityRun;
    try {
      await api(`/api/content/${encodeURIComponent(productionId)}/discoverability/run`, {
        method: 'POST', body: JSON.stringify({ platform: 'youtube' })
      });
      await refreshContentDialog(productionId, 'Pré-voo de SEO e descoberta atualizado. As pendências são consultivas até a revisão.');
    } catch (error) {
      showToast(error.message, 'error');
    }
    return;
  }

  const discoverabilityReview = event.target.closest('[data-discoverability-accept], [data-discoverability-dismiss]');
  if (discoverabilityReview) {
    const card = discoverabilityReview.closest('[data-discoverability-finding]');
    const productionId = $('#content-review-form')?.dataset.productionId;
    if (!card || !productionId) return;
    const status = discoverabilityReview.matches('[data-discoverability-dismiss]') ? 'dismissed' : 'accepted';
    const reason = status === 'dismissed'
      ? (prompt('Por que este apontamento é um falso positivo? O motivo será guardado para futuras auditorias semelhantes.') || '')
      : '';
    if (status === 'dismissed' && !reason) return;
    try {
      await api(`/api/discoverability/findings/${encodeURIComponent(card.dataset.discoverabilityFinding)}`, {
        method: 'PATCH', body: JSON.stringify({ status, reason })
      });
      await refreshContentDialog(productionId, status === 'dismissed' ? 'Apontamento dispensado com justificativa.' : 'Apontamento mantido como recomendação de melhoria.');
    } catch (error) {
      showToast(error.message, 'error');
    }
    return;
  }

  const shortAction = event.target.closest('[data-short-save], [data-short-render], [data-short-approve]');
  if (shortAction) {
    const card = shortAction.closest('[data-short-card]');
    const productionId = $('#content-review-form')?.dataset.productionId;
    const clipId = card?.dataset.shortCard;
    if (!productionId || !clipId) return;
    try {
      const values = shortFormData(card);
      await api(`/api/content/${encodeURIComponent(productionId)}/shorts/${encodeURIComponent(clipId)}`, {
        method: 'PATCH', body: JSON.stringify(values)
      });
      if (shortAction.matches('[data-short-save]')) {
        await refreshContentDialog(productionId, 'Rascunho do Short salvo.');
        return;
      }
      if (shortAction.matches('[data-short-render]')) {
        await api(`/api/content/${encodeURIComponent(productionId)}/shorts/${encodeURIComponent(clipId)}/render`, {
          method: 'POST', body: '{}'
        });
        await refreshContentDialog(productionId, 'Short vertical renderizado localmente com legendas dinâmicas.');
        return;
      }
      if (!confirm('Confirmar as evidências herdadas, direitos de uso, visibilidade e horário de publicação para este Short?')) return;
      await api(`/api/content/${encodeURIComponent(productionId)}/shorts/${encodeURIComponent(clipId)}/approve`, {
        method: 'POST', body: JSON.stringify({ ...values, confirmed: true })
      });
      await refreshContentDialog(productionId, 'Short aprovado e adicionado ao cronograma de publicação.');
    } catch (error) {
      showToast(error.message, 'error');
    }
    return;
  }

  const sceneButton = event.target.closest('[data-scene-save], [data-scene-narration], [data-scene-regenerate], [data-scene-lock], [data-scene-move]');
  if (sceneButton) {
    const card = sceneButton.closest('[data-scene-card]');
    const productionId = $('#content-review-form')?.dataset.productionId;
    const sceneId = card?.dataset.sceneCard;
    if (!productionId || !sceneId) return;
    try {
      if (sceneButton.matches('[data-scene-lock]')) {
        await api(`/api/content/${encodeURIComponent(productionId)}/scenes/${encodeURIComponent(sceneId)}`, {
          method: 'PATCH', body: JSON.stringify({ locked: !card.classList.contains('locked') })
        });
        await refreshContentDialog(productionId, card.classList.contains('locked') ? 'Cena desbloqueada.' : 'Cena bloqueada.');
        return;
      }
      if (sceneButton.matches('[data-scene-move]')) {
        const cards = $$('[data-scene-card]');
        const index = cards.indexOf(card);
        const target = sceneButton.dataset.sceneMove === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= cards.length) return;
        const ids = cards.map(item => item.dataset.sceneCard);
        [ids[index], ids[target]] = [ids[target], ids[index]];
        await api(`/api/content/${encodeURIComponent(productionId)}/scenes/reorder`, {
          method: 'POST', body: JSON.stringify({ sceneIds: ids })
        });
        await refreshContentDialog(productionId, 'Ordem da linha do tempo atualizada. Recompile o vídeo antes de aprovar.');
        return;
      }
      await api(`/api/content/${encodeURIComponent(productionId)}/scenes/${encodeURIComponent(sceneId)}`, {
        method: 'PATCH', body: JSON.stringify(sceneFormData(card))
      });
      if (sceneButton.matches('[data-scene-save]')) {
        await refreshContentDialog(productionId, 'Rascunho da cena salvo.');
        return;
      }
      if (sceneButton.matches('[data-scene-narration]')) {
        if (!confirm('Regenerar a narração apenas desta cena? Isso pode consumir créditos de TTS do provedor. Deseja continuar?')) return;
        await api(`/api/content/${encodeURIComponent(productionId)}/scenes/${encodeURIComponent(sceneId)}/narration`, {
          method: 'POST', body: JSON.stringify({ confirmCost: true })
        });
        await refreshContentDialog(productionId, 'Narração da cena regenerada. Recompile o vídeo final quando todas as partes estiverem prontas.');
        return;
      }
      const estimate = await api(`/api/content/${encodeURIComponent(productionId)}/scenes/${encodeURIComponent(sceneId)}/estimate`);
      const message = estimate.paid
        ? `Regenerar apenas esta cena com ${estimate.provider} (${estimate.generatedSeconds}s)? Isso consome créditos de provedor externo. Continuar?`
        : 'Regenerar apenas esta cena com o provedor de imagem configurado? Pode consumir créditos. Continuar?';
      if (!confirm(message)) return;
      await api(`/api/content/${encodeURIComponent(productionId)}/scenes/${encodeURIComponent(sceneId)}/regenerate`, {
        method: 'POST', body: JSON.stringify({ confirmPaid: estimate.paid })
      });
      await refreshContentDialog(productionId, 'Cena regenerada. Recompile o vídeo final quando a linha do tempo estiver pronta.');
    } catch (error) {
      showToast(error.message, 'error');
    }
    return;
  }

  const silenceAction = event.target.closest('[data-intentional-silence], [data-require-narration]');
  if (silenceAction) {
    const productionId = $('#content-review-form')?.dataset.productionId;
    if (!productionId) return;
    const enabled = silenceAction.matches('[data-intentional-silence]');
    let reason = '';
    if (enabled) {
      reason = prompt('Por que este vídeo é intencionalmente silencioso? Este motivo será armazenado na comprovação de aprovação.') || '';
      if (!reason) return;
      if (!confirm('Confirmar que este vídeo é intencionalmente silencioso? Legendas e elementos visuais serão mantidos.')) return;
    } else if (!confirm('Exigir narração novamente? A aprovação ficará bloqueada até que a narração pendente seja gerada e o vídeo recompilado.')) {
      return;
    }
    try {
      await api(`/api/content/${encodeURIComponent(productionId)}/narration/silence`, {
        method: 'POST', body: JSON.stringify({ enabled, confirmed: enabled, reason })
      });
      await refreshContentDialog(productionId, enabled ? 'Silêncio intencional registrado. Recompile antes de aprovar.' : 'Narração volta a ser obrigatória.');
    } catch (error) {
      showToast(error.message, 'error');
    }
    return;
  }

  const regenAllNarration = event.target.closest('[data-regenerate-all-narration]');
  if (regenAllNarration) {
    const productionId = regenAllNarration.dataset.regenerateAllNarration;
    if (!productionId) return;
    regenAllNarration.disabled = true;
    const originalText = regenAllNarration.textContent;
    regenAllNarration.textContent = '🎙️ Gerando áudio das cenas...';
    $('#loading').classList.add('active');
    showToast('Iniciando síntese de voz para todas as cenas...', 'success');
    try {
      const res = await api(`/api/content/${encodeURIComponent(productionId)}/scenes/regenerate-all-narration`, {
        method: 'POST',
        body: JSON.stringify({ confirmCost: true })
      });
      await refreshContentDialog(productionId, res.message || 'Todas as narrações foram geradas com sucesso! Agora clique em "Recompilar vídeo final".');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      regenAllNarration.disabled = false;
      regenAllNarration.textContent = originalText;
      $('#loading').classList.remove('active');
    }
    return;
  }

  const rebuildScenes = event.target.closest('[data-rebuild-scenes]');
  if (rebuildScenes) {
    const productionId = rebuildScenes.dataset.rebuildScenes;
    if (!productionId) return;
    rebuildScenes.disabled = true;
    const originalText = rebuildScenes.textContent;
    rebuildScenes.textContent = '⏳ Recompilando vídeo final...';
    $('#loading').classList.add('active');
    showToast('Recompilando o vídeo MP4 final...', 'success');
    try {
      await api(`/api/content/${encodeURIComponent(productionId)}/scenes/rebuild`, { method: 'POST', body: '{}' });
      await refreshContentDialog(productionId, 'Vídeo final recompilado com sucesso a partir da linha do tempo!');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      rebuildScenes.disabled = false;
      rebuildScenes.textContent = originalText;
      $('#loading').classList.remove('active');
    }
    return;
  }

  const suggestSources = event.target.closest('[data-suggest-provenance-sources]');
  if (suggestSources) {
    const productionId = suggestSources.dataset.suggestProvenanceSources || $('#content-review-form')?.dataset.productionId;
    if (!productionId) return;
    $('#loading').classList.add('active');
    try {
      showToast('Pesquisando e vinculando fontes oficiais com IA...', 'success');
      const res = await api(`/api/content/${encodeURIComponent(productionId)}/provenance/suggest-sources`, {
        method: 'POST',
        body: '{}'
      });
      await openContent(productionId);
      showToast(res.message || 'Fontes oficiais verificadas e vinculadas com sucesso pela IA!', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      $('#loading').classList.remove('active');
    }
    return;
  }

  const addSource = event.target.closest('[data-add-provenance-source]');
  if (addSource) {
    const list = $('#provenance-sources');
    list.querySelector('.empty-inline')?.remove();
    list.querySelector('.empty-provenance-box')?.remove();
    list.insertAdjacentHTML('beforeend', renderSourceEditor({ id: clientId('source') }));
    return;
  }

  const addClaim = event.target.closest('[data-add-provenance-claim]');
  if (addClaim) {
    const list = $('#provenance-claims');
    list.querySelector('.empty-inline')?.remove();
    list.insertAdjacentHTML('beforeend', renderClaimEditor({ id: clientId('claim') }, currentSourceOptions()));
    return;
  }

  const removeProvenance = event.target.closest('[data-remove-provenance]');
  if (removeProvenance) {
    removeProvenance.closest('.provenance-item')?.remove();
    return;
  }

  const saveProvenance = event.target.closest('[data-save-provenance]');
  if (saveProvenance) {
    const productionId = $('#content-review-form')?.dataset.productionId;
    if (productionId) await persistProvenance(productionId, 'Revisão de evidências salva com sucesso.').catch(() => {});
    return;
  }

  const save = event.target.closest('[data-save-content]');
  if (save) {
    try {
      await persistProvenance(save.dataset.saveContent);
      await mutate(`/api/content/${encodeURIComponent(save.dataset.saveContent)}`, 'PATCH', contentFormData(), 'Rascunho e evidências salvos.');
    } catch (_error) { /* toast already shown */ }
  }

  const approve = event.target.closest('[data-approve-content]');
  if (approve) {
    try {
      await persistProvenance(approve.dataset.approveContent);
      await mutate(`/api/content/${encodeURIComponent(approve.dataset.approveContent)}/approve`, 'POST', contentFormData(), 'Conteúdo aprovado e agendado.');
      $('#content-dialog').close();
    } catch (_error) { /* toast already shown */ }
  }

  const reschedule = event.target.closest('[data-reschedule-content]');
  if (reschedule) {
    const publishTime = contentFormData().publishTime;
    if (!publishTime) return showToast('Escolha uma data e horário futuros primeiro.', 'error');
    try {
      await mutate(`/api/content/${encodeURIComponent(reschedule.dataset.rescheduleContent)}/schedule`, 'PATCH', { publishTime }, 'Conteúdo reagendado.');
      await openContent(reschedule.dataset.rescheduleContent);
    } catch (_error) { /* toast already shown */ }
    return;
  }

  const publishNow = event.target.closest('[data-publish-now-content]');
  if (publishNow) {
    if (!confirm('Publicar este vídeo no YouTube agora utilizando as configurações de privacidade selecionadas?')) return;
    try {
      await mutate(`/api/content/${encodeURIComponent(publishNow.dataset.publishNowContent)}/publish-now`, 'POST', {}, 'Conteúdo publicado no YouTube com sucesso.');
      $('#content-dialog').close();
    } catch (_error) { /* toast already shown */ }
    return;
  }

  const deleteSchedule = event.target.closest('[data-delete-schedule]');
  if (deleteSchedule) {
    if (!confirm('Excluir este agendamento? Os arquivos e o conteúdo gerado serão mantidos.')) return;
    try {
      await mutate(`/api/content/${encodeURIComponent(deleteSchedule.dataset.deleteSchedule)}/schedule`, 'DELETE', undefined, 'Agendamento excluído; o conteúdo gerado foi mantido.');
      await openContent(deleteSchedule.dataset.deleteSchedule);
    } catch (_error) { /* toast already shown */ }
    return;
  }

  const reject = event.target.closest('[data-reject-content]');
  if (reject) {
    const productionId = reject.dataset.rejectContent;
    if (!productionId) return;
    if (!reject.dataset.confirming) {
      reject.dataset.confirming = 'true';
      reject.dataset.originalText = reject.textContent;
      reject.textContent = '⚠️ Confirmar rejeição?';
      setTimeout(() => {
        if (reject && reject.dataset.confirming) {
          delete reject.dataset.confirming;
          reject.textContent = reject.dataset.originalText || 'Rejeitar';
        }
      }, 5000);
      return;
    }
    delete reject.dataset.confirming;
    reject.disabled = true;
    reject.textContent = 'Rejeitando...';
    try {
      await mutate(`/api/content/${encodeURIComponent(productionId)}/reject`, 'POST', { notes: 'Rejeitado pelo operador' }, 'Conteúdo rejeitado com sucesso.');
      $('#content-dialog').close();
    } catch (error) {
      showToast(error.message, 'error');
      reject.disabled = false;
      reject.textContent = reject.dataset.originalText || 'Rejeitar';
    }
    return;
  }

  const retry = event.target.closest('[data-retry-content]');
  if (retry) {
    const productionId = retry.dataset.retryContent;
    if (!productionId) return;
    if (!retry.dataset.confirming) {
      retry.dataset.confirming = 'true';
      retry.dataset.originalText = retry.textContent;
      retry.textContent = '⚠️ Confirmar nova versão?';
      setTimeout(() => {
        if (retry && retry.dataset.confirming) {
          delete retry.dataset.confirming;
          retry.textContent = retry.dataset.originalText || 'Regenerar';
        }
      }, 5000);
      return;
    }
    delete retry.dataset.confirming;
    await mutate(`/api/content/${encodeURIComponent(productionId)}/retry`, 'POST', {}, 'Regeneração iniciada.').catch(() => {});
    $('#content-dialog').close();
    return;
  }

  const presetBtn = event.target.closest('[data-set-schedule-hour]');
  if (presetBtn) {
    const hourStr = presetBtn.dataset.setScheduleHour;
    const publishInput = document.querySelector('#content-review-form [name="publishTime"]');
    if (publishInput) {
      const currentVal = publishInput.value;
      const today = new Date();
      const defaultDate = toLocalInput(today).split('T')[0];
      const datePart = currentVal && currentVal.includes('T') ? currentVal.split('T')[0] : defaultDate;
      publishInput.value = `${datePart}T${hourStr}`;
      const container = document.getElementById('publish-tz-helper-container');
      if (container) {
        container.innerHTML = renderTimezoneConverterCard(publishInput.value);
      }
    }
    return;
  }

  const deleteProduction = event.target.closest('[data-delete-production]');
  if (deleteProduction) {
    const productionId = deleteProduction.dataset.deleteProduction;
    if (!productionId) return;
    if (!deleteProduction.dataset.confirming) {
      deleteProduction.dataset.confirming = 'true';
      deleteProduction.dataset.originalText = deleteProduction.textContent;
      deleteProduction.textContent = '⚠️ Confirmar exclusão permanente?';
      setTimeout(() => {
        if (deleteProduction && deleteProduction.dataset.confirming) {
          delete deleteProduction.dataset.confirming;
          deleteProduction.textContent = deleteProduction.dataset.originalText || 'Excluir projeto';
        }
      }, 5000);
      return;
    }
    delete deleteProduction.dataset.confirming;
    deleteProduction.disabled = true;
    deleteProduction.textContent = 'Excluindo...';
    try {
      await mutate(`/api/content/${encodeURIComponent(productionId)}`, 'DELETE', undefined, 'Projeto excluído permanentemente.');
      $('#content-dialog').close();
    } catch (_error) {
      deleteProduction.disabled = false;
      deleteProduction.textContent = deleteProduction.dataset.originalText || 'Excluir projeto';
    }
    return;
  }
});

document.addEventListener('change', event => {
  if (event.target.matches('#schedule-target-tz-select')) {
    localStorage.setItem('lumen_schedule_target_tz', event.target.value);
    const publishInput = document.querySelector('#content-review-form [name="publishTime"]');
    const container = document.getElementById('publish-tz-helper-container');
    if (container) {
      container.innerHTML = renderTimezoneConverterCard(publishInput ? publishInput.value : '', event.target.value);
    }
    document.querySelectorAll('[data-short-field="publishTime"]').forEach(inp => {
      const slot = inp.closest('.form-grid')?.querySelector('.tz-short-preview-slot');
      if (slot) slot.innerHTML = renderShortTimezoneBadge(inp.value, event.target.value);
    });
  }
  if (event.target.matches('#content-review-form [name="publishTime"]')) {
    const container = document.getElementById('publish-tz-helper-container');
    if (container) {
      container.innerHTML = renderTimezoneConverterCard(event.target.value);
    }
  }
  if (event.target.matches('[data-short-field="publishTime"]')) {
    const slot = event.target.closest('.form-grid')?.querySelector('.tz-short-preview-slot');
    if (slot) slot.innerHTML = renderShortTimezoneBadge(event.target.value);
  }
  if (event.target.matches('#retention-snapshot-select')) {
    ui.retentionSnapshotId = event.target.value;
    renderRetention(ui.state?.learning?.retention || {});
  }
  if (event.target.matches('#engagement-video-select')) {
    ui.engagementVideoId = event.target.value;
    ui.engagementDetail = null;
    renderEngagement(ui.state?.engagement || {});
  }
  if (event.target.matches('[name="selectedTitleVariant"]')) {
    const title = event.target.selectedOptions[0]?.dataset.title;
    const input = $('#content-review-form [name="title"]');
    if (title && input) input.value = title;
  }
  if (event.target.matches('[data-scene-upload]')) {
    const file = event.target.files?.[0];
    const card = event.target.closest('[data-scene-card]');
    const productionId = $('#content-review-form')?.dataset.productionId;
    if (file && card && productionId) {
      uploadSceneAsset(productionId, card.dataset.sceneCard, file);
    }
  }
  if (event.target.matches('[data-scene-audio-upload]')) {
    const file = event.target.files?.[0];
    const card = event.target.closest('[data-scene-card]');
    const productionId = $('#content-review-form')?.dataset.productionId;
    if (file && card && productionId) {
      uploadSceneAudio(productionId, card.dataset.sceneCard, file);
    }
  }
});

document.addEventListener('input', event => {
  if (event.target.matches('#content-review-form [name="publishTime"]')) {
    const container = document.getElementById('publish-tz-helper-container');
    if (container) {
      container.innerHTML = renderTimezoneConverterCard(event.target.value);
    }
  }
  if (event.target.matches('[data-short-field="publishTime"]')) {
    const slot = event.target.closest('.form-grid')?.querySelector('.tz-short-preview-slot');
    if (slot) slot.innerHTML = renderShortTimezoneBadge(event.target.value);
  }
});

$('#automation-guide-button')?.addEventListener('click', () => $('#guide-dialog')?.showModal());
$('#generate-button')?.addEventListener('click', () => switchView('workflow'));
$('#go-to-workflow-btn')?.addEventListener('click', () => switchView('workflow'));
$('#add-idea-button')?.addEventListener('click', () => $('#idea-dialog')?.showModal());
$('#refresh-button')?.addEventListener('click', () => refreshDashboard());
$('#pipeline-filter')?.addEventListener('change', () => renderPipeline(ui.state?.pipeline || []));

$('#experiment-create-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  await mutate('/api/experiments', 'POST', {
    productionId: values.productionId,
    armDurationHours: Number(values.armDurationHours),
    minImpressions: Number(values.minImpressions)
  }, 'Rascunho de teste A/B criado para revisão.').catch(() => {});
});

$('#run-readiness-button')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Executando testes ao vivo…';
  try {
    await mutate('/api/readiness/run', 'POST', {
      includePaidMedia: $('#paid-image-probe')?.checked,
      includePaidVideo: $('#paid-video-probe')?.checked
    }, 'Verificação de prontidão de produção concluída.');
    switchView('readiness');
  } catch (_error) { /* toast already shown */ }
  finally {
    button.disabled = false;
    button.textContent = 'Executar teste de prontidão';
  }
});

$('#automation-toggle')?.addEventListener('click', async () => {
  const action = ui.state?.system?.automationPaused ? 'resume' : 'pause';
  await mutate(`/api/automation/${action}`, 'POST', {}, `Automação ${action === 'resume' ? 'retomada' : 'pausada'}.`).catch(() => {});
});

function strategyFormData(status = ui.state?.channelStrategy?.status || 'draft') {
  const form = $('#strategy-form');
  const values = Object.fromEntries(new FormData(form));
  return {
    ...values,
    contentPillars: (values.contentPillars || '').split(',').map(value => value.trim()).filter(Boolean),
    cadencePerWeek: Number(values.cadencePerWeek || 7),
    videosPerRun: Number(values.videosPerRun || 1),
    defaultFormat: values.defaultFormat || 'explainer',
    defaultLength: values.defaultLength || 'medium',
    primaryKpi: values.primaryKpi || 'views',
    targetValue: values.targetValue ? Number(values.targetValue) : 10000,
    targetWindowDays: Number(values.targetWindowDays || 28),
    monthlyBudget: null,
    outcomeCurrency: 'EUR',
    successMetric: values.successMetric || 'Alta retenção e engajamento da comunidade de fé',
    status
  };
}

$('#strategy-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  await mutate('/api/operator/strategy', 'PUT', strategyFormData('active'), 'Estratégia e DNA do canal salvos com sucesso.').catch(() => {});
});

// Leitura inteligente do canal com IA
$('#analyze-channel-strategy-btn')?.addEventListener('click', async () => {
  const btn = $('#analyze-channel-strategy-btn');
  btn.disabled = true;
  btn.textContent = '✨ Lendo histórico do canal e sintetizando estratégia com IA...';
  $('#loading')?.classList.add('active');

  try {
    const res = await mutate('/api/operator/analyze-channel', 'POST', { days: 30, maxResults: 50 }, 'Canal analisado e estratégia sintetizada com sucesso!');
    if (res.result) {
      const { strategy, summaryDiagnosis, recentVideos } = res.result;

      // Preencher formulário com a nova estratégia
      if (strategy) {
        if (ui.state) ui.state.channelStrategy = strategy;
        renderOperator(strategy, ui.state?.operatorRuns || [], ui.state?.system || {});
      }

      // Preencher diagnóstico
      if (summaryDiagnosis && $('#dna-ai-diagnosis')) {
        $('#dna-ai-diagnosis').innerHTML = `<p style="color: #38bdf8; font-weight: 500;">${escapeHTML(summaryDiagnosis)}</p>`;
      }

      // Preencher vídeos recentes
      if (Array.isArray(recentVideos) && recentVideos.length > 0 && $('#dna-recent-videos-list')) {
        $('#dna-recent-videos-list').innerHTML = recentVideos.map(v => `
          <div class="dna-video-item">
            <strong title="${escapeHTML(v.title)}">${escapeHTML(v.title)}</strong>
            <span class="dna-video-views">${(v.viewCount || 0).toLocaleString()} views</span>
          </div>
        `).join('');
      }

      showToast('✨ DNA e Estratégia do Canal gerados com sucesso! Revise e ajuste como desejar.', 'success');
    }
  } catch (err) {
    showToast(`Erro ao analisar canal: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Ler Meu Canal com IA e Resumir Estratégia';
    $('#loading')?.classList.remove('active');
  }
});

$('#activate-operator-button')?.addEventListener('click', async () => {
  if (!$('#strategy-form')?.reportValidity()) return;
  await mutate('/api/operator/start', 'POST', strategyFormData('active'), 'Operador autônomo iniciado com sucesso.').catch(() => {});
});

$('#pause-operator-button')?.addEventListener('click', async () => {
  await mutate('/api/operator/pause', 'POST', {}, 'Operador autônomo pausado.').catch(() => {});
});

$('#cancel-operator-run')?.addEventListener('click', async event => {
  const runId = event.currentTarget.dataset.runId;
  if (runId && confirm('Interromper esta execução autônoma após a etapa atual?')) {
    await mutate(`/api/operator/runs/${encodeURIComponent(runId)}/cancel`, 'POST', {}, 'Interrupção solicitada.').catch(() => {});
  }
});

$('#resume-operator-run')?.addEventListener('click', async event => {
  const runId = event.currentTarget.dataset.runId;
  if (runId && confirm('Retomar esta execução autônoma a partir do plano e etapas salvas?')) {
    await mutate(`/api/operator/runs/${encodeURIComponent(runId)}/resume`, 'POST', {}, 'Operador autônomo retomado.').catch(() => {});
  }
});

$('#generate-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await mutate('/generate', 'POST', { ...values, topic: values.topic.trim() || null }, 'Geração de conteúdo iniciada.');
    $('#generate-dialog').close();
    event.currentTarget.reset();
  } catch (_error) { /* toast already shown */ }
});

$('#idea-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await mutate('/api/ideas', 'POST', values, 'Ideia adicionada ao banco de temas.');
    $('#idea-dialog').close();
    event.currentTarget.reset();
  } catch (_error) { /* toast already shown */ }
});

$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  values.bannedTopics = values.bannedTopics.split(',').map(value => value.trim()).filter(Boolean);
  try {
    await mutate('/api/profile', 'PUT', values, 'Configuração do canal salva com sucesso.');
    await mutate('/api/settings', 'PUT', {
      approval_required: $('#approval-required').checked,
      notification_enabled: $('#notifications-enabled').checked,
      channel_timezone: values.timezone,
      video_provider: values.videoProvider,
      video_generation_mode: values.videoGenerationMode,
      video_clip_duration: Number(values.videoClipDuration),
      video_max_generated_seconds: Number(values.videoMaxGeneratedSeconds)
    }, 'Configurações operacionais salvas com sucesso.');
  } catch (_error) { /* toast already shown */ }
});

$('#api-key-button').addEventListener('click', () => {
  if (requestApiKey() !== null) showToast('Chave de API do painel salva neste navegador.');
});

// YouTube Account Switcher UI Handlers
let youtubeAuthPollInterval = null;

$('#yt-switch-account-btn')?.addEventListener('click', () => {
  const dialog = $('#youtube-account-dialog');
  if (dialog) dialog.showModal();
});

$('#yt-accounts-select')?.addEventListener('change', async (e) => {
  const channelId = e.target.value;
  if (!channelId) return;
  try {
    await mutate('/api/youtube/switch', 'POST', { channelId }, 'Canal do YouTube alterado com sucesso!');
    await refreshDashboard();
  } catch (_err) {
    /* ignore */
  }
});

$('#youtube-account-dialog')?.addEventListener('click', async (e) => {
  const switchBtn = e.target.closest('[data-switch-channel]');
  if (switchBtn) {
    const channelId = switchBtn.dataset.switchChannel;
    try {
      await mutate('/api/youtube/switch', 'POST', { channelId }, 'Canal alternado com sucesso!');
      $('#youtube-account-dialog')?.close();
      await refreshDashboard();
    } catch (_err) {
      /* ignore */
    }
    return;
  }

  const deleteBtn = e.target.closest('[data-delete-channel]');
  if (deleteBtn) {
    const channelId = deleteBtn.dataset.deleteChannel;
    if (confirm('Deseja realmente remover esta conta do histórico?')) {
      try {
        await mutate(`/api/youtube/accounts/${encodeURIComponent(channelId)}`, 'DELETE', {}, 'Conta removida do histórico.');
        await refreshDashboard();
      } catch (_err) {
        /* ignore */
      }
    }
    return;
  }
});

async function startYouTubeAuthFlow(incognito = false) {
  const normalBtn = $('#youtube-start-auth-btn');
  const incognitoBtn = $('#youtube-start-auth-incognito-btn');
  const progress = $('#youtube-auth-progress');
  const statusText = $('#youtube-auth-status-text');
  const errorHint = $('#youtube-auth-error-hint');
  const guideBox = $('#auth-guide-box');
  const linkBox = $('#youtube-auth-link-box');
  const urlInput = $('#youtube-auth-url-input');

  if (normalBtn) normalBtn.disabled = true;
  if (incognitoBtn) incognitoBtn.disabled = true;
  progress?.classList.remove('hidden');
  if (errorHint) errorHint.classList.add('hidden');
  if (guideBox) guideBox.classList.remove('highlight');
  if (linkBox) linkBox.classList.add('hidden');
  if (urlInput) urlInput.value = '';

  statusText.textContent = incognito 
    ? 'Iniciando servidor e abrindo janela anônima (InPrivate)...'
    : 'Iniciando servidor de autenticação...';

  try {
    const res = await mutate('/api/youtube/auth/start', 'POST', { incognito }, incognito
      ? 'Janela anônima iniciada! Autorize sua conta.'
      : 'Acesse a janela do Google para selecionar a conta.');

    if (res?.authUrl && urlInput && linkBox) {
      urlInput.value = res.authUrl;
      linkBox.classList.remove('hidden');
    }

    statusText.textContent = incognito
      ? 'Aguardando autorização na janela anônima... Faça login com a conta correta!'
      : 'Aguardando autorização no navegador... Escolha a conta no Google!';

    if (youtubeAuthPollInterval) clearInterval(youtubeAuthPollInterval);
    youtubeAuthPollInterval = setInterval(async () => {
      try {
        const apiKey = localStorage.getItem('yaa_api_key');
        const headers = apiKey ? { 'x-api-key': apiKey } : {};
        const pollRes = await fetch('/api/youtube/auth/status', { headers });
        const data = await pollRes.json();

        if (data.auth?.authUrl && urlInput && linkBox && !urlInput.value) {
          urlInput.value = data.auth.authUrl;
          linkBox.classList.remove('hidden');
        }

        if (data.auth?.status === 'success') {
          clearInterval(youtubeAuthPollInterval);
          youtubeAuthPollInterval = null;
          progress?.classList.add('hidden');
          if (normalBtn) normalBtn.disabled = false;
          if (incognitoBtn) incognitoBtn.disabled = false;
          showToast(`🎉 Canal "${data.auth.result?.title || 'YouTube'}" conectado com sucesso!`);
          $('#youtube-account-dialog')?.close();
          await refreshDashboard();
        } else if (data.auth?.status === 'error') {
          clearInterval(youtubeAuthPollInterval);
          youtubeAuthPollInterval = null;
          statusText.textContent = `Erro: ${data.auth.error || 'Falha na autenticação'}`;
          if (normalBtn) normalBtn.disabled = false;
          if (incognitoBtn) incognitoBtn.disabled = false;
          if (errorHint) errorHint.classList.remove('hidden');
          if (guideBox) {
            guideBox.classList.add('highlight');
            guideBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      } catch (_err) {
        /* ignore poll errors */
      }
    }, 2000);
  } catch (err) {
    if (normalBtn) normalBtn.disabled = false;
    if (incognitoBtn) incognitoBtn.disabled = false;
    statusText.textContent = `Erro: ${err.message}`;
    if (errorHint) errorHint.classList.remove('hidden');
    if (guideBox) {
      guideBox.classList.add('highlight');
      guideBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

$('#youtube-start-auth-incognito-btn')?.addEventListener('click', () => startYouTubeAuthFlow(true));
$('#youtube-start-auth-btn')?.addEventListener('click', () => startYouTubeAuthFlow(false));

$('#youtube-copy-auth-url-btn')?.addEventListener('click', (e) => {
  const urlInput = $('#youtube-auth-url-input');
  if (urlInput && urlInput.value) {
    copyToClipboard(urlInput.value, e.target);
  }
});

// Abertura do Guia Passo a Passo de Primeira Conexão (Modal Separado)
$('#yt-open-first-time-guide-btn')?.addEventListener('click', () => {
  $('#youtube-account-dialog')?.close();
  const guideDialog = $('#youtube-first-time-guide-dialog');
  if (guideDialog) guideDialog.showModal();
});

$('#yt-error-open-guide-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  $('#youtube-account-dialog')?.close();
  const guideDialog = $('#youtube-first-time-guide-dialog');
  if (guideDialog) guideDialog.showModal();
});

$('#yt-guide-back-to-auth-btn')?.addEventListener('click', () => {
  $('#youtube-first-time-guide-dialog')?.close();
  const authDialog = $('#youtube-account-dialog');
  if (authDialog) authDialog.showModal();
});

// Resgate Manual da Conexão (Caso o navegador mostre "Não consigo chegar a esta página")
$('#youtube-auth-rescue-submit-btn')?.addEventListener('click', async () => {
  const input = $('#youtube-auth-rescue-url-input');
  const btn = $('#youtube-auth-rescue-submit-btn');
  const urlVal = input?.value?.trim();
  if (!urlVal) {
    showToast('Cole o endereço da barra do navegador ou o código de autorização.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Conectando...';

  try {
    const res = await mutate('/api/youtube/auth/manual-callback', 'POST', {
      callbackUrl: urlVal
    }, '🎉 Canal conectado com sucesso!');

    $('#youtube-account-dialog')?.close();
    showToast(`Canal "${res.channelInfo?.title || 'YouTube'}" conectado com sucesso!`);
    await refreshDashboard();
  } catch (err) {
    showToast(`Erro ao concluir conexão: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Concluir Conexão';
  }
});

/* ==========================================================================
   Estúdio de Produção (Workflow Studio) Handlers
   ========================================================================== */
const wfState = {
  themes: [],
  script: null,
  narrationBlocks: [],
  googleFlowPrompts: [],
  nanoBananaPrompts: [],
  seo: null,
  summary: null
};

/* ==========================================================================
   Sistema de Persistência e Auto-Save de Rascunhos de Conteúdo (Local & Servidor)
   Garante que o roteiro, blocos, prompts e metadados nunca sejam perdidos,
   mesmo se a página for fechada, recarregada ou a conexão com a internet cair.
   ========================================================================== */
const WF_DRAFT_STORAGE_KEY = 'lumen_wf_production_draft_v1';
let wfDraftAutoSaveTimer = null;
let wfDraftIsRestored = false;
let wfDraftSaving = false;
let wfLastSavedDraftTimestamp = null;

function updateDraftStatusIndicator(status = 'saved', timeStr = '', offline = false) {
  const pill = $('#wf-draft-status-pill');
  const textEl = $('#wf-draft-status-text');
  if (!pill || !textEl) return;

  pill.classList.remove('saving', 'error', 'offline');
  if (status === 'saving') {
    pill.classList.add('saving');
    textEl.textContent = '💾 Gravando rascunho...';
  } else if (status === 'offline') {
    pill.classList.add('offline');
    textEl.textContent = offline ? '💾 Salvo no navegador (offline)' : '💾 Salvo localmente';
  } else if (status === 'error') {
    pill.classList.add('error');
    textEl.textContent = '⚠️ Falha no auto-save';
  } else if (status === 'restored') {
    textEl.textContent = '✓ Rascunho restaurado';
  } else {
    const formatted = timeStr || (new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    textEl.textContent = `💾 Salvo automaticamente (${formatted})`;
  }
}

function showDraftRecoveryBanner(draft) {
  const banner = $('#wf-draft-recovery-banner');
  const desc = $('#wf-draft-recovery-desc');
  if (!banner) return;

  let timeText = '';
  if (draft?.savedAt) {
    try {
      const d = new Date(draft.savedAt);
      timeText = ` Última alteração salva em ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`;
    } catch (_e) {}
  }
  if (desc) {
    desc.textContent = `Seus dados, roteiro e configurações foram restaurados exatamente de onde você parou.${timeText}`;
  }
  banner.classList.remove('hidden');
}

function hideDraftRecoveryBanner() {
  const banner = $('#wf-draft-recovery-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
}

function gatherCurrentDraft() {
  const formatEl = $('#wf-script-format');
  const uploadFormatEl = $('#wf-upload-format');
  const timeEl = $('#wf-upload-time');
  const langEl = $('#wf-upload-lang');
  const commentsEl = $('#wf-upload-comments');
  const synthEl = $('#wf-upload-synthetic-media');
  const ignoreThumbEl = $('#wf-ignore-thumb-checkbox');

  return {
    savedAt: new Date().toISOString(),
    mode: typeof wfStudioMode !== 'undefined' ? wfStudioMode : 'full',
    activeThemeId: typeof activeThemeId !== 'undefined' ? activeThemeId : null,
    // Etapa 2
    topic: $('#wf-script-topic')?.value || '',
    angle: $('#wf-script-angle')?.value || '',
    format: formatEl ? formatEl.value : 'explainer',
    authorAngle: $('#wf-script-author-angle')?.value || '',
    channelPos: $('#wf-script-channel-pos')?.value || '',
    leaveOut: $('#wf-script-leave-out')?.value || '',
    hookType: $('#wf-script-hook-type')?.value || '',
    angleFamily: $('#wf-script-angle-family')?.value || '',
    fieldA: $('#wf-field-a')?.value || '',
    directScript: $('#wf-direct-script-input')?.value || '',
    script: wfState.script || null,
    // Etapas 3, 4, 5, 6
    narrationBlocks: Array.isArray(wfState.narrationBlocks) ? wfState.narrationBlocks : [],
    googleFlowPrompts: Array.isArray(wfState.googleFlowPrompts) ? wfState.googleFlowPrompts : [],
    nanoBananaPrompts: Array.isArray(wfState.nanoBananaPrompts) ? wfState.nanoBananaPrompts : [],
    seo: wfState.seo || null,
    // Etapa 8
    uploadTitle: $('#wf-upload-title')?.value || '',
    uploadDescription: $('#wf-upload-description')?.value || $('#wf-upload-desc')?.value || '',
    uploadTags: $('#wf-upload-tags')?.value || '',
    uploadTime: timeEl ? timeEl.value : '',
    uploadFormat: uploadFormatEl ? uploadFormatEl.value : (typeof wfCurrentUploadFormat !== 'undefined' ? wfCurrentUploadFormat : 'explainer'),
    uploadLanguage: langEl ? langEl.value : 'it',
    syntheticMedia: synthEl ? synthEl.checked : true,
    commentModeration: commentsEl ? commentsEl.value : 'MODERATE',
    uploadPath: $('#wf-upload-path')?.value || '',
    uploadThumbnailPath: $('#wf-upload-thumbnail-path')?.value || '',
    ignoreThumbForShort: ignoreThumbEl ? ignoreThumbEl.checked : false
  };
}

function hasDraftContent(draft) {
  if (!draft) return false;
  if (draft.topic && draft.topic.trim().length > 0) return true;
  if (draft.directScript && draft.directScript.trim().length > 0) return true;
  if (draft.script && (draft.script.hook || draft.script.fullScript)) return true;
  if (draft.uploadTitle && draft.uploadTitle.trim().length > 0) return true;
  if (draft.uploadDescription && draft.uploadDescription.trim().length > 0) return true;
  if (draft.seo && (draft.seo.title || draft.seo.description)) return true;
  if (Array.isArray(draft.narrationBlocks) && draft.narrationBlocks.length > 0) return true;
  if (Array.isArray(draft.googleFlowPrompts) && draft.googleFlowPrompts.length > 0) return true;
  if (Array.isArray(draft.nanoBananaPrompts) && draft.nanoBananaPrompts.length > 0) return true;
  return false;
}

function scheduleAutoSaveDraft(delayMs = 1200) {
  if (wfDraftAutoSaveTimer) clearTimeout(wfDraftAutoSaveTimer);
  updateDraftStatusIndicator('saving');
  wfDraftAutoSaveTimer = setTimeout(() => {
    saveWorkflowDraft(false);
  }, delayMs);
}

async function saveWorkflowDraft(showToastNotice = false) {
  try {
    const draft = gatherCurrentDraft();
    if (!hasDraftContent(draft)) {
      updateDraftStatusIndicator('saved');
      return;
    }

    // 1. Persistência Imediata Offline-First no localStorage
    try {
      localStorage.setItem(WF_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch (_lsErr) {
      console.warn('Erro ao salvar rascunho no localStorage:', _lsErr);
    }

    wfLastSavedDraftTimestamp = Date.now();
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    // 2. Persistência no SQLite (se servidor estiver acessível)
    let serverOk = true;
    try {
      await api('/api/workflow/draft', {
        method: 'POST',
        body: JSON.stringify(draft)
      });
    } catch (_netErr) {
      serverOk = false;
      console.info('Auto-save no servidor indisponível no momento, salvo no navegador:', _netErr?.message);
    }

    if (serverOk) {
      updateDraftStatusIndicator('saved', timeStr);
      if (showToastNotice) {
        showToast('💾 Rascunho salvo com sucesso no navegador e no banco de dados!', 'success');
      }
    } else {
      updateDraftStatusIndicator('offline', timeStr, true);
      if (showToastNotice) {
        showToast('💾 Rascunho salvo com sucesso no navegador (offline)!', 'info');
      }
    }
  } catch (err) {
    console.error('Falha ao salvar rascunho do workflow:', err);
    updateDraftStatusIndicator('error');
    if (showToastNotice) {
      showToast('⚠️ Não foi possível salvar o rascunho no momento.', 'error');
    }
  }
}

async function clearWorkflowDraft(showToastNotice = false) {
  try {
    if (wfDraftAutoSaveTimer) clearTimeout(wfDraftAutoSaveTimer);
    try {
      localStorage.removeItem(WF_DRAFT_STORAGE_KEY);
    } catch (_e) {}

    await api('/api/workflow/draft', { method: 'DELETE' }).catch(() => {});
    hideDraftRecoveryBanner();
    updateDraftStatusIndicator('saved');
    if (showToastNotice) {
      showToast('🧹 Rascunho descartado com sucesso.', 'info');
    }
  } catch (err) {
    console.warn('Erro ao limpar rascunho:', err);
  }
}

async function restoreWorkflowDraft(force = false) {
  if (wfDraftIsRestored && !force) return false;
  wfDraftIsRestored = true;

  try {
    // 1. Tentar ler do localStorage primeiro (mais rápido e resiliente)
    let draft = null;
    try {
      const rawLocal = localStorage.getItem(WF_DRAFT_STORAGE_KEY);
      if (rawLocal) draft = JSON.parse(rawLocal);
    } catch (_e) {}

    // 2. Se não encontrou no localStorage, consultar a API
    if (!draft || !hasDraftContent(draft)) {
      try {
        const res = await api('/api/workflow/draft');
        if (res?.success && res.draft && hasDraftContent(res.draft)) {
          draft = res.draft;
        }
      } catch (_apiErr) {
        console.info('Não foi possível obter rascunho do servidor no momento:', _apiErr?.message);
      }
    }

    if (!draft || !hasDraftContent(draft)) {
      return false;
    }

    // Aplicar dados do rascunho aos campos da interface
    // Etapa 2
    if (draft.topic) {
      const el = $('#wf-script-topic');
      if (el) el.value = draft.topic;
    }
    if (draft.angle) {
      const el = $('#wf-script-angle');
      if (el) el.value = draft.angle;
    }
    if (draft.format) {
      const el = $('#wf-script-format');
      if (el) el.value = draft.format;
    }
    if (draft.authorAngle) {
      const el = $('#wf-script-author-angle');
      if (el) el.value = draft.authorAngle;
    }
    if (draft.channelPos) {
      const el = $('#wf-script-channel-pos');
      if (el) el.value = draft.channelPos;
    }
    if (draft.leaveOut) {
      const el = $('#wf-script-leave-out');
      if (el) el.value = draft.leaveOut;
    }
    if (draft.hookType) {
      const el = $('#wf-script-hook-type');
      if (el) el.value = draft.hookType;
    }
    if (draft.angleFamily) {
      const el = $('#wf-script-angle-family');
      if (el) el.value = draft.angleFamily;
    }
    if (draft.fieldA) {
      const el = $('#wf-field-a');
      if (el) el.value = draft.fieldA;
      const label = $('#wf-field-a-btn-label');
      if (label) label.textContent = 'Histórico Editorial Preenchido (Campo A)';
    }

    // Roteiro colado por fora
    if (draft.directScript) {
      const directInput = $('#wf-direct-script-input');
      const drawer = $('#wf-direct-script-drawer');
      const counter = $('#wf-direct-script-counter');
      if (directInput) directInput.value = draft.directScript;
      if (drawer) drawer.classList.remove('hidden');
      if (counter) counter.textContent = `${draft.directScript.length} caracteres`;
      const directIcon = $('#wf-direct-script-icon');
      const directLabel = $('#wf-direct-script-label');
      if (directIcon) directIcon.textContent = '✓';
      if (directLabel) directLabel.textContent = 'Roteiro Colado Pronto';
    }

    // Roteiro estruturado gerado
    if (draft.script) {
      wfState.script = draft.script;
      if (typeof renderWorkflowScript === 'function') {
        renderWorkflowScript(draft.script);
      }
    }

    // Etapa 3 (Blocos de narração)
    if (Array.isArray(draft.narrationBlocks) && draft.narrationBlocks.length > 0) {
      wfState.narrationBlocks = draft.narrationBlocks;
      if (typeof renderNarrationBlocks === 'function') {
        renderNarrationBlocks(draft.narrationBlocks);
      }
    }

    // Etapa 4 (Google Flow)
    if (Array.isArray(draft.googleFlowPrompts) && draft.googleFlowPrompts.length > 0) {
      wfState.googleFlowPrompts = draft.googleFlowPrompts;
      if (typeof renderGoogleFlowPrompts === 'function') {
        renderGoogleFlowPrompts(draft.googleFlowPrompts);
      }
    }

    // Etapa 5 (Nano Banana)
    if (Array.isArray(draft.nanoBananaPrompts) && draft.nanoBananaPrompts.length > 0) {
      wfState.nanoBananaPrompts = draft.nanoBananaPrompts;
      if (typeof renderNanoBananaVersions === 'function') {
        renderNanoBananaVersions(draft.nanoBananaPrompts);
      }
    }

    // Etapa 6 (SEO)
    if (draft.seo) {
      wfState.seo = draft.seo;
      if (typeof renderWorkflowSEO === 'function') {
        renderWorkflowSEO(draft.seo);
      }
    }

    // Etapa 8 (Upload e Agendamento)
    let hasUploadData = false;
    if (draft.uploadTitle) {
      const el = $('#wf-upload-title');
      if (el) {
        el.value = draft.uploadTitle;
        if (typeof updateTitleCharCounter === 'function') updateTitleCharCounter();
        hasUploadData = true;
      }
    }
    if (draft.uploadDescription) {
      const el = $('#wf-upload-description') || $('#wf-upload-desc');
      if (el) {
        el.value = draft.uploadDescription;
        if (typeof updateDescCharCounter === 'function') updateDescCharCounter();
        hasUploadData = true;
      }
    }
    if (draft.uploadTags) {
      const el = $('#wf-upload-tags');
      if (el) el.value = draft.uploadTags;
    }
    if (draft.uploadTime) {
      const el = $('#wf-upload-time');
      if (el) el.value = draft.uploadTime;
    }
    if (draft.uploadFormat) {
      if (typeof setWorkflowUploadFormat === 'function') {
        setWorkflowUploadFormat(draft.uploadFormat);
      }
    }
    if (draft.uploadLanguage) {
      const el = $('#wf-upload-lang');
      if (el) el.value = draft.uploadLanguage;
    }
    if (draft.syntheticMedia !== undefined) {
      const el = $('#wf-upload-synthetic-media');
      if (el) el.checked = draft.syntheticMedia;
    }
    if (draft.commentModeration) {
      const el = $('#wf-upload-comments');
      if (el) el.value = draft.commentModeration;
    }
    if (draft.uploadPath) {
      const el = $('#wf-upload-path');
      if (el) {
        el.value = draft.uploadPath;
        $('#wf-video-selected-box')?.classList.remove('hidden');
        $('#wf-video-drop-content')?.classList.add('hidden');
        const filenameSpan = $('#wf-video-filename');
        if (filenameSpan) filenameSpan.textContent = draft.uploadPath.split(/[/\\]/).pop();
      }
    }

    if (hasUploadData && typeof revealMetadataFields === 'function') {
      revealMetadataFields(false);
    }

    // Modo da tela
    if (draft.mode === 'cortes' && typeof setWorkflowStudioMode === 'function') {
      setWorkflowStudioMode('cortes');
    }

    // Exibir banner de notificação de restauração e atualizar indicador
    showDraftRecoveryBanner(draft);
    updateDraftStatusIndicator('restored');
    return true;
  } catch (err) {
    console.error('Erro ao restaurar rascunho de produção:', err);
    return false;
  }
}

function attachWorkflowAutoSaveListeners() {
  const autoSaveInputs = [
    '#wf-script-topic',
    '#wf-script-angle',
    '#wf-script-author-angle',
    '#wf-script-channel-pos',
    '#wf-script-leave-out',
    '#wf-field-a',
    '#wf-direct-script-input',
    '#wf-upload-title',
    '#wf-upload-description',
    '#wf-upload-desc',
    '#wf-upload-tags'
  ];

  autoSaveInputs.forEach(selector => {
    const el = $(selector);
    if (el) {
      el.addEventListener('input', () => scheduleAutoSaveDraft(1200));
    }
  });

  const autoSaveSelects = [
    '#wf-script-format',
    '#wf-script-hook-type',
    '#wf-script-angle-family',
    '#wf-upload-time',
    '#wf-upload-format',
    '#wf-upload-lang',
    '#wf-upload-synthetic-media',
    '#wf-upload-comments',
    '#wf-ignore-thumb-checkbox'
  ];

  autoSaveSelects.forEach(selector => {
    const el = $(selector);
    if (el) {
      el.addEventListener('change', () => scheduleAutoSaveDraft(400));
    }
  });

  // Botão manual de Salvar Rascunho
  $('#wf-save-draft-btn')?.addEventListener('click', () => {
    saveWorkflowDraft(true);
  });

  // Ações do Banner de Recuperação
  $('#wf-draft-dismiss-btn')?.addEventListener('click', () => {
    hideDraftRecoveryBanner();
    showToast('✓ Rascunho mantido. Você pode continuar editando normalmente.', 'info');
  });

  $('#wf-draft-discard-btn')?.addEventListener('click', () => {
    if (confirm('Tem certeza de que deseja descartar este rascunho e limpar o estúdio?')) {
      clearWorkflowDraft(true);
      resetWorkflowStudio({ keepFieldA: true, preserveTopic: '', preserveLog: false, notify: false });
    }
  });

  // Evento antes de fechar a aba/janela ou recarregar (beforeunload)
  window.addEventListener('beforeunload', () => {
    try {
      const draft = gatherCurrentDraft();
      if (hasDraftContent(draft)) {
        localStorage.setItem(WF_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      }
    } catch (_e) {}
  });

  // Eventos de rede online/offline
  window.addEventListener('offline', () => {
    updateDraftStatusIndicator('offline', '', true);
  });
  window.addEventListener('online', () => {
    scheduleAutoSaveDraft(200);
  });
}

/**
 * Reseta todos os dados e saídas do Estúdio de Produção para permitir criar outro vídeo limpo.
 * Preserva o Campo A (histórico editorial do canal para o próximo roteiro não repetir ganchos)
 * e o cronograma de temas.
 */
/**
 * Oculta e limpa completamente o banner verde de status do agendamento
 */
function hideScheduleStatusBanner() {
  const banner = $('#wf-schedule-status');
  if (banner) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
  }
}

/**
 * Reseta todos os campos do modal de colar metadados externos (Gemini/ChatGPT)
 */
function resetPasteModal() {
  const pasteRaw = $('#wf-paste-raw-textarea');
  const pasteTitle = $('#wf-paste-out-title');
  const pasteDesc = $('#wf-paste-out-desc');
  const pasteTags = $('#wf-paste-out-tags');
  const pasteStatus = $('#wf-paste-detected-status');
  const pasteTimeStat = $('#wf-paste-time-status');
  const quickTopic = $('#wf-gen-quick-topic');
  const pasteTime = $('#wf-paste-out-time');

  if (pasteRaw) pasteRaw.value = '';
  if (pasteTitle) pasteTitle.value = '';
  if (pasteDesc) pasteDesc.value = '';
  if (pasteTags) pasteTags.value = '';
  if (pasteStatus) pasteStatus.textContent = '';
  if (pasteTimeStat) pasteTimeStat.textContent = '';
  if (quickTopic) quickTopic.value = '';

  if (pasteTime) {
    const tomorrow18 = new Date();
    tomorrow18.setDate(tomorrow18.getDate() + 1);
    tomorrow18.setHours(18, 0, 0, 0);
    if (typeof formatLocalDateToIsoMinute === 'function') {
      pasteTime.value = formatLocalDateToIsoMinute(tomorrow18);
    }
  }

  if (typeof updatePasteModalCounters === 'function') {
    updatePasteModalCounters();
  }
}

/**
 * Limpa saídas intermediárias de produção (prompts, thumbnail, SEO e formulário de upload)
 * mantendo o roteiro ativo na tela quando um novo roteiro for gerado ou aplicado.
 */
function clearDownstreamProductionData() {
  wfState.narrationBlocks = [];
  wfState.googleFlowPrompts = [];
  wfState.nanoBananaPrompts = [];
  wfState.seo = null;

  // Etapa 3 (Blocos de Narração)
  $('#wf-narration-blocks-container')?.classList.add('hidden');
  const narrationList = $('#wf-narration-blocks-list');
  if (narrationList) narrationList.innerHTML = '';

  // Etapa 4 (Prompts Google Flow)
  $('#wf-google-flow-container')?.classList.add('hidden');
  if ($('#wf-modal-google-flow-list')) $('#wf-modal-google-flow-list').innerHTML = '';
  if ($('#wf-google-flow-list')) $('#wf-google-flow-list').innerHTML = '';

  // Etapa 5 (Thumbnail Nano Banana)
  $('#wf-nano-banana-container')?.classList.add('hidden');
  if ($('#wf-nano-banana-list')) $('#wf-nano-banana-list').innerHTML = '';
  const nbCompactBox = $('#wf-nano-banana-compact-box');
  if (nbCompactBox) {
    nbCompactBox.classList.add('hidden');
    nbCompactBox.style.display = 'none';
  }
  if ($('#wf-nb-compact-text')) $('#wf-nb-compact-text').textContent = '';

  // Etapa 6 (SEO)
  $('#wf-seo-container')?.classList.add('hidden');
  if ($('#wf-out-title')) $('#wf-out-title').textContent = '';
  if ($('#wf-out-desc')) $('#wf-out-desc').textContent = '';
  if ($('#wf-out-hashtags')) $('#wf-out-hashtags').textContent = '';

  // Etapa 8 (Upload e Agendamento)
  const videoFileInput = $('#wf-video-file-input');
  const uploadPathInput = $('#wf-upload-path');
  if (videoFileInput) videoFileInput.value = '';
  if (uploadPathInput) uploadPathInput.value = '';
  $('#wf-video-selected-box')?.classList.add('hidden');
  $('#wf-video-drop-content')?.classList.remove('hidden');

  const thumbFileInput = $('#wf-thumb-file-input');
  const thumbPathInput = $('#wf-upload-thumbnail-path');
  const thumbImgPreview = $('#wf-thumb-img-preview');
  const thumbPlaceholder = $('#wf-thumb-placeholder');
  const removeThumbBtn = $('#wf-remove-thumb-btn');

  if (thumbFileInput) thumbFileInput.value = '';
  if (thumbPathInput) thumbPathInput.value = '';
  if (thumbImgPreview) {
    thumbImgPreview.src = '';
    thumbImgPreview.classList.add('hidden');
  }
  if (thumbPlaceholder) {
    thumbPlaceholder.classList.remove('hidden');
  }
  removeThumbBtn?.classList.add('hidden');
  if ($('#wf-thumb-status-msg')) $('#wf-thumb-status-msg').textContent = '';

  const titleInp = $('#wf-upload-title');
  if (titleInp) {
    titleInp.value = '';
    if (typeof updateTitleCharCounter === 'function') updateTitleCharCounter();
  }
  const descInp = $('#wf-upload-description') || $('#wf-upload-desc');
  if (descInp) {
    descInp.value = '';
    if (typeof updateDescCharCounter === 'function') updateDescCharCounter();
  }
  const tagsInp = $('#wf-upload-tags');
  if (tagsInp) tagsInp.value = '';

  // Ocultar card de progresso de upload
  $('#wf-schedule-progress-card')?.classList.add('hidden');
  resetPasteModal();
  hideScheduleStatusBanner();
  if (typeof collapseMetadataFields === 'function') {
    collapseMetadataFields();
  }
}

/**
 * Reseta todos os dados e saídas do Estúdio de Produção para permitir criar outro vídeo limpo.
 * Preserva o Campo A (histórico editorial do canal para o próximo roteiro não repetir ganchos)
 * e o cronograma de temas.
 */
function resetWorkflowStudio({ keepFieldA = true, preserveTopic = '', preserveLog = false, notify = true } = {}) {
  // 1. Resetar Estado Interno
  wfState.currentThemeId = null;
  wfState.scheduledDate = null;
  wfState.scheduledTime = null;
  wfState.script = null;
  wfState.narrationBlocks = [];
  wfState.googleFlowPrompts = [];
  wfState.nanoBananaPrompts = [];
  wfState.seo = null;
  if (!preserveLog) {
    lastProductionLog = null;
    hideScheduleStatusBanner();
  }
  resetPasteModal();

  // 2. Etapa 2 (Tema e Geração de Roteiro)
  const topicInput = $('#wf-script-topic');
  const angleInput = $('#wf-script-angle');
  const authorAngle = $('#wf-script-author-angle');
  const channelPos = $('#wf-script-channel-pos');
  const leaveOut = $('#wf-script-leave-out');
  const hookType = $('#wf-script-hook-type');
  const angleFamily = $('#wf-script-angle-family');
  const formatSelect = $('#wf-script-format');

  if (topicInput) topicInput.value = preserveTopic || '';
  if (angleInput) angleInput.value = '';
  if (authorAngle) authorAngle.value = '';
  if (channelPos) channelPos.value = '';
  if (leaveOut) leaveOut.value = '';
  if (hookType) hookType.value = '';
  if (angleFamily) angleFamily.value = '';
  if (formatSelect) formatSelect.value = 'explainer';

  // Recolher caixa de decisão humana se estiver aberta
  $('#wf-human-decision-container')?.classList.add('hidden');

  const scriptOutput = $('#wf-script-output');
  if (scriptOutput) scriptOutput.classList.add('hidden');
  if ($('#wf-out-hook')) $('#wf-out-hook').textContent = '';
  if ($('#wf-out-pinned')) $('#wf-out-pinned').textContent = '';
  if ($('#wf-out-hook-register')) $('#wf-out-hook-register').textContent = '';
  if ($('#wf-out-full-script-text')) $('#wf-out-full-script-text').textContent = '';
  if ($('#wf-hook-register-container')) $('#wf-hook-register-container').classList.add('hidden');
  if ($('#wf-full-script-preview-container')) $('#wf-full-script-preview-container').classList.add('hidden');

  const directScriptDrawer = $('#wf-direct-script-drawer');
  if (directScriptDrawer) directScriptDrawer.classList.add('hidden');
  const directScriptInput = $('#wf-direct-script-input');
  if (directScriptInput) directScriptInput.value = '';
  const directScriptCounter = $('#wf-direct-script-counter');
  if (directScriptCounter) directScriptCounter.textContent = '0 caracteres';
  const directLabel = $('#wf-direct-script-label');
  const directIcon = $('#wf-direct-script-icon');
  if (directIcon) directIcon.textContent = '📋';
  if (directLabel) directLabel.textContent = 'Já possui o roteiro total pronto gerado por fora? Colar aqui';

  // 3. Limpar saídas intermediárias e de upload (Etapas 3, 4, 5, 6 e 8)
  clearDownstreamProductionData();

  // 4. Etapa 7 (Resumo para o próximo roteiro / Campo A)
  if (!keepFieldA) {
    wfState.summary = null;
    const fieldA = $('#wf-field-a');
    if (fieldA) fieldA.value = '';
    const label = $('#wf-field-a-btn-label');
    const icon = $('#wf-field-a-btn-icon');
    if (label) label.textContent = 'Inserir Histórico do Roteiro Anterior (Campo A)';
    if (icon) icon.textContent = '＋';
  }

  // 5. Redefinir data e hora padrão para amanhã 18:00
  const timeInp = $('#wf-upload-time');
  if (timeInp) {
    const tomorrow18 = new Date();
    tomorrow18.setDate(tomorrow18.getDate() + 1);
    tomorrow18.setHours(18, 0, 0, 0);
    if (typeof formatLocalDateToIsoMinute === 'function') {
      timeInp.value = formatLocalDateToIsoMinute(tomorrow18);
    }
  }

  // Restaurar botão de agendamento de upload para estado inicial
  const submitBtn = $('#wf-schedule-form')?.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = '📅 Agendar Lançamento PÚBLICO no YouTube Oficial';
    submitBtn.style.background = '';
    submitBtn.style.opacity = '1';
    submitBtn.style.boxShadow = '';
  }

  if (notify) {
    showToast('✨ Estúdio limpo com sucesso! Pronto para a próxima produção.', 'info');
  }
}

function confirmAndResetStudio() {
  clearWorkflowDraft(false);
  resetWorkflowStudio({ keepFieldA: true, preserveLog: false, notify: true });
  const statusEl = document.getElementById('wf-schedule-status');
  if (statusEl) statusEl.classList.add('hidden');
  const step1 = document.getElementById('wf-step-1-panel') || document.getElementById('wf-script-topic');
  if (step1) step1.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const topicEl = document.getElementById('wf-script-topic');
  if (topicEl) topicEl.focus();
}

// Botões para limpar estúdio e começar novo vídeo
$('#wf-reset-studio-btn')?.addEventListener('click', confirmAndResetStudio);
$('#wf-clean-new-script-btn')?.addEventListener('click', confirmAndResetStudio);
document.addEventListener('click', (e) => {
  if (e.target.closest('#wf-reset-studio-btn') || e.target.closest('#wf-clean-new-script-btn')) {
    confirmAndResetStudio();
  }
});

// Auxiliar de cópia com feedback visual
async function copyToClipboard(text, btnElement = null) {
  if (!text) return;
  try {
    const nav = typeof window !== 'undefined' ? window.navigator : null;
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    if (btnElement) {
      const originalText = btnElement.textContent;
      btnElement.textContent = '✓ Copiado!';
      btnElement.classList.add('copied');
      setTimeout(() => {
        btnElement.textContent = originalText;
        btnElement.classList.remove('copied');
      }, 2000);
    }
    showToast('Copiado para a área de transferência!', 'success');
  } catch (err) {
    showToast('Não foi possível copiar automaticamente.', 'error');
  }
}

// Carregar último resumo salvo no Campo A
async function loadLastWorkflowSummary() {
  try {
    const res = await api('/api/workflow/last-summary');
    if (res.summary) {
      wfState.summary = res.summary;
      const summaryBox = $('#wf-summary-text');
      if (summaryBox) summaryBox.textContent = res.summary.summaryText || '';
      const fieldA = $('#wf-field-a');
      if (fieldA && !fieldA.value) {
        fieldA.value = res.summary.summaryText || '';
      }
    }
  } catch (_e) {
    /* ignore */
  }
}

// Botões genéricos de cópia
document.addEventListener('click', (e) => {
  const copyBtn = e.target.closest('.copy-btn');
  if (copyBtn && copyBtn.dataset.target) {
    const targetEl = document.getElementById(copyBtn.dataset.target);
    if (targetEl) {
      let text = targetEl.textContent || targetEl.innerText;
      if (targetEl.classList.contains('narration-text-area') || copyBtn.dataset.target.startsWith('wf-narration-text')) {
        text = typeof cleanNarrationForTTS === 'function' ? cleanNarrationForTTS(text) : text;
      }
      copyToClipboard(text, copyBtn);
    }
  }
});

// ====================================================
// Etapa 1: Cronograma e Temas Persistentes
// ====================================================
let wfPlannedThemes = [];
let wfThemesCurrentFilter = 'all';
let wfThemesCurrentFormatFilter = 'all';
let wfStudioMode = 'full';
let wfCurrentUploadFormat = 'explainer';
let wfQueueSortOrder = 'asc';
let wfQueueFilterType = 'all';

function isShortTheme(t) {
  if (!t) return false;
  return t.format === 'short' || /#shorts?/i.test(t.topic || '');
}

function isAvulsoTheme(t) {
  if (!t) return false;
  if (t.notes === 'avulso') return true;
  const why = String(t.why_better || '');
  if (why.includes('Direto') || why.includes('Avulso') || why.includes('Cortes')) return true;
  if (!t.hook_angle && !t.full_script && isShortTheme(t)) return true;
  return false;
}

function formatScheduleDate(dateStr) {
  if (!dateStr) return 'Sem data definida';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(d);
      target.setHours(0, 0, 0, 0);
      const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
      
      let relative = '';
      if (diffDays === 0) relative = ' (Hoje)';
      else if (diffDays === 1) relative = ' (Amanhã)';
      else if (diffDays === -1) relative = ' (Ontem)';
      
      const formatted = new Intl.DateTimeFormat('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short'
      }).format(d);
      return `${formatted}${relative}`;
    }
  } catch (_e) {
    /* ignore parse error */
  }
  return dateStr;
}

async function loadWorkflowPlannedThemes() {
  try {
    const apiKey = localStorage.getItem('yaa_api_key');
    const headers = apiKey ? { 'x-api-key': apiKey } : {};
    const res = await fetch(`/api/workflow/planned-themes?_t=${Date.now()}`, { headers });
    const data = await res.json();
    if (data.success) {
      wfPlannedThemes = data.themes || [];
      updateWorkflowThemesCounts(data.counts || {});
      renderWorkflowPlannedThemes(wfPlannedThemes, wfThemesCurrentFilter);
      renderCalendarPlannedThemes();
    }
  } catch (err) {
    console.error('Erro ao carregar temas planejados:', err);
  }
}

function updateWorkflowThemesCounts(counts = {}) {
  const isShortTheme = (t) => t.format === 'short' || /#shorts?/i.test(t.topic || '');
  const isLongTheme = (t) => !isShortTheme(t);

  const total = counts.total ?? wfPlannedThemes.length;
  const pending = counts.pending ?? wfPlannedThemes.filter(t => t.status === 'pending').length;
  const production = counts.inProduction ?? wfPlannedThemes.filter(t => t.status === 'in_production').length;
  const posted = counts.posted ?? wfPlannedThemes.filter(t => t.status === 'posted').length;

  const shorts = counts.shorts ?? wfPlannedThemes.filter(isShortTheme).length;
  const postedShorts = counts.postedShorts ?? wfPlannedThemes.filter(t => t.status === 'posted' && isShortTheme(t)).length;

  const longs = counts.longs ?? wfPlannedThemes.filter(isLongTheme).length;
  const postedLongs = counts.postedLongs ?? wfPlannedThemes.filter(t => t.status === 'posted' && isLongTheme(t)).length;

  if ($('#wf-count-total')) $('#wf-count-total').innerHTML = `📌 <strong>${total}</strong> temas no cronograma`;
  if ($('#wf-count-pending')) $('#wf-count-pending').innerHTML = `⏳ <strong>${pending}</strong> pendentes`;
  if ($('#wf-count-production')) $('#wf-count-production').innerHTML = `⚙️ <strong>${production}</strong> em produção`;
  if ($('#wf-count-posted')) $('#wf-count-posted').innerHTML = `✅ <strong>${posted}</strong> já postados`;
  if ($('#wf-count-shorts')) $('#wf-count-shorts').innerHTML = `⚡ <strong>${shorts}</strong> shorts (${postedShorts} postados)`;
  if ($('#wf-count-longs')) $('#wf-count-longs').innerHTML = `🎬 <strong>${longs}</strong> longos (${postedLongs} postados)`;
}

function renderWorkflowPlannedThemes(themes, filter = 'all', formatFilter = 'all') {
  const emptyState = $('#wf-themes-empty');
  const list = $('#wf-themes-list');
  if (!list) return;

  const currentStatusFilter = filter || wfThemesCurrentFilter || 'all';
  const currentFmtFilter = formatFilter || wfThemesCurrentFormatFilter || 'all';

  const isShortTheme = (t) => t.format === 'short' || /#shorts?/i.test(t.topic || '');

  const filtered = (themes || []).filter(t => {
    const matchesStatus = currentStatusFilter === 'all' || t.status === currentStatusFilter;
    const isShort = isShortTheme(t);
    const matchesFormat = currentFmtFilter === 'all' 
      ? true 
      : (currentFmtFilter === 'short' ? isShort : !isShort);
    return matchesStatus && matchesFormat;
  });

  if (filtered.length === 0) {
    if (emptyState) {
      emptyState.classList.remove('hidden');
      let msg = 'Nenhum tema no cronograma ainda';
      if (currentStatusFilter !== 'all') {
        const filterName = currentStatusFilter === 'pending' ? 'Pendente' : currentStatusFilter === 'in_production' ? 'Em Produção' : 'Já Postado';
        msg = `Nenhum tema com status "${filterName}"`;
      } else if (currentFmtFilter === 'short') {
        msg = 'Nenhum Short encontrado no cronograma';
      } else if (currentFmtFilter === 'long') {
        msg = 'Nenhum Vídeo Longo encontrado no cronograma';
      }
      emptyState.querySelector('h4').textContent = msg;
      emptyState.querySelector('p').textContent = 'Alterne os filtros acima para visualizar outros formatos ou planeje novos temas.';
    }
    list.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  list.classList.remove('hidden');

  list.innerHTML = filtered.map(t => {
    const isPosted = t.status === 'posted';
    const dateFormatted = formatScheduleDate(t.scheduled_date);
    const hasFullScript = Boolean(t.full_script && String(t.full_script).trim());
    const charCount = t.script_char_count || (hasFullScript ? t.full_script.length : 0);
    const isShort = isShortTheme(t);
    const isAvulso = isAvulsoTheme(t);
    const formatClass = isShort ? 'format-short' : 'format-long';
    const formatBadge = isShort
      ? '<span class="theme-card-format" style="background: rgba(244, 63, 94, 0.16); color: #fda4af; border: 1px solid rgba(244, 63, 94, 0.35); font-weight: 700;">⚡ Short</span>'
      : `<span class="theme-card-format" style="background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.3); font-weight: 600;">🎬 ${escapeHTML(t.format || 'Vídeo Longo')}</span>`;

    const originBadge = isAvulso
      ? (isShort
          ? '<span class="theme-origin-badge origin-avulso" title="Short / Corte enviado de forma avulsa">⚡ Corte Avulso</span>'
          : '<span class="theme-origin-badge origin-avulso" title="Vídeo enviado de forma avulsa">📤 Envio Avulso</span>')
      : '<span class="theme-origin-badge origin-planejado" title="Tema criado pelo planejamento editorial do canal">📋 Planejado</span>';

    let benchmarkRef = t.benchmark_ref || t.benchmarkRef || '';
    if (!benchmarkRef && t.notes) {
      try {
        const parsedNotes = JSON.parse(t.notes);
        benchmarkRef = parsedNotes.benchmarkRef || '';
      } catch (_e) {}
    }
    const recoveryBadge = benchmarkRef
      ? `<span class="theme-origin-badge" style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.35); font-weight: 600;" title="Fórmula campeã: ${escapeHTML(benchmarkRef)}">🎯 Recuperação</span>`
      : '';

    return `
      <div class="theme-card status-${escapeHTML(t.status || 'pending')} ${formatClass}" data-theme-card-id="${escapeHTML(t.id)}">
        <div>
          <!-- Linha superior de Data e Status -->
          <div class="theme-card-date-row">
            <span class="theme-date-badge" title="${isPosted ? 'Data de postagem no YouTube' : 'Data e horário previstos de postagem'}" ${isPosted ? 'style="background: rgba(16, 185, 129, 0.12); color: #34d399; border-color: rgba(16, 185, 129, 0.3);"' : ''}>
              📅 ${escapeHTML(dateFormatted)}${t.scheduled_time ? ` · ⏰ ${escapeHTML(t.scheduled_time)}` : ''}
              ${!isPosted ? `<button type="button" data-edit-theme-date="${escapeHTML(t.id)}" data-theme-title="${escapeHTML(t.topic)}" data-current-date="${escapeHTML(t.scheduled_date || '')}" data-current-time="${escapeHTML(t.scheduled_time || '')}" title="Editar data e horário de postagem">✏️</button>` : ''}
            </span>
            <div class="theme-status-selector-wrap">
              <select class="theme-status-select ${escapeHTML(t.status || 'pending')} status-${escapeHTML(t.status || 'pending')}" data-change-theme-status="${escapeHTML(t.id)}" title="Escolha o status do tema">
                <option value="pending" ${t.status === 'pending' || !t.status ? 'selected' : ''}>⏳ Pendente</option>
                <option value="in_production" ${t.status === 'in_production' ? 'selected' : ''}>🎬 Em Produção</option>
                <option value="posted" ${t.status === 'posted' ? 'selected' : ''}>✅ Já Postado</option>
              </select>
            </div>
          </div>

          <!-- Tipo, Origem e Título -->
          <div class="theme-card-top" style="margin-top: 8px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            ${formatBadge}
            ${originBadge}
            ${recoveryBadge}
          </div>
          <h4 class="theme-card-title">${escapeHTML(t.topic)}</h4>
          ${hasFullScript ? `
            <div style="margin: 6px 0;">
              <span class="chip-metric chip-production" style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px; border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.12); padding: 3px 8px; border-radius: 6px;">
                📜 Roteiro Pronto (${charCount.toLocaleString()} carac.)
              </span>
            </div>
          ` : ''}
          ${(t.hook_angle || t.why_better || benchmarkRef) ? `
            <details class="theme-card-details" ${wfThemesDetailsExpanded ? 'open' : ''}>
              <summary class="theme-card-summary" title="Clique para ver ou ocultar o gancho e ângulo da estratégia">
                <span>💡 Ver Gancho &amp; Ângulo</span>
                <span class="theme-details-chevron">▾</span>
              </summary>
              <div class="theme-details-content">
                ${benchmarkRef ? `<p class="theme-card-why" style="color: #fda4af; margin-bottom: 6px;"><strong>🎯 Gatilho Campeão:</strong> ${escapeHTML(benchmarkRef)}</p>` : ''}
                ${t.hook_angle ? `<p class="theme-card-hook"><strong>🎣 Gancho:</strong> ${escapeHTML(t.hook_angle)}</p>` : ''}
                ${t.why_better ? `<p class="theme-card-why"><strong>💡 Ângulo:</strong> ${escapeHTML(t.why_better)}</p>` : ''}
              </div>
            </details>
          ` : ''}
        </div>

        <!-- Rodapé do Card com Ações -->
        <div class="theme-card-footer">
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            ${isPosted 
              ? `
                ${(t.published_url || t.publishedUrl) ? `
                  <a href="${escapeHTML(t.published_url || t.publishedUrl)}" target="_blank" rel="noopener noreferrer" class="button ghost small" style="font-size: 11px; color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;" title="Abrir vídeo no YouTube">
                    ▶️ Ver no YouTube
                  </a>
                ` : ''}
                <button type="button" class="button ghost small wf-theme-txt-btn" data-theme-id="${escapeHTML(t.id)}" data-theme-topic="${escapeHTML(t.topic)}" style="font-size: 11px; color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.08);" title="Visualizar ou baixar arquivo TXT com todos os dados usados nesta produção">
                  📄 Log TXT
                </button>
                <button type="button" class="button ghost small" data-set-theme-status="${escapeHTML(t.id)}" data-new-status="pending" style="font-size: 11px; color: var(--muted);" title="Mudar status de volta para Pendente">↩ Reabrir como Pendente</button>
              `
              : hasFullScript
                ? `<button type="button" class="button primary small" data-use-planned-theme="${escapeHTML(t.id)}" data-theme-topic="${escapeHTML(t.topic)}" data-theme-angle="${escapeHTML(t.hook_angle || '')}" data-theme-format="${escapeHTML(t.format || 'explainer')}" style="background: linear-gradient(135deg, #ef4444, #f43f5e); font-weight: 600;">
                    👉 Seguir Fluxo (Roteiro Pronto)
                   </button>`
                : `<button type="button" class="button primary small" data-use-planned-theme="${escapeHTML(t.id)}" data-theme-topic="${escapeHTML(t.topic)}" data-theme-angle="${escapeHTML(t.hook_angle || '')}" data-theme-format="${escapeHTML(t.format || 'explainer')}">
                    👉 Produzir Roteiro
                   </button>`
            }
          </div>
          <button type="button" class="button ghost small" data-delete-planned-theme="${escapeHTML(t.id)}" title="${t.status === 'posted' ? 'Remover este vídeo postado da lista do painel' : t.status === 'in_production' ? 'Excluir tema em produção' : 'Excluir tema pendente'}" style="color: var(--red); padding: 4px 8px; font-size: 12px;">
            🗑️
          </button>
        </div>
      </div>
    `;
  }).join('');
}

let wfThemesDetailsExpanded = false;
$('#wf-toggle-all-details-btn')?.addEventListener('click', () => {
  wfThemesDetailsExpanded = !wfThemesDetailsExpanded;
  document.querySelectorAll('.theme-card-details').forEach(el => {
    el.open = wfThemesDetailsExpanded;
  });
  const btn = $('#wf-toggle-all-details-btn');
  if (btn) btn.textContent = wfThemesDetailsExpanded ? '🙈 Ocultar Detalhes' : '👁️ Expandir Detalhes';
});

// Botões de Ações Rápidas do Cockpit Executivo (Início)
$('#overview-quick-resume-btn')?.addEventListener('click', () => {
  switchView('workflow');
  setWorkflowStudioMode('full', false);
  setTimeout(() => {
    const inProdCard = document.querySelector('.theme-card.in-production') || $('#wf-step-2-panel');
    inProdCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
});

$('#overview-quick-cortes-btn')?.addEventListener('click', () => {
  switchView('workflow');
  setWorkflowStudioMode('cortes', true);
});

$('#overview-quick-new-doc-btn')?.addEventListener('click', () => {
  switchView('workflow');
  setWorkflowStudioMode('full', false);
  setTimeout(() => {
    $('#wf-step-1-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
});

$('#overview-quick-plan-ai-btn')?.addEventListener('click', () => {
  switchView('workflow');
  setWorkflowStudioMode('full', false);
  setTimeout(() => {
    $('#wf-open-scheduler-btn')?.click();
  }, 120);
});

// Abrir modal de planejamento com IA
$('#wf-open-scheduler-btn')?.addEventListener('click', () => {
  const dialog = $('#wf-scheduler-dialog');
  const dateInput = $('#wf-sched-start-date');
  if (dateInput && !dateInput.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.value = tomorrow.toISOString().split('T')[0];
  }
  dialog?.showModal();
});

// Alternar dicas explicativas do Modo de Estratégia no modal
$('#wf-sched-strategy-mode')?.addEventListener('change', (e) => {
  const hint = $('#wf-strategy-mode-hint');
  if (hint) {
    if (e.target.value === 'recovery') {
      hint.innerHTML = '🔥 <strong>Modo Recuperação Ativo:</strong> A IA analisa seus picos históricos (Shorts de até 4,5k views e vídeos de revelação/mistério) para diagnosticar o que causou a queda recente e criar temas com a mesma fórmula comprovada de alta retenção.';
      hint.style.color = '#fca5a5';
    } else {
      hint.innerHTML = '✨ <strong>Modo Padrão:</strong> A IA analisa apenas o que foi postado recentemente nos últimos dias para sugerir continuidades sem repetir temas.';
      hint.style.color = 'var(--muted)';
    }
  }
});

// Submeter geração de temas e cronograma com IA
$('#wf-scheduler-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dialog = $('#wf-scheduler-dialog');
  const submitBtn = $('#wf-submit-generate-themes-btn');
  const days = $('#wf-days-window')?.value || '7';
  const language = $('#wf-target-language')?.value || 'it-IT';
  const fieldAHistory = $('#wf-field-a')?.value || '';
  const startDate = $('#wf-sched-start-date')?.value || new Date().toISOString().split('T')[0];
  const cadence = $('#wf-sched-cadence')?.value || 'daily';
  const strategyMode = $('#wf-sched-strategy-mode')?.value || 'recovery';
  const isRecovery = strategyMode === 'recovery';

  submitBtn.disabled = true;
  submitBtn.textContent = isRecovery
    ? '⏳ Analisando picos em alta e gerando temas de recuperação...'
    : '⏳ Analisando canal e criando temas...';
  $('#loading').classList.add('active');

  try {
    const res = await mutate('/api/workflow/generate-themes', 'POST', {
      days,
      language,
      fieldAHistory,
      strategyMode
    }, isRecovery
      ? `Plano de Recuperação gerado com sucesso! ${days} temas modelados após os maiores sucessos do canal.`
      : `Análise concluída: ${days} novos temas gerados pela IA!`);

    if (res.themes && res.themes.length > 0) {
      await mutate('/api/workflow/planned-themes/batch', 'POST', {
        themes: res.themes,
        startDate,
        cadence
      }, `Cronograma com ${res.themes.length} temas salvo com sucesso!`);

      dialog?.close();
      await loadWorkflowPlannedThemes();

      if (res.diagnosis) {
        showToast(`🎯 Diagnóstico: ${res.diagnosis.slice(0, 110)}...`, 'info', 6000);
      }
    }
  } catch (err) {
    showToast(`Erro ao gerar temas: ${err.message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '🚀 Analisar e Criar Cronograma';
    $('#loading').classList.remove('active');
  }
});

// Abrir modal de tema manual
$('#wf-open-manual-btn')?.addEventListener('click', () => {
  const dialog = $('#wf-manual-theme-dialog');
  const dateInput = $('#wf-manual-date');
  if (dateInput && !dateInput.value) {
    const today = new Date();
    dateInput.value = today.toISOString().split('T')[0];
  }
  const counter = $('#wf-manual-script-counter');
  const scriptArea = $('#wf-manual-full-script');
  if (counter && scriptArea) {
    const len = scriptArea.value ? scriptArea.value.length : 0;
    counter.textContent = `${len.toLocaleString()} caracteres`;
  }

  // Garantir que o campo de gancho manual comece recolhido por padrão
  const hookContainer = $('#wf-manual-hook-container');
  const hookIcon = $('#wf-manual-hook-icon');
  const hookLabel = $('#wf-manual-hook-label');
  if (hookContainer) hookContainer.classList.add('hidden');
  if (hookIcon) hookIcon.textContent = '＋';
  if (hookLabel) hookLabel.textContent = 'Definir Gancho Personalizado Manualmente';

  dialog?.showModal();
});

// Toggle sob demanda para o campo de gancho no modal manual
$('#wf-toggle-manual-hook-btn')?.addEventListener('click', () => {
  const container = $('#wf-manual-hook-container');
  const label = $('#wf-manual-hook-label');
  const icon = $('#wf-manual-hook-icon');
  const textarea = $('#wf-manual-hook');
  if (!container) return;

  const isHidden = container.classList.toggle('hidden');
  if (icon) icon.textContent = isHidden ? '＋' : '✕';
  if (label) {
    const hasVal = Boolean(textarea?.value?.trim());
    label.textContent = isHidden 
      ? (hasVal ? 'Gancho Personalizado Configurado · Editar' : 'Definir Gancho Personalizado Manualmente')
      : 'Recolher Gancho Personalizado';
  }
  if (!isHidden) {
    textarea?.focus();
  }
});

// Contador dinâmico para o textarea do roteiro total manual
$('#wf-manual-full-script')?.addEventListener('input', (e) => {
  const counter = $('#wf-manual-script-counter');
  const len = e.target.value ? e.target.value.length : 0;
  if (counter) {
    counter.textContent = `${len.toLocaleString()} caracteres`;
  }
});

// Salvar tema manual
$('#wf-manual-theme-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dialog = $('#wf-manual-theme-dialog');
  const topic = $('#wf-manual-topic')?.value?.trim();
  const hookAngle = $('#wf-manual-hook')?.value?.trim();
  const fullScript = $('#wf-manual-full-script')?.value?.trim() || null;
  const format = $('#wf-manual-format')?.value || 'explainer';
  const scheduledDate = $('#wf-manual-date')?.value;
  const scheduledTime = $('#wf-manual-time')?.value || null;

  if (!topic) return;

  try {
    const successMsg = fullScript 
      ? `Tema adicionado com roteiro pronto (${fullScript.length.toLocaleString()} caracteres)!`
      : 'Tema adicionado ao cronograma!';

    await mutate('/api/workflow/planned-themes', 'POST', {
      topic,
      hookAngle: hookAngle || null,
      fullScript,
      format,
      scheduledDate,
      scheduledTime: scheduledTime ? scheduledTime.trim() : null,
      status: 'pending'
    }, successMsg);

    dialog?.close();
    e.target.reset();
    const counter = $('#wf-manual-script-counter');
    if (counter) counter.textContent = '0 caracteres';
    $('#wf-manual-hook-container')?.classList.add('hidden');
    const hookIcon = $('#wf-manual-hook-icon');
    const hookLabel = $('#wf-manual-hook-label');
    if (hookIcon) hookIcon.textContent = '＋';
    if (hookLabel) hookLabel.textContent = 'Definir Gancho Personalizado Manualmente';

    await loadWorkflowPlannedThemes();
  } catch (err) {
    showToast(`Erro ao salvar tema: ${err.message}`, 'error');
  }
});

// Modal de alteração de data e horário
$('#wf-edit-date-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dialog = $('#wf-edit-date-dialog');
  const themeId = $('#wf-edit-date-theme-id')?.value;
  const newDate = $('#wf-edit-date-input')?.value;
  const newTime = $('#wf-edit-time-input')?.value;

  if (!themeId || !newDate) return;

  try {
    await mutate(`/api/workflow/planned-themes/${encodeURIComponent(themeId)}`, 'PATCH', {
      scheduledDate: newDate,
      scheduledTime: newTime ? newTime.trim() : null
    }, 'Data e horário de postagem atualizados!');

    dialog?.close();
    await loadWorkflowPlannedThemes();
  } catch (err) {
    showToast(`Erro ao atualizar data e horário: ${err.message}`, 'error');
  }
});

// Modal de pergunta do horário de postagem (ao clicar em Produzir Roteiro pela 1ª vez)
$('#wf-ask-post-time-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dialog = $('#wf-ask-post-time-dialog');
  const themeId = $('#wf-ask-time-theme-id')?.value;
  const chosenTime = $('#wf-ask-time-input')?.value?.trim();

  if (!themeId || !chosenTime) return;

  const currentTheme = (Array.isArray(wfPlannedThemes) ? wfPlannedThemes : []).find(t => t.id === themeId);

  try {
    await mutate(`/api/workflow/planned-themes/${encodeURIComponent(themeId)}`, 'PATCH', {
      scheduledTime: chosenTime
    }, `⏰ Horário de postagem memorizado: ${chosenTime}!`);

    if (currentTheme) {
      currentTheme.scheduled_time = chosenTime;
    }

    dialog?.close();
    await loadWorkflowPlannedThemes();

    if (currentTheme) {
      applyThemeToWorkflowStudio(currentTheme, {
        topic: currentTheme.topic,
        angle: currentTheme.hook_angle,
        format: currentTheme.format
      });
    }
  } catch (err) {
    showToast(`Erro ao memorizar horário: ${err.message}`, 'error');
  }
});

// Atalhos rápidos de clique de horário nos modais
document.addEventListener('click', (e) => {
  const presetEditBtn = e.target.closest('.chip-preset-edit-time');
  if (presetEditBtn) {
    const timeInput = $('#wf-edit-time-input');
    if (timeInput) timeInput.value = presetEditBtn.dataset.setTime;
    return;
  }
  const presetAskBtn = e.target.closest('.chip-preset-ask-time');
  if (presetAskBtn) {
    const timeInput = $('#wf-ask-time-input');
    if (timeInput) timeInput.value = presetAskBtn.dataset.setTime;
    return;
  }
});

// Modal de exclusão de temas pendentes (Proteção total de Em Produção e Postados)
$('#wf-clear-all-themes-btn')?.addEventListener('click', () => {
  const pendingThemes = (Array.isArray(wfPlannedThemes) ? wfPlannedThemes : []).filter(t => t.status === 'pending' || !t.status);
  if (pendingThemes.length === 0) {
    showToast('Não há temas pendentes para excluir. Temas em produção e postados são blindados!', 'info');
    return;
  }
  const summaryEl = $('#wf-clear-pending-count-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `⏳ <strong>${pendingThemes.length} tema(s) pendente(s)</strong> serão excluídos. Seus temas em produção e já postados continuarão 100% preservados e intactos.`;
  }
  const dialog = $('#wf-clear-themes-dialog');
  const checkbox = $('#wf-clear-confirm-checkbox');
  const confirmBtn = $('#wf-confirm-clear-btn');
  if (checkbox) checkbox.checked = false;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '🗑️ Excluir Temas Pendentes';
  }
  dialog?.showModal();
});

$('#wf-clear-confirm-checkbox')?.addEventListener('change', (e) => {
  const confirmBtn = $('#wf-confirm-clear-btn');
  if (confirmBtn) {
    confirmBtn.disabled = !e.target.checked;
  }
});

$('#wf-clear-themes-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dialog = $('#wf-clear-themes-dialog');
  const confirmBtn = $('#wf-confirm-clear-btn');

  confirmBtn.disabled = true;
  confirmBtn.textContent = '⏳ Excluindo pendentes...';
  $('#loading').classList.add('active');

  try {
    await mutate('/api/workflow/planned-themes', 'DELETE', {}, 
      'Temas pendentes excluídos com sucesso. Temas em produção e postados permanecem intactos.');
    
    dialog?.close();
    await loadWorkflowPlannedThemes();
  } catch (err) {
    showToast(`Erro ao excluir temas pendentes: ${err.message}`, 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = '🗑️ Excluir Temas Pendentes';
    $('#loading').classList.remove('active');
  }
});

// Ação de Limpar Duplicados do Cronograma
$('#wf-deduplicate-themes-btn')?.addEventListener('click', async () => {
  $('#loading')?.classList.add('active');
  try {
    const res = await mutate('/api/workflow/planned-themes/deduplicate', 'POST', {}, '');
    await loadWorkflowPlannedThemes();
    if (res && res.count > 0) {
      showToast(`🧹 Limpeza concluída: ${res.count} item(ns) duplicado(s) removido(s) com sucesso!`, 'success');
    } else {
      showToast('✓ Nenhuma duplicata encontrada no cronograma. Sua listagem já está 100% limpa!', 'info');
    }
  } catch (err) {
    showToast(`Erro ao limpar duplicatas: ${err.message}`, 'error');
  } finally {
    $('#loading')?.classList.remove('active');
  }
});

// Aplica tema planejado selecionado ao estúdio (roteiro, agendamento e blocos)
function applyThemeToWorkflowStudio(currentTheme, { topic, angle, format }) {
  if (ui.currentView !== 'workflow') {
    switchView('workflow');
  }

  // Limpa automaticamente todos os dados residuais da produção anterior
  resetWorkflowStudio({ keepFieldA: true, preserveTopic: topic, notify: false });

  const topicInput = $('#wf-script-topic');
  const angleInput = $('#wf-script-angle');
  const formatSelect = $('#wf-script-format');

  if (topicInput) topicInput.value = topic || '';
  if (angleInput) angleInput.value = angle || '';
  if (formatSelect && format) {
    const opt = formatSelect.querySelector(`option[value="${format.toLowerCase()}"]`);
    if (opt) formatSelect.value = format.toLowerCase();
  }

  // Memoriza o tema atual em produção e seu agendamento no estado do estúdio
  wfState.currentThemeId = currentTheme?.id || null;
  wfState.scheduledDate = currentTheme?.scheduled_date || null;
  wfState.scheduledTime = currentTheme?.scheduled_time || null;

  // Preenche automaticamente o campo de agendamento de upload (Data e Horário)
  if (currentTheme?.scheduled_date) {
    const timeInput = $('#wf-upload-time');
    if (timeInput) {
      const timePart = currentTheme.scheduled_time ? currentTheme.scheduled_time.slice(0, 5) : '18:00';
      timeInput.value = `${currentTheme.scheduled_date}T${timePart}`;
    }
  }

  if (currentTheme && currentTheme.status === 'pending') {
    mutate(`/api/workflow/planned-themes/${encodeURIComponent(currentTheme.id)}`, 'PATCH', {
      status: 'in_production'
    }, `Tema em produção: "${topic}"`)
      .then(() => loadWorkflowPlannedThemes())
      .catch(() => {});
  }

  // Se o tema já possui roteiro total construído externamente:
  if (currentTheme && currentTheme.full_script) {
    let blocks = [];
    if (currentTheme.narration_blocks) {
      try {
        blocks = typeof currentTheme.narration_blocks === 'string'
          ? JSON.parse(currentTheme.narration_blocks)
          : currentTheme.narration_blocks;
      } catch (e) {
        blocks = [];
      }
    }
    if (!Array.isArray(blocks) || blocks.length === 0) {
      const clean = currentTheme.full_script.trim();
      const half = Math.floor(clean.length / 2);
      blocks = [
        { index: 1, title: 'Bloco 1', charCount: half, text: clean.slice(0, half).trim() },
        { index: 2, title: 'Bloco 2', charCount: clean.length - half, text: clean.slice(half).trim() }
      ];
    }

    wfState.script = {
      topic: currentTheme.topic,
      hook: currentTheme.hook_angle || '',
      fullScript: currentTheme.full_script,
      totalCharacters: currentTheme.script_char_count || currentTheme.full_script.length,
      part1Chars: blocks[0]?.charCount || 0,
      part2Chars: blocks[1]?.charCount || 0,
      officialBible: 'Bibbia CEI 2008 (Construído Externamente)',
      hookType: 'Roteiro Total Externo',
      narrationBlocks: blocks
    };

    renderWorkflowScript(wfState.script);
    renderNarrationBlocks(blocks);

    const panel = $('#wf-step-3-panel') || $('#wf-narration-blocks-container');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    scheduleAutoSaveDraft(100);
    const timeNotice = currentTheme.scheduled_time ? ` · ⏰ ${currentTheme.scheduled_time}` : '';
    showToast(`Roteiro pronto carregado (${(currentTheme.script_char_count || currentTheme.full_script.length).toLocaleString()} carac.)! Agendado: ${formatScheduleDate(currentTheme.scheduled_date)}${timeNotice}.`, 'success');
    return;
  }

  scheduleAutoSaveDraft(100);
  topicInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const timeNotice = currentTheme?.scheduled_time ? ` (Agendado às ${currentTheme.scheduled_time})` : '';
  showToast(`Tema preenchido para o Roteiro: "${topic}"${timeNotice}.`, 'success');
}

// Cliques gerais da Etapa 1 (Filtros, Alternar Status, Editar Data, Excluir, Produzir e Exportar)
document.addEventListener('click', (e) => {
  const filterTab = e.target.closest('[data-filter-status]');
  if (filterTab) {
    $$('[data-filter-status]').forEach(tab => tab.classList.remove('active'));
    filterTab.classList.add('active');
    wfThemesCurrentFilter = filterTab.dataset.filterStatus || 'all';
    renderWorkflowPlannedThemes(wfPlannedThemes, wfThemesCurrentFilter, wfThemesCurrentFormatFilter);
    return;
  }

  const formatTab = e.target.closest('[data-filter-format]');
  if (formatTab) {
    $$('[data-filter-format]').forEach(tab => tab.classList.remove('active'));
    formatTab.classList.add('active');
    wfThemesCurrentFormatFilter = formatTab.dataset.filterFormat || 'all';
    renderWorkflowPlannedThemes(wfPlannedThemes, wfThemesCurrentFilter, wfThemesCurrentFormatFilter);
    return;
  }

  const themeTxtBtn = e.target.closest('.wf-theme-txt-btn');
  if (themeTxtBtn) {
    const themeId = themeTxtBtn.dataset.themeId;
    const themeTopic = themeTxtBtn.dataset.themeTopic || '';
    const themeObj = (Array.isArray(wfPlannedThemes) ? wfPlannedThemes : []).find(t => t.id === themeId);
    handleOpenThemeTxtLog(themeObj || { topic: themeTopic, id: themeId });
    return;
  }

  const setStatusBtn = e.target.closest('[data-set-theme-status]');
  if (setStatusBtn) {
    const themeId = setStatusBtn.dataset.setThemeStatus;
    const newStatus = setStatusBtn.dataset.newStatus || 'pending';
    mutate(`/api/workflow/planned-themes/${encodeURIComponent(themeId)}`, 'PATCH', {
      status: newStatus
    }, 'Tema reaberto como Pendente.')
      .then(() => loadWorkflowPlannedThemes())
      .catch((err) => showToast(`Erro ao alterar status: ${err.message}`, 'error'));
    return;
  }

  const editDateBtn = e.target.closest('[data-edit-theme-date]');
  if (editDateBtn) {
    const themeId = editDateBtn.dataset.editThemeDate;
    const targetTheme = (Array.isArray(wfPlannedThemes) ? wfPlannedThemes : []).find(t => t.id === themeId);
    if (targetTheme && targetTheme.status === 'posted') {
      showToast('Vídeos já postados não podem ter data ou horário alterados.', 'warning');
      return;
    }

    const themeTitle = editDateBtn.dataset.themeTitle;
    const currentDate = editDateBtn.dataset.currentDate;
    const currentTime = editDateBtn.dataset.currentTime;

    $('#wf-edit-date-theme-id').value = themeId || '';
    $('#wf-edit-date-theme-title').textContent = themeTitle || '';
    $('#wf-edit-date-input').value = currentDate || new Date().toISOString().split('T')[0];
    $('#wf-edit-time-input').value = currentTime || '';

    $('#wf-edit-date-dialog')?.showModal();
    return;
  }

  const deleteBtn = e.target.closest('[data-delete-planned-theme]');
  if (deleteBtn) {
    const themeId = deleteBtn.dataset.deletePlannedTheme;
    const targetTheme = (Array.isArray(wfPlannedThemes) ? wfPlannedThemes : []).find(t => t.id === themeId);
    const topic = targetTheme?.topic || 'este tema';
    const status = targetTheme?.status || 'pending';

    let confirmMsg = `Deseja realmente excluir este tema planejado do cronograma?\n\n"${topic}"`;
    if (status === 'posted') {
      confirmMsg = `⚠️ Deseja remover este vídeo POSTADO do seu cronograma/painel?\n\n"${topic}"\n\n(Nota: O vídeo já enviado/agendado no YouTube continuará intacto no YouTube Studio. Esta ação apenas limpa o registro deste card no seu painel local)`;
    } else if (status === 'in_production') {
      confirmMsg = `⚠️ Deseja remover este tema que está EM PRODUÇÃO do cronograma?\n\n"${topic}"`;
    }

    if (confirm(confirmMsg)) {
      const isForce = (status === 'posted' || status === 'in_production');
      mutate(`/api/workflow/planned-themes/${encodeURIComponent(themeId)}${isForce ? '?force=true' : ''}`, 'DELETE', {}, 'Item removido do cronograma com sucesso.')
        .then(() => loadWorkflowPlannedThemes())
        .catch((err) => showToast(`Erro ao remover tema: ${err.message}`, 'error'));
    }
    return;
  }

  const usePlannedBtn = e.target.closest('[data-use-planned-theme]');
  if (usePlannedBtn) {
    const themeId = usePlannedBtn.dataset.usePlannedTheme;
    const topic = usePlannedBtn.dataset.themeTopic;
    const angle = usePlannedBtn.dataset.themeAngle;
    const format = usePlannedBtn.dataset.themeFormat;

    const currentTheme = (Array.isArray(wfPlannedThemes) ? wfPlannedThemes : []).find(t => t.id === themeId);

    // REGRA DE SEGURANÇA: Casos JÁ POSTADOS jamais solicitam nem alteram horário
    if (currentTheme && currentTheme.status === 'posted') {
      applyThemeToWorkflowStudio(currentTheme, { topic, angle, format });
      return;
    }

    // REGRA SOLICITADA: O questionamento do horário ocorre ESTRITAMENTE para casos PENDENTES que vão para produção
    const isPending = !currentTheme?.status || currentTheme?.status === 'pending';
    const hasRecordedTime = currentTheme && currentTheme.scheduled_time && String(currentTheme.scheduled_time).trim().length >= 4;

    if (isPending && !hasRecordedTime) {
      // NÃO POSSUI HORÁRIO AINDA E ESTÁ PENDENTE: questiona o usuário pela 1ª vez
      const askDialog = $('#wf-ask-post-time-dialog');
      if (askDialog) {
        $('#wf-ask-time-theme-id').value = themeId;
        $('#wf-ask-time-theme-title').textContent = topic || currentTheme?.topic || 'Tema Selecionado';
        const dateText = currentTheme?.scheduled_date ? formatScheduleDate(currentTheme.scheduled_date) : 'Sem data definida';
        $('#wf-ask-time-date-notice').textContent = `📅 Data prevista no cronograma: ${dateText}`;
        $('#wf-ask-time-input').value = '18:00';
        askDialog.showModal();
        return;
      }
    }

    // JÁ INSERIU A HORA OU JÁ ESTÁ EM PRODUÇÃO: não pergunta de novo!
    applyThemeToWorkflowStudio(currentTheme, { topic, angle, format });
    return;
  }

  const exportBtn = e.target.closest('#wf-export-themes-btn');
  if (exportBtn) {
    if (wfPlannedThemes.length === 0) {
      showToast('Nenhum tema no cronograma para exportar.', 'warning');
      return;
    }
    const header = 'DATA\tSTATUS\tFORMATO\tTEMA\tGANCHO\n';
    const rows = wfPlannedThemes.map(t => {
      const status = t.status === 'posted' ? 'POSTADO' : t.status === 'in_production' ? 'EM PRODUÇÃO' : 'PENDENTE';
      return `${t.scheduled_date || ''}\t${status}\t${t.format || ''}\t${(t.topic || '').replace(/\t/g, ' ')}\t${(t.hook_angle || '').replace(/\t/g, ' ')}`;
    }).join('\n');

    copyToClipboard(header + rows, exportBtn);
    showToast('📋 Lista copiada! Basta colar no Excel (Ctrl + V).', 'success');
    return;
  }
});

// Alteração direta e explícita do status do tema pelo seletor dropdown
document.addEventListener('change', async (e) => {
  const select = e.target.closest('[data-change-theme-status]');
  if (!select) return;
  const themeId = select.dataset.changeThemeStatus;
  const newStatus = select.value;
  const statusLabels = {
    pending: '⏳ Pendente',
    in_production: '🎬 Em Produção',
    posted: '✅ Já Postado'
  };

  try {
    await mutate(`/api/workflow/planned-themes/${encodeURIComponent(themeId)}`, 'PATCH', {
      status: newStatus
    }, `Status definido para: ${statusLabels[newStatus] || newStatus}`);
    await loadWorkflowPlannedThemes();
  } catch (err) {
    showToast(`Erro ao alterar status: ${err.message}`, 'error');
  }
});

// ========================================================
// Controles de Visual Clean Sob Demanda (Estúdio de Produção)
// ========================================================
$('#wf-toggle-field-a-btn')?.addEventListener('click', () => {
  const container = $('#wf-field-a-container');
  const icon = $('#wf-field-a-btn-icon');
  const label = $('#wf-field-a-btn-label');
  const textarea = $('#wf-field-a');
  if (!container) return;

  const isHidden = container.classList.toggle('hidden');
  const val = textarea?.value?.trim() || '';

  if (icon) icon.textContent = isHidden ? (val ? '✓' : '＋') : '✕';
  if (label) {
    if (isHidden) {
      label.textContent = val ? `Histórico Ativo (${val.length} carac.) · Editar` : 'Inserir Histórico do Roteiro Anterior (Campo A)';
    } else {
      label.textContent = 'Recolher Histórico (Campo A)';
      textarea?.focus();
    }
  }
});

$('#wf-field-a')?.addEventListener('input', (e) => {
  const val = e.target.value?.trim() || '';
  const hint = $('#wf-field-a-hint');
  if (hint) {
    hint.textContent = val ? `✓ ${val.length} caracteres configurados no histórico.` : 'Opcional · Evita repetições de ganchos anteriores';
  }
});

$('#wf-toggle-custom-angles-btn')?.addEventListener('click', () => {
  const container = $('#wf-human-decision-container');
  const label = $('#wf-custom-angles-label');
  const icon = $('#wf-custom-angles-icon');
  if (!container) return;

  const isHidden = container.classList.toggle('hidden');
  if (icon) icon.textContent = isHidden ? '⚙️' : '✕';
  if (label) label.textContent = isHidden ? 'Personalizar Diretrizes & Autoria' : 'Recolher Diretrizes';

  if (!isHidden) {
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

$('#wf-close-custom-angles-btn')?.addEventListener('click', () => {
  const container = $('#wf-human-decision-container');
  const label = $('#wf-custom-angles-label');
  const icon = $('#wf-custom-angles-icon');
  if (container) container.classList.add('hidden');
  if (icon) icon.textContent = '⚙️';
  if (label) label.textContent = 'Personalizar Diretrizes & Autoria';
});

// ========================================================
// Drawer: Colar Roteiro Total Externo Diretamente (Etapa 2)
// ========================================================
$('#wf-toggle-direct-script-btn')?.addEventListener('click', () => {
  const drawer = $('#wf-direct-script-drawer');
  const label = $('#wf-direct-script-label');
  const icon = $('#wf-direct-script-icon');
  if (!drawer) return;
  const isHidden = drawer.classList.toggle('hidden');
  if (icon) icon.textContent = isHidden ? '📋' : '✕';
  if (label) label.textContent = isHidden ? 'Já possui o roteiro total pronto gerado por fora? Colar aqui' : 'Recolher campo de roteiro externo';
  if (!isHidden) {
    $('#wf-direct-script-input')?.focus();
  }
});

$('#wf-close-direct-script-btn')?.addEventListener('click', () => {
  const drawer = $('#wf-direct-script-drawer');
  const label = $('#wf-direct-script-label');
  const icon = $('#wf-direct-script-icon');
  if (drawer) drawer.classList.add('hidden');
  if (icon) icon.textContent = '📋';
  if (label) label.textContent = 'Já possui o roteiro total pronto gerado por fora? Colar aqui';
});

$('#wf-direct-script-input')?.addEventListener('input', (e) => {
  const len = e.target.value ? e.target.value.length : 0;
  const counter = $('#wf-direct-script-counter');
  if (counter) {
    if (len > 10000) {
      counter.innerHTML = `<span style="color: #f59e0b; font-weight: 600;">${len.toLocaleString()} caracteres ⚠️ (Atenção: excede o limite de 10.000 do navegador)</span>`;
    } else {
      counter.textContent = `${len.toLocaleString()} caracteres (<= 10.000 OK)`;
    }
  }
});

$('#wf-apply-direct-script-btn')?.addEventListener('click', async () => {
  const scriptText = $('#wf-direct-script-input')?.value?.trim();
  const topic = $('#wf-script-topic')?.value?.trim() || 'Roteiro Total Externo';
  if (!scriptText) {
    showToast('Cole o texto do roteiro antes de aplicar.', 'warning');
    $('#wf-direct-script-input')?.focus();
    return;
  }

  try {
    $('#loading')?.classList.add('active');
    // Limpar saídas residuais de vídeos anteriores (prompts, thumbs, seo, upload)
    clearDownstreamProductionData();
    const res = await mutate('/api/workflow/split-script', 'POST', { scriptText });
    const blocks = res.blocks || [];

    wfState.script = {
      topic,
      hook: $('#wf-script-angle')?.value?.trim() || scriptText.slice(0, 150) + '...',
      fullScript: scriptText,
      totalCharacters: scriptText.length,
      part1Chars: blocks[0]?.charCount || 0,
      part2Chars: blocks[1]?.charCount || 0,
      officialBible: 'Bibbia CEI 2008 (Construído Externamente)',
      hookType: 'Roteiro Total Externo',
      narrationBlocks: blocks
    };

    renderWorkflowScript(wfState.script);
    renderNarrationBlocks(blocks);
    scheduleAutoSaveDraft(100);

    $('#wf-direct-script-drawer')?.classList.add('hidden');
    const label = $('#wf-direct-script-label');
    const icon = $('#wf-direct-script-icon');
    if (icon) icon.textContent = '📋';
    if (label) label.textContent = 'Já possui o roteiro total pronto gerado por fora? Colar aqui';

    const panel = $('#wf-step-3-panel') || $('#wf-narration-blocks-container');
    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Roteiro pronto carregado (${scriptText.length.toLocaleString()} carac.)! Blocos de narração disponíveis para cópia.`, 'success');
  } catch (err) {
    showToast(`Erro ao processar roteiro: ${err.message}`, 'error');
  } finally {
    $('#loading')?.classList.remove('active');
  }
});

// Etapa 2: Gerar Roteiro Estruturado (Meta: 10.000 Caracteres)
$('#wf-generate-script-btn')?.addEventListener('click', async () => {
  const btn = $('#wf-generate-script-btn');
  const topic = $('#wf-script-topic')?.value?.trim();
  const authorAngle = $('#wf-script-author-angle')?.value?.trim() || '';
  const channelPosition = $('#wf-script-channel-pos')?.value?.trim() || '';
  const leaveOut = $('#wf-script-leave-out')?.value?.trim() || '';
  const hookType = $('#wf-script-hook-type')?.value || '';
  const angleFamily = $('#wf-script-angle-family')?.value || '';
  const format = $('#wf-script-format')?.value || 'explainer';
  const language = $('#wf-target-language')?.value || 'it-IT';
  const fieldAHistory = $('#wf-field-a')?.value || '';

  if (!topic) {
    showToast('Informe o tema do roteiro primeiro.', 'error');
    $('#wf-script-topic')?.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = '⚡ Escrevendo roteiro denso de 10.000 caracteres (14 blocos)...';
  $('#loading').classList.add('active');

  try {
    // Limpar saídas residuais de vídeos anteriores (prompts, thumbs, seo, upload)
    clearDownstreamProductionData();
    const res = await mutate('/api/workflow/generate-script', 'POST', {
      topic,
      authorAngle,
      channelPosition,
      leaveOut,
      hookType,
      angleFamily,
      format,
      language,
      fieldAHistory
    }, 'Roteiro de 10.000 caracteres gerado e fatiado em blocos com sucesso!');

    if (res.result) {
      wfState.script = res.result;

      // Atualizar automaticamente o Campo A com o gancho registrado para as próximas gerações
      if (res.result.hookRegisterBlock) {
        const fieldA = $('#wf-field-a');
        if (fieldA) {
          fieldA.value = res.result.hookRegisterBlock;
          const label = $('#wf-field-a-btn-label');
          const icon = $('#wf-field-a-btn-icon');
          if (label) label.textContent = `Histórico Salvo Automático (${res.result.hookRegisterBlock.length} carac.) · Editar`;
          if (icon) icon.textContent = '✓';
        }
      }

      renderWorkflowScript(res.result);
      renderNarrationBlocks(res.result.narrationBlocks || []);
      scheduleAutoSaveDraft(100);
    }
  } catch (err) {
    showToast(`Erro ao gerar roteiro: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Gerar Roteiro Completo de 10.000 Caracteres';
    $('#loading').classList.remove('active');
  }
});

function renderWorkflowScript(script) {
  const output = $('#wf-script-output');
  if (!output) return;

  $('#wf-out-hook').textContent = script.hook || '';
  $('#wf-out-pinned').textContent = script.pinnedCommentQuestion || '';
  if ($('#wf-out-hook-register')) {
    $('#wf-out-hook-register').textContent = script.hookRegisterBlock || '';
  }
  if ($('#wf-out-full-script-text')) {
    $('#wf-out-full-script-text').textContent = script.fullScript || '';
  }

  // Ocultar card de pergunta fixada se estiver vazio para evitar caixas pretas sem conteúdo
  const pinnedCard = $('#wf-script-pinned-card');
  if (pinnedCard) {
    pinnedCard.style.display = script.pinnedCommentQuestion?.trim() ? 'block' : 'none';
  }

  // Medição real e rigorosa de caracteres (meta cravada: 10.000 caracteres)
  const part1Len = script.part1Chars || (script.part1 || '').length;
  const part2Len = script.part2Chars || (script.part2 || '').length;
  const totalLen = script.totalCharacters || (part1Len + part2Len);

  if ($('#wf-badge-part1')) {
    $('#wf-badge-part1').innerHTML = `Bloco 1: <strong>${part1Len.toLocaleString()}</strong> carac.`;
    $('#wf-badge-part1').style.display = part1Len > 0 ? 'inline-flex' : 'none';
  }
  if ($('#wf-badge-part2')) {
    $('#wf-badge-part2').innerHTML = `Bloco 2: <strong>${part2Len.toLocaleString()}</strong> carac.`;
    $('#wf-badge-part2').style.display = part2Len > 0 ? 'inline-flex' : 'none';
  }
  if ($('#wf-badge-total')) {
    const isOver10k = totalLen > 10000;
    const isGood = totalLen >= 9000 && totalLen <= 10000;
    if (isOver10k) {
      $('#wf-badge-total').className = 'meta-badge warning';
      $('#wf-badge-total').style.borderColor = 'rgba(245, 158, 11, 0.4)';
      $('#wf-badge-total').style.color = '#f59e0b';
      $('#wf-badge-total').innerHTML = `Total: <strong>${totalLen.toLocaleString()}</strong> carac. ⚠️ (Excede teto de 10.000 do navegador!)`;
    } else if (isGood) {
      $('#wf-badge-total').className = 'meta-badge success';
      $('#wf-badge-total').style.borderColor = '';
      $('#wf-badge-total').style.color = '';
      $('#wf-badge-total').innerHTML = `Total: <strong>${totalLen.toLocaleString()}</strong> carac. ✅ (Meta Cravada: 9k-10k)`;
    } else {
      $('#wf-badge-total').className = 'meta-badge';
      $('#wf-badge-total').style.borderColor = '';
      $('#wf-badge-total').style.color = '';
      $('#wf-badge-total').innerHTML = `Total: <strong>${totalLen.toLocaleString()}</strong> carac. (Abaixo da meta de 10k)`;
    }
  }
  if ($('#wf-badge-bible')) $('#wf-badge-bible').textContent = script.officialBible || '🇮🇹 Bibbia CEI 2008';
  if ($('#wf-badge-hook-type')) $('#wf-badge-hook-type').textContent = script.hookType || 'Tipo de Gancho 1';

  output.classList.remove('hidden');
  output.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Drawer de Inspecionar Registro de Gancho (Guia Colapsável na Etapa 2)
$('#wf-toggle-hook-register-btn')?.addEventListener('click', () => {
  const container = $('#wf-hook-register-container');
  const icon = $('#wf-hook-register-icon');
  const label = $('#wf-hook-register-label');
  if (!container) return;

  const isHidden = container.classList.toggle('hidden');
  if (icon) icon.textContent = isHidden ? '⚙️' : '✕';
  if (label) label.textContent = isHidden ? 'Registro' : 'Recolher';
});

$('#wf-close-hook-register-btn')?.addEventListener('click', () => {
  $('#wf-hook-register-container')?.classList.add('hidden');
  const icon = $('#wf-hook-register-icon');
  const label = $('#wf-hook-register-label');
  if (icon) icon.textContent = '⚙️';
  if (label) label.textContent = 'Registro';
});

// Drawer de Roteiro Completo Unificado
$('#wf-toggle-full-script-preview-btn')?.addEventListener('click', () => {
  $('#wf-full-script-preview-container')?.classList.toggle('hidden');
});

$('#wf-close-full-script-preview-btn')?.addEventListener('click', () => {
  $('#wf-full-script-preview-container')?.classList.add('hidden');
});

// Botão de salto direto para a Etapa 3 (Narração)
$('#wf-jump-to-narration-btn')?.addEventListener('click', () => {
  const panel = $('#wf-step-3-panel');
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

// Copiar roteiro completo (Etapa 2)
$('#wf-copy-full-script-btn')?.addEventListener('click', (e) => {
  if (wfState.script?.fullScript) {
    copyToClipboard(wfState.script.fullScript, e.target);
  }
});

// ====================================================
// Higienização de Narração para IA / TTS
// ====================================================
/**
 * Higieniza o texto de narração para motores de IA / TTS (ElevenLabs, etc.):
 * - Remove quebras de linha e espaçamentos vazios, transformando em texto contínuo, direto e único
 * - Remove caracteres invisíveis / zero-width (\u200B-\u200D, \uFEFF)
 * - Remove aspas duplas e curvas (" “ ” « ») que quebram a leitura ou delimitadores de IA
 * - Normaliza apóstrofos tipográficos para apóstrofo reto simples (') preservando elisões fonéticas (ex: l'imperatore, dell'Apocalisse)
 * - Converte travessões longos (— –) em vírgula para fluidez natural da fala
 * - Remove marcadores de markdown (* _ # ~ [ ] { })
 * - Normaliza espaçamentos e pontuações
 */
function cleanNarrationForTTS(str) {
  if (!str) return '';
  let s = String(str)
    // Caracteres invisíveis / zero-width
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Remover aspas duplas e curvas
    .replace(/["“”«»]/g, '')
    // Normalizar apóstrofos para reto simples (')
    .replace(/[’‘`]/g, "'")
    // Converter travessões longos para vírgula
    .replace(/[—–]/g, ', ')
    // Remover marcadores markdown
    .replace(/[*_#~\[\]{}]/g, '')
    // Substituir todas as quebras de linha (\r\n, \r, \n) por espaço simples
    .replace(/\r\n|\r|\n/g, ' ')
    // Colapsar múltiplos espaços
    .replace(/\s+/g, ' ')
    .trim();

  // Ajustar pontuação: sem espaço antes de pontuação
  s = s.replace(/\s+([.,;:?!])/g, '$1');
  // Garantir espaço após pontuação se seguido de letra ou número
  s = s.replace(/([.,;:?!])([a-zA-ZÀ-ÿ0-9])/g, '$1 $2');

  return s.trim();
}

/**
 * Estima a duração de fala (média de ~140 palavras por minuto)
 */
function estimateSpeechDuration(text) {
  if (!text) return '0 min';
  const words = text.split(/\s+/).filter(Boolean).length;
  const minutes = (words / 140).toFixed(1);
  return `~${minutes} min`;
}

/**
 * Garante rigorosamente que o texto fique dentro do limite de 10.000 caracteres do navegador,
 * cortando na última frase completa (. ! ?) para nunca truncar palavras ou sentido no meio.
 */
function enforceMax10kChars(text, maxChars = 10000) {
  if (!text || text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastDot = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  if (lastDot > 8000) {
    return slice.slice(0, lastDot + 1).trim();
  }
  return slice.trim();
}

// Cópia geral do roteiro contínuo sem separação (Etapa 3 · Narração)
function copyFullNarrationScript(triggerBtn) {
  let fullText = wfState.script?.fullScript;
  if (!fullText && Array.isArray(wfState.script?.narrationBlocks) && wfState.script.narrationBlocks.length) {
    fullText = wfState.script.narrationBlocks.map(b => b.text).join(' ');
  }
  if (!fullText) {
    const textEls = document.querySelectorAll('.narration-text-area');
    if (textEls.length) {
      fullText = Array.from(textEls).map(el => el.textContent.trim()).join(' ');
    }
  }

  if (!fullText || !fullText.trim()) {
    showToast('Nenhum roteiro disponível para cópia no momento.', 'warning');
    return;
  }

  const cleanFull = cleanNarrationForTTS(fullText);
  // Trava rigorosa: garante que NUNCA passe de 10.000 caracteres (limite do navegador)
  const safeText = enforceMax10kChars(cleanFull, 10000);
  copyToClipboard(safeText, triggerBtn);
  const est = estimateSpeechDuration(safeText);

  if (cleanFull.length > 10000) {
    showToast(`📋 Roteiro Geral copiado (${safeText.length.toLocaleString()} carac. · ${est})! Ajustado com segurança para o teto de 10.000 do navegador, sem quebras e sem caracteres especiais.`, 'success');
  } else {
    showToast(`📋 Roteiro Geral corrido copiado (${safeText.length.toLocaleString()} carac. · ${est})! Texto único contínuo dentro do limite de 10.000 e sem caracteres especiais.`, 'success');
  }
}

$('#wf-copy-all-narration-btn')?.addEventListener('click', (e) => copyFullNarrationScript(e.target));

// Listener dedicado para cópia de blocos individuais de narração com higienização de voz TTS
document.addEventListener('click', (e) => {
  const nBtn = e.target.closest('.narration-block-copy-btn');
  if (nBtn && nBtn.dataset.target) {
    const targetEl = document.getElementById(nBtn.dataset.target);
    if (targetEl) {
      const cleanText = cleanNarrationForTTS(targetEl.textContent || targetEl.innerText);
      copyToClipboard(cleanText, nBtn);
      const idx = nBtn.dataset.blockIdx || '';
      const est = nBtn.dataset.est || '';
      showToast(`📋 Bloco ${idx} copiado (${cleanText.length.toLocaleString()} carac. · ${est})! Texto corrido e livre de caracteres especiais.`, 'success');
    }
    return;
  }
});

// Etapa 3: Fatiamento em blocos de narração (até 5.000 caracteres cada)
function renderNarrationBlocks(blocks) {
  const container = $('#wf-narration-blocks-container');
  const totalBadge = $('#wf-narration-total-badge');
  const headerBtn = $('#wf-copy-all-narration-btn');
  const ttsBanner = $('#wf-narration-tts-banner');
  if (!container) return;

  const validBlocks = (blocks || []).filter(b => (b.charCount > 0 || (b.text && b.text.trim().length > 0)));

  if (!validBlocks.length) {
    container.innerHTML = '<p class="placeholder-text">Nenhum bloco de narração disponível.</p>';
    if (totalBadge) totalBadge.style.display = 'none';
    if (headerBtn) headerBtn.style.display = 'none';
    if (ttsBanner) ttsBanner.style.display = 'none';
    return;
  }

  // Higienizar blocos para texto corrido
  const cleanedBlocks = validBlocks.map(b => {
    const cleanedText = cleanNarrationForTTS(b.text);
    return {
      ...b,
      text: cleanedText,
      charCount: cleanedText.length,
      estTime: estimateSpeechDuration(cleanedText)
    };
  });

  const totalChars = cleanedBlocks.reduce((acc, b) => acc + b.charCount, 0);
  const totalWords = cleanedBlocks.reduce((acc, b) => acc + b.text.split(/\s+/).filter(Boolean).length, 0);
  const totalEstTime = `~${(totalWords / 140).toFixed(1)} min`;

  if (totalBadge) {
    if (totalChars > 10000) {
      totalBadge.textContent = `📜 Total: ${totalChars.toLocaleString()} carac. · ${totalEstTime} ⚠️ (> 10k)`;
      totalBadge.style.color = '#f59e0b';
      totalBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      totalBadge.style.background = 'rgba(245, 158, 11, 0.12)';
    } else {
      totalBadge.textContent = `📜 Total: ${totalChars.toLocaleString()} carac. · ${totalEstTime} (<= 10k OK)`;
      totalBadge.style.color = '#10b981';
      totalBadge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
      totalBadge.style.background = 'rgba(16, 185, 129, 0.12)';
    }
    totalBadge.style.display = 'inline-flex';
  }
  if (headerBtn) {
    headerBtn.style.display = 'inline-flex';
    headerBtn.textContent = '📋 Copiar Roteiro Geral Corrido (Max 10.000 carac.)';
    headerBtn.title = 'Copia o roteiro contínuo higienizado garantindo rigorosamente até 10.000 caracteres para o seu navegador';
  }
  if (ttsBanner) {
    ttsBanner.style.display = 'flex';
  }

  container.innerHTML = cleanedBlocks.map(b => `
    <div class="narration-block-card">
      <div class="narration-block-top">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="narration-block-title">${escapeHTML(b.title || `Bloco ${b.index}`)}</span>
          <span style="font-size: 11px; color: #10b981; font-weight: 600;">⏱️ ${b.estTime}</span>
        </div>
        <span class="narration-block-badge">${b.charCount.toLocaleString()} caracteres</span>
      </div>
      <div class="narration-text-area narration-clean-text" id="wf-narration-text-${b.index}">${escapeHTML(b.text)}</div>
      <div style="margin-top: 10px;">
        <button type="button" class="button primary small narration-block-copy-btn" data-target="wf-narration-text-${b.index}" data-block-idx="${b.index}" data-est="${b.estTime}">
          📋 Copiar Bloco ${b.index} Corrido (${b.charCount.toLocaleString()} carac. · ${b.estTime})
        </button>
      </div>
    </div>
  `).join('');
}

// Etapa 4: 35 Prompts em Inglês para Google Flow
$('#wf-generate-google-flow-btn')?.addEventListener('click', async () => {
  const btn = $('#wf-generate-google-flow-btn');
  const topic = $('#wf-script-topic')?.value || '';

  if (!wfState.script && !topic) {
    showToast('Gere o roteiro primeiro ou informe o tema.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '🎨 Gerando 35 prompts em inglês...';
  $('#loading').classList.add('active');

  try {
    const res = await mutate('/api/workflow/generate-google-flow-prompts', 'POST', {
      script: wfState.script,
      topic,
      count: 35
    }, '35 prompts em inglês gerados para o Google Flow!');

    if (res.prompts) {
      wfState.googleFlowPrompts = res.prompts;
      renderGoogleFlowPrompts(res.prompts);
      scheduleAutoSaveDraft(100);
    }
  } catch (err) {
    showToast(`Erro ao gerar prompts: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🎨 Gerar 35 Prompts Google Flow';
    $('#loading').classList.remove('active');
  }
});

// Funções auxiliares para os 35 Prompts do Google Flow (sem numeração e separados por linhas em branco)
function cleanGoogleFlowPrompt(text) {
  if (!text) return '';
  let clean = String(text).trim();
  // Remove prefixos como "1.", "1 -", "1: ", "1)", "Prompt 1:", "Prompt 01 -", "#1: ", etc.
  clean = clean.replace(/^(?:prompt\s*\d+[:.-]?|#?\d+[-.):]\s*|\d+[-.):]\s*)/i, '').trim();
  return clean;
}

function getCleanGoogleFlowPromptsText(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) return '';
  return prompts
    .map(p => {
      const raw = typeof p === 'string' ? p : (p.prompt || '');
      return cleanGoogleFlowPrompt(raw);
    })
    .filter(Boolean)
    .join('\n\n');
}

function renderGoogleFlowPrompts(prompts) {
  const container = $('#wf-google-flow-container');
  if (!container) return;

  container.classList.remove('hidden');
  const countBadge = $('#wf-google-flow-count');
  if (countBadge) countBadge.textContent = `${prompts.length} Prompts Gerados`;

  // Prepara a lista dentro do modal pop-up para visualização despoluída
  renderGoogleFlowModalList(prompts);
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderGoogleFlowModalList(prompts) {
  const list = $('#wf-modal-google-flow-list');
  const badge = $('#wf-modal-google-flow-badge');
  if (badge) badge.textContent = `${prompts.length} Prompts Prontos`;
  if (!list) return;

  list.innerHTML = prompts.map((p, idx) => {
    const raw = typeof p === 'string' ? p : (p.prompt || '');
    const cleanPrompt = cleanGoogleFlowPrompt(raw);
    const sceneNum = p.index || (idx + 1);

    return `
      <div class="prompt-modal-item" style="background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span style="font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-family: var(--font-mono);">
            Cena ${String(sceneNum).padStart(2, '0')} / ${prompts.length}
          </span>
          <button type="button" class="button ghost small copy-gf-item-btn" data-clean-prompt="${escapeHTML(cleanPrompt)}" style="padding: 4px 10px; font-size: 11.5px;">
            📋 Copiar Prompt
          </button>
        </div>
        <div style="font-size: 13px; line-height: 1.55; color: var(--text); background: rgba(0, 0, 0, 0.25); padding: 10px 12px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.05); font-family: var(--font-mono); word-break: break-word;">
          ${escapeHTML(cleanPrompt)}
        </div>
      </div>
    `;
  }).join('');

  // Ativa listeners de cópia individual no modal
  list.querySelectorAll('.copy-gf-item-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const text = btn.getAttribute('data-clean-prompt') || '';
      copyToClipboard(text, e.currentTarget);
      showToast('Prompt individual copiado sem numeração!', 'success');
    });
  });
}

// Abrir pop-up dos 35 prompts (para não poluir a tela do gerador)
$('#wf-open-google-flow-modal-btn')?.addEventListener('click', () => {
  if (!wfState.googleFlowPrompts || wfState.googleFlowPrompts.length === 0) {
    showToast('Gere os 35 prompts do Google Flow primeiro.', 'warning');
    return;
  }
  renderGoogleFlowModalList(wfState.googleFlowPrompts);
  const dialog = $('#wf-google-flow-dialog');
  dialog?.showModal();
});

// Copiar todos os 35 prompts sem numeração, separados por linha em branco (botão no gerador)
$('#wf-copy-all-google-flow-btn')?.addEventListener('click', (e) => {
  if (wfState.googleFlowPrompts && wfState.googleFlowPrompts.length > 0) {
    const textAll = getCleanGoogleFlowPromptsText(wfState.googleFlowPrompts);
    copyToClipboard(textAll, e.currentTarget);
    showToast('35 prompts copiados! (Sem numeração, separados por linha em branco)', 'success');
  } else {
    showToast('Nenhum prompt disponível para copiar.', 'warning');
  }
});

// Copiar todos os 35 prompts sem numeração, separados por linha em branco (botão dentro do modal)
$('#wf-modal-copy-all-btn')?.addEventListener('click', (e) => {
  if (wfState.googleFlowPrompts && wfState.googleFlowPrompts.length > 0) {
    const textAll = getCleanGoogleFlowPromptsText(wfState.googleFlowPrompts);
    copyToClipboard(textAll, e.currentTarget);
    showToast('35 prompts copiados! (Sem numeração, separados por linha em branco)', 'success');
  } else {
    showToast('Nenhum prompt disponível para copiar.', 'warning');
  }
});

// Etapa 5: Thumbnail para Nano Banana (Seletor de quantidade 1-10, padrão 3)
$('#wf-nb-versions-count')?.addEventListener('change', (e) => {
  const count = parseInt(e.target.value || '3', 10);
  const btn = $('#wf-generate-nano-banana-btn');
  if (btn) btn.textContent = `🖼️ Gerar ${count} Versões Nano Banana`;
});

$('#wf-generate-nano-banana-btn')?.addEventListener('click', async () => {
  const btn = $('#wf-generate-nano-banana-btn');
  const topic = $('#wf-script-topic')?.value || '';
  const countSelect = $('#wf-nb-versions-count');
  let versionsCount = countSelect ? parseInt(countSelect.value || '3', 10) : 3;
  if (isNaN(versionsCount) || versionsCount < 1) versionsCount = 3;
  if (versionsCount > 10) versionsCount = 10;

  btn.disabled = true;
  btn.textContent = `🖼️ Gerando ${versionsCount} versões em inglês...`;
  $('#loading').classList.add('active');

  try {
    const langSelect = $('#wf-language-select');
    const language = langSelect ? langSelect.value : (wfState.language || 'it-IT');
    const res = await mutate('/api/workflow/generate-nano-banana-prompts', 'POST', {
      topic,
      script: wfState.script,
      language,
      versionsCount
    }, `${versionsCount} versões de thumbnail para Nano Banana geradas!`);

    if (res.versions) {
      wfState.nanoBananaPrompts = res.versions;
      renderNanoBananaVersions(res.versions);
      scheduleAutoSaveDraft(100);
    }
  } catch (err) {
    showToast(`Erro ao gerar versões Nano Banana: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = `🖼️ Gerar ${versionsCount} Versões Nano Banana`;
    $('#loading').classList.remove('active');
  }
});

function renderNanoBananaVersions(versions) {
  const container = $('#wf-nano-banana-container');
  const list = $('#wf-nano-banana-list');
  const compactBox = $('#wf-nano-banana-compact-box');
  const compactText = $('#wf-nb-compact-text');
  const countBadge = $('#wf-nano-banana-count');
  if (!container) return;

  const count = versions ? versions.length : 0;
  container.classList.remove('hidden');

  if (countBadge) {
    countBadge.textContent = `${count} Variaç${count === 1 ? 'ão Gerada' : 'ões Geradas'}`;
  }

  // Regra:
  // Se até 3 variações: mostrar as caixas pretas individuais igual à imagem
  // Passou de 3: exibir formato compacto com os prompts em linha e separados por linha em branco
  if (count <= 3) {
    if (list) {
      list.style.display = 'grid';
      list.innerHTML = versions.map(v => `
        <div class="nano-banana-card">
          <div>
            <h4 class="nano-banana-title">${escapeHTML(v.title || `Versão ${v.version}`)}</h4>
            <div class="nano-banana-prompt-box" id="wf-nb-prompt-${v.version}">${escapeHTML(v.promptNanoBanana)}</div>
          </div>
          <div>
            <button type="button" class="button primary small copy-btn" data-target="wf-nb-prompt-${v.version}">
              📋 Copiar Prompt para Nano Banana
            </button>
          </div>
        </div>
      `).join('');
    }
    if (compactBox) {
      compactBox.style.display = 'none';
      compactBox.classList.add('hidden');
    }
  } else {
    // Passou de 3: ocultar os cards pretos individuais e mostrar formato em linha compacto
    if (list) {
      list.style.display = 'none';
      list.innerHTML = '';
    }
    if (compactBox && compactText) {
      compactBox.style.display = 'block';
      compactBox.classList.remove('hidden');
      // Cada prompt é um bloco contínuo e são separados por exatamente 1 linha em branco
      const fullText = versions.map(v => {
        const clean = (v.promptNanoBanana || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('RESULT:')).join('\n');
        return clean;
      }).join('\n\n');
      compactText.textContent = fullText;
    }
  }

  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Botão para copiar todas as variações (cada bloco contínuo, separados por 1 linha em branco)
$('#wf-copy-all-nano-banana-btn')?.addEventListener('click', (e) => {
  if (wfState.nanoBananaPrompts && wfState.nanoBananaPrompts.length > 0) {
    const fullText = wfState.nanoBananaPrompts.map(v => {
      return (v.promptNanoBanana || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('RESULT:')).join('\n');
    }).join('\n\n');
    copyToClipboard(fullText, e.target);
    showToast(`📋 ${wfState.nanoBananaPrompts.length} variações copiadas prontas para lote!`, 'success');
  } else {
    showToast('Nenhuma variação gerada ainda.', 'warning');
  }
});

// Etapa 6: Título, Descrição SEO e 7 Hashtags (sem #)
$('#wf-generate-seo-btn')?.addEventListener('click', async () => {
  const btn = $('#wf-generate-seo-btn');
  const topic = $('#wf-script-topic')?.value || '';
  const language = $('#wf-target-language')?.value || 'it-IT';

  btn.disabled = true;
  btn.textContent = '🚀 Gerando metadados de alto CTR...';
  $('#loading').classList.add('active');

  try {
    const res = await mutate('/api/workflow/generate-seo', 'POST', {
      script: wfState.script,
      topic,
      language
    }, 'Título, descrição e 7 hashtags gerados no idioma ativo!');

    if (res.seo) {
      wfState.seo = res.seo;
      renderWorkflowSEO(res.seo);
      scheduleAutoSaveDraft(100);
    }
  } catch (err) {
    showToast(`Erro ao gerar SEO: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Gerar Título, Descrição e Hashtags';
    $('#loading').classList.remove('active');
  }
});

// Formata e garante espaçamento legível com quebras de linha e timestamps isolados para o YouTube
function formatYouTubeDescriptionSpacing(text) {
  if (!text) return '';
  let str = String(text);

  // 1. Converter quebras literais escapadas '\\n' em quebras reais '\n'
  str = str.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');
  str = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. Garantir que o timestamp inicial 00:00 fique separado por linha em branco do texto anterior
  str = str.replace(/([^\n\r])\s*(00:00\b)/g, '$1\n\n$2');

  // 3. Garantir que cada timestamp (ex: 02:30, 10:30) fique em sua própria linha isolada
  str = str.replace(/([^\n\r:])\s*(\d{1,2}:\d{2}(?::\d{2})?\b)/g, '$1\n$2');

  // 4. Separar bloco de hashtags coladas no texto
  str = str.replace(/([^\n\r#\s])\s*(#[a-zA-Z0-9À-ÿ_]+)/g, '$1\n\n$2');

  // 5. Normalizar quebras de linha múltiplas para no máximo 2
  str = str.replace(/\n{3,}/g, '\n\n');

  return str.trim();
}

function renderWorkflowSEO(seo) {
  const container = $('#wf-seo-container');
  if (!container) return;

  const formattedDesc = formatYouTubeDescriptionSpacing(seo.description || '');
  $('#wf-out-title').textContent = seo.title || '';
  $('#wf-out-desc').textContent = formattedDesc;
  const hashtagsArray = Array.isArray(seo.hashtags) ? seo.hashtags : [];
  $('#wf-out-hashtags').textContent = seo.hashtagsString || hashtagsArray.join(', ');

  container.classList.remove('hidden');
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Etapa 7: RESUMO PARA O PRÓXIMO ROTEIRO
$('#wf-build-summary-btn')?.addEventListener('click', async () => {
  const usedHooks = wfState.script?.hook ? `Gancho de abertura: "${wfState.script.hook.slice(0, 120)}..."` : 'Gancho padrão de quebra mecânica súbita';
  const forbiddenType = 'Não repetir mesmo padrão de gancho nem mesma fórmula de início da Parte 1';
  const previousSignatures = $('#wf-script-topic')?.value || 'Vídeo anterior concluído com sucesso';
  const thumbnailVersion = 'Versão 1 (Close-up de Alto Impacto)';
  const topic = $('#wf-script-topic')?.value || '';

  try {
    const res = await mutate('/api/workflow/save-summary', 'POST', {
      usedHooks,
      forbiddenType,
      previousSignatures,
      thumbnailVersion,
      topic
    }, 'Resumo para o próximo roteiro gerado e salvo!');

    if (res.summary) {
      wfState.summary = res.summary;
      $('#wf-summary-text').textContent = res.summary.summaryText || '';
    }
  } catch (err) {
    showToast(`Erro ao salvar resumo: ${err.message}`, 'error');
  }
});

$('#wf-copy-summary-btn')?.addEventListener('click', (e) => {
  const summaryBox = $('#wf-summary-text');
  if (summaryBox) {
    copyToClipboard(summaryBox.textContent || summaryBox.innerText, e.target);
  }
});

// ==========================================================================
// Etapa 8: Agendamento no YouTube (Explorer, Capa e Metadados Completos)
// ==========================================================================

// Helper para formatar tamanho de arquivos
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Upload de arquivo binário para o servidor local (/api/workflow/upload-file)
async function uploadWorkflowAsset(file) {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name);
  const loadingText = isVideo ? 'Enviando vídeo para o estúdio local...' : 'Carregando miniatura...';
  
  showToast(loadingText, 'info');
  $('#loading').classList.add('active');
  const headers = {
    'x-file-name': encodeURIComponent(file.name),
    'content-type': file.type || 'application/octet-stream'
  };

  try {
    const res = await fetch('/api/workflow/upload-file', {
      method: 'POST',
      body: file,
      headers
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Falha no upload do arquivo');
    }
    return data;
  } finally {
    $('#loading').classList.remove('active');
  }
}

// 1. Controle do Arquivo de Vídeo (.mp4)
const videoDropZone = $('#wf-video-drop-zone');
const videoFileInput = $('#wf-video-file-input');
const chooseVideoBtn = $('#wf-choose-video-btn');
const removeVideoBtn = $('#wf-remove-video-btn');
const toggleManualPathBtn = $('#wf-toggle-manual-path-btn');
const manualPathContainer = $('#wf-manual-path-container');
const uploadPathInput = $('#wf-upload-path');
const videoDropContent = $('#wf-video-drop-content');
const videoSelectedBox = $('#wf-video-selected-box');
const videoNameLabel = $('#wf-video-name');
const videoSizeLabel = $('#wf-video-size');

chooseVideoBtn?.addEventListener('click', () => videoFileInput?.click());

// Drag and Drop para vídeo
if (videoDropZone) {
  videoDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    videoDropZone.classList.add('dragover');
  });
  videoDropZone.addEventListener('dragleave', () => {
    videoDropZone.classList.remove('dragover');
  });
  videoDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    videoDropZone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) {
      handleSelectedVideoFile(e.dataTransfer.files[0]);
    }
  });
}

videoFileInput?.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    handleSelectedVideoFile(e.target.files[0]);
  }
});

async function handleSelectedVideoFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|avi|mkv|webm)$/i.test(file.name)) {
    showToast('Por favor, selecione um arquivo de vídeo válido (.mp4).', 'error');
    return;
  }

  showToast(`Carregando vídeo: "${file.name}" (${formatFileSize(file.size)})...`, 'info');
  try {
    const uploadResult = await uploadWorkflowAsset(file);
    if (uploadPathInput) uploadPathInput.value = uploadResult.filePath;
    
    if (videoNameLabel) videoNameLabel.textContent = file.name;
    if (videoSizeLabel) videoSizeLabel.textContent = formatFileSize(file.size);
    
    videoDropContent?.classList.add('hidden');
    videoSelectedBox?.classList.remove('hidden');
    showToast('✓ Vídeo pronto para agendamento!', 'success');
  } catch (err) {
    showToast(`Erro ao carregar vídeo: ${err.message}`, 'error');
  }
}

removeVideoBtn?.addEventListener('click', () => {
  if (videoFileInput) videoFileInput.value = '';
  if (uploadPathInput) uploadPathInput.value = '';
  videoSelectedBox?.classList.add('hidden');
  videoDropContent?.classList.remove('hidden');
});

toggleManualPathBtn?.addEventListener('click', () => {
  manualPathContainer?.classList.toggle('hidden');
});

// 2. Controle da Miniatura / Capa (Thumbnail)
const chooseThumbBtn = $('#wf-choose-thumb-file-btn');
const thumbFileInput = $('#wf-thumb-file-input');
const thumbPathInput = $('#wf-upload-thumbnail-path');
const thumbImgPreview = $('#wf-thumb-img-preview');
const thumbPlaceholder = $('#wf-thumb-placeholder');
const removeThumbBtn = $('#wf-remove-thumb-btn');
const useGeneratedThumbBtn = $('#wf-use-generated-thumb-btn');
const thumbStatusMsg = $('#wf-thumb-status-msg');

chooseThumbBtn?.addEventListener('click', () => thumbFileInput?.click());

thumbFileInput?.addEventListener('change', async (e) => {
  if (e.target.files && e.target.files.length > 0) {
    const file = e.target.files[0];
    if (!file.type.startsWith('image/')) {
      showToast('Por favor, selecione uma imagem válida (.png, .jpg, .webp).', 'error');
      return;
    }

    // Prévia instantânea na tela
    const localUrl = URL.createObjectURL(file);
    if (thumbImgPreview) {
      thumbImgPreview.src = localUrl;
      thumbImgPreview.style.width = '240px';
      thumbImgPreview.style.height = '135px';
      thumbImgPreview.style.maxWidth = '240px';
      thumbImgPreview.style.maxHeight = '135px';
      thumbImgPreview.style.objectFit = 'cover';
      thumbImgPreview.style.display = 'block';
      thumbImgPreview.classList.remove('hidden');
    }
    thumbPlaceholder?.classList.add('hidden');
    removeThumbBtn?.classList.remove('hidden');

    try {
      showToast('Enviando imagem de capa...', 'info');
      const uploadResult = await uploadWorkflowAsset(file);
      if (thumbPathInput) thumbPathInput.value = uploadResult.filePath;
      if (thumbStatusMsg) {
        thumbStatusMsg.innerHTML = `<span style="color: var(--green);">✓ Capa anexada:</span> <strong>${escapeHTML(file.name)}</strong> (${formatFileSize(file.size)})`;
      }
      showToast('✓ Miniatura de capa definida!', 'success');
    } catch (err) {
      showToast(`Erro ao carregar capa: ${err.message}`, 'error');
    }
  }
});

removeThumbBtn?.addEventListener('click', () => {
  if (thumbFileInput) thumbFileInput.value = '';
  if (thumbPathInput) thumbPathInput.value = '';
  if (thumbImgPreview) {
    thumbImgPreview.src = '';
    thumbImgPreview.classList.add('hidden');
  }
  if (thumbPlaceholder) {
    thumbPlaceholder.classList.remove('hidden');
    thumbPlaceholder.innerHTML = `
      <span style="font-size: 26px;">🖼️</span>
      <p style="margin: 4px 0 2px 0; font-size: 12px; font-weight: 600; color: var(--text);">Sem capa anexada</p>
      <small style="color: var(--muted); font-size: 10px;">Miniatura (16:9)</small>
    `;
  }
  removeThumbBtn?.classList.add('hidden');
  if (thumbStatusMsg) thumbStatusMsg.textContent = '';
});

// Modo Corte / Short (Ignorar Capa Personalizada e usar Frame Automático do YouTube)
$('#wf-corte-no-thumb-btn')?.addEventListener('click', () => {
  if (thumbFileInput) thumbFileInput.value = '';
  if (thumbPathInput) thumbPathInput.value = '';
  if (thumbImgPreview) {
    thumbImgPreview.src = '';
    thumbImgPreview.classList.add('hidden');
  }
  removeThumbBtn?.classList.remove('hidden');
  if (thumbPlaceholder) {
    thumbPlaceholder.classList.remove('hidden');
    thumbPlaceholder.innerHTML = `
      <span style="font-size: 26px;">✂️</span>
      <p style="margin: 4px 0 2px 0; font-size: 12px; font-weight: 700; color: #6ee7b7;">Corte / Short (Sem Capa)</p>
      <small style="color: var(--text-2); font-size: 10px;">Frame automático do YouTube</small>
    `;
  }
  if (thumbStatusMsg) {
    thumbStatusMsg.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 6px 10px; color: #a7f3d0; font-size: 12px;">
        ✓ <strong>Modo Corte / Short Ativo:</strong> Nenhuma miniatura será enviada. O YouTube usará automaticamente o frame do vídeo como capa padrão.
      </div>
    `;
  }
  showToast('✂️ Modo Corte/Short definido: o YouTube gerará a capa automaticamente!', 'info');
});

// Usar Capa gerada no Nano Banana
useGeneratedThumbBtn?.addEventListener('click', () => {
  if (wfState.nanoBananaPrompts && wfState.nanoBananaPrompts.length > 0) {
    const v1 = wfState.nanoBananaPrompts[0];
    if (thumbStatusMsg) {
      thumbStatusMsg.innerHTML = `
        <div style="background: rgba(255, 77, 94, 0.08); padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255, 77, 94, 0.2);">
          <strong>✨ Versão do Nano Banana Selecionada:</strong> ${escapeHTML(v1.title || 'Versão 1')}<br>
          <small style="color: var(--text-2);">Gere ou salve a arte final no Nano Banana e selecione o arquivo com o botão 'Buscar Imagem no Explorer'.</small>
        </div>
      `;
    }
    showToast('Prompt do Nano Banana referenciado para a capa!', 'info');
  } else {
    showToast('Nenhuma versão de thumbnail gerada na Etapa 5 ainda.', 'warning');
  }
});

// 3. Contadores de Caracteres em Tempo Real
const titleInput = $('#wf-upload-title');
const descInput = $('#wf-upload-description');
const titleCharCounter = $('#wf-title-char-count');
const descCharCounter = $('#wf-desc-char-count');

function updateTitleCharCounter() {
  if (!titleInput || !titleCharCounter) return;
  const len = titleInput.value.length;
  titleCharCounter.textContent = `${len} / 100`;
  titleCharCounter.className = 'char-counter';
  if (len > 90) titleCharCounter.classList.add('limit-reached');
  else if (len > 70) titleCharCounter.classList.add('limit-near');
}

function updateDescCharCounter() {
  if (!descInput || !descCharCounter) return;
  const len = descInput.value.length;
  descCharCounter.textContent = `${len} / 5000`;
  descCharCounter.className = 'char-counter';
  if (len > 4800) descCharCounter.classList.add('limit-reached');
}

titleInput?.addEventListener('input', updateTitleCharCounter);
descInput?.addEventListener('input', updateDescCharCounter);

// 4. Sincronização Automática com Etapa 6 (SEO) e Etapas Anteriores
function pullSEODataIntoSchedule() {
  let pulledCount = 0;
  
  // Título
  const currentTitle = wfState.seo?.title || $('#wf-script-topic')?.value?.trim();
  if (currentTitle && titleInput) {
    titleInput.value = currentTitle;
    updateTitleCharCounter();
    pulledCount++;
  }

  // Descrição com espaçamento e quebras de linha garantidas
  const currentDesc = wfState.seo?.description;
  if (currentDesc && descInput) {
    descInput.value = formatYouTubeDescriptionSpacing(currentDesc);
    updateDescCharCounter();
    pulledCount++;
  }

  // Tags (extrair das hashtags da etapa 6 ou tags)
  const currentTags = wfState.seo?.tags || wfState.seo?.hashtags;
  const tagsInput = $('#wf-upload-tags');
  if (currentTags && tagsInput) {
    const cleanTags = Array.isArray(currentTags)
      ? currentTags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean).join(', ')
      : String(currentTags).replace(/#/g, '');
    tagsInput.value = cleanTags;
    pulledCount++;
  }

  // Data sugerida: Se houver tema planejado com data/horário memorizado, usar diretamente!
  const timeInput = $('#wf-upload-time');
  if (timeInput) {
    if (wfState.scheduledDate) {
      const timePart = wfState.scheduledTime ? wfState.scheduledTime.slice(0, 5) : '18:00';
      timeInput.value = `${wfState.scheduledDate}T${timePart}`;
    } else if (!timeInput.value) {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + 1);
      nextDate.setHours(18, 0, 0, 0);
      const localIso = new Date(nextDate.getTime() - nextDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      timeInput.value = localIso;
    }
  }

  if (pulledCount > 0) {
    showToast('⚡ Título, descrição espaçada e tags preenchidos com os dados do SEO!', 'success');
  } else {
    showToast('Gere o roteiro e o SEO nas etapas anteriores para preenchimento automático.', 'warning');
  }
}

$('#wf-sync-from-workflow-btn')?.addEventListener('click', pullSEODataIntoSchedule);
$('#wf-pull-seo-btn')?.addEventListener('click', pullSEODataIntoSchedule);

// Botão para organizar espaçamentos da descrição no formulário de upload
$('#wf-format-desc-spacing-btn')?.addEventListener('click', () => {
  if (!descInput || !descInput.value.trim()) {
    showToast('A descrição está vazia.', 'warning');
    return;
  }
  const formatted = formatYouTubeDescriptionSpacing(descInput.value);
  descInput.value = formatted;
  updateDescCharCounter();
  showToast('Espaçamentos e timestamps organizados com sucesso!', 'success');
});

// ========================================================
// Pop-up / Modal: Colar e Importar Metadados Externos (Gemini / ChatGPT)
// ========================================================

function parseExternalMetadataText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { title: '', description: '', tags: [] };
  }
  
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  let title = '';
  let description = '';
  let tags = [];

  // 0. Suporte caso o retorno venha formatado em JSON (ex: { "titulo": "...", "descricao": "...", ... })
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj && (obj.titulo || obj.title || obj.tema || obj.descricao || obj.description)) {
        title = obj.titulo || obj.title || obj.tema || '';
        description = obj.descricao || obj.description || '';
        const rawTags = obj.hashtags || obj.tags || [];
        tags = Array.isArray(rawTags)
          ? rawTags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean)
          : String(rawTags).split(/[,; ]/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
        
        return {
          title: String(title).slice(0, 100).trim(),
          description: formatYouTubeDescriptionSpacing(description),
          tags: [...new Set(tags)]
        };
      }
    }
  } catch (_e) {
    // Prossegue normalmente para o parser textual
  }

  // 1. Extração de Hashtags (#palavra) presentes em qualquer parte do texto
  const hashtagMatches = text.match(/#[a-zA-Z0-9À-ÿ_]+/g) || [];
  const extractedHashtags = hashtagMatches.map(h => h.replace(/^#/, '').trim().toLowerCase());

  // 2. Extração explícita de Tags / Palavras-chave / Hashtags se houver rótulo
  const tagsBlockMatch = text.match(/(?:###?\s*)?(?:\*\*|\*)?(?:Tags?|Palavras[\s-]chave|Hashtags?)(?:\*\*|\*)?\s*[:\-–]?\s*([^\n\r]+)/i);
  if (tagsBlockMatch && tagsBlockMatch[1]) {
    const rawTags = tagsBlockMatch[1].split(/[,; ]/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
    tags = [...new Set([...rawTags, ...extractedHashtags])];
  } else {
    tags = [...new Set(extractedHashtags)];
  }

  // 3. Extração de Título / Tema com prioridade para TÍTULO
  const specificTitleMatch = text.match(/(?:###?\s*)?(?:\*\*|\*)?(?:T[íi]tulo(?:\s+do\s+v[íi]deo)?|Title)(?:\*\*|\*)?\s*[:\-–]?\s*["'“]?([^\n\r"”]+)["'”]?/i);
  if (specificTitleMatch && specificTitleMatch[1]) {
    title = specificTitleMatch[1].trim();
  } else {
    const themeMatch = text.match(/(?:###?\s*)?(?:\*\*|\*)?(?:Tema(?:\s+do\s+v[íi]deo)?)(?:\*\*|\*)?\s*[:\-–]?\s*["'“]?([^\n\r"”]+)["'”]?/i);
    if (themeMatch && themeMatch[1]) {
      title = themeMatch[1].trim();
    }
  }

  // 4. Extração de Descrição com rótulos
  const descMatch = text.match(/(?:###?\s*)?(?:\*\*|\*)?(?:Descri[çc][ãa]o(?:\s+completa)?|Description)(?:\*\*|\*)?\s*[:\-–]?\s*\n?([\s\S]*?)(?=(?:###?\s*)?(?:\*\*|\*)?(?:Hashtags?|Tags?|Palavras[\s-]chave|$))/i);
  if (descMatch && descMatch[1] && descMatch[1].trim()) {
    description = descMatch[1].trim();
  }

  // 5. Análise Posicional Inteligente (para TEXTO BRUTO sem nenhum rótulo)
  const lines = text.split('\n').map(l => l.trim());
  const nonEmptyLines = lines.filter(l => l.length > 0);

  // Se não identificou título por rótulo, usa a primeira linha
  if (!title && nonEmptyLines.length > 0) {
    const first = nonEmptyLines[0].replace(/^(?:###?|\*\*|Title:|Título:|Titulo:|Tema:)\s*/i, '').replace(/["'“”]/g, '').trim();
    if (first.length <= 110) {
      title = first;
    } else {
      const firstSentence = first.split(/[.?!]/)[0];
      if (firstSentence && firstSentence.length <= 100) {
        title = firstSentence.trim();
      } else {
        title = first.slice(0, 95).trim();
      }
    }
  }

  // Se não identificou descrição por rótulo, coleta o corpo do texto
  if (!description) {
    const descLines = [];
    let pastTitle = false;
    for (const line of lines) {
      if (!pastTitle) {
        if ((title && line.includes(title)) || line.length === 0) {
          pastTitle = true;
          continue;
        }
      }
      // Se for apenas bloco de hashtags ou cabeçalho de tags, interrompe
      if (/^(?:#[a-zA-Z0-9À-ÿ_]+\s*)+$/.test(line) || /^(?:###?\s*)?(?:\*\*|\*)?(?:Hashtags?|Tags?):/i.test(line)) {
        break;
      }
      descLines.push(line);
    }
    description = descLines.join('\n').trim();
    
    if (!description && nonEmptyLines.length > 1) {
      description = nonEmptyLines.slice(1).join('\n\n').trim();
    }
  }

  // Sanitização do Título
  title = title
    .replace(/^["'“”«»]/, '')
    .replace(/["'“”«»]$/, '')
    .replace(/\*\*/g, '')
    .replace(/^(?:T[íi]tulo|Tema|Title)\s*[:\-–]\s*/i, '')
    .trim();
  if (title.length > 100) {
    title = title.slice(0, 100);
  }

  // Sanitização da Descrição
  description = description
    .replace(/^(?:Descri[çc][ãa]o|Description)\s*[:\-–]\s*/i, '')
    .trim();
  description = formatYouTubeDescriptionSpacing(description);

  // 6. Extração de Data e Horário de Publicação
  const scheduleTime = extractDateTimeFromText(text);

  return { title, description, tags, scheduleTime };
}

// Extrai data e horário a partir de menções como "DATA E HORA: 28/10/2026 18:00" ou "AGENDAMENTO: 28/10/2026 18:00"
function extractDateTimeFromText(text) {
  if (!text) return null;
  const now = new Date();

  // 1. Procurar trecho com marcadores explícitos de agendamento/horário
  const scheduleMatch = text.match(/(?:###?\s*)?(?:\*\*|\*)?(?:Data\s*(?:e|\/)\s*hora(?:rio)?|Agendamento|Postagem|Programar(?:\s+para)?|Publicar(?:\s+em)?|Data|Hor[áa]rio)(?:\*\*|\*)?\s*[:\-–]?\s*([^\n\r]+)/i);
  const targetText = scheduleMatch ? scheduleMatch[1].trim() : text;

  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth();
  let targetDate = now.getDate();
  let targetHours = null;
  let targetMinutes = 0;
  let hasDate = false;
  let hasTime = false;

  // 2. Tentar casar formato direto completo: DD/MM/YYYY HH:MM (ex: 28/10/2026 18:00 ou 28/10/2026 às 18:00)
  const fullDateTimeMatch = targetText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(?:[aà]s\s+)?([01]?\d|2[0-3])(?:[:hH](\d{2})?)\b/i);
  if (fullDateTimeMatch) {
    const day = parseInt(fullDateTimeMatch[1], 10);
    const month = parseInt(fullDateTimeMatch[2], 10) - 1;
    let year = fullDateTimeMatch[3] ? parseInt(fullDateTimeMatch[3], 10) : targetYear;
    if (year < 100) year += 2000;
    targetYear = year;
    targetMonth = month;
    targetDate = day;
    targetHours = parseInt(fullDateTimeMatch[4], 10);
    targetMinutes = fullDateTimeMatch[5] ? parseInt(fullDateTimeMatch[5], 10) : 0;
    hasDate = true;
    hasTime = true;
  } else {
    // Verificar menções relativas: "amanhã"
    if (/amanh[ãa]/i.test(targetText)) {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      targetYear = tomorrow.getFullYear();
      targetMonth = tomorrow.getMonth();
      targetDate = tomorrow.getDate();
      hasDate = true;
    }

    // Verificar data no formato DD/MM/YYYY ou DD/MM
    const dateMatch = targetText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10) - 1;
      let year = dateMatch[3] ? parseInt(dateMatch[3], 10) : targetYear;
      if (year < 100) year += 2000;
      targetYear = year;
      targetMonth = month;
      targetDate = day;
      hasDate = true;
    }

    // Verificar data no formato YYYY-MM-DD
    const isoDateMatch = targetText.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoDateMatch) {
      targetYear = parseInt(isoDateMatch[1], 10);
      targetMonth = parseInt(isoDateMatch[2], 10) - 1;
      targetDate = parseInt(isoDateMatch[3], 10);
      hasDate = true;
    }

    // Extrair horário isolado: "18:00", "18h30", "18h"
    const timeMatch = targetText.match(/\b([01]?\d|2[0-3])(?:[:hH](\d{2})?)\b/);
    if (timeMatch) {
      targetHours = parseInt(timeMatch[1], 10);
      targetMinutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      hasTime = true;
    }
  }

  if (hasDate || hasTime) {
    if (targetHours === null) {
      targetHours = 18; // Padrão 18:00 para publicações programadas
      targetMinutes = 0;
    }

    // Se informou apenas horário sem data, agenda para o dia seguinte no horário
    if (!hasDate) {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      targetYear = tomorrow.getFullYear();
      targetMonth = tomorrow.getMonth();
      targetDate = tomorrow.getDate();
    }

    const scheduledDate = new Date(targetYear, targetMonth, targetDate, targetHours, targetMinutes, 0, 0);
    return formatLocalDateToIsoMinute(scheduledDate);
  }

  return null;
}

function formatLocalDateToIsoMinute(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

const pasteDialog = $('#wf-paste-metadata-dialog');
const openPasteDialogBtn = $('#wf-open-paste-metadata-btn');
const pasteRawTextarea = $('#wf-paste-raw-textarea');
const pasteParseBtn = $('#wf-paste-parse-btn');
const pasteOutTitle = $('#wf-paste-out-title');
const pasteOutDesc = $('#wf-paste-out-desc');
const pasteOutTags = $('#wf-paste-out-tags');
const pasteOutTime = $('#wf-paste-out-time');
const pasteTimeStatus = $('#wf-paste-time-status');
const pasteTitleCount = $('#wf-paste-title-count');
const pasteDescCount = $('#wf-paste-desc-count');
const pasteTagsCount = $('#wf-paste-tags-count');
const pasteDetectedStatus = $('#wf-paste-detected-status');
const applyPastedMetadataBtn = $('#wf-apply-pasted-metadata-btn');

const pasteTabBtn = $('#wf-paste-tab-btn');
const genQuickTabBtn = $('#wf-gen-quick-tab-btn');
const pastePanel = $('#wf-paste-panel');
const genQuickPanel = $('#wf-gen-quick-panel');
const genQuickTopic = $('#wf-gen-quick-topic');
const genQuickBtn = $('#wf-gen-quick-btn');

function setTimePreset(preset) {
  const target = new Date();
  if (preset === 'tomorrow-18') {
    target.setDate(target.getDate() + 1);
    target.setHours(18, 0, 0, 0);
  } else if (preset === 'in-2-days') {
    target.setDate(target.getDate() + 2);
    target.setHours(18, 0, 0, 0);
  } else if (preset === 'in-3-days') {
    target.setDate(target.getDate() + 3);
    target.setHours(18, 0, 0, 0);
  } else if (preset === 'in-7-days') {
    target.setDate(target.getDate() + 7);
    target.setHours(18, 0, 0, 0);
  }
  if (pasteOutTime) {
    pasteOutTime.value = formatLocalDateToIsoMinute(target);
    if (pasteTimeStatus) pasteTimeStatus.textContent = '✓ Data futura definida via atalho!';
  }
}

document.querySelectorAll('.wf-time-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = btn.getAttribute('data-preset');
    setTimePreset(p);
  });
});

function updatePasteModalCounters() {
  if (pasteOutTitle && pasteTitleCount) {
    const len = pasteOutTitle.value.length;
    pasteTitleCount.textContent = `${len} / 100`;
    pasteTitleCount.style.color = len > 90 ? 'var(--red)' : len > 70 ? '#f59e0b' : 'var(--muted)';
  }
  if (pasteOutDesc && pasteDescCount) {
    const len = pasteOutDesc.value.length;
    pasteDescCount.textContent = `${len} / 5000`;
    pasteDescCount.style.color = len > 4800 ? 'var(--red)' : 'var(--muted)';
  }
  if (pasteOutTags && pasteTagsCount) {
    const count = pasteOutTags.value.split(',').filter(t => t.trim()).length;
    pasteTagsCount.textContent = `${count} tags`;
  }
}

function processPastedMetadataText() {
  const raw = pasteRawTextarea?.value || '';
  if (!raw.trim()) {
    if (pasteDetectedStatus) pasteDetectedStatus.textContent = '';
    return;
  }
  const parsed = parseExternalMetadataText(raw);
  if (pasteOutTitle) pasteOutTitle.value = parsed.title;
  if (pasteOutDesc) pasteOutDesc.value = parsed.description;
  if (pasteOutTags) pasteOutTags.value = parsed.tags.join(', ');
  
  if (parsed.scheduleTime) {
    if (pasteOutTime) pasteOutTime.value = parsed.scheduleTime;
    if (pasteTimeStatus) {
      pasteTimeStatus.textContent = `✓ Horário detectado no texto!`;
    }
  } else if (pasteOutTime && !pasteOutTime.value) {
    const tomorrow18 = new Date();
    tomorrow18.setDate(tomorrow18.getDate() + 1);
    tomorrow18.setHours(18, 0, 0, 0);
    pasteOutTime.value = formatLocalDateToIsoMinute(tomorrow18);
    if (pasteTimeStatus) pasteTimeStatus.textContent = '';
  }

  updatePasteModalCounters();
  if (pasteDetectedStatus) {
    pasteDetectedStatus.textContent = '✓ Campos extraídos com sucesso!';
  }
}

openPasteDialogBtn?.addEventListener('click', () => {
  resetPasteModal();
  hideScheduleStatusBanner();
  pasteDialog?.showModal();
  pasteRawTextarea?.focus();
});

$('#wf-paste-clear-btn')?.addEventListener('click', () => {
  resetPasteModal();
  pasteRawTextarea?.focus();
  showToast('Campos do modal limpos!', 'info');
});

pasteTabBtn?.addEventListener('click', () => {
  if (pasteTabBtn) {
    pasteTabBtn.style.background = 'var(--surface-2)';
    pasteTabBtn.style.color = 'var(--text)';
    pasteTabBtn.style.borderColor = 'var(--line-strong)';
  }
  if (genQuickTabBtn) {
    genQuickTabBtn.style.background = 'transparent';
    genQuickTabBtn.style.color = 'var(--text-2)';
    genQuickTabBtn.style.borderColor = 'transparent';
  }
  pastePanel?.classList.remove('hidden');
  genQuickPanel?.classList.add('hidden');
});

genQuickTabBtn?.addEventListener('click', () => {
  if (genQuickTabBtn) {
    genQuickTabBtn.style.background = 'var(--surface-2)';
    genQuickTabBtn.style.color = 'var(--text)';
    genQuickTabBtn.style.borderColor = 'var(--line-strong)';
  }
  if (pasteTabBtn) {
    pasteTabBtn.style.background = 'transparent';
    pasteTabBtn.style.color = 'var(--text-2)';
    pasteTabBtn.style.borderColor = 'transparent';
  }
  genQuickPanel?.classList.remove('hidden');
  pastePanel?.classList.add('hidden');
  genQuickTopic?.focus();
});

pasteRawTextarea?.addEventListener('input', () => {
  processPastedMetadataText();
});

pasteParseBtn?.addEventListener('click', () => {
  processPastedMetadataText();
  showToast('✓ Texto processado e campos extraídos!', 'info');
});

pasteOutTitle?.addEventListener('input', updatePasteModalCounters);
pasteOutDesc?.addEventListener('input', updatePasteModalCounters);
pasteOutTags?.addEventListener('input', updatePasteModalCounters);

genQuickBtn?.addEventListener('click', async () => {
  const topic = genQuickTopic?.value?.trim();
  if (!topic) {
    showToast('Digite sobre o que é o vídeo/corte para gerar o SEO.', 'warning');
    genQuickTopic?.focus();
    return;
  }
  genQuickBtn.disabled = true;
  genQuickBtn.textContent = '⏳ Gerando com IA...';
  try {
    const lang = $('#wf-upload-language')?.value || 'it';
    const res = await mutate('/api/workflow/generate-seo', 'POST', {
      topic,
      language: lang
    });
    if (res?.seo) {
      if (pasteOutTitle) pasteOutTitle.value = (res.seo.title || '').slice(0, 100);
      if (pasteOutDesc) pasteOutDesc.value = formatYouTubeDescriptionSpacing(res.seo.description || '');
      const tagsArr = Array.isArray(res.seo.tags) ? res.seo.tags : (res.seo.hashtags || []);
      const cleanTags = tagsArr.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean);
      if (pasteOutTags) pasteOutTags.value = cleanTags.join(', ');
      updatePasteModalCounters();
      if (pasteDetectedStatus) pasteDetectedStatus.textContent = '✓ Metadados gerados com sucesso!';
      showToast('✨ SEO gerado com sucesso pela IA!', 'success');
    }
  } catch (err) {
    showToast(`Erro ao gerar SEO: ${err.message}`, 'error');
  } finally {
    genQuickBtn.disabled = false;
    genQuickBtn.textContent = '🚀 Gerar com IA';
  }
});

applyPastedMetadataBtn?.addEventListener('click', () => {
  const finalTitle = pasteOutTitle?.value?.trim() || '';
  const finalDesc = formatYouTubeDescriptionSpacing(pasteOutDesc?.value?.trim() || '');
  const finalTags = pasteOutTags?.value?.trim() || '';
  const finalTime = pasteOutTime?.value || '';

  if (!finalTitle && !finalDesc) {
    showToast('Preencha ao menos o título ou a descrição antes de aplicar.', 'warning');
    return;
  }

  if (titleInput && finalTitle) {
    titleInput.value = finalTitle;
    updateTitleCharCounter();
  }
  if (descInput && finalDesc) {
    descInput.value = finalDesc;
    updateDescCharCounter();
  }
  const tagsInput = $('#wf-upload-tags');
  if (tagsInput && finalTags) {
    tagsInput.value = finalTags;
  }
  const timeInput = $('#wf-upload-time');
  if (finalTime && timeInput) {
    timeInput.value = finalTime;
  }

  // Ocultar imediatamente o banner verde do post anterior para não deixar dados conflitantes
  hideScheduleStatusBanner();

  pasteDialog?.close();
  resetPasteModal();
  revealMetadataFields(false);
  scheduleAutoSaveDraft(100);
  showToast('🎉 Metadados e agendamento aplicados nos campos oficiais com sucesso!', 'success');
});


// ====================================================
// Controlador da Barra de Progresso de Upload / Agendamento
// ====================================================
const scheduleProgressCtrl = {
  timer: null,
  startTime: null,
  currentPercent: 0,

  start() {
    this.currentPercent = 6;
    this.startTime = Date.now();
    const card = $('#wf-schedule-progress-card');
    const bar = $('#wf-schedule-progress-bar');
    const percentEl = $('#wf-schedule-progress-percent');
    const stepEl = $('#wf-schedule-progress-step');
    const titleEl = $('#wf-schedule-progress-title');
    const spinner = $('#wf-schedule-spinner');
    const elapsedEl = $('#wf-schedule-progress-elapsed');
    const hintEl = $('#wf-schedule-progress-hint');

    if (!card) return;

    card.classList.remove('hidden', 'completed', 'error');
    if (spinner) spinner.style.display = 'block';
    if (titleEl) {
      titleEl.innerHTML = '<span style="color: #38bdf8;">Enviando e Programando no YouTube...</span>';
    }
    if (bar) {
      bar.style.width = '6%';
      bar.style.background = 'linear-gradient(90deg, #3b82f6, #06b6d4, #10b981)';
    }
    if (percentEl) {
      percentEl.textContent = '6%';
      percentEl.style.color = '#38bdf8';
    }
    if (stepEl) {
      stepEl.innerHTML = '📁 <strong>1/4:</strong> Validando arquivo de vídeo e miniatura no disco...';
    }
    if (elapsedEl) elapsedEl.textContent = '⏱️ 00:00';
    if (hintEl) {
      hintEl.textContent = 'Não feche esta página enquanto o vídeo é enviado e registrado no YouTube oficial';
    }

    if (this.timer) clearInterval(this.timer);

    this.timer = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
      const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const secs = String(elapsedSec % 60).padStart(2, '0');
      if (elapsedEl) elapsedEl.textContent = `⏱️ ${mins}:${secs}`;

      if (elapsedSec < 3) {
        this.currentPercent = Math.min(22, this.currentPercent + 2.5);
        if (stepEl) stepEl.innerHTML = '📁 <strong>1/4:</strong> Validando formato .mp4, miniatura e metadados...';
      } else if (elapsedSec < 8) {
        this.currentPercent = Math.min(48, this.currentPercent + 1.8);
        if (stepEl) stepEl.innerHTML = '🔐 <strong>2/4:</strong> Conectando com a API oficial do YouTube Studio...';
      } else if (elapsedSec < 25) {
        this.currentPercent = Math.min(78, this.currentPercent + 0.9);
        if (stepEl) stepEl.innerHTML = '☁️ <strong>3/4:</strong> Enviando pacote de vídeo (.mp4) e aplicando metadados...';
      } else if (elapsedSec < 60) {
        this.currentPercent = Math.min(94, this.currentPercent + 0.35);
        if (stepEl) stepEl.innerHTML = '⚙️ <strong>4/4:</strong> Vinculando miniatura, moderação de comentários e gravando agendamento...';
      } else {
        this.currentPercent = Math.min(98, this.currentPercent + 0.1);
        if (stepEl) stepEl.innerHTML = '⏳ Finalizando gravação na API oficial do YouTube... Aguarde mais alguns instantes.';
      }

      const displayPct = Math.floor(this.currentPercent);
      if (bar) bar.style.width = `${displayPct}%`;
      if (percentEl) percentEl.textContent = `${displayPct}%`;
    }, 400);
  },

  success(titleText) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const card = $('#wf-schedule-progress-card');
    const bar = $('#wf-schedule-progress-bar');
    const percentEl = $('#wf-schedule-progress-percent');
    const stepEl = $('#wf-schedule-progress-step');
    const titleEl = $('#wf-schedule-progress-title');
    const spinner = $('#wf-schedule-spinner');
    const hintEl = $('#wf-schedule-progress-hint');

    if (card) {
      card.classList.remove('hidden', 'error');
      card.classList.add('completed');
    }
    if (spinner) spinner.style.display = 'none';
    if (titleEl) {
      titleEl.innerHTML = '🎉 <span style="color: #10b981; font-weight: 700;">Vídeo Programado com Sucesso no Canal!</span>';
    }
    if (bar) {
      bar.style.width = '100%';
      bar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
    }
    if (percentEl) {
      percentEl.textContent = '100%';
      percentEl.style.color = '#10b981';
    }
    if (stepEl) {
      stepEl.innerHTML = `<span style="color: #10b981; font-weight: 600;">✓ Concluído com Sucesso:</span> Vídeo registrado na API oficial e agendado no canal!`;
    }
    if (hintEl) {
      hintEl.textContent = 'Confira os detalhes da publicação abaixo ou na fila de vídeos agendados.';
    }
  },

  error(errMsg) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    const card = $('#wf-schedule-progress-card');
    const bar = $('#wf-schedule-progress-bar');
    const percentEl = $('#wf-schedule-progress-percent');
    const stepEl = $('#wf-schedule-progress-step');
    const titleEl = $('#wf-schedule-progress-title');
    const spinner = $('#wf-schedule-spinner');
    const hintEl = $('#wf-schedule-progress-hint');

    if (card) {
      card.classList.remove('hidden', 'completed');
      card.classList.add('error');
    }
    if (spinner) spinner.style.display = 'none';
    if (titleEl) {
      titleEl.innerHTML = '⚠️ <span style="color: #ef4444; font-weight: 700;">Falha ao Programar Vídeo</span>';
    }
    if (bar) {
      bar.style.width = '100%';
      bar.style.background = '#ef4444';
    }
    if (percentEl) {
      percentEl.textContent = 'Erro';
      percentEl.style.color = '#ef4444';
    }
    if (stepEl) {
      stepEl.innerHTML = `<span style="color: #f87171; font-weight: 600;">Erro:</span> ${escapeHTML(errMsg || 'Ocorreu uma falha durante o envio.')}`;
    }
    if (hintEl) {
      hintEl.textContent = 'Verifique se o arquivo existe e se a sua conta do YouTube possui permissão de upload.';
    }
  }
};

// ====================================================
// Gerador e Exportador de Log TXT de Produção (5 Seções)
// 1) Roteiro, 2) Prompts imagens, 3) Prompt Thumb, 4) Dados Seo, 5) Dados Postagem
// ====================================================
let lastProductionLog = null;

function downloadTxtFile(filename, content) {
  if (!content) return;
  const safeName = filename || `producao_${Date.now()}.txt`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openProductionLogModal({ title, content, filePath, fileName, relativePath } = {}) {
  const dialog = $('#wf-production-log-dialog');
  if (!dialog) return;

  const titleEl = $('#wf-log-dialog-title');
  const pathEl = $('#wf-log-dialog-filepath');
  const contentEl = $('#wf-log-dialog-content');
  const copyBtn = $('#wf-log-dialog-copy-btn');
  const downloadBtn = $('#wf-log-dialog-download-btn');

  if (titleEl) titleEl.textContent = title ? `Produção: ${title}` : 'Dados Completos da Produção (.txt)';
  if (pathEl) pathEl.textContent = relativePath || filePath || fileName || 'producoes/...';
  if (contentEl) contentEl.textContent = content || '';

  if (copyBtn) {
    copyBtn.onclick = (e) => {
      copyToClipboard(content, e.currentTarget);
      showToast('Log completo copiado para a área de transferência!', 'success');
    };
  }

  if (downloadBtn) {
    downloadBtn.onclick = () => {
      downloadTxtFile(fileName || 'producao.txt', content);
      showToast('Download do arquivo .txt iniciado!', 'success');
    };
  }

  dialog.showModal();
}

function gatherProductionBundle(overrides = {}) {
  const topic = overrides.topic || $('#wf-script-topic')?.value?.trim() || wfState.script?.topic || overrides.title || 'Tema sem título';
  const channel = $('#wf-upload-channel')?.value?.trim() || 'Canal Conectado';
  const language = overrides.language || $('#wf-upload-language')?.value || 'it';
  const videoPath = overrides.videoPath || uploadPathInput?.value?.trim() || '';
  const thumbnailPath = overrides.thumbnailPath || thumbPathInput?.value?.trim() || '';
  const publishTime = overrides.publishTime || $('#wf-upload-time')?.value || '';
  const containsSyntheticMedia = overrides.containsSyntheticMedia ?? ($('#wf-contains-synthetic-media')?.checked ?? true);

  // Thumbnail prompt selecionado
  let selectedThumbPrompt = '';
  if (Array.isArray(wfState.nanoBananaPrompts) && wfState.nanoBananaPrompts.length > 0) {
    selectedThumbPrompt = wfState.nanoBananaPrompts[0]?.promptNanoBanana || '';
  }

  // SEO
  const seoObj = wfState.seo || {};
  const currentTitle = overrides.title || titleInput?.value?.trim() || seoObj.title || topic;
  const currentDesc = overrides.description || descInput?.value?.trim() || seoObj.description || '';
  const currentTags = overrides.tags || (tagsInput?.value ? tagsInput.value.split(',').map(t => t.trim()).filter(Boolean) : (seoObj.tags || []));

  return {
    topic,
    title: currentTitle,
    description: currentDesc,
    tags: currentTags,
    videoPath,
    thumbnailPath,
    publishTime,
    channelName: channel,
    language,
    containsSyntheticMedia,
    script: wfState.script ? {
      ...wfState.script,
      cleanedNarration: typeof cleanNarrationForTTS === 'function' ? cleanNarrationForTTS(wfState.script.fullScript) : wfState.script.fullScript
    } : null,
    googleFlowPrompts: wfState.googleFlowPrompts || [],
    nanoBananaPrompts: wfState.nanoBananaPrompts || [],
    thumbnailPrompt: selectedThumbPrompt,
    seo: {
      ...seoObj,
      title: currentTitle,
      description: currentDesc,
      tags: currentTags
    },
    fieldAHistory: $('#wf-field-a')?.value?.trim() || ''
  };
}

async function handleExportProductionLog() {
  const bundle = gatherProductionBundle();
  $('#loading')?.classList.add('active');

  try {
    const res = await mutate('/api/workflow/export-production-log', 'POST', bundle, '✓ Arquivo TXT da produção gerado com sucesso!');
    if (res?.logContent) {
      lastProductionLog = {
        title: bundle.title,
        content: res.logContent,
        filePath: res.logFilePath,
        fileName: res.logFileName,
        relativePath: res.logRelativePath
      };

      // Arquivo armazenado com sucesso no disco em producoes/.
      // Abre modal para conferência (o download no navegador só ocorre se o usuário clicar no botão)
      openProductionLogModal({
        title: bundle.title,
        content: res.logContent,
        filePath: res.logFilePath,
        fileName: res.logFileName,
        relativePath: res.logRelativePath
      });
    }
  } catch (err) {
    showToast(`Erro ao exportar log TXT: ${err.message}`, 'error');
  } finally {
    $('#loading')?.classList.remove('active');
  }
}

async function handleOpenThemeTxtLog(theme) {
  if (!theme) return;
  $('#loading')?.classList.add('active');
  try {
    const logsRes = await api('/api/workflow/production-logs');
    const logs = logsRes?.logs || [];
    const themeSlug = (theme.topic || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const matchedLog = logs.find(l => {
      const fn = l.fileName.toLowerCase();
      return (themeSlug.length > 5 && fn.includes(themeSlug.slice(0, 20))) || 
             (theme.scheduled_date && fn.includes(theme.scheduled_date));
    });

    if (matchedLog) {
      const contentRes = await fetch(`/api/workflow/download-production-log?file=${encodeURIComponent(matchedLog.fileName)}`);
      const txt = await contentRes.text();
      openProductionLogModal({
        title: theme.topic,
        content: txt,
        filePath: matchedLog.filePath,
        fileName: matchedLog.fileName,
        relativePath: `producoes/${matchedLog.fileName}`
      });
      return;
    }

    const bundle = gatherProductionBundle({
      topic: theme.topic,
      title: theme.topic,
      publishTime: theme.scheduled_date ? `${theme.scheduled_date}T18:00:00` : '',
      script: theme.full_script ? {
        topic: theme.topic,
        hook: theme.hook_angle,
        fullScript: theme.full_script,
        cleanedNarration: typeof cleanNarrationForTTS === 'function' ? cleanNarrationForTTS(theme.full_script) : theme.full_script
      } : wfState.script
    });

    const res = await mutate('/api/workflow/export-production-log', 'POST', bundle, '✓ Arquivo de log da produção gerado!');
    if (res?.logContent) {
      openProductionLogModal({
        title: theme.topic,
        content: res.logContent,
        filePath: res.logFilePath,
        fileName: res.logFileName,
        relativePath: res.logRelativePath
      });
    }
  } catch (err) {
    showToast(`Erro ao abrir log da produção: ${err.message}`, 'error');
  } finally {
    $('#loading')?.classList.remove('active');
  }
}

$('#wf-export-txt-btn')?.addEventListener('click', handleExportProductionLog);
$('#wf-export-txt-step7-btn')?.addEventListener('click', handleExportProductionLog);

$('#wf-schedule-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const videoPath = uploadPathInput?.value?.trim();
  const thumbnailPath = thumbPathInput?.value?.trim() || null;
  const title = titleInput?.value?.trim();
  const description = formatYouTubeDescriptionSpacing(descInput?.value || '');
  const tagsRaw = $('#wf-upload-tags')?.value?.trim() || '';
  const publishTime = $('#wf-upload-time')?.value;

  if (!videoPath) {
    showToast('Selecione o arquivo de vídeo (.mp4) no Explorer ou informe o caminho.', 'error');
    videoDropZone?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (!title) {
    showToast('Informe o título do vídeo no YouTube.', 'error');
    titleInput?.focus();
    return;
  }

  if (!publishTime) {
    showToast('Escolha a data e hora de publicação.', 'error');
    $('#wf-upload-time')?.focus();
    return;
  }

  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
  const containsSyntheticMedia = $('#wf-contains-synthetic-media')?.checked ?? true;
  const language = $('#wf-upload-language')?.value || 'it';

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Enviando vídeo e programando...';
  submitBtn.style.opacity = '0.85';
  $('#loading').classList.add('active');

  // Disparar barra de carregamento dinâmica em tempo real
  scheduleProgressCtrl.start();

  const langNames = { it: 'Italiano', pt: 'Português', es: 'Espanhol', en: 'Inglês', pl: 'Polonês' };
  const langDisplay = langNames[language] || language.toUpperCase();

  const bundlePayload = gatherProductionBundle({
    videoPath,
    thumbnailPath,
    publishTime,
    title,
    description,
    tags,
    containsSyntheticMedia,
    language
  });

  try {
    const postRes = await mutate('/api/workflow/schedule-upload', 'POST', {
      videoPath,
      thumbnailPath,
      publishTime,
      title,
      description,
      tags,
      containsSyntheticMedia,
      language,
      format: $('#wf-upload-format')?.value || wfCurrentUploadFormat || 'explainer',
      themeId: wfState.currentThemeId || null,
      channelName: bundlePayload.channelName,
      script: bundlePayload.script,
      googleFlowPrompts: bundlePayload.googleFlowPrompts,
      nanoBananaPrompts: bundlePayload.nanoBananaPrompts,
      thumbnailPrompt: bundlePayload.thumbnailPrompt,
      seo: bundlePayload.seo,
      bundle: bundlePayload
    }, '🎉 Vídeo programado no canal do YouTube com sucesso!');

    const schedResult = postRes?.result || postRes;
    if (schedResult?.logContent) {
      lastProductionLog = {
        title,
        content: schedResult.logContent,
        filePath: schedResult.logFilePath,
        fileName: schedResult.logFileName,
        relativePath: schedResult.logRelativePath
      };
      // O arquivo já fica armazenado permanentemente no disco em producoes/ aguardando o usuário
    }

    // Progresso 100% verde concluído
    scheduleProgressCtrl.success(title);

    // Recarregar temas do cronograma (o backend já sincronizou com o status 'posted' sem duplicações)
    try {
      await loadWorkflowPlannedThemes();
    } catch (_syncErr) {
      console.warn('Aviso ao recarregar tema no cronograma:', _syncErr);
    }

    const banner = $('#wf-schedule-status');
    if (banner) {
      banner.classList.remove('hidden');
      banner.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
          <div style="font-weight: 700; font-size: 15px; color: var(--green);">
            ✓ Lançamento PÚBLICO Programado com Sucesso!
          </div>
          <button type="button" id="wf-close-schedule-banner-btn" class="button ghost small" style="color: var(--text-2); padding: 3px 10px; font-size: 12px; line-height: 1; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; cursor: pointer;" title="Fechar aviso de lançamento">
            ✕ Fechar Aviso
          </button>
        </div>
        <div><strong>Título:</strong> ${escapeHTML(title)}</div>
        <div><strong>Data e Hora:</strong> ${formatDate(publishTime)} · <span style="color: #10b981; font-weight: 700;">🌐 Lançamento PÚBLICO Programado</span></div>
        <div><strong>Visibilidade no YouTube Studio:</strong> <span style="color: #10b981; font-weight: 600;">Programada (Liberado como Público automaticamente para todos)</span></div>
        <div><strong>Idioma no YouTube:</strong> 🇮🇹 ${escapeHTML(langDisplay)} (Áudio falado, título e descrição)</div>
        <div><strong>Declaração de IA (YouTube Studio):</strong> ${containsSyntheticMedia ? '<span style="color: var(--green); font-weight: 600;">✓ Conteúdo Gerado por IA ("Sim")</span>' : 'Não declarado'}</div>
        <div><strong>Moderação de Comentários:</strong> <span style="color: var(--green); font-weight: 600;">🛡️ Básica (Filtro anti-impropriedades ativo)</span></div>
        ${thumbnailPath ? `<div><strong>Miniatura:</strong> Vinculada e programada</div>` : '<div style="color: var(--text-2); font-size: 12px;">Miniatura padrão do YouTube selecionada</div>'}

        <!-- Bloco de Log TXT Armazenado no Disco -->
        <div class="production-log-saved-card" style="margin-top: 14px; padding: 14px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
            <div style="font-weight: 700; color: #10b981; font-size: 13px; display: flex; align-items: center; gap: 6px;">
              <span>💾 Log Gravado em Disco:</span>
              <code style="background: rgba(0,0,0,0.35); padding: 2px 7px; border-radius: 4px; color: #fff; font-family: var(--font-mono); font-size: 11.5px;">${escapeHTML(schedResult?.logRelativePath || schedResult?.logFileName || 'producoes/log.txt')}</code>
            </div>
            <span style="font-size: 11.5px; color: var(--text-2);">✓ Salvo permanentemente em producoes/</span>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" id="wf-banner-view-txt-btn" class="button primary small" style="background: linear-gradient(135deg, #10b981, #059669); font-size: 12px; padding: 6px 14px;">
              👁️ Visualizar Log da Produção
            </button>
            <button type="button" id="wf-banner-copy-txt-btn" class="button secondary small" style="font-size: 12px; padding: 6px 12px;">
              📋 Copiar Conteúdo
            </button>
            <button type="button" id="wf-banner-download-txt-btn" class="button ghost small" style="font-size: 12px; padding: 6px 12px; color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35);">
              📥 Baixar Cópia (.txt)
            </button>
          </div>

          <!-- Confirmação de Estúdio Limpo & Botão Próxima Produção -->
          <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed rgba(255, 255, 255, 0.15); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div style="font-size: 12px; color: var(--text-2); display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 16px;">🧹</span>
              <span><strong>Estúdio limpo automaticamente!</strong> Todos os dados foram gravados em disco e os campos liberados para o próximo vídeo (histórico do Campo A preservado).</span>
            </div>
            <button type="button" id="wf-start-next-production-btn" class="button primary small" style="background: linear-gradient(135deg, #3b82f6, #06b6d4); font-weight: 600; font-size: 12px; padding: 7px 16px;">
              ✨ Ir para Cronograma / Novo Roteiro
            </button>
          </div>
        </div>
      `;

      $('#wf-close-schedule-banner-btn')?.addEventListener('click', hideScheduleStatusBanner);
      $('#wf-banner-download-txt-btn')?.addEventListener('click', () => {
        if (lastProductionLog) downloadTxtFile(lastProductionLog.fileName, lastProductionLog.content);
      });
      $('#wf-banner-copy-txt-btn')?.addEventListener('click', (e) => {
        if (lastProductionLog) copyToClipboard(lastProductionLog.content, e.currentTarget);
      });
      $('#wf-banner-view-txt-btn')?.addEventListener('click', () => {
        if (lastProductionLog) openProductionLogModal(lastProductionLog);
      });
      $('#wf-start-next-production-btn')?.addEventListener('click', () => {
        $('#wf-schedule-status')?.classList.add('hidden');
        const step1 = $('#wf-step-1-panel') || $('#wf-script-topic');
        step1?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('#wf-script-topic')?.focus();
      });

      banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Limpa o rascunho salvo pois a produção foi concluída e agendada com sucesso
    clearWorkflowDraft(false);
    resetWorkflowStudio({ keepFieldA: true, preserveTopic: '', preserveLog: true, notify: false });

    // Restaura o botão de agendamento imediatamente para estar pronto para a próxima produção
    submitBtn.disabled = false;
    submitBtn.textContent = '📅 Agendar Lançamento PÚBLICO no YouTube Oficial';
    submitBtn.style.background = '';
    submitBtn.style.opacity = '1';
    submitBtn.style.boxShadow = '';

    await refreshDashboard(true);
    await loadWorkflowPlannedThemes();
  } catch (err) {
    scheduleProgressCtrl.error(err.message);
    showToast(`Erro ao programar vídeo: ${err.message}`, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = '📅 Tentar Programar Novamente';
    submitBtn.style.background = '';
    submitBtn.style.opacity = '1';
    submitBtn.style.boxShadow = '';
  } finally {
    $('#loading').classList.remove('active');
    setTimeout(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = '📅 Agendar Lançamento PÚBLICO no YouTube Oficial';
      submitBtn.style.background = '';
      submitBtn.style.opacity = '1';
      submitBtn.style.boxShadow = '';
    }, 4500);
  }
});


// Ocultar automaticamente o banner verde do post anterior ao editar qualquer dado do próximo vídeo
[
  titleInput,
  descInput,
  $('#wf-upload-tags'),
  $('#wf-upload-time'),
  $('#wf-video-file-input'),
  $('#wf-thumb-file-input'),
  $('#wf-upload-path'),
  $('#wf-upload-thumbnail-path')
].forEach(inputEl => {
  inputEl?.addEventListener('input', hideScheduleStatusBanner);
  inputEl?.addEventListener('change', hideScheduleStatusBanner);
});

[
  $('#wf-choose-video-btn'),
  $('#wf-remove-video-btn'),
  $('#wf-choose-thumb-file-btn'),
  $('#wf-remove-thumb-btn'),
  $('#wf-use-generated-thumb-btn'),
  $('#wf-corte-no-thumb-btn'),
  $('#wf-sync-from-workflow-btn'),
  $('#wf-pull-seo-btn')
].forEach(btnEl => {
  btnEl?.addEventListener('click', hideScheduleStatusBanner);
});

// Renderizar fila de vídeos agendados na Etapa 8
function renderWorkflowScheduledQueue(schedule = []) {
  const container = $('#wf-scheduled-videos-list');
  const countBadge = $('#wf-scheduled-count-badge');
  if (!container) return;

  const rawScheduled = (schedule || []).filter(item => 
    ['scheduled', 'uploading', 'published'].includes(item.status)
  );

  // Filtrar por formato se selecionado
  const filtered = rawScheduled.filter(item => {
    if (wfQueueFilterType === 'all') return true;
    const isShort = isItemShort(item);
    return wfQueueFilterType === 'short' ? isShort : !isShort;
  });

  // Ordenar por data (crescente ou decrescente)
  filtered.sort((a, b) => {
    const timeA = new Date(a.publish_time || a.publishTime || 0).getTime();
    const timeB = new Date(b.publish_time || b.publishTime || 0).getTime();
    return wfQueueSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} de ${rawScheduled.length} agendado${rawScheduled.length === 1 ? '' : 's'}`;
  }

  if (!filtered.length) {
    container.innerHTML = '<p class="placeholder-text" style="color: var(--text-2); font-size: 13px; text-align: center; padding: 20px;">Nenhum vídeo aguardando publicação neste filtro.</p>';
    return;
  }

  container.innerHTML = filtered.map(item => {
    const isPublished = item.status === 'published';
    const cleanTitle = cleanTitlePrefix(item.title || 'Vídeo sem título');
    const publishDate = item.publish_time || item.publishTime;
    const statusBadge = isPublished
      ? '<span class="status-pill success">✅ Publicado</span>'
      : '<span class="scheduled-badge-live">🌐 Público Programado</span>';

    const isShort = isItemShort(item);

    let metaObj = {};
    if (item.metadata) {
      try {
        metaObj = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
      } catch (_) {}
    }

    // Duração formatada se disponível (ex: 29s ou 13m 05s)
    let durationLabel = '';
    const rawDur = metaObj?.duration || item.duration || '';
    if (rawDur) {
      const dMatch = String(rawDur).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
      if (dMatch) {
        const h = parseInt(dMatch[1] || '0', 10);
        const m = parseInt(dMatch[2] || '0', 10);
        const s = parseInt(dMatch[3] || '0', 10);
        if (h > 0) durationLabel = `${h}h ${m}m`;
        else if (m > 0) durationLabel = `${m}m${s > 0 ? ' ' + String(s).padStart(2, '0') + 's' : ''}`;
        else if (s > 0) durationLabel = `${s}s`;
      }
    }

    const formatBadge = isShort
      ? `<span style="font-size: 10.5px; padding: 2px 7px; background: rgba(244, 63, 94, 0.16); color: #fda4af; border: 1px solid rgba(244, 63, 94, 0.35); border-radius: 4px; font-weight: 700;">⚡ Short${durationLabel ? ' · ' + durationLabel : ''}</span>`
      : `<span style="font-size: 10.5px; padding: 2px 7px; background: rgba(59, 130, 246, 0.15); color: #93c5fd; border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 4px; font-weight: 600;">🎬 Vídeo Longo${durationLabel ? ' · ' + durationLabel : ''}</span>`;

    const logFileName = metaObj?.logFileName || null;
    const thumbUrl = metaObj?.thumbnail || null;

    return `
      <div class="scheduled-video-card">
        <div class="scheduled-video-left">
          ${thumbUrl 
            ? `<img class="scheduled-video-thumb" src="${escapeHTML(thumbUrl)}" alt="" loading="lazy" onerror="this.style.display='none';">` 
            : ''
          }
          <div class="scheduled-video-thumb-placeholder" style="${thumbUrl ? 'display: none;' : ''}">${isShort ? '⚡' : '🎬'}</div>
          <div class="scheduled-video-info">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap;">
              ${formatBadge}
              <h4 class="scheduled-video-title" title="${escapeHTML(cleanTitle)}" style="margin: 0;">${escapeHTML(cleanTitle)}</h4>
            </div>
            <div class="scheduled-video-meta">
              <span>📅 <strong>${formatDate(publishDate)}</strong></span>
              <span>·</span>
              <span>${statusBadge}</span>
            </div>
          </div>
        </div>
        <div class="scheduled-video-right" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          ${logFileName 
            ? `<a href="/api/workflow/download-production-log?file=${encodeURIComponent(logFileName)}" class="button secondary small" style="font-size: 11.5px; padding: 4px 10px;" title="Baixar arquivo TXT completo desta produção">📄 Baixar TXT</a>`
            : `<button type="button" class="button ghost small wf-sched-export-txt-btn" data-sched-title="${escapeHTML(cleanTitle)}" style="font-size: 11.5px; padding: 4px 10px;" title="Exportar log TXT">📄 TXT</button>`
          }
          ${item.youtube_url || item.youtubeUrl 
            ? `<a href="${escapeHTML(item.youtube_url || item.youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="button secondary small">Assistir no YouTube ↗</a>` 
            : `<span style="font-size: 11.5px; color: var(--text-2);">Fila local salva</span>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Ativar listeners dos botões TXT da fila se não tiver arquivo salvo prévio
  container.querySelectorAll('.wf-sched-export-txt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      handleExportProductionLog();
    });
  });
}

// Atualizar nome do canal no input do upload
function syncWorkflowChannel() {
  const activeAccount = ui.state?.youtubeAccount;
  const channelInput = $('#wf-upload-channel');
  if (channelInput) {
    channelInput.value = activeAccount ? `${activeAccount.title} (${activeAccount.id})` : 'Canal Ativo Conectado';
  }
}

// Inicializar estúdio de produção
loadLastWorkflowSummary();
loadWorkflowPlannedThemes();
if (typeof attachWorkflowAutoSaveListeners === 'function') {
  attachWorkflowAutoSaveListeners();
}
if (typeof restoreWorkflowDraft === 'function') {
  restoreWorkflowDraft();
}

const rawHash = location.hash.slice(1);
const initialView = rawHash === 'readiness' ? 'workflow' : rawHash;
if (['overview', 'workflow', 'operator', 'pipeline', 'calendar', 'analytics', 'engagement', 'settings'].includes(initialView)) switchView(initialView);
refreshDashboard().then(() => syncWorkflowChannel());
setInterval(() => {
  refreshDashboard(true);
  syncWorkflowChannel();
}, 8000);


// ====================================================
// Gerenciamento do Modo "Envio de Cortes" e Formato
// ====================================================
function setWorkflowStudioMode(mode = 'full', scrollToStep8 = false) {
  wfStudioMode = mode;
  const workflowView = $('#workflow-view');
  const btnFull = $('#wf-mode-tab-full');
  const btnCortes = $('#wf-mode-tab-cortes');
  const indicator = $('#wf-mode-indicator-text');

  if (mode === 'cortes') {
    workflowView?.classList.add('studio-mode-cortes');
    btnFull?.classList.remove('active');
    btnCortes?.classList.add('active');
    if (indicator) {
      indicator.innerHTML = 'Visualizando: <strong>Envio de Cortes</strong> (Tela limpa focada apenas na postagem rápida de Shorts)';
    }
    setWorkflowUploadFormat('short');
  } else {
    workflowView?.classList.remove('studio-mode-cortes');
    btnCortes?.classList.remove('active');
    btnFull?.classList.add('active');
    if (indicator) {
      indicator.innerHTML = 'Visualizando: <strong>Estúdio Completo</strong> (Planejamento, Roteiro, Narração, Imagens e Postagem)';
    }
    setWorkflowUploadFormat('explainer');
  }

  if (scrollToStep8) {
    setTimeout(() => {
      $('#wf-step-8-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }
}
window.setWorkflowStudioMode = setWorkflowStudioMode;

function revealMetadataFields(focusTitle = false) {
  const hero = $('#wf-metadata-paste-hero');
  const wrapper = $('#wf-metadata-fields-wrapper');
  if (hero) hero.classList.add('hidden');
  if (wrapper) wrapper.classList.remove('hidden');
  if (focusTitle) {
    setTimeout(() => $('#wf-upload-title')?.focus(), 50);
  }
}
window.revealMetadataFields = revealMetadataFields;

function collapseMetadataFields() {
  const hero = $('#wf-metadata-paste-hero');
  const wrapper = $('#wf-metadata-fields-wrapper');
  if (wrapper) wrapper.classList.add('hidden');
  if (hero) hero.classList.remove('hidden');
}
window.collapseMetadataFields = collapseMetadataFields;

function setWorkflowUploadFormat(format = 'explainer') {
  wfCurrentUploadFormat = format;
  const formatInput = $('#wf-upload-format');
  if (formatInput) formatInput.value = format;

  const btnLong = $('#wf-format-btn-long');
  const btnShort = $('#wf-format-btn-short');
  const thumbCard = $('#wf-thumb-schedule-card');
  const optionalThumbWrap = $('#wf-optional-thumb-trigger-wrap');
  const metaTitle = $('#wf-metadata-section-title');
  const publishTitle = $('#wf-publish-section-title');
  const cortesBanner = $('.cortes-mode-header-card');

  if (format === 'short') {
    btnShort?.classList.add('active', 'primary');
    btnShort?.classList.remove('secondary');
    btnLong?.classList.remove('active', 'primary');
    btnLong?.classList.add('secondary');

    // Em Shorts/Cortes, o banner de envio rápido é exibido
    cortesBanner?.classList.remove('hidden');

    // Em Shorts/Cortes, o bloco de capa fica 100% oculto pois o YouTube seleciona o frame automático
    thumbCard?.classList.add('hidden');
    optionalThumbWrap?.classList.remove('hidden');

    if (metaTitle) metaTitle.textContent = '📝 2. Metadados Oficiais do Vídeo';
    if (publishTitle) publishTitle.textContent = '📅 3. Data, Horário e Canal de Publicação';

    if (!$('#wf-upload-title')?.value?.trim() && !$('#wf-upload-desc')?.value?.trim()) {
      collapseMetadataFields();
    }
  } else {
    btnLong?.classList.add('active', 'primary');
    btnLong?.classList.remove('secondary');
    btnShort?.classList.remove('active', 'primary');
    btnShort?.classList.add('secondary');

    // Em Vídeo Longo, o banner de cortes fica TOTALMENTE OCULTO (menos poluição visual)
    cortesBanner?.classList.add('hidden');

    // Em Vídeo Longo, o bloco de capa fica visível normalmente
    thumbCard?.classList.remove('hidden');
    optionalThumbWrap?.classList.add('hidden');

    if (metaTitle) metaTitle.textContent = '📝 3. Metadados Oficiais do Vídeo';
    if (publishTitle) publishTitle.textContent = '📅 4. Data, Horário e Canal de Publicação';
  }
}
window.setWorkflowUploadFormat = setWorkflowUploadFormat;

// Listeners dos botões de alternância de modo
$('#btn-envio-cortes-top')?.addEventListener('click', () => {
  switchView('workflow');
  setWorkflowStudioMode('cortes', true);
});

$('#wf-mode-tab-full')?.addEventListener('click', () => {
  setWorkflowStudioMode('full');
});

$('#wf-mode-tab-cortes')?.addEventListener('click', () => {
  setWorkflowStudioMode('cortes', true);
});

// Listeners dos botões de escolha de formato na Etapa 8
$('#wf-format-btn-long')?.addEventListener('click', () => {
  setWorkflowUploadFormat('explainer');
});

$('#wf-format-btn-short')?.addEventListener('click', () => {
  setWorkflowUploadFormat('short');
});

$('#wf-produce-short-thumb-btn')?.addEventListener('click', () => {
  $('#wf-choose-thumb-file-btn')?.click();
});

// Listeners da fila de agendamento (ordenação por data e filtro de tipo)
$('#wf-queue-sort-order')?.addEventListener('change', (e) => {
  wfQueueSortOrder = e.target.value || 'asc';
  renderWorkflowScheduledQueue(ui.state?.schedule || []);
});

$('#wf-queue-filter-type')?.addEventListener('change', (e) => {
  wfQueueFilterType = e.target.value || 'all';
  renderWorkflowScheduledQueue(ui.state?.schedule || []);
});

$('#wf-cortes-toggle-schedule-btn')?.addEventListener('click', () => {
  const panel = $('#wf-step-1-panel');
  if (!panel) return;
  const isShown = panel.classList.toggle('show-in-cortes');
  const btn = $('#wf-cortes-toggle-schedule-btn');
  if (btn) btn.textContent = isShown ? '✕ Ocultar Cronograma' : '📅 Ver Cronograma';
  if (isShown) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#wf-cortes-back-full-btn')?.addEventListener('click', () => {
  setWorkflowStudioMode('full');
});


// Listeners do hero de metadados
$('#wf-hero-paste-btn')?.addEventListener('click', () => {
  resetPasteModal();
  hideScheduleStatusBanner();
  pasteDialog?.showModal();
  pasteRawTextarea?.focus();
});

$('#wf-reveal-metadata-manual-btn')?.addEventListener('click', () => {
  revealMetadataFields(true);
});

$('#wf-repaste-metadata-btn')?.addEventListener('click', () => {
  resetPasteModal();
  hideScheduleStatusBanner();
  pasteDialog?.showModal();
  pasteRawTextarea?.focus();
});

$('#wf-collapse-metadata-btn')?.addEventListener('click', () => {
  collapseMetadataFields();
});

$('#wf-show-optional-thumb-btn')?.addEventListener('click', () => {
  $('#wf-thumb-schedule-card')?.classList.remove('hidden');
  $('#wf-optional-thumb-trigger-wrap')?.classList.add('hidden');
  $('#wf-thumb-schedule-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Inicialização consistente do formato de upload: se não for explicitamente 'short', garante modo Vídeo Longo com banner oculto
if (typeof wfCurrentUploadFormat === 'undefined' || wfCurrentUploadFormat !== 'short') {
  setWorkflowUploadFormat('explainer');
}

