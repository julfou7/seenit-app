const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const MAX_INPUT_EVENTS = 5000;
const MAX_COUNTER = 1_000_000_000_000;
const FAMILY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const COUNTER_KEYS = Object.freeze([
  'requests',
  'memoryHits',
  'inFlightHits',
  'upstream',
  'upstreamBytes'
]);

function boundedCounter(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(MAX_COUNTER, Math.floor(parsed));
}

function extractEnvelope(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.seenitDiagnostic && typeof entry.seenitDiagnostic === 'object') return entry.seenitDiagnostic;
  if (entry.jsonPayload?.seenitDiagnostic && typeof entry.jsonPayload.seenitDiagnostic === 'object') {
    return entry.jsonPayload.seenitDiagnostic;
  }
  if (typeof entry.textPayload === 'string' && entry.textPayload.length <= 20_000) {
    try {
      const parsed = JSON.parse(entry.textPayload);
      return parsed?.seenitDiagnostic && typeof parsed.seenitDiagnostic === 'object'
        ? parsed.seenitDiagnostic
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeFamilies(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const families = {};
  for (const [family, rawCounters] of Object.entries(value).slice(0, 30)) {
    if (!FAMILY_PATTERN.test(family) || !rawCounters || typeof rawCounters !== 'object' || Array.isArray(rawCounters)) continue;
    families[family] = Object.fromEntries(COUNTER_KEYS.map(key => [key, boundedCounter(rawCounters[key])]));
  }
  return families;
}

function readInstanceIdentity(entry) {
  const exact = entry?.labels?.instanceId
    || entry?.labels?.instance_id
    || entry?.resource?.labels?.instance_id
    || null;
  if (typeof exact === 'string' && exact.trim()) {
    return { key: `instance:${exact}`, exact: true };
  }

  const revision = entry?.resource?.labels?.revision_name;
  if (typeof revision === 'string' && revision.trim()) {
    return { key: `revision:${revision}`, exact: false };
  }
  return { key: 'unknown-runtime', exact: false };
}

function normalizeDiagnostic(entry) {
  const envelope = extractEnvelope(entry);
  if (
    !envelope
    || Number(envelope.schemaVersion) !== SCHEMA_VERSION
    || envelope.code !== 'TMDB_REQUEST_CACHE_SUMMARY'
  ) return null;

  const timestampMs = Date.parse(String(envelope.timestamp || entry?.timestamp || ''));
  if (!Number.isFinite(timestampMs)) return null;

  const context = envelope.context && typeof envelope.context === 'object' ? envelope.context : {};
  const identity = readInstanceIdentity(entry);
  return {
    timestampMs,
    instanceKey: identity.key,
    exactInstanceIdentity: identity.exact,
    requests: boundedCounter(context.requests),
    families: normalizeFamilies(context.families),
  };
}

function emptyCounters() {
  return { requests: 0, memoryHits: 0, inFlightHits: 0, upstream: 0, upstreamBytes: 0 };
}

function addCounters(target, delta) {
  for (const key of COUNTER_KEYS) target[key] += delta[key];
}

function diffCounters(previous, current) {
  for (const key of COUNTER_KEYS) {
    if (current[key] < previous[key]) return null;
  }
  return Object.fromEntries(COUNTER_KEYS.map(key => [key, current[key] - previous[key]]));
}

function summarizeTmdbCacheDiagnostics(entries, options = {}) {
  const source = Array.isArray(entries) ? entries : [];
  const limited = source.slice(0, MAX_INPUT_EVENTS);
  const normalized = [];
  let rejectedCount = 0;

  for (const entry of limited) {
    const diagnostic = normalizeDiagnostic(entry);
    if (diagnostic) normalized.push(diagnostic);
    else rejectedCount += 1;
  }

  const byInstance = new Map();
  for (const event of normalized) {
    const bucket = byInstance.get(event.instanceKey) || [];
    bucket.push(event);
    byInstance.set(event.instanceKey, bucket);
  }

  const aggregate = new Map();
  const lifetimeAggregate = new Map();
  let comparableIntervals = 0;
  let exactComparableIntervals = 0;
  let resetIntervals = 0;
  let excludedInitialSnapshots = 0;
  let instancesWithComparableSnapshots = 0;
  let exactInstancesObserved = 0;

  for (const events of byInstance.values()) {
    events.sort((left, right) => left.timestampMs - right.timestampMs);
    if (events[0]?.exactInstanceIdentity) exactInstancesObserved += 1;
    if (events.length > 0) {
      excludedInitialSnapshots += 1;
      const latest = events[events.length - 1];
      for (const [family, counters] of Object.entries(latest.families)) {
        const currentAggregate = lifetimeAggregate.get(family) || emptyCounters();
        addCounters(currentAggregate, counters);
        lifetimeAggregate.set(family, currentAggregate);
      }
    }
    if (events.length < 2) continue;

    let instanceCompared = false;
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1];
      const current = events[index];
      if (current.requests < previous.requests) {
        resetIntervals += 1;
        continue;
      }

      const familyNames = new Set([...Object.keys(previous.families), ...Object.keys(current.families)]);
      let intervalCompared = false;
      for (const family of familyNames) {
        const before = previous.families[family];
        const after = current.families[family];
        if (!before || !after) continue;
        const delta = diffCounters(before, after);
        if (!delta) continue;
        const currentAggregate = aggregate.get(family) || emptyCounters();
        addCounters(currentAggregate, delta);
        aggregate.set(family, currentAggregate);
        intervalCompared = true;
      }

      if (intervalCompared) {
        comparableIntervals += 1;
        if (current.exactInstanceIdentity && previous.exactInstanceIdentity) exactComparableIntervals += 1;
        instanceCompared = true;
      }
    }
    if (instanceCompared) instancesWithComparableSnapshots += 1;
  }

  const families = [...aggregate.entries()]
    .map(([family, counters]) => ({
      family,
      ...counters,
      cacheAvoided: counters.memoryHits + counters.inFlightHits,
      upstreamRate: counters.requests > 0 ? Number((counters.upstream / counters.requests).toFixed(4)) : 0,
    }))
    .sort((left, right) =>
      right.upstream - left.upstream
      || right.upstreamBytes - left.upstreamBytes
      || left.family.localeCompare(right.family)
    );

  const totals = families.reduce((sum, family) => {
    for (const key of COUNTER_KEYS) sum[key] += family[key];
    sum.cacheAvoided += family.cacheAvoided;
    return sum;
  }, { ...emptyCounters(), cacheAvoided: 0 });

  const lifetimeFamilies = [...lifetimeAggregate.entries()]
    .map(([family, counters]) => ({
      family,
      ...counters,
      cacheAvoided: counters.memoryHits + counters.inFlightHits,
      upstreamRate: counters.requests > 0 ? Number((counters.upstream / counters.requests).toFixed(4)) : 0,
    }))
    .sort((left, right) =>
      right.upstream - left.upstream
      || right.upstreamBytes - left.upstreamBytes
      || left.family.localeCompare(right.family)
    );

  const lifetimeTotals = lifetimeFamilies.reduce((sum, family) => {
    for (const key of COUNTER_KEYS) sum[key] += family[key];
    sum.cacheAvoided += family.cacheAvoided;
    return sum;
  }, { ...emptyCounters(), cacheAvoided: 0 });

  const sourceStatus = String(options.sourceStatus || 'ok');
  const baselineStatus = sourceStatus !== 'ok'
    ? 'source_unavailable'
    : totals.requests >= 50 && comparableIntervals >= 2
      ? 'ready'
      : totals.requests > 0
        ? 'partial'
        : 'insufficient';

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: (options.now || new Date()).toISOString(),
    sourceStatus,
    baselineStatus,
    inputCount: source.length,
    acceptedCount: normalized.length,
    rejectedCount,
    truncatedCount: Math.max(0, source.length - limited.length),
    coverage: {
      instancesObserved: byInstance.size,
      exactInstancesObserved,
      instancesWithComparableSnapshots,
      comparableIntervals,
      exactComparableIntervals,
      resetIntervals,
      excludedInitialSnapshots,
      note: 'Les premiers snapshots cumulés de chaque instance sont exclus afin de ne pas attribuer à la fenêtre des appels antérieurs.',
    },
    totals,
    families,
    lifetimeSinceInstanceStart: {
      note: 'Somme du dernier snapshot cumulé de chaque instance observée. Ce compteur couvre la vie de l’instance, pas nécessairement la seule fenêtre de 6 h.',
      totals: lifetimeTotals,
      families: lifetimeFamilies,
    },
  };
}

