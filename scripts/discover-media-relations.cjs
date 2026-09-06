const fs = require('node:fs');
const path = require('node:path');
const { normalizeCatalog } = require('./media-relations-catalog.cjs');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'data/media-relations/catalog.json');
const endpoint = 'https://query.wikidata.org/sparql';
const pageSize = 5000;
const maximumPages = 20;

const queryFor = offset => `
SELECT DISTINCT ?relationGroup ?relationKind ?work ?mediaType ?tmdbId WHERE {
  VALUES (?relationProperty ?relationKind) {
    (wdt:P1080 "universe")
    (wdt:P179 "saga")
  }
  ?work ?relationProperty ?relationGroup .
  {
    ?work wdt:P4947 ?tmdbId .
    BIND("movie" AS ?mediaType)
  }
  UNION
  {
    ?work wdt:P4983 ?tmdbId .
    BIND("tv" AS ?mediaType)
  }
}
ORDER BY ?relationKind ?relationGroup ?work ?mediaType ?tmdbId
LIMIT ${pageSize}
OFFSET ${offset}`.trim();

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function qidFromUri(value) {
  const match = String(value || '').match(/^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/);
  return match ? match[1] : null;
}

function exactMediaKey(binding) {
  const mediaType = binding?.mediaType?.value;
  const rawId = binding?.tmdbId?.value;
  if ((mediaType !== 'movie' && mediaType !== 'tv') || !/^[1-9]\d*$/.test(String(rawId || ''))) return null;
  return `${mediaType}:${Number(rawId)}`;
}

function buildCandidateSnapshot(bindings, rawCatalog, generatedAt = new Date().toISOString()) {
  invariant(Array.isArray(bindings), 'Les résultats Wikidata doivent être un tableau.');
  const catalog = normalizeCatalog(rawCatalog);
  const groupsByUniverse = new Map();
  const workIdentities = new Map();
  const rejected = [];

  for (const binding of bindings) {
    const sourceGroupId = qidFromUri(binding?.relationGroup?.value);
    const relationKind = binding?.relationKind?.value;
    const workId = qidFromUri(binding?.work?.value);
    const mediaKey = exactMediaKey(binding);
    if (!sourceGroupId || (relationKind !== 'saga' && relationKind !== 'universe') || !workId || !mediaKey) {
      rejected.push({ reason: 'identity_incomplete' });
      continue;
    }

    const knownIdentities = workIdentities.get(workId) || new Set();
    knownIdentities.add(mediaKey);
    workIdentities.set(workId, knownIdentities);

    const relationGroupKey = `${relationKind}:${sourceGroupId}`;
    const members = groupsByUniverse.get(relationGroupKey) || new Set();
    members.add(mediaKey);
    groupsByUniverse.set(relationGroupKey, members);
  }

  const ambiguousWorks = new Set(
    [...workIdentities.entries()].filter(([, identities]) => identities.size > 1).map(([workId]) => workId)
  );
  if (ambiguousWorks.size > 0) {
    for (const binding of bindings) {
      const workId = qidFromUri(binding?.work?.value);
      const sourceGroupId = qidFromUri(binding?.relationGroup?.value);
      const relationKind = binding?.relationKind?.value;
      const mediaKey = exactMediaKey(binding);
      if (workId && sourceGroupId && (relationKind === 'saga' || relationKind === 'universe') && mediaKey && ambiguousWorks.has(workId)) {
        groupsByUniverse.get(`${relationKind}:${sourceGroupId}`)?.delete(mediaKey);
      }
    }
    for (const workId of ambiguousWorks) rejected.push({ workId, reason: 'typed_identity_ambiguous' });
  }

  const catalogMemberSets = catalog.groups.map(group => ({
    groupId: group.groupId,
    relationKind: group.relationKind,
    members: new Set(group.members.map(member => member.mediaKey))
  }));

  const candidates = [...groupsByUniverse.entries()].flatMap(([relationGroupKey, memberSet]) => {
    const [relationKind, sourceGroupId] = relationGroupKey.split(':');
    const members = [...memberSet].sort();
    if (members.length < 2) return [];
    const identical = catalogMemberSets.find(group =>
      group.relationKind === relationKind &&
      group.members.size === members.length &&
      members.every(mediaKey => group.members.has(mediaKey))
    );
    if (identical) return [];
    const overlaps = catalogMemberSets
      .filter(group => group.relationKind === relationKind && members.some(mediaKey => group.members.has(mediaKey)))
      .map(group => group.groupId)
      .sort();
    return [{
      candidateId: `wikidata-${relationKind}:${sourceGroupId}`,
      relationKind,
      source: relationKind === 'universe' ? 'wikidata-narrative-universe' : 'wikidata-series',
      sourceGroupId,
      reference: `https://www.wikidata.org/wiki/${sourceGroupId}`,
      reviewStatus: 'pending-review',
      members,
      overlaps
    }];
  }).sort((left, right) => left.candidateId.localeCompare(right.candidateId));

  return {
    schemaVersion: 1,
    generatedAt,
    query: {
      endpoint,
      relationProperties: {
        universe: 'P1080',
        saga: 'P179'
      },
      movieIdentityProperty: 'P4947',
      tvIdentityProperty: 'P4983'
    },
    candidates,
    rejected
  };
}

async function fetchPage(offset) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const url = new URL(endpoint);
    url.searchParams.set('query', queryFor(offset));
    url.searchParams.set('format', 'json');
    const response = await fetch(url, {
      headers: {
        Accept: 'application/sparql-results+json',
        'User-Agent': 'SeenIt media-relations discovery (https://github.com/julfou7/seenit-app)'
      },
      signal: controller.signal
    });
    invariant(response.ok, `Wikidata a répondu HTTP ${response.status}.`);
    const payload = await response.json();
    invariant(Array.isArray(payload?.results?.bindings), 'Réponse Wikidata SPARQL invalide.');
    return payload.results.bindings;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAllBindings() {
  const bindings = [];
  for (let page = 0; page < maximumPages; page += 1) {
    const current = await fetchPage(page * pageSize);
    bindings.push(...current);
    if (current.length < pageSize) return bindings;
  }
  throw new Error(`Pagination Wikidata incomplète après ${maximumPages * pageSize} lignes.`);
}

function argumentValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length) || null;
}

function resolveRepositoryPath(relativePath, label) {
  invariant(relativePath, `${label} est requis.`);
  const absolutePath = path.resolve(root, relativePath);
  invariant(absolutePath.startsWith(`${root}${path.sep}`), `${label} doit rester dans le dépôt.`);
  return absolutePath;
}

async function main() {
  const outputPath = resolveRepositoryPath(argumentValue('output'), '--output');
  const fixture = argumentValue('fixture');
  const bindings = fixture
    ? JSON.parse(fs.readFileSync(resolveRepositoryPath(fixture, '--fixture'), 'utf8'))
    : await fetchAllBindings();
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const snapshot = buildCandidateSnapshot(bindings, catalog);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`[Relations] ${snapshot.candidates.length} groupe(s) candidat(s), ${snapshot.rejected.length} ligne(s) rejetée(s).`);
  console.log('[Relations] Aucun candidat n’a été publié : une revue humaine reste obligatoire.');
}

module.exports = {
  buildCandidateSnapshot,
  exactMediaKey,
  qidFromUri,
  queryFor
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[Relations] Découverte impossible : ${error.message}`);
    process.exitCode = 1;
  });
}
