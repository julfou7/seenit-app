const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'data/media-relations/catalog.json');
const snapshotPath = path.join(root, 'src/features/shows/mediaRelations.generated.ts');

const MEDIA_KEY_PATTERN = /^(movie|tv):([1-9]\d*)$/;
const GROUP_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_PROVIDERS = new Set([
  'seenit-editorial-review',
  'tmdb-collection',
  'tvdb-approved-list',
  'wikidata-narrative-universe',
  'wikidata-series'
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, allowed, context) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), `${context} doit être un objet.`);
  for (const key of Object.keys(value)) {
    invariant(allowed.has(key), `${context} contient le champ interdit ou inconnu « ${key} ».`);
  }
}

function normalizeMember(value, context) {
  assertExactKeys(value, new Set([
    'mediaKey', 'mediaType', 'tmdbId', 'label', 'releaseDate', 'posterPath'
  ]), context);
  const match = String(value.mediaKey || '').match(MEDIA_KEY_PATTERN);
  invariant(match, `${context}.mediaKey doit être movie:<tmdbId> ou tv:<tmdbId>.`);
  const mediaType = match[1];
  const tmdbId = Number(match[2]);
  invariant(value.mediaType === mediaType, `${context}.mediaType diverge de mediaKey.`);
  invariant(Number.isSafeInteger(value.tmdbId) && value.tmdbId === tmdbId, `${context}.tmdbId diverge de mediaKey.`);
  invariant(typeof value.label === 'string' && value.label.trim(), `${context}.label est requis pour l'affichage.`);
  invariant(typeof value.releaseDate === 'string' && ISO_DATE_PATTERN.test(value.releaseDate), `${context}.releaseDate doit être YYYY-MM-DD.`);
  invariant(
    value.posterPath === null || (typeof value.posterPath === 'string' && /^\/[A-Za-z0-9._-]+$/.test(value.posterPath)),
    `${context}.posterPath doit être null ou un chemin TMDB relatif.`
  );
  return {
    mediaKey: value.mediaKey,
    mediaType,
    tmdbId,
    label: value.label.trim(),
    releaseDate: value.releaseDate,
    posterPath: value.posterPath
  };
}