function buildSummary(report) {
  const top = report.families.slice(0, 6)
    .map(item => `- ${item.family}: upstream=${item.upstream}, requests=${item.requests}, cacheAvoided=${item.cacheAvoided}, upstreamBytes=${item.upstreamBytes}`);
  const lifetimeTop = report.lifetimeSinceInstanceStart.families.slice(0, 6)
    .map(item => `- ${item.family}: upstream=${item.upstream}, requests=${item.requests}, cacheAvoided=${item.cacheAvoided}, upstreamBytes=${item.upstreamBytes}`);
  return [
    '## Baseline cache TMDB SeenIt',
    '',
    `- Source : **${report.sourceStatus}**`,
    `- Statut : **${report.baselineStatus}**`,
    `- Snapshots acceptés : ${report.acceptedCount}/${report.inputCount}`,
    `- Intervalles comparables : ${report.coverage.comparableIntervals} (identité instance exacte : ${report.coverage.exactComparableIntervals})`,
    `- Requêtes couvertes : ${report.totals.requests} ; upstream : ${report.totals.upstream} ; économisées/coalescées : ${report.totals.cacheAvoided}`,
    '',
    ...(top.length ? ['### Familles les plus coûteuses — delta fenêtre', '', ...top] : ['Aucun delta comparable dans la fenêtre.']),
    '',
    '### Dernier compteur cumulé par instance',
    '',
    `- Requêtes depuis démarrage des instances observées : ${report.lifetimeSinceInstanceStart.totals.requests} ; upstream : ${report.lifetimeSinceInstanceStart.totals.upstream} ; économisées/coalescées : ${report.lifetimeSinceInstanceStart.totals.cacheAvoided}`,
    ...(lifetimeTop.length ? lifetimeTop : ['Aucun snapshot cumulatif exploitable.']),
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

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.input || !args.report) {
    throw new Error('Usage: node scripts/summarize-tmdb-cache-diagnostics.cjs --input=<json> --report=<json>');
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
  const report = summarizeTmdbCacheDiagnostics(input, {
    sourceStatus: process.env.SEENIT_TMDB_DIAGNOSTIC_SOURCE_STATUS || 'ok',
  });
  const reportPath = path.resolve(args.report);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const summary = buildSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, 'utf8');
  console.log(`[TMDBCacheBaseline] source=${report.sourceStatus} statut=${report.baselineStatus} snapshots=${report.acceptedCount} intervals=${report.coverage.comparableIntervals} requests=${report.totals.requests} upstream=${report.totals.upstream} lifetimeRequests=${report.lifetimeSinceInstanceStart.totals.requests} lifetimeUpstream=${report.lifetimeSinceInstanceStart.totals.upstream}`);
  for (const family of report.lifetimeSinceInstanceStart.families.slice(0, 8)) {
    console.log(`[TMDBCacheBaselineFamily] family=${family.family} lifetimeRequests=${family.requests} memoryHits=${family.memoryHits} inFlightHits=${family.inFlightHits} upstream=${family.upstream} upstreamBytes=${family.upstreamBytes}`);
  }
}

module.exports = {
  MAX_INPUT_EVENTS,
  buildSummary,
  normalizeDiagnostic,
  summarizeTmdbCacheDiagnostics,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[TMDBCacheBaseline] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
