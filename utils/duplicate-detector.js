/**
 * Validador Anti-Repetição e Detector de Duplicidades de Conteúdo
 * Verifica sobreposição de títulos, temas, descrições e horários de publicação
 * para evitar canibalização de audiência e penalizações do algoritmo do YouTube.
 */

function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/#[\wÀ-ÿ]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWordTokens(text) {
  const stopWords = new Set([
    'a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
    'por', 'para', 'com', 'sem', 'sob', 'sobre', 'que', 'e', 'ou', 'se', 'um', 'uma',
    'di', 'da', 'del', 'della', 'dei', 'degli', 'delle', 'in', 'il', 'lo', 'la', 'i', 'gli', 'le',
    'un', 'uno', 'una', 'che', 'con', 'per', 'su', 'tra', 'fra', 'the', 'of', 'and', 'to', 'is', 'in'
  ]);
  return normalizeText(text)
    .split(' ')
    .filter(w => w.length > 2 && !stopWords.has(w));
}

function calculateSimilarity(textA, textB) {
  const normA = normalizeText(textA);
  const normB = normalizeText(textB);
  if (!normA || !normB) return 0;
  if (normA === normB) return 100;

  const tokensA = getWordTokens(textA);
  const tokensB = getWordTokens(textB);
  if (!tokensA.length || !tokensB.length) return 0;

  const setB = new Set(tokensB);
  const intersection = tokensA.filter(w => setB.has(w));
  const union = new Set([...tokensA, ...tokensB]);

  const jaccard = intersection.length / union.size;
  const overlapA = intersection.length / tokensA.length;
  const overlapB = intersection.length / tokensB.length;
  const score = Math.max(jaccard, (overlapA + overlapB) / 2);

  return Math.round(score * 100);
}

function checkContentDuplication({
  newTitle = '',
  newTopic = '',
  newPublishTime = null,
  newFormat = 'explainer',
  existingItems = [],
  excludeId = null
}) {
  const issues = [];
  const matches = [];

  const normNewTitle = normalizeText(newTitle || newTopic);
  const tokensNew = getWordTokens(newTitle || newTopic);

  // Normalizar data e hora de forma segura sem distorção de fuso horário
  let newDateIso = null;
  let newTimeStr = null;
  if (newPublishTime) {
    if (typeof newPublishTime === 'string') {
      const parts = newPublishTime.trim().split(/[T ]/);
      if (parts[0] && parts[0].includes('-')) {
        newDateIso = parts[0];
      }
      if (parts[1]) {
        newTimeStr = parts[1].slice(0, 5);
      }
    }
    if (!newDateIso || !newTimeStr) {
      try {
        const d = new Date(newPublishTime);
        if (!isNaN(d.getTime())) {
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          newDateIso = newDateIso || `${year}-${month}-${day}`;
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          newTimeStr = newTimeStr || `${hh}:${mm}`;
        }
      } catch (_) {}
    }
  }

  for (const item of existingItems) {
    if (!item) continue;
    if (excludeId && String(item.id) === String(excludeId)) continue;

    const itemTitle = item.title || item.topic || '';
    const normItemTitle = normalizeText(itemTitle);
    const itemStatus = item.status || 'pending';
    const isPosted = itemStatus === 'posted';
    const isShort = item.format === 'short' || /#shorts?/i.test(itemTitle);
    
    let itemDate = item.scheduled_date || null;
    let itemTime = item.scheduled_time || null;
    if (!itemDate && item.publish_time) {
      const p = String(item.publish_time).split(/[T ]/);
      itemDate = p[0];
      if (p[1]) itemTime = itemTime || p[1].slice(0, 5);
    }
    if (itemTime && itemTime.length > 5) {
      itemTime = itemTime.slice(0, 5);
    }

    // 1. DUPLICIDADE EXATA DE TÍTULO / TEMA (BLOQUEIO TOTAL)
    if (normNewTitle && normItemTitle && normNewTitle === normItemTitle) {
      if (!isPosted) {
        // Se o item não está postado no YouTube e é o mesmo tema planejado, é o próprio item sendo publicado!
        continue;
      }
      const statusLabel = 'já publicado no YouTube';
      issues.push({
        type: 'exact_title',
        severity: 'block',
        message: `⛔ TÍTULO DUPLICADO: Já existe um conteúdo com este exato título (${statusLabel}): "${itemTitle}".`,
        item
      });
      matches.push({ id: item.id, title: itemTitle, status: itemStatus, similarity: 100, type: 'exact_title' });
      continue;
    }

    // 2. CONFLITO EXATO DE DATA E HORÁRIO (BLOQUEIO TOTAL)
    if (newDateIso && itemDate && newDateIso === itemDate) {
      if (newTimeStr && itemTime && newTimeStr === itemTime) {
        const sim = calculateSimilarity(newTitle || newTopic, itemTitle);
        const isSamePlannedTheme = !isPosted && (
          normNewTitle === normItemTitle || 
          sim >= 40 || 
          itemStatus === 'in_production' ||
          (excludeId && String(item.id) === String(excludeId))
        );

        if (!isSamePlannedTheme) {
          const statusLabel = isPosted ? 'já postado no YouTube' : 'ocupado por outro vídeo planejado';
          issues.push({
            type: 'same_datetime',
            severity: 'block',
            message: `⛔ HORÁRIO OCUPADO: O horário de ${newDateIso} às ${newTimeStr} está ${statusLabel} ("${itemTitle}").`,
            item
          });
          matches.push({ id: item.id, title: itemTitle, status: itemStatus, type: 'same_datetime' });
        }
      }
    }

    // 3. SOBREPOSIÇÃO TEMÁTICA ALTA (AVISO DE DERIVAÇÃO / REPETIÇÃO)
    // Se é o próprio tema planejado não postado sendo publicado, não gera conflito consigo mesmo
    if (!isPosted && (itemStatus === 'in_production' || normNewTitle === normItemTitle)) {
      continue;
    }

    const sim = calculateSimilarity(newTitle || newTopic, itemTitle);
    const tokensItem = getWordTokens(itemTitle);
    const common = tokensNew.filter(w => tokensItem.includes(w));

    // Se compartilha pelo menos 4 palavras-chave substantivas ou similaridade >= 55%
    if (sim >= 55 || (common.length >= 4 && tokensNew.length >= 4)) {
      const isComplementaryShort = newFormat === 'short' && !isShort;
      issues.push({
        type: 'similar_theme',
        severity: isComplementaryShort ? 'warning' : 'block',
        similarity: sim,
        commonWords: common,
        message: isComplementaryShort
          ? `⚠️ TEMA RELACIONADO: Este corte compartilha tema com o vídeo longo "${itemTitle}" (${isPosted ? 'Já Postado' : 'No Cronograma'}). Diferencie o título para maximizar retenção.`
          : `⚠️ ALTA SIMILARIDADE (${sim}%): O tema é muito semelhante a "${itemTitle}". Evite repetição no canal.`,
        item
      });
      matches.push({ id: item.id, title: itemTitle, status: itemStatus, similarity: sim, type: 'similar_theme' });
    }
  }

  const hasBlockingIssue = issues.some(i => i.severity === 'block');

  return {
    isClean: issues.length === 0,
    hasBlockingIssue,
    issues,
    matches
  };
}

module.exports = {
  normalizeText,
  getWordTokens,
  calculateSimilarity,
  checkContentDuplication
};