function normalizeProvenance(value, context) {
  assertExactKeys(value, new Set(['provider', 'reference', 'reviewedAt']), context);
  invariant(ALLOWED_PROVIDERS.has(value.provider), `${context}.provider n'est pas approuvé.`);
  invariant(typeof value.reference === 'string' && /^https:\/\//.test(value.reference), `${context}.reference HTTPS est requise.`);
  invariant(typeof value.reviewedAt === 'string' && ISO_DATE_PATTERN.test(value.reviewedAt), `${context}.reviewedAt doit être YYYY-MM-DD.`);
  return {
    provider: value.provider,
    reference: value.reference,
    reviewedAt: value.reviewedAt
  };
}

function normalizeCatalog(value) {
  assertExactKeys(value, new Set(['schemaVersion', 'catalogVersion', 'groups']), 'catalogue');
  invariant(value.schemaVersion === 1, 'catalogue.schemaVersion doit valoir 1.');
  invariant(Number.isSafeInteger(value.catalogVersion) && value.catalogVersion >= 1, 'catalogue.catalogVersion doit être un entier positif.');
  invariant(Array.isArray(value.groups) && value.groups.length > 0, 'catalogue.groups doit contenir au moins un groupe.');

  const groupIds = new Set();
  const relationOwners = new Map();
  const groups = value.groups.map((group, groupIndex) => {
    const context = `catalogue.groups[${groupIndex}]`;
    assertExactKeys(group, new Set([
      'groupId', 'relationKind', 'sourceGroupId', 'version', 'provenance', 'members'
    ]), context);
    invariant(typeof group.groupId === 'string' && GROUP_ID_PATTERN.test(group.groupId), `${context}.groupId est invalide.`);
    invariant(!groupIds.has(group.groupId), `${context}.groupId « ${group.groupId} » est dupliqué.`);
    groupIds.add(group.groupId);
    invariant(group.relationKind === 'saga' || group.relationKind === 'universe', `${context}.relationKind est invalide.`);
    invariant(typeof group.sourceGroupId === 'string' && group.sourceGroupId.trim(), `${context}.sourceGroupId est requis.`);
    invariant(Number.isSafeInteger(group.version) && group.version >= 1, `${context}.version doit être un entier positif.`);
    invariant(Array.isArray(group.members) && group.members.length >= 2, `${context} doit contenir au moins deux membres.`);

    const memberKeys = new Set();
    const members = group.members.map((member, memberIndex) => {
      const normalized = normalizeMember(member, `${context}.members[${memberIndex}]`);
      invariant(!memberKeys.has(normalized.mediaKey), `${context} duplique ${normalized.mediaKey}.`);
      memberKeys.add(normalized.mediaKey);

      const ownershipKey = `${group.relationKind}:${normalized.mediaKey}`;
      const previousOwner = relationOwners.get(ownershipKey);
      invariant(!previousOwner, `${normalized.mediaKey} appartient à deux groupes ${group.relationKind} : ${previousOwner} et ${group.groupId}.`);
      relationOwners.set(ownershipKey, group.groupId);
      return normalized;
    }).sort((left, right) => left.releaseDate.localeCompare(right.releaseDate) || left.mediaKey.localeCompare(right.mediaKey));

    return {
      groupId: group.groupId,
      relationKind: group.relationKind,
      source: 'seenit-manifest',
      sourceGroupId: group.sourceGroupId.trim(),
      version: group.version,
      provenance: normalizeProvenance(group.provenance, `${context}.provenance`),
      members
    };
  }).sort((left, right) => left.groupId.localeCompare(right.groupId));

  return {
    schemaVersion: 1,
    catalogVersion: value.catalogVersion,
    groups
  };
}

function readCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
}

function renderSnapshot(catalog) {
  const normalized = normalizeCatalog(catalog);
  // Le snapshot est une sortie machine compacte : le catalogue JSON reste la surface de revue humaine.
  const payload = JSON.stringify(normalized.groups);
  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  return `/* Fichier généré par npm run relations:build. Ne pas modifier à la main. */\n` +
    `export const MEDIA_RELATION_CATALOG_VERSION = ${normalized.catalogVersion} as const;\n` +
    `export const MEDIA_RELATION_CATALOG_SHA256 = '${digest}' as const;\n` +
    `export const MEDIA_RELATION_CATALOG = ${payload} as const;\n`;
}

function buildSnapshot() {
  const catalog = readCatalog();
  const snapshot = renderSnapshot(catalog);
  fs.writeFileSync(snapshotPath, snapshot, 'utf8');
  return normalizeCatalog(catalog);
}

function checkSnapshot() {
  const catalog = readCatalog();
  const expected = renderSnapshot(catalog);
  invariant(fs.existsSync(snapshotPath), 'Le snapshot généré est absent. Lancez npm run relations:build.');
  const actual = fs.readFileSync(snapshotPath, 'utf8');
  invariant(actual === expected, 'Le snapshot généré diverge du catalogue. Lancez npm run relations:build.');
  return normalizeCatalog(catalog);
}

function main() {
  const command = process.argv[2] || 'check';
  invariant(command === 'build' || command === 'check', 'Commande attendue : build ou check.');
  const catalog = command === 'build' ? buildSnapshot() : checkSnapshot();
  const memberCount = catalog.groups.reduce((total, group) => total + group.members.length, 0);
  console.log(`[Relations] Catalogue v${catalog.catalogVersion} valide : ${catalog.groups.length} groupes, ${memberCount} membres.`);
}

module.exports = {
  ALLOWED_PROVIDERS,
  MEDIA_KEY_PATTERN,
  buildSnapshot,
  checkSnapshot,
  normalizeCatalog,
  normalizeMember,
  renderSnapshot
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[Relations] ${error.message}`);
    process.exitCode = 1;
  }
}
