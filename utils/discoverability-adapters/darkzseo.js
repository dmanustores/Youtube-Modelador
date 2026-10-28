const { spawn } = require('child_process');
const path = require('path');

const AUTHORITY_DOMAINS = [
  '.gov', '.edu', 'wikipedia.org', 'statista.com', 'nature.com',
  'ncbi.nlm.nih.gov', 'scholar.google.com', 'pubmed.gov', 'cdc.gov',
  'who.int', 'nih.gov', 'ieee.org', 'acm.org'
];
const COMPARISON_KEYWORDS = new Set(['vs', 'versus', 'best', 'compare', 'comparison', 'top', 'review']);
const QUESTION_WORDS = new Set(['what', 'how', 'why', 'when', 'where', 'which', 'who', 'can', 'does', 'is', 'are']);
const UNIT_PATTERN = /\b\d+\s*(kg|lbs?|oz|g|in|cm|mm|ft|m|km|mi|°[cf]|mph|kph|gb|mb|tb)\b/i;

function text(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return text(value.text || value.content || value.description || '');
  return String(value || '').trim();
}

function words(value) {
  return text(value).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || [];
}

function syllables(value) {
  let word = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;
  if (word.endsWith('e')) word = word.slice(0, -1);
  const groups = word.match(/[aeiouy]+/g);
  return Math.max(1, groups?.length || 1);
}

function hasAuthoritySource(sources) {
  return sources.some(source => {
    try {
      const hostname = new URL(String(source?.url || '')).hostname.toLowerCase();
      return AUTHORITY_DOMAINS.some(domain => hostname.endsWith(domain) || hostname.includes(domain));
    } catch (_error) {
      return false;
    }
  });
}

function auditContent(contentPackage = {}) {
  const target = String(contentPackage.id || contentPackage.contentId || '<content>');
  const platform = String(contentPackage.platform || 'generic').toLowerCase();
  const applicability = platform === 'generic' ? ['content'] : [platform, 'content'];
  const title = text(contentPackage.title);
  const description = text(contentPackage.description);
  const transcript = text(contentPackage.transcript || contentPackage.script);
  const brand = text(contentPackage.brand || 'Brand');
  const sources = Array.isArray(contentPackage.sources) ? contentPackage.sources : [];
  const sections = Array.isArray(contentPackage.sections) ? contentPackage.sections : [];
  const opening = words(`${title} ${description} ${transcript}`).slice(0, 200).join(' ');
  const combined = [title, description, transcript].filter(Boolean).join('\n');
  const findings = [];
  const addFinding = (ruleId, category, severity, message, remediation) => findings.push({
    ruleId, category, severity, file: target, message, remediation, applicability,
    timestamp: new Date().toISOString()
  });

  if (brand && brand.toLowerCase() !== 'brand' && !opening.toLowerCase().includes(brand.toLowerCase())) {
    addFinding(
      'geo.entity_salience', 'GEO', 'MEDIUM',
      `Destaque de marca: A marca "${brand}" não foi mencionada no título ou introdução`,
      'Mencione a marca ou o canal naturalmente no título, descrição ou nas primeiras 200 palavras.'
    );
  }
  if (words(transcript).length >= 1000 && !hasAuthoritySource(sources)) {
    addFinding(
      'geo.trust_network', 'GEO', 'HIGH',
      'Rede de confiança: Conteúdo longo sem fontes de autoridade vinculadas',
      'Vincule ao menos uma fonte de autoridade oficial ou regulatória verificada a este conteúdo factual.'
    );
  }
  if (title.toLowerCase().split(/\s+/).some(word => COMPARISON_KEYWORDS.has(word)) && !contentPackage.hasComparisonTable) {
    addFinding(
      'aio.comparison_intent', 'AIO', 'HIGH',
      'Estrutura comparativa: Ausência de segmento comparativo estruturado',
      'Adicione uma seção de comparação estruturada com critérios consistentes e uma conclusão clara.'
    );
  }
  transcript.split(/\n\s*\n+/).map(part => part.trim()).filter(Boolean).forEach((paragraph, index) => {
    if (words(paragraph).length > 150) {
      addFinding(
        'aio.skimmability', 'AIO', 'MEDIUM',
        `Legibilidade e ritmo: O parágrafo ${index + 1} excede 150 palavras`,
        'Divida o trecho do roteiro em falas mais curtas ou parágrafos alinhados aos capítulos do vídeo.'
      );
    }
  });
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const heading = text(section.title || section.heading);
    const answer = text(section.content || section.text);
    const headingWords = heading.toLowerCase().split(/\s+/).filter(Boolean);
    if (!headingWords.length || (!QUESTION_WORDS.has(headingWords[0]) && !heading.endsWith('?'))) continue;
    if (!answer || words(answer).length > 60) {
      addFinding(
        'aio.direct_answer', 'AIO', 'MEDIUM',
        `Resposta direta: A resposta para "${heading.slice(0, 40)}" deve ter menos de 60 palavras`,
        'Inicie a seção com uma resposta direta e concisa (menos de 60 palavras) antes de detalhar.'
      );
    }
    const answerWords = words(answer);
    if (answerWords.length && answerWords.filter(word => syllables(word) >= 3).length / answerWords.length > 0.2) {
      addFinding(
        'aeo.simplicity', 'AEO', 'MEDIUM',
        `Clareza de vocabulário: A resposta para "${heading.slice(0, 40)}" está muito densa ou complexa`,
        'Utilize palavras e frases mais curtas e diretas na parte de resposta rápida desta seção.'
      );
    }
  }
  if (UNIT_PATTERN.test(combined) && !contentPackage.unitsExplained) {
    addFinding(
      'aeo.unit_clarity', 'AEO', 'LOW',
      'Clareza de unidades: Medidas citadas sem contextualização ou expansão explicativa',
      'Explique ou detalhe o significado da unidade de medida na primeira menção falada ou na descrição.'
    );
  }

  const severity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  const category = { SEO: 0, GEO: 0, AIO: 0, AEO: 0 };
  for (const finding of findings) {
    severity[finding.severity]++;
    category[finding.category]++;
  }
  const blocking = findings.some(finding => ['CRITICAL', 'HIGH'].includes(finding.severity));
  return {
    schemaVersion: '1.0',
    engine: { name: 'darkzseo', version: '1.4.0-bundled' },
    mode: 'content',
    target,
    status: blocking ? 'attention_required' : findings.length ? 'advisory' : 'passed',
    generatedAt: new Date().toISOString(),
    itemsScanned: 1,
    totalFindings: findings.length,
    summary: { severity, category },
    findings
  };
}

