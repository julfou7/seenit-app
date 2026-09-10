const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AUDITOR_SCHEMA_VERSION = 1;
const MAX_INPUT_EVENTS = 5000;
const MAX_NEW_ISSUES_PER_RUN = 3;
const MAX_NEW_ISSUES_PER_UTC_DAY = 3;
const EXISTING_ISSUE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const AUTO_CREATED_MARKER = 'Créée automatiquement par l’auditeur de logs SeenIt';
const FINGERPRINT_PREFIX = 'seenit-log-fingerprint:';

const RULES = Object.freeze({
  API_UNHANDLED_ERROR: Object.freeze({
    autoIssue: true,
    domain: 'runtime',
    impact: 'Des requêtes backend terminent en erreur 500 de manière répétée.',
    investigation: 'Identifier le handler associé au code stable, reproduire sans données utilisateur puis ajouter un TNR ciblé.',
    priority: 'P1',
    threshold: 5,
    title: 'Erreurs API non gérées répétées'
  }),
  BACKEND_STARTUP_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'runtime',
    impact: 'Le backend échoue plusieurs fois avant de pouvoir servir les parcours SeenIt.',
    investigation: 'Contrôler la révision Cloud Run, le code stable de démarrage et les dépendances de configuration sans exporter leur valeur.',
    priority: 'P1',
    threshold: 2,
    title: 'Échecs répétés du démarrage backend'
  }),
  PLEX_SYNC_PARTIAL: Object.freeze({
    autoIssue: false,
    domain: 'plex',
    impact: 'Des collectes Plex restent partielles ; une indisponibilité ponctuelle peut toutefois être normale.',
    investigation: 'Réévaluer le taux et les causes techniques avant toute activation de création automatique.',
    priority: 'P2',
    threshold: 20,
    title: 'Synchronisations Plex partielles répétées'
  })
});

const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,79}$/;
const SAFE_CORRELATION_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'UNKNOWN']);

function redactText(value) {
  return String(value || '')
    .slice(0, 4000)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [MASQUÉ]')
    .replace(/([?&](?:token|apikey|api_key|secret|sid|password)=)[^&#\s]+/gi, '$1[MASQUÉ]')
    .replace(/(X-Plex-Token\s*[:=]\s*)[^\s,;]+/gi, '$1[MASQUÉ]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_MASQUÉ]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[IDENTIFIANT_MASQUÉ]')
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, '[CHEMIN_MASQUÉ]')
    .replace(/\/(?:home|Users|private|tmp|var)\/[^\s,;]*/g, '[CHEMIN_MASQUÉ]');
}

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return '[PROFONDEUR_LIMITÉE]';
  if (typeof value === 'string') return redactText(value);
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(entry => sanitizeValue(entry, depth + 1));
  if (typeof value !== 'object') return redactText(value);

  const safe = {};
  for (const [key, entry] of Object.entries(value).slice(0, 30)) {
    if (/(authorization|cookie|password|secret|token|api[_-]?key|sid|uid|user(?:id)?|email|path|url|title|message)/i.test(key)) {
      safe[key] = '[MASQUÉ]';
    } else {
      safe[key] = sanitizeValue(entry, depth + 1);
    }
  }
  return safe;
}

function normalizeCode(value, fallback = 'UNKNOWN_EVENT') {
  const code = String(value || '').trim().toUpperCase();
  return SAFE_CODE_PATTERN.test(code) ? code : fallback;
}

function normalizeMethod(value) {
  const method = String(value || '').trim().toUpperCase();
  return SAFE_METHODS.has(method) ? method : 'UNKNOWN';
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(100, Math.floor(count)));
}

function normalizeRuleContext(code, context = {}) {
  if (code === 'API_UNHANDLED_ERROR') {
    return {
      errorCode: normalizeErrorCode(context.errorCode, 'API_ERROR'),
      method: normalizeMethod(context.method)
    };
  }
  if (code === 'BACKEND_STARTUP_FAILED') {
    return { errorCode: normalizeErrorCode(context.errorCode, 'STARTUP_ERROR') };
  }
  if (code === 'PLEX_SYNC_PARTIAL') {
    return {
      mode: context.mode === 'delta' ? 'delta' : 'full',
      incompleteSourceCount: normalizeCount(context.incompleteSourceCount)
    };
  }
  return {};
}

function normalizeErrorCode(value, fallback) {
  const code = normalizeCode(value, fallback);
  if (code.length > 20 && !/[_:-]/.test(code)) return fallback;
  return code;
}

function fingerprintContext(code, context) {
  if (code === 'API_UNHANDLED_ERROR') {
    return { errorCode: context.errorCode, method: context.method };
  }
  if (code === 'BACKEND_STARTUP_FAILED') return { errorCode: context.errorCode };
  if (code === 'PLEX_SYNC_PARTIAL') return { mode: context.mode };
  return {};
}

