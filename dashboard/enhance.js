/* ============================================================
   Lumen console enhancement layer — motion, command palette,
   instrumentation. Loads after app.js; touches nothing internal.
   Cross-file globals below are declared by app.js.
   ============================================================ */
/* global ui, renderNotifications */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const MINI_LABELS = {
    overview: 'Início', calendar: 'Calendário', workflow: 'Modelador',
    engagement: 'Engajamento', analytics: 'Estatísticas', operator: 'Operador',
    settings: 'Configurações'
  };
  function ensureMiniLabels() {
    $$('.nav-item').forEach(item => {
      const existing = item.querySelector('.mini-label');
      const text = MINI_LABELS[item.dataset.view] || item.textContent.trim();
      if (!existing) {
        const span = document.createElement('span');
        span.className = 'mini-label';
        span.textContent = text;
        item.appendChild(span);
      } else if (existing.textContent !== text) {
        existing.textContent = text;
      }
    });
  }
  ensureMiniLabels();
  setInterval(ensureMiniLabels, 4000);

  /* ---------- 1. View choreography ---------- */
  const VIEW_META = {
    overview: ['VISÃO GERAL DO OPERADOR', 'Cockpit executivo e métricas do canal.', 'Início'],
    workflow: ['ESTÚDIO DE PRODUÇÃO', 'Roteiro 10k, narração, prompts e agendamento.', 'Modelador'],
    calendar: ['GRADE EDITORIAL & YOUTUBE', 'Lançamentos programados no canal e temas.', 'Calendário'],
    operator: ['DIRETRIZES & DNA DO CANAL', 'Tom de voz, regras bíblicas e estratégia.', 'Operador'],
    engagement: ['ENGAJAMENTO DO PÚBLICO', 'Comentários e respostas com IA.', 'Engajamento'],
    analytics: ['DESEMPENHO & RETENÇÃO', 'Transforme resultados nos próximos passos.', 'Estatísticas'],
    settings: ['CONFIGURAÇÕES & INTEGRAÇÕES', 'Chaves de API, credenciais e conexões.', 'Configurações']
  };
  let currentView = 'overview';
  const baseSwitchView = window.switchView;
  if (typeof baseSwitchView === 'function') {
    window.switchView = function (view) {
      if (!VIEW_META[view]) return baseSwitchView(view);
      const changed = view !== currentView;
      const previous = currentView;
      currentView = view;
      baseSwitchView(view);
      document.title = `Youtube - ${VIEW_META[view][2]}`;
      const section = $(`#${view}-view`);
      if (section) {
        // Directional slide: forward views enter from the right, back from the left.
        const order = Object.keys(VIEW_META);
        section.style.setProperty('--enter-from', order.indexOf(view) >= order.indexOf(previous) ? '1' : '-1');
        delete section.dataset.viewEnter;
        if (changed && !reduceMotion) {
          void section.offsetWidth; // restart animation
          section.dataset.viewEnter = 'true';
        }
        // Restagger static children + arm scroll reveals
        Array.from(section.children).forEach((child, i) => child.style.setProperty('--i', i));
        armReveals(section);
      }
    };
  }

  // Sincroniza título na carga direta por hash ou inicial
  const initialHash = (location.hash || '').replace('#', '');
  if (initialHash && VIEW_META[initialHash]) {
    currentView = initialHash;
    document.title = `Youtube - ${VIEW_META[initialHash][2]}`;
  } else {
    document.title = `Youtube - ${VIEW_META.overview[2]}`;
  }

  /* ---------- 2. Count-up instrumentation ---------- */
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  function countUp(el) {
    if (!el || reduceMotion) return;
    const raw = (el.textContent || '').trim();
    const match = raw.match(/^(\d[\d,]*)(.*)$/);
    if (!match) return;
    const target = Number(match[1].replaceAll(',', ''));
    if (!Number.isFinite(target) || target === 0 || target > 100000) return;
    if (el.dataset.counted === String(target)) return;
    el.dataset.counted = String(target);
    const suffix = match[2];
    const dur = 750;
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = `${Math.round(target * easeOut(t)).toLocaleString()}${suffix}`;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  const origRenderDashboard = window.renderDashboard;
  if (typeof origRenderDashboard === 'function') {
    window.renderDashboard = function (...args) {
      origRenderDashboard.apply(this, args);
      // Rail pause/resume glyph follows real system state
      document.body.dataset.automationPaused = String(Boolean(ui.state?.system?.automationPaused));
      requestAnimationFrame(() => {
        ['#stat-review', '#stat-scheduled', '#stat-published', '#analytics-total'].forEach(s => countUp($(s)));
        const score = $('#stat-score');
        if (score && /\d/.test(score.textContent)) {
          const rawScore = score.textContent.trim();
          if (score.dataset.lastScore !== rawScore) {
            score.dataset.lastScore = rawScore;
            score.dataset.counted = '';
            score.classList.remove('score-pop');
            void score.offsetWidth;
            score.classList.add('score-pop');
          }
        }
      });
    };
  }

  /* ---------- 3. Command palette ---------- */
  const palette = document.createElement('div');
  palette.className = 'cmdk-backdrop hidden';
  palette.innerHTML = `
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
      <div class="cmdk-head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input class="cmdk-input" type="text" placeholder="Buscar comando, tela ou ação… (ex: cortes, 10k, temas, youtube)" aria-label="Comando" autocomplete="off" spellcheck="false">
        <kbd>esc</kbd>
      </div>
      <div class="cmdk-list" role="listbox" aria-label="Comandos"></div>
      <div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> executar</span><span class="cmdk-brand">YouTube Automation Studio</span></div>
    </div>`;
  document.body.appendChild(palette);
  const listEl = palette.querySelector('.cmdk-list');
  const inputEl = palette.querySelector('.cmdk-input');

  function buildCommands() {
    const cmds = Object.entries(VIEW_META).map(([id, meta]) => ({
      group: 'Navegação', icon: 'view', label: meta[2],
      hint: meta[1], keywords: `${id} ${meta[2]} ${meta[0]} ir para tela`, run: () => window.switchView(id)
    }));

    const action = (group, label, hint, keywords, fn, iconKind = 'action') => ({
      group, icon: iconKind, label, hint, keywords, run: fn
    });

    const clickSelector = (selector, viewTarget = null) => {
      if (viewTarget && typeof window.switchView === 'function') {
        window.switchView(viewTarget);
      }
      setTimeout(() => {
        const el = $(selector);
        if (el) el.click();
      }, viewTarget ? 100 : 0);
    };

    // --- Produção & Modelador ---
    cmds.push(
      action('Produção & Modelador', '⚡ Envio Rápido de Cortes / Shorts', 'Postagem ágil de vídeos curtos em 9:16', 'corte cortes short shorts vertical video rapido postagem upload envio', () => {
        clickSelector('#btn-envio-cortes-top', 'workflow');
      }, 'cortes'),
      action('Produção & Modelador', '🚀 Retomar Produção Atual', 'Ir direto para a etapa em andamento no Modelador', 'retomar producao rascunho continuar workflow script', () => {
        clickSelector('#overview-quick-resume-btn', 'workflow');
      }),
      action('Produção & Modelador', '🎬 Novo Documentário (10.000 carac.)', 'Limpar estúdio e iniciar novo documentário bíblico', 'novo documentario 10k roteiro producao historia', () => {
        clickSelector('#overview-quick-new-doc-btn', 'workflow');
      }),
      action('Produção & Modelador', '📋 Inserir Roteiro Completo Pronto', 'Colar texto gerado externamente para fatiar em blocos', 'colar roteiro texto direto importar bloco narracao pronto', () => {
        clickSelector('#wf-toggle-direct-script-btn', 'workflow');
      }),
      action('Produção & Modelador', '🎨 Gerar 35 Prompts Google Flow', 'Criar prompts visuais cinematográficos para os blocos', 'google flow prompts imagens visual gerador prompts', () => {
        clickSelector('#wf-generate-google-flow-btn', 'workflow');
      }),
      action('Produção & Modelador', '🖼️ Gerar 3 Versões de Capa (Nano Banana)', 'Criar variações de miniaturas com IA', 'capa thumbnail nano banana miniatura gerar', () => {
        clickSelector('#wf-generate-nano-banana-btn', 'workflow');
      }),
      action('Produção & Modelador', '🚀 Gerar Metadados SEO (Título e Descrição)', 'Gerar título magnético, descrição e tags para YouTube', 'seo titulo descricao hashtags tags youtube metadados', () => {
        clickSelector('#wf-generate-seo-btn', 'workflow');
      })
    );

    // --- Grade & Calendário ---
    cmds.push(
      action('Grade & Calendário', '✨ Planejar 7 Novos Temas com IA', 'Criar cronograma com ganchos e referências bíblicas', 'planejar temas ia sugestoes cronograma calendario ideias pauta', () => {
        clickSelector('#overview-quick-plan-ai-btn', 'workflow');
      }),
      action('Grade & Calendário', '＋ Adicionar Tema Manual ao Calendário', 'Inserir novo tema avulso no cronograma', 'adicionar tema manual novo criar calendario pauta', () => {
        clickSelector('#cal-open-manual-btn', 'calendar');
      }),
      action('Grade & Calendário', '🔄 Sincronizar Vídeos do YouTube Studio', 'Atualizar grade com lançamentos agendados e publicados', 'sincronizar canal youtube studio videos agendados grade postados', () => {
        clickSelector('#cal-sync-yt-btn', 'calendar');
      }),
      action('Grade & Calendário', '🧹 Limpar Temas Duplicados', 'Remover temas repetidos do cronograma', 'limpar duplicados deduplicar cronograma temas', () => {
        clickSelector('#wf-deduplicate-themes-btn', 'workflow');
      }),
      action('Grade & Calendário', '📋 Exportar / Copiar Temas do Cronograma', 'Copiar lista de temas planejados para a área de transferência', 'copiar exportar temas cronograma backup', () => {
        clickSelector('#wf-export-themes-btn', 'workflow');
      })
    );

    // --- YouTube & Sistema ---
    cmds.push(
      action('YouTube & Sistema', '🔄 Atualizar Dados do Painel', 'Recarregar métricas e status agora', 'atualizar refresh reload sync dados painel', () => {
        clickSelector('#refresh-button');
      }),
      action('YouTube & Sistema', '🔍 Testar Conexão com YouTube', 'Verificar se o canal está ativo e autorizado', 'testar conexao youtube oauth token api status', () => {
        clickSelector('#yt-test-connection-btn', 'settings');
      }),
      action('YouTube & Sistema', '👤 Trocar Conta / Canal do YouTube', 'Alternar entre perfis e canais conectados', 'trocar conta canal youtube switch account alternar', () => {
        clickSelector('#yt-switch-account-btn', 'settings');
      }),
      action('YouTube & Sistema', '💬 Sincronizar Comentários do YouTube', 'Baixar novos comentários da audiência', 'comentarios engajamento sincronizar sync audiencia respostas', () => {
        clickSelector('#engagement-sync-button', 'engagement');
      }),
      action('YouTube & Sistema', '🤖 Gerar Rascunhos de Resposta com IA', 'Criar sugestões de resposta para os comentários', 'respostas rascunhos comentarios ia engajamento draft', () => {
        clickSelector('#engagement-draft-button', 'engagement');
      }),
      ui.state?.system?.automationPaused
        ? action('YouTube & Sistema', '▶️ Retomar Automação', 'Despausar o agendador e gerador automático', 'retomar unpause automacao play ligar', () => clickSelector('#automation-toggle'))
        : action('YouTube & Sistema', '⏸️ Pausar Automação', 'Pausar a geração agendada do sistema', 'pausar automacao stop pause desligar', () => clickSelector('#automation-toggle')),
      action('YouTube & Sistema', '🔑 Definir Chave de API do Painel', 'Salvar chave de acesso neste navegador', 'api key autenticacao credentials token', () => {
        clickSelector('#api-key-button', 'settings');
      })
    );

    return cmds;
  }

  let filtered = [];
  let selected = 0;

  function icon(kind) {
    if (kind === 'view') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    }
    if (kind === 'cortes') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6.5z"/></svg>';
  }

  function renderList() {
    const q = inputEl.value.trim().toLowerCase();
    const cmds = buildCommands();
    filtered = q ? cmds.filter(c => `${c.label} ${c.hint} ${c.keywords}`.toLowerCase().includes(q)) : cmds;
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    if (!filtered.length) {
      listEl.innerHTML = '<div class="cmdk-empty">Nenhum comando correspondente.</div>';
      return;
    }
    let lastGroup = '';
    listEl.innerHTML = filtered.map((c, i) => {
      const head = c.group !== lastGroup ? `<p class="cmdk-group">${c.group}</p>` : '';
      lastGroup = c.group;
      return `${head}<div class="cmdk-row ${i === selected ? 'selected' : ''}" role="option" aria-selected="${i === selected}" data-cmd="${i}">
        <span class="cmdk-icon">${icon(c.icon)}</span>
        <span class="cmdk-label">${c.label}</span>
        <span class="cmdk-hint">${c.hint}</span>
      </div>`;
    }).join('');
    listEl.querySelector('.cmdk-row.selected')?.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    palette.classList.remove('hidden');
    document.body.classList.add('cmdk-open');
    inputEl.value = '';
    selected = 0;
    renderList();
    requestAnimationFrame(() => inputEl.focus());
  }
  function closePalette() {
    palette.classList.add('hidden');
    document.body.classList.remove('cmdk-open');
  }
  function runCommand(index) {
    const cmd = filtered[index];
    if (!cmd) return;
    closePalette();
    setTimeout(() => cmd.run(), 60);
  }

  palette.addEventListener('click', event => {
    if (event.target === palette) return closePalette();
    const row = event.target.closest('[data-cmd]');
    if (row) runCommand(Number(row.dataset.cmd));
  });
  inputEl.addEventListener('input', () => { selected = 0; renderList(); });

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      return palette.classList.contains('hidden') ? openPalette() : closePalette();
    }
    if (!palette.classList.contains('hidden')) {
      if (event.key === 'Escape') { event.preventDefault(); return closePalette(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); selected = Math.min(filtered.length - 1, selected + 1); return renderList(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(0, selected - 1); return renderList(); }
      if (event.key === 'Enter') { event.preventDefault(); return runCommand(selected); }
      return;
    }
    // Typing guard: chords only outside form fields
    const tag = event.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable;
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === '/') { event.preventDefault(); return openPalette(); }
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      window.switchView('workflow');
      return;
    }
    // g-chords: g o → overview, g w/m → workflow, g c → calendar, g e → engagement, g a → analytics, g d → operator, g s → settings, g k/x → cortes
    if (event.key.toLowerCase() === 'g') {
      chordArmed = true;
      clearTimeout(chordTimer);
      chordTimer = setTimeout(() => { chordArmed = false; }, 1200);
      return;
    }
    if (chordArmed) {
      const key = event.key.toLowerCase();
      chordArmed = false;
      clearTimeout(chordTimer);

      if (key === 'k' || key === 'x') {
        event.preventDefault();
        window.switchView('workflow');
        if (typeof window.setWorkflowStudioMode === 'function') {
          window.setWorkflowStudioMode('cortes', true);
        }
        return;
      }

      const map = {
        o: 'overview',
        w: 'workflow',
        m: 'workflow',
        c: 'calendar',
        e: 'engagement',
        a: 'analytics',
        d: 'operator',
        s: 'settings'
      };
      const view = map[key];
      if (view) { event.preventDefault(); window.switchView(view); }
    }
  });
  let chordArmed = false;
  let chordTimer = null;

  // Visible trigger in the topbar
  const trigger = document.createElement('button');
  trigger.className = 'kbd-trigger';
  trigger.setAttribute('aria-label', 'Abrir paleta de comandos');
  trigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Buscar</span><kbd>Ctrl K</kbd>';
  trigger.addEventListener('click', openPalette);
  $('.top-actions').prepend(trigger);

  /* ---------- 4. Cursor spotlight + card glow + tilt ---------- */
  if (!reduceMotion) {
    const glowSelector = '.stat, .pipeline-item, .review-card, .job-card, .plan-card, .learning-card, .readiness-check, .retention-scene';
    const spotlight = $('.spotlight');
    let lastGlow = null;
    let spotlightRaf = 0;
    document.addEventListener('pointermove', event => {
      document.body.classList.add('has-pointer');
      if (spotlight) {
        cancelAnimationFrame(spotlightRaf);
        spotlightRaf = requestAnimationFrame(() => {
          spotlight.style.setProperty('--mx', `${event.clientX}px`);
          spotlight.style.setProperty('--my', `${event.clientY}px`);
        });
      }
      const el = event.target.closest?.(glowSelector);
      if (el !== lastGlow && lastGlow) lastGlow.style.setProperty('--gx', '');
      lastGlow = el;
      if (el) {
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--gx', `${event.clientX - rect.left}px`);
        el.style.setProperty('--gy', `${event.clientY - rect.top}px`);
      }
    }, { passive: true });

    // Subtle 3D tilt on stat cards
    $$('.stat').forEach(card => {
      card.addEventListener('pointermove', event => {
        const rect = card.getBoundingClientRect();
        const rx = ((event.clientY - rect.top) / rect.height - .5) * -4;
        const ry = ((event.clientX - rect.left) / rect.width - .5) * 4;
        card.style.transform = `perspective(700px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  /* ---------- 5. Button ripple ---------- */
  if (!reduceMotion) {
    document.addEventListener('pointerdown', event => {
      const button = event.target.closest('.button.primary, .button.secondary, .nav-item');
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const size = Math.max(rect.width, rect.height) * 2.1;
      ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - rect.left - size / 2}px;top:${event.clientY - rect.top - size / 2}px`;
      button.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    });
  }

  /* ---------- 6. Scroll reveals (static panels only) ---------- */
  const io = 'IntersectionObserver' in window && !reduceMotion
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        }
      }
    }, { threshold: .06, rootMargin: '0px 0px -36px 0px' })
    : null;
  function armReveals(scope) {
    if (!io) return;
    (scope || document).querySelectorAll('.panel:not(.revealed)').forEach(panel => {
      panel.classList.add('reveal');
      io.observe(panel);
    });
  }

  /* ---------- 7. Sticky topbar elevation ---------- */
  const topbar = $('.topbar');
  window.addEventListener('scroll', () => {
    document.body.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });
  if (topbar) armReveals(document);

  /* ---------- 8. Toast v2 (icon + slide, keeps API) ---------- */
  const origShowToast = window.showToast;
  if (typeof origShowToast === 'function') {
    window.showToast = function (message, type = 'success') {
      origShowToast(message, type);
      const iconPath = type === 'error'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.5v.5"/></svg>'
        : type === 'warning'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="m8 12.5 2.8 2.8L16.5 9"/></svg>';
      document.querySelectorAll('.toast:not(.hidden)').forEach(toast => {
        toast.innerHTML = `<span class="toast-icon ${type}">${iconPath}</span><span class="toast-msg"></span>`;
        toast.querySelector('.toast-msg').textContent = message;
        void toast.offsetWidth;
        toast.classList.add('armed');
      });
    };
  }

  /* ---------- 9. Live relative-time ticker ---------- */
  setInterval(() => {
    if (ui.state && !ui.refreshing && !document.hidden) {
      try {
        renderNotifications(ui.state.notifications || [], ui.state.events || []);
      } catch { /* next tick */ }
    }
  }, 30000);

  /* ---------- 10. Sidebar status cluster (clock + version) ---------- */
  const footer = $('.sidebar-footer');
  if (footer) {
    const cluster = document.createElement('div');
    cluster.className = 'console-meta';
    cluster.innerHTML = `
      <div class="console-clock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg><span>--:--</span></div>
      <span class="console-version">v2.8.0 · local</span>`;
    footer.prepend(cluster);
    const clockLabel = cluster.querySelector('.console-clock span');
    const tickClock = () => {
      clockLabel.textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    };
    tickClock();
    setInterval(tickClock, 15000);
  }

  /* ---------- 11. First-paint boot sequence ---------- */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.remove('preboot');
    armReveals($('.view.active'));
  }));
})();
