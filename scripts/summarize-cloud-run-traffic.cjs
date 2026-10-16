const fs = require('node:fs');
const path = require('node:path');

const MAX_INPUT_ENTRIES = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000_000;
const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000;

const API_ROUTES = Object.freeze([
  [/^\/api\/health$/, '/api/health'],
  [/^\/api\/media\/tmdb(?:\/.*)?$/, '/api/media/tmdb/*'],
  [/^\/api\/media\/tvdb\/franchise$/, '/api/media/tvdb/franchise'],
  [/^\/api\/media\/parental-ratings$/, '/api/media/parental-ratings'],
  [/^\/api\/plex\/availability$/, '/api/plex/availability'],
  [/^\/api\/plex\/history$/, '/api/plex/history'],
  [/^\/api\/plex\/resolve-slug$/, '/api/plex/resolve-slug'],
  [/^\/api\/c411\/(?:search|test)$/, '/api/c411/:action'],
  [/^\/api\/service-proxy$/, '/api/service-proxy'],
  [/^\/api\/releases\/notify$/, '/api/releases/notify'],
  [/^\/api\/update$/, '/api/update'],
  [/^\/api\/devices(?:\/[^/]+)?$/, '/api/devices/:installation'],
  [/^\/api\/webhooks\/config(?:\/rotate)?$/, '/api/webhooks/config'],
  [/^\/api\/webhook\/(?:sonarr|radarr)\/[^/]+$/, '/api/webhook/:source/:endpoint']
]);

function parseArguments(argv) {
  const args = {};
  for (const item of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(item);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function normalizeRoute(requestUrl) {
  let pathname;
  try {
    pathname = new URL(String(requestUrl || ''), 'https://seenit.invalid').pathname;
  } catch {
    return 'invalid-request';
  }

  if (pathname.startsWith('/assets/')) return '/assets/*';
  if (pathname === '/firebase-messaging-sw.js') return '/firebase-messaging-sw.js';
  if (pathname === '/manifest.json') return '/manifest.json';
  if (pathname.startsWith('/icons/')) return '/icons/*';
  if (!pathname.startsWith('/api/')) return 'pwa-shell-or-route';

  for (const [pattern, bucket] of API_ROUTES) {
    if (pattern.test(pathname)) return bucket;
  }
  return '/api/other';
}

function boundedInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(maximum, Math.floor(number)));
}

function normalizeStatusClass(value) {
  const status = boundedInteger(value, 999);
  return status >= 100 ? `${Math.floor(status / 100)}xx` : 'unknown';
}