function extractEnvelope(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.seenitEvent && typeof entry.seenitEvent === 'object') return entry.seenitEvent;
  if (entry.jsonPayload?.seenitEvent && typeof entry.jsonPayload.seenitEvent === 'object') {
    return entry.jsonPayload.seenitEvent;
  }
  if (typeof entry.textPayload === 'string' && entry.textPayload.length <= 10_000) {
    try {
      const parsed = JSON.parse(entry.textPayload);
      return parsed?.seenitEvent && typeof parsed.seenitEvent === 'object' ? parsed.seenitEvent : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeEvent(entry) {
  const envelope = extractEnvelope(entry);
  if (!envelope || Number(envelope.schemaVersion) !== AUDITOR_SCHEMA_VERSION) return null;

  const timestampValue = envelope.timestamp || entry.timestamp;
  const timestampMs = Date.parse(String(timestampValue || ''));
  if (!Number.isFinite(timestampMs)) return null;

  const normalizedCode = normalizeCode(envelope.code);
  const rule = RULES[normalizedCode] || null;
  const code = rule ? normalizedCode : 'UNKNOWN_EVENT';
  const domain = rule?.domain || 'unknown';
  const correlationId = SAFE_CORRELATION_PATTERN.test(String(envelope.correlationId || ''))
    ? String(envelope.correlationId)
    : null;

  return {
    code,
    context: rule ? normalizeRuleContext(code, envelope.context) : {},
    correlationId,
    domain,
    level: envelope.level === 'warn' ? 'warn' : 'error',
    rule,
    timestamp: new Date(timestampMs).toISOString()
  };
}

function createFingerprint(event) {
  const identity = JSON.stringify({
    schemaVersion: AUDITOR_SCHEMA_VERSION,
    domain: event.domain,
    code: event.code,
    context: fingerprintContext(event.code, event.context)
  });
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20);
}

function analyzeLogEntries(entries, options = {}) {
  const source = Array.isArray(entries) ? entries : [];
  const limited = source.slice(0, MAX_INPUT_EVENTS);
  const groupsByFingerprint = new Map();
  let rejectedCount = 0;

  for (const entry of limited) {
    const event = normalizeEvent(entry);
    if (!event) {
      rejectedCount += 1;
      continue;
    }
    const fingerprint = createFingerprint(event);
    let group = groupsByFingerprint.get(fingerprint);
    if (!group) {
      group = {
        autoIssue: Boolean(event.rule?.autoIssue),
        code: event.code,
        context: event.context,
        correlationId: event.correlationId,
        count: 0,
        domain: event.domain,
        fingerprint,
        firstOccurrence: event.timestamp,
        impact: event.rule?.impact || 'Événement non reconnu conservé pour revue.',
        investigation: event.rule?.investigation || 'Qualifier le code et sa sécurité avant de créer une règle.',
        lastOccurrence: event.timestamp,
        priority: event.rule?.priority || 'P2',
        threshold: event.rule?.threshold || null,
        title: event.rule?.title || 'Événement inconnu'
      };
      groupsByFingerprint.set(fingerprint, group);
    }

    group.count += 1;
    if (event.timestamp < group.firstOccurrence) group.firstOccurrence = event.timestamp;
    if (event.timestamp > group.lastOccurrence) {
      group.lastOccurrence = event.timestamp;
      group.correlationId = event.correlationId;
    }
  }

  const groups = [...groupsByFingerprint.values()]
    .map(group => ({
      ...group,
      decision: !RULES[group.code]
        ? 'unknown_report_only'
        : group.count < group.threshold
          ? 'below_threshold'
          : group.autoIssue
            ? 'candidate'
            : 'known_report_only'
    }))
    .sort((left, right) => right.count - left.count || left.fingerprint.localeCompare(right.fingerprint));

  return {
    acceptedCount: limited.length - rejectedCount,
    candidates: groups.filter(group => group.decision === 'candidate'),
    generatedAt: (options.now || new Date()).toISOString(),
    groups,
    inputCount: source.length,
    rejectedCount,
    truncatedCount: Math.max(0, source.length - limited.length)
  };
}

function fingerprintMarker(fingerprint) {
  return `${FINGERPRINT_PREFIX}${fingerprint}`;
}

function buildIssueTitle(group) {
  const domain = group.domain === 'plex' ? 'Plex' : 'Runtime';
  return `[${group.priority}][${domain}] ${group.title}`;
}

function buildSafeSample(group) {
  return sanitizeValue({
    code: group.code,
    context: group.context,
    correlationId: group.correlationId ? group.correlationId.slice(0, 12) : 'indisponible',
    domain: group.domain
  });
}

function buildIssueBody(group) {
  return [
    `<!-- ${fingerprintMarker(group.fingerprint)} -->`,
    `_${AUTO_CREATED_MARKER}._`,
    '',
    '## Signal agrégé',
    '',
    `- Première occurrence : ${group.firstOccurrence}`,
    `- Dernière occurrence : ${group.lastOccurrence}`,
    `- Occurrences dans le lot : **${group.count}** (seuil : ${group.threshold})`,
    `- Domaine / code : \`${group.domain}\` / \`${group.code}\``,
    `- Fingerprint : \`${fingerprintMarker(group.fingerprint)}\``,
    '',
    '## Exemple redigé',
    '',
    '```json',
    JSON.stringify(buildSafeSample(group), null, 2),
    '```',
    '',
    '## Impact estimé',
    '',
    group.impact,
    '',
    '## Piste d’investigation',
    '',
    group.investigation,
    '',
    '> Ce signal ne contient aucun dump brut. L’issue ne doit jamais être fermée automatiquement.'
  ].join('\n');
}

function buildIssueUpdateComment(group) {
  return [
    `<!-- ${fingerprintMarker(group.fingerprint)} -->`,
    `Nouvelle agrégation automatique redigée : **${group.count} occurrence(s)** entre`,
    `\`${group.firstOccurrence}\` et \`${group.lastOccurrence}\`.`,
    '',
    `Contexte technique allowlisté : \`${JSON.stringify(buildSafeSample(group))}\`.`
  ].join('\n');
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'live' || mode === 'off' ? mode : 'dry-run';
}

function isWithinCooldown(updatedAt, now) {
  const updatedMs = Date.parse(String(updatedAt || ''));
  return Number.isFinite(updatedMs) && now.getTime() - updatedMs < EXISTING_ISSUE_COOLDOWN_MS;
}

async function executeAudit({ analysis, github, mode, now = new Date(), sourceStatus = 'ok' }) {
  const normalizedMode = normalizeMode(mode);
  const result = {
    ...analysis,
    actions: [],
    degraded: false,
    mode: normalizedMode,
    sourceStatus
  };

  if (normalizedMode === 'off') {
    result.actions.push({ decision: 'kill_switch', detail: 'Écriture GitHub et collecte désactivées.' });
    return result;
  }

  if (sourceStatus !== 'ok') {
    result.degraded = true;
    result.actions.push({ decision: 'source_unavailable', detail: 'Source Cloud Logging indisponible ; aucune écriture GitHub.' });
    return result;
  }

  let newIssuesToday = null;
  let createdThisRun = 0;

  for (const group of analysis.candidates) {
    let existing = null;
    try {
      existing = github ? await github.findOpenIssue(group.fingerprint) : null;
    } catch {
      result.degraded = true;
      result.actions.push({ decision: 'github_unavailable', fingerprint: group.fingerprint });
      continue;
    }

    if (normalizedMode === 'dry-run') {
      result.actions.push({
        decision: existing ? 'dry_run_would_update' : 'dry_run_would_create',
        fingerprint: group.fingerprint,
        issueNumber: existing?.number || null
      });
      continue;
    }

    if (!github) {
      result.degraded = true;
      result.actions.push({ decision: 'github_unavailable', fingerprint: group.fingerprint });
      continue;
    }

    if (existing) {
      if (isWithinCooldown(existing.updatedAt, now)) {
        result.actions.push({
          decision: 'existing_issue_cooldown',
          fingerprint: group.fingerprint,
          issueNumber: existing.number
        });
        continue;
      }
      try {
        await github.addIssueComment(existing.number, buildIssueUpdateComment(group));
        result.actions.push({
          decision: 'existing_issue_updated',
          fingerprint: group.fingerprint,
          issueNumber: existing.number
        });
      } catch {
        result.degraded = true;
        result.actions.push({ decision: 'github_unavailable', fingerprint: group.fingerprint });
      }
      continue;
    }

    if (createdThisRun >= MAX_NEW_ISSUES_PER_RUN) {
      result.actions.push({ decision: 'run_rate_limited', fingerprint: group.fingerprint });
      continue;
    }

    try {
      if (newIssuesToday === null) newIssuesToday = await github.countIssuesCreatedSinceUtcDay(now);
      if (newIssuesToday + createdThisRun >= MAX_NEW_ISSUES_PER_UTC_DAY) {
        result.actions.push({ decision: 'daily_rate_limited', fingerprint: group.fingerprint });
        continue;
      }
      const created = await github.createIssue(buildIssueTitle(group), buildIssueBody(group));
      createdThisRun += 1;
      result.actions.push({
        decision: 'new_issue_created',
        fingerprint: group.fingerprint,
        issueNumber: created.number
      });
    } catch {
      result.degraded = true;
      result.actions.push({ decision: 'github_unavailable', fingerprint: group.fingerprint });
    }
  }

  return result;
}

function createGithubClient({ fetchImpl = globalThis.fetch, repository, token }) {
  if (typeof fetchImpl !== 'function') throw new Error('Client HTTP GitHub indisponible.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))) {
    throw new Error('Dépôt GitHub invalide.');
  }
  if (!String(token || '').trim()) throw new Error('Jeton GitHub absent.');

  async function request(apiPath, options = {}) {
    const response = await fetchImpl(`https://api.github.com${apiPath}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'seenit-log-auditor',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`GitHub API indisponible (${response.status}).`);
    return response.status === 204 ? null : response.json();
  }

  async function searchIssues(query) {
    const payload = await request(`/search/issues?q=${encodeURIComponent(query)}&per_page=10`);
    return payload || { items: [], total_count: 0 };
  }

  return {
    async addIssueComment(issueNumber, body) {
      await request(`/repos/${repository}/issues/${issueNumber}/comments`, {
        body: JSON.stringify({ body }),
        method: 'POST'
      });
    },
    async countIssuesCreatedSinceUtcDay(now) {
      const day = now.toISOString().slice(0, 10);
      const query = `repo:${repository} is:issue created:>=${day} "${AUTO_CREATED_MARKER}"`;
      const payload = await searchIssues(query);
      return Number(payload.total_count || 0);
    },
    async createIssue(title, body) {
      const payload = await request(`/repos/${repository}/issues`, {
        body: JSON.stringify({ body, title }),
        method: 'POST'
      });
      return { number: Number(payload.number) };
    },
    async findOpenIssue(fingerprint) {
      const query = `repo:${repository} is:issue is:open "${fingerprintMarker(fingerprint)}"`;
      const payload = await searchIssues(query);
      const match = Array.isArray(payload.items) ? payload.items[0] : null;
      return match
        ? { number: Number(match.number), updatedAt: match.updated_at || null }
        : null;
    }
  };
}

function buildMarkdownSummary(result) {
  const decisions = new Map();
  for (const action of result.actions) {
    decisions.set(action.decision, (decisions.get(action.decision) || 0) + 1);
  }
  const decisionLines = [...decisions.entries()].map(([decision, count]) => `- \`${decision}\` : ${count}`);
  return [
    '## Auditeur de logs SeenIt',
    '',
    `- Mode : **${result.mode}**`,
    `- Source : **${result.sourceStatus}**`,
    `- Entrées / acceptées / rejetées : ${result.inputCount} / ${result.acceptedCount} / ${result.rejectedCount}`,
    `- Groupes / candidats : ${result.groups.length} / ${result.candidates.length}`,
    `- État : **${result.degraded ? 'dégradé' : 'sain'}**`,
    '',
    ...(decisionLines.length ? ['### Décisions', '', ...decisionLines] : ['Aucune action GitHub candidate.'])
  ].join('\n');
}

function parseArguments(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(item);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.input || !args.report) {
    throw new Error('Usage: node scripts/audit-structured-logs.cjs --input=<json> --report=<json>');
  }

  const mode = normalizeMode(process.env.SEENIT_LOG_AUDITOR_MODE);
  const sourceStatus = String(process.env.SEENIT_LOG_AUDITOR_SOURCE_STATUS || 'ok');
  let entries = [];
  if (mode !== 'off') {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
    entries = Array.isArray(parsed) ? parsed : [];
  }

  const analysis = analyzeLogEntries(entries);
  let github = null;
  if (mode !== 'off' && process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
    github = createGithubClient({
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN
    });
  }

  const result = await executeAudit({ analysis, github, mode, sourceStatus });
  const reportPath = path.resolve(args.report);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(sanitizeValue(result), null, 2)}\n`, 'utf8');

  const summary = buildMarkdownSummary(result);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, 'utf8');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `audit_status=${result.degraded ? 'degraded' : 'ok'}\n`, 'utf8');
  }
  console.log(`[LogAuditor] mode=${result.mode} source=${result.sourceStatus} groupes=${result.groups.length} candidats=${result.candidates.length} état=${result.degraded ? 'dégradé' : 'sain'}`);
  if (result.degraded) process.exitCode = 1;
}

module.exports = {
  AUTO_CREATED_MARKER,
  EXISTING_ISSUE_COOLDOWN_MS,
  MAX_INPUT_EVENTS,
  MAX_NEW_ISSUES_PER_RUN,
  MAX_NEW_ISSUES_PER_UTC_DAY,
  RULES,
  analyzeLogEntries,
  buildIssueBody,
  buildIssueTitle,
  buildIssueUpdateComment,
  buildMarkdownSummary,
  createFingerprint,
  createGithubClient,
  executeAudit,
  fingerprintMarker,
  normalizeEvent,
  normalizeMode,
  redactText,
  sanitizeValue
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[LogAuditor] ${redactText(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 1;
  });
}