class DarkzSEOAdapter {
  constructor(options = {}) {
    this.spawnProcess = options.spawnProcess || spawn;
    this.python = options.python || process.env.DARKZSEO_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    this.scriptPath = Object.prototype.hasOwnProperty.call(options, 'scriptPath')
      ? options.scriptPath
      : this.resolveScriptPath();
    this.timeoutMs = Number(options.timeoutMs || process.env.DARKZSEO_TIMEOUT_MS || 30000);
    this.maxOutputBytes = Number(options.maxOutputBytes || 2 * 1024 * 1024);
  }

  resolveScriptPath() {
    if (process.env.DARKZSEO_PATH) return path.resolve(process.env.DARKZSEO_PATH);
    return null;
  }

  command() {
    if (!this.scriptPath) return null;
    return {
      executable: this.python,
      args: [this.scriptPath, '--mode', 'content', '--input-json', '-', '--json-stdout', '--no-html', '--fail-on', 'none']
    };
  }

  childEnvironment() {
    const allowed = [
      'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
      'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PYTHONPATH', 'VIRTUAL_ENV'
    ];
    const environment = { PYTHONUTF8: '1' };
    for (const key of allowed) {
      if (process.env[key] !== undefined) environment[key] = process.env[key];
    }
    return environment;
  }

  async audit(contentPackage) {
    const command = this.command();
    if (!command) return auditContent(contentPackage);
    try {
      return await this.auditExternal(command, contentPackage);
    } catch (_error) {
      return auditContent(contentPackage);
    }
  }

  async auditExternal(command, contentPackage) {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(command.executable, command.args, {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.childEnvironment()
      });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        const error = new Error(`DarkzSEO timed out after ${this.timeoutMs}ms`);
        error.code = 'DARKZSEO_TIMEOUT';
        finish(reject, error);
      }, this.timeoutMs);

      child.on('error', error => {
        error.code = error.code === 'ENOENT' ? 'DARKZSEO_UNAVAILABLE' : (error.code || 'DARKZSEO_PROCESS_ERROR');
        finish(reject, error);
      });
      child.stdout.on('data', chunk => {
        stdout += chunk.toString('utf8');
        if (Buffer.byteLength(stdout, 'utf8') > this.maxOutputBytes) {
          child.kill();
          const error = new Error('DarkzSEO returned more output than allowed');
          error.code = 'DARKZSEO_OUTPUT_LIMIT';
          finish(reject, error);
        }
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString('utf8');
      });
      child.on('close', code => {
        if (settled) return;
        if (code !== 0) {
          const error = new Error(`DarkzSEO exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
          error.code = 'DARKZSEO_FAILED';
          return finish(reject, error);
        }
        try {
          const report = JSON.parse(stdout);
          if (report.schemaVersion !== '1.0' || report.engine?.name !== 'darkzseo' || !Array.isArray(report.findings)) {
            const error = new Error('DarkzSEO returned an unsupported report schema');
            error.code = 'DARKZSEO_SCHEMA_MISMATCH';
            return finish(reject, error);
          }
          return finish(resolve, report);
        } catch (parseError) {
          const error = new Error(`DarkzSEO returned invalid JSON: ${parseError.message}`);
          error.code = 'DARKZSEO_INVALID_JSON';
          return finish(reject, error);
        }
      });

      child.stdin.end(JSON.stringify(contentPackage));
    });
  }
}

module.exports = { DarkzSEOAdapter, auditContent };