function toEpoch(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveRequestedWindow(options = {}) {
  const nowMs = toEpoch(options.now || new Date());
  const safeNow = nowMs === null ? Date.now() : nowMs;
  const endMs = toEpoch(options.windowEnd);
  const startMs = toEpoch(options.windowStart);
  const resolvedEnd = endMs === null ? safeNow : endMs;
  const resolvedStart = startMs === null ? resolvedEnd - DEFAULT_WINDOW_MS : startMs;
  if (resolvedStart > resolvedEnd) {
    throw new Error('Fenêtre Cloud Run invalide : le début est après la fin.');
  }
  return { startMs: resolvedStart, endMs: resolvedEnd };
}

function normalizeSourceStatus(value) {
  const status = String(value || 'ok').trim().toLowerCase();
  return status === 'ok' ? 'ok' : status || 'unavailable';
}

function analyzeCloudRunTraffic(entries, options = {}) {
  const allEntries = Array.isArray(entries) ? entries : [];
  const source = allEntries.slice(0, MAX_INPUT_ENTRIES);
  const requested = resolveRequestedWindow(options);
  const sourceStatus = normalizeSourceStatus(options.sourceStatus);
  const buckets = new Map();
  const regions = new Set();
  let acceptedEntries = 0;
  let rejectedEntries = 0;
  let invalidTimestampEntries = 0;
  let outOfWindowEntries = 0;
  let totalResponseBytes = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let sourceFirstTimestamp = null;
  let sourceLastTimestamp = null;

  for (const entry of source) {
    const request = entry?.httpRequest;
    if (!request || typeof request !== 'object' || !request.requestUrl) {
      rejectedEntries += 1;
      continue;
    }

    const timestamp = toEpoch(entry.timestamp);
    if (timestamp === null) {
      rejectedEntries += 1;
      invalidTimestampEntries += 1;
      continue;
    }

    sourceFirstTimestamp = sourceFirstTimestamp === null ? timestamp : Math.min(sourceFirstTimestamp, timestamp);
    sourceLastTimestamp = sourceLastTimestamp === null ? timestamp : Math.max(sourceLastTimestamp, timestamp);
    if (timestamp < requested.startMs || timestamp > requested.endMs) {
      outOfWindowEntries += 1;
      continue;
    }

    acceptedEntries += 1;
    firstTimestamp = firstTimestamp === null ? timestamp : Math.min(firstTimestamp, timestamp);
    lastTimestamp = lastTimestamp === null ? timestamp : Math.max(lastTimestamp, timestamp);
    const route = normalizeRoute(request.requestUrl);
    const responseBytes = boundedInteger(request.responseSize, MAX_RESPONSE_BYTES);
    const statusClass = normalizeStatusClass(request.status);
    const region = String(entry?.resource?.labels?.location || '').trim();
    if (/^[a-z]+(?:-[a-z0-9]+)+$/.test(region)) regions.add(region);

    const bucket = buckets.get(route) || {
      route,
      requests: 0,
      responseBytes: 0,
      maxResponseBytes: 0,
      statusClasses: {}
    };
    bucket.requests += 1;
    bucket.responseBytes += responseBytes;
    bucket.maxResponseBytes = Math.max(bucket.maxResponseBytes, responseBytes);
    bucket.statusClasses[statusClass] = (bucket.statusClasses[statusClass] || 0) + 1;
    buckets.set(route, bucket);
    totalResponseBytes += responseBytes;
  }

  const truncatedEntries = Math.max(0, allEntries.length - source.length);
  const saturated = source.length >= MAX_INPUT_ENTRIES || truncatedEntries > 0;
  const stale = sourceStatus === 'ok' && outOfWindowEntries > 0;
  const intentionallyOff = sourceStatus === 'off';
  const unavailable = sourceStatus !== 'ok' && !intentionallyOff;
  const reasons = [];
  if (unavailable) reasons.push(`source_${sourceStatus}`);
  if (stale) reasons.push('entries_outside_requested_window');
  if (saturated) reasons.push('collection_limit_reached');

  let qualityStatus = 'ok';
  if (intentionallyOff) qualityStatus = 'off';
  else if (unavailable) qualityStatus = 'unavailable';
  else if (stale) qualityStatus = 'stale';
  else if (saturated) qualityStatus = 'saturated';
  else if (acceptedEntries === 0) qualityStatus = 'empty';

  return {
    schemaVersion: 2,
    generatedAt: new Date(toEpoch(options.now || new Date()) ?? Date.now()).toISOString(),
    requestedWindow: {
      startTimestamp: new Date(requested.startMs).toISOString(),
      endTimestamp: new Date(requested.endMs).toISOString()
    },
    window: {
      firstTimestamp: firstTimestamp === null ? null : new Date(firstTimestamp).toISOString(),
      lastTimestamp: lastTimestamp === null ? null : new Date(lastTimestamp).toISOString()
    },
    sourceWindow: {
      firstTimestamp: sourceFirstTimestamp === null ? null : new Date(sourceFirstTimestamp).toISOString(),
      lastTimestamp: sourceLastTimestamp === null ? null : new Date(sourceLastTimestamp).toISOString()
    },
    quality: {
      status: qualityStatus,
      sourceStatus,
      complete: intentionallyOff || (!unavailable && !stale && !saturated),
      stale,
      saturated,
      reasons
    },
    inputEntries: allEntries.length,
    acceptedEntries,
    rejectedEntries,
    invalidTimestampEntries,
    outOfWindowEntries,
    truncatedEntries,
    collectionLimit: MAX_INPUT_ENTRIES,
    regions: [...regions].sort(),
    totals: {
      requests: acceptedEntries,
      responseBytes: totalResponseBytes
    },
    routes: [...buckets.values()].sort((left, right) => (
      right.responseBytes - left.responseBytes
      || right.requests - left.requests
      || left.route.localeCompare(right.route)
    ))
  };
}

function formatMebibytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function buildMarkdownSummary(report) {
  const rows = report.routes.slice(0, 12).map(route => (
    `| \`${route.route}\` | ${route.requests} | ${formatMebibytes(route.responseBytes)} | ${formatMebibytes(route.maxResponseBytes)} |`
  ));
  return [
    '## Trafic Cloud Run agrégé — FinOps',
    '',
    `- Qualité : **${report.quality.status}**${report.quality.complete ? ' (complet)' : ' (dégradé)'}`,
    `- Source : **${report.quality.sourceStatus}**`,
    `- Fenêtre demandée : ${report.requestedWindow.startTimestamp} → ${report.requestedWindow.endTimestamp}`,
    `- Fenêtre observée : ${report.window.firstTimestamp || 'vide'} → ${report.window.lastTimestamp || 'vide'}`,
    `- Région(s) : ${report.regions.length ? report.regions.join(', ') : 'indisponible'}`,
    `- Requêtes : **${report.totals.requests}**`,
    `- Réponse cumulée observée : **${formatMebibytes(report.totals.responseBytes)} MiB**`,
    `- Saturation : **${report.quality.saturated ? 'oui' : 'non'}** (${report.inputEntries}/${report.collectionLimit} entrées)`,
    '',
    '| Route agrégée | Requêtes | MiB cumulés | Max MiB |',
    '| --- | ---: | ---: | ---: |',
    ...(rows.length ? rows : ['| aucune requête | 0 | 0.00 | 0.00 |']),
    '',
    'Les URL, paramètres, identifiants et logs bruts ne sont jamais archivés.'
  ].join('\n');
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.input || !args.report) {
    throw new Error('Usage: node scripts/summarize-cloud-run-traffic.cjs --input=<json> --report=<json>');
  }

  const sourceStatus = normalizeSourceStatus(process.env.SEENIT_CLOUD_RUN_TRAFFIC_SOURCE_STATUS || 'ok');
  const input = sourceStatus === 'ok'
    ? JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'))
    : [];
  const report = analyzeCloudRunTraffic(input, {
    sourceStatus,
    windowStart: process.env.SEENIT_CLOUD_RUN_TRAFFIC_WINDOW_START,
    windowEnd: process.env.SEENIT_CLOUD_RUN_TRAFFIC_WINDOW_END
  });
  const reportPath = path.resolve(args.report);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${buildMarkdownSummary(report)}\n`, 'utf8');
  }
  console.log(`[CloudRunTraffic] source=${sourceStatus} qualité=${report.quality.status} requêtes=${report.totals.requests} octets=${report.totals.responseBytes}`);
  if (!report.quality.complete) process.exitCode = 2;
}

module.exports = {
  MAX_INPUT_ENTRIES,
  analyzeCloudRunTraffic,
  buildMarkdownSummary,
  normalizeRoute,
  resolveRequestedWindow
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[CloudRunTraffic] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
