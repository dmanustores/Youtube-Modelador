const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_TAGS_LENGTH = 450;

function removeControlCharacters(value, replacement = '') {
  return Array.from(String(value ?? '')).map(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? replacement : character;
  }).join('');
}

function cleanText(value) {
  return removeControlCharacters(value, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Higieniza a descrição do YouTube preservando rigorosamente quebras de linha (\n),
 * múltiplos parágrafos e espaçamento correto de timestamps de capítulos.
 */
function cleanYouTubeDescription(value) {
  if (value == null) return '';
  let str = String(value);

  // 1. Converter quebras de linha literais '\\n' em quebras reais '\n' caso tenham sido escapadas
  str = str.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n');

  // 2. Normalizar quebras de linha para \n
  str = str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Remover caracteres de controle nocivos, mas PRESERVAR ESTRITAMENTE \n (10) e \t (9)
  str = Array.from(str).map(character => {
    const code = character.charCodeAt(0);
    if (code === 10 || code === 9) return character;
    if (code <= 31 || code === 127) return '';
    return character;
  }).join('');

  // 4. Garantir que o timestamp inicial 00:00 fique separado por linha em branco do texto anterior
  str = str.replace(/([^\n\r])\s*(00:00\b)/g, '$1\n\n$2');

  // 5. Garantir que cada timestamp (ex: 02:30, 10:30) fique em sua própria linha isolada
  str = str.replace(/([^\n\r:])\s*(\d{1,2}:\d{2}(?::\d{2})?\b)/g, '$1\n$2');

  // 6. Se o bloco de hashtags (#Tag1 #Tag2) estiver colado no final do parágrafo, garantir linha em branco antes
  str = str.replace(/([^\n\r#\s])\s*(#[a-zA-Z0-9À-ÿ_]+)/g, '$1\n\n$2');

  // 7. Colapsar mais de duas quebras consecutivas em no máximo duas quebras
  str = str.replace(/\n{3,}/g, '\n\n');

  return str.slice(0, MAX_DESCRIPTION_LENGTH).trim();
}

function normalizeTags(input) {
  const values = Array.isArray(input) ? input : String(input || '').split(',');
  const unique = [];
  const seen = new Set();
  let totalLength = 0;

  for (const value of values) {
    const tag = cleanText(value).replace(/^#+/, '').replaceAll('"', '').slice(0, 100).trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    const nextLength = totalLength + tag.length + (unique.length ? 1 : 0);
    if (nextLength > MAX_TAGS_LENGTH || unique.length >= 30) break;
    unique.push(tag);
    seen.add(key);
    totalLength = nextLength;
  }

  return unique;
}

function normalizeYouTubeMetadata(metadata = {}) {
  const snippet = metadata.snippet || metadata.seo || metadata;
  const channelLang = (process.env.CHANNEL_LANGUAGE || 'it').split('-')[0].trim();
  return {
    title: cleanText(snippet.title).slice(0, MAX_TITLE_LENGTH),
    description: cleanYouTubeDescription(snippet.description),
    tags: normalizeTags(snippet.tags),
    categoryId: String(snippet.categoryId ?? snippet.metadata?.category ?? '22').trim(),
    defaultLanguage: String(snippet.defaultLanguage ?? snippet.language ?? snippet.metadata?.language ?? channelLang).trim(),
    defaultAudioLanguage: String(snippet.defaultAudioLanguage ?? snippet.audioLanguage ?? snippet.language ?? snippet.metadata?.language ?? channelLang).trim()
  };
}

function validateYouTubeMetadata(metadata = {}) {
  const value = normalizeYouTubeMetadata(metadata);
  const errors = [];
  const warnings = [];

  if (!value.title) errors.push('A video title is required.');
  if (value.title.length > MAX_TITLE_LENGTH) errors.push(`Title exceeds ${MAX_TITLE_LENGTH} characters.`);
  if (!value.description) warnings.push('The video description is empty.');
  if (value.description.length > MAX_DESCRIPTION_LENGTH) errors.push(`Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`);
  if (!/^\d{1,3}$/.test(value.categoryId)) errors.push('YouTube category must be a numeric category ID.');
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value.defaultLanguage)) errors.push('Default language must be a valid language code.');
  if (value.tags.length < 3) warnings.push('Fewer than three usable tags remain after validation.');

  return { valid: errors.length === 0, errors, warnings, value };
}

function assertValidYouTubeMetadata(metadata = {}) {
  const result = validateYouTubeMetadata(metadata);
  if (!result.valid) {
    const error = new Error(`YouTube metadata is invalid: ${result.errors.join(' ')}`);
    error.code = 'INVALID_YOUTUBE_METADATA';
    error.validation = result;
    throw error;
  }
  return result;
}

module.exports = {
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS_LENGTH,
  cleanYouTubeDescription,
  normalizeTags,
  normalizeYouTubeMetadata,
  validateYouTubeMetadata,
  assertValidYouTubeMetadata
};
