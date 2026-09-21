const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AUDITOR_SCHEMA_VERSION = 1;
const MAX_INPUT_EVENTS = 5000;
const MAX_NEW_ISSUES_PER_RUN = 3;
const MAX_NEW_ISSUES_PER_UTC_DAY = 3;
const EXISTING_ISSUE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const RECURRENCE_WINDOW_MS = 6 * 60 * 60 * 1000;
const UNKNOWN_WARNING_THRESHOLD = 8;
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
  PROVIDER_UPSTREAM_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'providers',
    impact: 'TMDB ou TVDB échoue de façon répétée sur la frontière backend, ce qui dégrade les métadonnées, diffuseurs ou univers.',
    investigation: 'Contrôler le fournisseur et le statut HTTP agrégé, puis reproduire sans exporter de requête, média ou utilisateur.',
    priority: 'P2',
    threshold: 10,
    title: 'Échecs répétés d’un fournisseur de métadonnées'
  }),
  PARENTAL_RATING_PROVIDER_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'providers',
    impact: 'Les classifications d’âge ne peuvent pas être résolues de façon répétée et le filtre âge doit alors rester fail-closed.',
    investigation: 'Contrôler la route batch de classifications et TMDB sans transformer une classification inconnue en valeur permissive.',
    priority: 'P2',
    threshold: 12,
    title: 'Échecs répétés des classifications d’âge'
  }),
  DOWNLOAD_C411_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'downloads',
    impact: 'Les recherches ou tests C411 échouent de façon répétée sur la frontière backend.',
    investigation: 'Vérifier la disponibilité de C411 et le type d’échec stable sans exporter de requête ni de clé API.',
    priority: 'P2',
    threshold: 10,
    title: 'Échecs répétés de C411'
  }),
  DOWNLOAD_SERVICE_PROXY_FAILED: Object.freeze({
    autoIssue: false,
    domain: 'downloads',
    impact: 'Un service privé Sonarr, Radarr ou qBittorrent est momentanément injoignable via le proxy.',
    investigation: 'Conserver ce signal en rapport uniquement : une machine privée éteinte ou hors réseau peut être normale.',
    priority: 'P2',
    threshold: 20,
    title: 'Indisponibilités répétées du proxy de téléchargement'
  }),
  DOWNLOAD_WEBHOOK_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'downloads',
    impact: 'Des webhooks Sonarr/Radarr valides ne peuvent pas être traités de façon répétée par SeenIt.',
    investigation: 'Contrôler le traitement du webhook et la livraison de notification sans journaliser le payload, le média ou l’utilisateur.',
    priority: 'P2',
    threshold: 3,
    title: 'Échecs répétés des webhooks de téléchargement'
  }),
  RELEASE_UPDATE_PUSH_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'release',
    impact: 'La notification d’une nouvelle version SeenIt échoue de façon répétée.',
    investigation: 'Contrôler la publication de release et le code d’échec stable de la notification sans exporter de token appareil.',
    priority: 'P1',
    threshold: 2,
    title: 'Échecs répétés de notification de mise à jour'
  }),
  UPDATE_CHECK_BACKEND_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'release',
    impact: 'Le backend n’arrive plus de façon répétée à lire la dernière release disponible.',
    investigation: 'Contrôler l’accès GitHub Releases et la configuration backend sans exporter de jeton.',
    priority: 'P2',
    threshold: 5,
    title: 'Échecs répétés de vérification des mises à jour'
  }),
  FIRESTORE_CLIENT_SYNC_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'firestore',
    impact: 'Des synchronisations Firestore côté application échouent de façon répétée malgré les mécanismes de reprise.',
    investigation: 'Reproduire le parcours de synchronisation concerné et qualifier le défaut sans exporter de document, UID ou contenu utilisateur.',
    priority: 'P1',
    threshold: 5,
    title: 'Échecs répétés de synchronisation Firestore'
  }),
  NOTIFICATION_CLIENT_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'notifications',
    impact: 'Des notifications locales ou leurs médias échouent après les reprises bornées prévues.',
    investigation: 'Contrôler le chemin Android/PWA de notification avec un TNR ciblé sans exporter le titre, l’image ou le token.',
    priority: 'P2',
    threshold: 5,
    title: 'Échecs répétés des notifications client'
  }),
  DOWNLOAD_CLIENT_SYNC_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'downloads',
    impact: 'La synchronisation partagée des téléchargements côté application échoue de façon répétée.',
    investigation: 'Contrôler l’écriture ou l’écoute Firestore du suivi de téléchargement sans exporter de média ni de configuration privée.',
    priority: 'P2',
    threshold: 6,
    title: 'Échecs répétés de synchronisation des téléchargements'
  }),
  APP_UPDATE_CLIENT_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'release',
    impact: 'Le téléchargement, la vérification ou l’ouverture de l’APK échoue de façon répétée côté Android.',
    investigation: 'Contrôler le parcours de mise à jour intégré, le digest et le Package Installer sans exporter de chemin local.',
    priority: 'P1',
    threshold: 4,
    title: 'Échecs répétés de mise à jour APK'
  }),
  CACHE_CLIENT_STORAGE_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'cache',
    impact: 'Le cache persistant de métadonnées rencontre des erreurs répétées de lecture ou d’écriture.',
    investigation: 'Contrôler IndexedDB et la stratégie de fallback/stale sans exporter les clés de médias.',
    priority: 'P2',
    threshold: 8,
    title: 'Échecs répétés du cache persistant'
  }),
  PLEX_SYNC_PARTIAL: Object.freeze({
    autoIssue: true,
    domain: 'plex',
    impact: 'Des collectes Plex restent partielles de façon répétée et empêchent la validation fiable du curseur.',
    investigation: 'Identifier la source Plex incomplète, vérifier sa disponibilité puis conserver le curseur tant que la collecte n’est pas complète.',
    priority: 'P2',
    threshold: 20,
    title: 'Synchronisations Plex partielles répétées'
  }),
  PLEX_SNAPSHOT_STORE_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'plex',
    impact: 'Le snapshot technique utilisé par la synchronisation Plex ne peut pas être lu ou persisté de façon répétée.',
    investigation: 'Vérifier Firestore et la taille du snapshot, puis ajouter un TNR sur le code d’erreur stable observé.',
    priority: 'P2',
    threshold: 6,
    title: 'Échecs répétés du snapshot Plex'
  }),
  PLEX_DELTA_SNAPSHOT_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'plex',
    impact: 'L’enrichissement delta Plex échoue de façon répétée et peut retarder la convergence des états vus/non vus.',
    investigation: 'Contrôler la collecte delta et le code d’erreur stable sans exposer de média ni d’utilisateur.',
    priority: 'P2',
    threshold: 4,
    title: 'Échecs répétés de la delta Plex'
  }),
  PLEX_FULL_SNAPSHOT_SEED_FAILED: Object.freeze({
    autoIssue: true,
    domain: 'plex',
    impact: 'La synchronisation complète n’arrive pas à préparer de façon répétée la baseline technique du prochain delta.',
    investigation: 'Contrôler la persistance de la baseline après un full complet et reproduire avec un TNR ciblé.',
    priority: 'P2',
    threshold: 4,
    title: 'Échecs répétés de la baseline Plex'
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

function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,39}$/.test(domain) ? domain : 'unknown';
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(100, Math.floor(count)));
}

function normalizeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
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
  if (code === 'PLEX_SNAPSHOT_STORE_FAILED') {
    const action = String(context.action || '').trim();
    return {
      action: ['read', 'read-resolution-cache', 'write'].includes(action) ? action : 'unknown',
      errorCode: normalizeErrorCode(context.errorCode, 'SNAPSHOT_STORE_FAILED')
    };
  }
  if (code === 'PLEX_DELTA_SNAPSHOT_FAILED' || code === 'PLEX_FULL_SNAPSHOT_SEED_FAILED') {
    return { errorCode: normalizeErrorCode(context.errorCode, code) };
  }
  if (code === 'PROVIDER_UPSTREAM_FAILED') {
    const provider = String(context.provider || '').trim().toLowerCase();
    return {
      provider: provider === 'tmdb' || provider === 'tvdb' ? provider : 'unknown',
      status: normalizeHttpStatus(context.status),
      count: normalizeCount(context.count)
    };
  }
  if (
    code === 'PARENTAL_RATING_PROVIDER_FAILED'
    || code === 'FIRESTORE_CLIENT_SYNC_FAILED'
    || code === 'NOTIFICATION_CLIENT_FAILED'
    || code === 'DOWNLOAD_CLIENT_SYNC_FAILED'
    || code === 'APP_UPDATE_CLIENT_FAILED'
    || code === 'CACHE_CLIENT_STORAGE_FAILED'
  ) {
    return { count: normalizeCount(context.count) };
  }
  if (code === 'DOWNLOAD_C411_FAILED') {
    const action = String(context.action || '').trim().toLowerCase();
    return {
      action: action === 'test' || action === 'search' ? action : 'unknown',
      errorCode: normalizeErrorCode(context.errorCode, 'C411_FAILED')
    };
  }
  if (code === 'DOWNLOAD_SERVICE_PROXY_FAILED' || code === 'UPDATE_CHECK_BACKEND_FAILED') {
    return { errorCode: normalizeErrorCode(context.errorCode, code) };
  }
  if (code === 'DOWNLOAD_WEBHOOK_FAILED') {
    const source = String(context.source || '').trim().toLowerCase();
    return {
      source: source === 'sonarr' || source === 'radarr' ? source : 'unknown',
      errorCode: normalizeErrorCode(context.errorCode, 'WEBHOOK_FAILED')
    };
  }
  if (code === 'RELEASE_UPDATE_PUSH_FAILED') {
    return {
      status: normalizeHttpStatus(context.status),
      errorCode: normalizeErrorCode(context.errorCode, 'RELEASE_PUSH_FAILED')
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
  if (code === 'PLEX_SNAPSHOT_STORE_FAILED') return { action: context.action, errorCode: context.errorCode };
  if (code === 'PLEX_DELTA_SNAPSHOT_FAILED' || code === 'PLEX_FULL_SNAPSHOT_SEED_FAILED') return { errorCode: context.errorCode };
  if (code === 'PROVIDER_UPSTREAM_FAILED') return { provider: context.provider, status: context.status };
  if (code === 'DOWNLOAD_C411_FAILED') return { action: context.action, errorCode: context.errorCode };
  if (code === 'DOWNLOAD_SERVICE_PROXY_FAILED' || code === 'UPDATE_CHECK_BACKEND_FAILED') return { errorCode: context.errorCode };
  if (code === 'DOWNLOAD_WEBHOOK_FAILED') return { source: context.source, errorCode: context.errorCode };
  if (code === 'RELEASE_UPDATE_PUSH_FAILED') return { status: context.status, errorCode: context.errorCode };
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

  const code = normalizeCode(envelope.code);
  const rule = RULES[code] || null;
  const domain = rule?.domain || normalizeDomain(envelope.domain);
  const correlationId = SAFE_CORRELATION_PATTERN.test(String(envelope.correlationId || ''))
    ? String(envelope.correlationId)
    : null;

  const context = rule ? normalizeRuleContext(code, envelope.context) : {};
  const weight = rule && typeof context.count === 'number' && context.count > 0
    ? context.count
    : 1;

  return {
    code,
    context,
    correlationId,
    domain,
    level: envelope.level === 'warn' ? 'warn' : 'error',
    rule,
    timestamp: new Date(timestampMs).toISOString(),
    weight
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
  const normalized = [];
  let rejectedCount = 0;
  for (const entry of limited) {
    const event = normalizeEvent(entry);
    if (event) normalized.push(event);
    else rejectedCount += 1;
  }

  const latestTimestampMs = normalized.reduce((latest, event) => Math.max(latest, Date.parse(event.timestamp)), 0);
  const explicitNowMs = options.now instanceof Date ? options.now.getTime() : Number.NaN;
  const anchorMs = Number.isFinite(explicitNowMs) ? explicitNowMs : (latestTimestampMs > 0 ? latestTimestampMs + 1 : Date.now());
  const currentWindowStart = anchorMs - RECURRENCE_WINDOW_MS;
  const previousWindowStart = currentWindowStart - RECURRENCE_WINDOW_MS;
  const groupsByFingerprint = new Map();

  for (const event of normalized) {
    const fingerprint = createFingerprint(event);
    let group = groupsByFingerprint.get(fingerprint);
    if (!group) {
      const configured = Boolean(event.rule);
      group = {
        autoIssue: Boolean(event.rule?.autoIssue),
        code: event.code,
        context: event.context,
        correlationId: event.correlationId,
        count: 0,
        domain: event.domain,
        fingerprint,
        firstOccurrence: event.timestamp,
        impact: event.rule?.impact || 'Un warning structuré non catalogué se répète sur plusieurs fenêtres d’audit.',
        investigation: event.rule?.investigation || 'Qualifier ce code stable, décider ignore/report-only/auto-issue puis ajouter un TNR avant toute règle spécialisée.',
        lastOccurrence: event.timestamp,
        level: event.level,
        previousWindowCount: 0,
        priority: event.rule?.priority || 'P2',
        recentWindowCount: 0,
        ruleConfigured: configured,
        threshold: event.rule?.threshold || UNKNOWN_WARNING_THRESHOLD,
        title: event.rule?.title || `Warning récurrent à qualifier : ${event.code}`,
        totalCount: 0
      };
      groupsByFingerprint.set(fingerprint, group);
    }
    group.totalCount += event.weight;
    const timestampMs = Date.parse(event.timestamp);
    if (timestampMs >= currentWindowStart && timestampMs <= anchorMs) group.recentWindowCount += event.weight;
    else if (timestampMs >= previousWindowStart && timestampMs < currentWindowStart) group.previousWindowCount += event.weight;
    if (event.timestamp < group.firstOccurrence) group.firstOccurrence = event.timestamp;
    if (event.timestamp > group.lastOccurrence) {
      group.lastOccurrence = event.timestamp;
      group.correlationId = event.correlationId;
    }
  }

  const groups = [...groupsByFingerprint.values()]
    .filter(group => group.ruleConfigured ? group.recentWindowCount > 0 : group.totalCount > 0)
    .map(group => {
      const unknownRecurring = !group.ruleConfigured && group.level === 'warn'
        && group.recentWindowCount > 0 && group.previousWindowCount > 0
        && group.totalCount >= UNKNOWN_WARNING_THRESHOLD;
      const count = group.ruleConfigured ? group.recentWindowCount : group.totalCount;
      return {
        ...group,
        autoIssue: group.ruleConfigured ? group.autoIssue : unknownRecurring,
        count,
        decision: group.ruleConfigured
          ? count < group.threshold ? 'below_threshold' : group.autoIssue ? 'candidate' : 'known_report_only'
          : unknownRecurring ? 'candidate' : 'unknown_report_only'
      };
    })
    .sort((left, right) => right.count - left.count || left.fingerprint.localeCompare(right.fingerprint));

  const candidates = groups.filter(group => group.decision === 'candidate');
  const knownGroupCount = groups.filter(group => group.ruleConfigured).length;
  const unknownGroupCount = groups.length - knownGroupCount;
  const coverageStatus = candidates.length > 0 ? 'candidates_detected'
    : normalized.length === 0 ? (source.length === 0 ? 'no_events' : 'no_structured_signal')
    : knownGroupCount === 0 ? 'no_covered_signal' : 'covered_no_anomaly';

  return {
    acceptedCount: normalized.length,
    candidates,
    coverageStatus,
    generatedAt: (options.now || new Date(anchorMs)).toISOString(),
    groups,
    inputCount: source.length,
    knownGroupCount,
    rejectedCount,
    truncatedCount: Math.max(0, source.length - limited.length),
    unknownGroupCount
  };
}
function fingerprintMarker(fingerprint) {
  return `${FINGERPRINT_PREFIX}${fingerprint}`;
}

function buildIssueTitle(group) {
  const labels = {
    cache: 'Cache',
    downloads: 'Téléchargements',
    firestore: 'Firestore',
    notifications: 'Notifications',
    plex: 'Plex',
    providers: 'Fournisseurs',
    release: 'Mise à jour',
    runtime: 'Runtime'
  };
  const domain = labels[group.domain] || 'Runtime';
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
    `- Niveau : **${group.level === 'error' ? 'error' : 'warning'}**`,
    `- Fingerprint : \`${fingerprintMarker(group.fingerprint)}\``,
    ...(/^[a-f0-9]{40}$/i.test(String(process.env.GITHUB_SHA || ''))
      ? [`- SHA des règles d’audit : \`${process.env.GITHUB_SHA}\``]
      : []),
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
  for (const action of result.actions) decisions.set(action.decision, (decisions.get(action.decision) || 0) + 1);
  const decisionLines = [...decisions.entries()].map(([decision, count]) => `- \`${decision}\` : ${count}`);
  const groupDecisions = new Map();
  for (const group of result.groups) {
    groupDecisions.set(group.decision, (groupDecisions.get(group.decision) || 0) + 1);
  }
  const groupDecisionLines = [...groupDecisions.entries()]
    .map(([decision, count]) => `- \`${decision}\` : ${count}`);
  const coverageLabels = {
    candidates_detected: 'anomalie(s) candidate(s) détectée(s)',
    covered_no_anomaly: 'signaux couverts présents, aucune anomalie au-dessus des seuils',
    no_covered_signal: 'signaux structurés présents, aucun code couvert par les règles',
    no_events: 'aucun événement structuré collecté',
    no_structured_signal: 'entrées présentes mais aucun signal structuré exploitable'
  };
  return [
    '## Auditeur de logs SeenIt', '',
    `- Mode : **${result.mode}**`,
    `- Source : **${result.sourceStatus}**`,
    `- Couverture : **${coverageLabels[result.coverageStatus] || result.coverageStatus}**`,
    `- Événements vus / exploitables / ignorés-rejetés : ${result.inputCount} / ${result.acceptedCount} / ${result.rejectedCount}`,
    `- Groupes configurés / inconnus / candidats : ${result.knownGroupCount} / ${result.unknownGroupCount} / ${result.candidates.length}`,
    `- État : **${result.degraded ? 'dégradé' : 'sain'}**`, '',
    ...(groupDecisionLines.length ? ['### Classement des signaux', '', ...groupDecisionLines, ''] : []),
    ...(decisionLines.length ? ['### Décisions GitHub', '', ...decisionLines] : ['Aucune action GitHub candidate.'])
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
  RECURRENCE_WINDOW_MS,
  RULES,
  UNKNOWN_WARNING_THRESHOLD,
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
