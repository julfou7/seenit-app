const fs = require('node:fs');
const path = require('node:path');

const MAX_INPUT_ENTRIES = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000_000;

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

function analyzeCloudRunTraffic(entries, options = {}) {
  const source = Array.isArray(entries) ? entries.slice(0, MAX_INPUT_ENTRIES) : [];
  const buckets = new Map();
  const regions = new Set();
  let acceptedEntries = 0;
  let rejectedEntries = 0;
  let totalResponseBytes = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  for (const entry of source) {
    const request = entry?.httpRequest;
    if (!request || typeof request !== 'object' || !request.requestUrl) {
      rejectedEntries += 1;
      continue;
    }

    acceptedEntries += 1;
    const route = normalizeRoute(request.requestUrl);
    const responseBytes = boundedInteger(request.responseSize, MAX_RESPONSE_BYTES);
    const statusClass = normalizeStatusClass(request.status);
    const timestamp = Date.parse(String(entry.timestamp || ''));
    const region = String(entry?.resource?.labels?.location || '').trim();
    if (/^[a-z]+(?:-[a-z0-9]+)+$/.test(region)) regions.add(region);
    if (Number.isFinite(timestamp)) {
      firstTimestamp = firstTimestamp === null ? timestamp : Math.min(firstTimestamp, timestamp);
      lastTimestamp = lastTimestamp === null ? timestamp : Math.max(lastTimestamp, timestamp);
    }

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

  return {
    schemaVersion: 1,
    generatedAt: (options.now || new Date()).toISOString(),
    window: {
      firstTimestamp: firstTimestamp === null ? null : new Date(firstTimestamp).toISOString(),
      lastTimestamp: lastTimestamp === null ? null : new Date(lastTimestamp).toISOString()
    },
    inputEntries: Array.isArray(entries) ? entries.length : 0,
    acceptedEntries,
    rejectedEntries,
    truncatedEntries: Math.max(0, (Array.isArray(entries) ? entries.length : 0) - source.length),
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

function buildMarkdownSummary(report, sourceStatus = 'ok') {
  const rows = report.routes.slice(0, 12).map(route => (
    `| \`${route.route}\` | ${route.requests} | ${formatMebibytes(route.responseBytes)} | ${formatMebibytes(route.maxResponseBytes)} |`
  ));
  return [
    '## Trafic Cloud Run agrégé — FinOps',
    '',
    `- Source : **${sourceStatus}**`,
    `- Région(s) : ${report.regions.length ? report.regions.join(', ') : 'indisponible'}`,
    `- Requêtes : **${report.totals.requests}**`,
    `- Réponse cumulée observée : **${formatMebibytes(report.totals.responseBytes)} MiB**`,
    `- Fenêtre : ${report.window.firstTimestamp || 'vide'} → ${report.window.lastTimestamp || 'vide'}`,
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

  const sourceStatus = String(process.env.SEENIT_CLOUD_RUN_TRAFFIC_SOURCE_STATUS || 'ok');
  const input = sourceStatus === 'ok'
    ? JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'))
    : [];
  const report = analyzeCloudRunTraffic(input);
  const reportPath = path.resolve(args.report);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${buildMarkdownSummary(report, sourceStatus)}\n`, 'utf8');
  }
  console.log(`[CloudRunTraffic] source=${sourceStatus} requêtes=${report.totals.requests} octets=${report.totals.responseBytes}`);
}

module.exports = {
  analyzeCloudRunTraffic,
  buildMarkdownSummary,
  normalizeRoute
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[CloudRunTraffic] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
