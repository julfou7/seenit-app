const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const selfPath = __filename;
const originalSelf = execFileSync('git', ['show', 'HEAD^:scripts/sync-app-version.cjs'], { cwd: root, encoding: 'utf8' });

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, 'utf8');
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`[1.4.73 safety] Motif introuvable pour ${label}`);
  return source.replace(search, replacement);
}

// Centralise la décision de nettoyage afin qu'aucune branche ne puisse réintroduire un hash préexistant.
{
  const file = 'src/features/downloads/episodePackSelection.ts';
  let source = read(file);
  const anchor = `  return Array.from(exact);
}

function releaseMatchesQuality`;
  const replacement = `  return Array.from(exact);
}

/**
 * Choisit l'unique identifiant qu'un nettoyage de sécurité est autorisé à toucher.
 * La frontière est absolue : tout hash présent avant la demande est exclu, quelle
 * que soit la preuve Sonarr apparue ensuite.
 */
export function chooseExactCleanupTorrentId(
  exactNewTorrentIds: Array<string | null | undefined>,
  corroboratedSonarrIds: Array<string | null | undefined>,
  beforeQbitHashes: Array<string | null | undefined>,
  releaseHash?: string | null
): string | null {
  const before = new Set(
    (beforeQbitHashes || []).map(normalizeTorrentCorrelationId).filter(Boolean)
  );
  const release = normalizeTorrentCorrelationId(releaseHash);
  if (release && !before.has(release)) return release;

  const exact = Array.from(new Set(
    (exactNewTorrentIds || [])
      .map(normalizeTorrentCorrelationId)
      .filter(id => id && !before.has(id))
  ));
  if (exact.length === 1) return exact[0];

  const corroborated = Array.from(new Set(
    (corroboratedSonarrIds || [])
      .map(normalizeTorrentCorrelationId)
      .filter(id => id && !before.has(id))
  ));
  return corroborated.length === 1 ? corroborated[0] : null;
}

function releaseMatchesQuality`;
  source = replaceOnce(source, anchor, replacement, 'helper nettoyage exact');
  write(file, source);
}

{
  const file = 'src/features/downloads/episodeSeasonPackFallback.ts';
  let source = read(file);
  source = replaceOnce(
    source,
    `  extractReleaseTorrentHash,
  findExactNewTorrentIds,`,
    `  chooseExactCleanupTorrentId,
  extractReleaseTorrentHash,
  findExactNewTorrentIds,`,
    'import helper nettoyage'
  );

  const oldDecision = `    const exactCleanupId = exactNewIds.length === 1
      ? exactNewIds[0]
      : corroboratedSonarrIds.length === 1
        ? corroboratedSonarrIds[0]
        : releaseHash && !beforeQbitHashes.has(releaseHash)
          ? releaseHash
          : null;`;
  const newDecision = `    const exactCleanupId = chooseExactCleanupTorrentId(
      exactNewIds,
      corroboratedSonarrIds,
      Array.from(beforeQbitHashes),
      releaseHash
    );`;
  source = replaceOnce(source, oldDecision, newDecision, 'décision nettoyage pack');
  write(file, source);
}

{
  const file = 'tests/episodePackSelection.test.ts';
  let source = read(file);
  source = replaceOnce(
    source,
    `import {
  extractEpisodeRefsFromFileName,`,
    `import {
  chooseExactCleanupTorrentId,
  extractEpisodeRefsFromFileName,`,
    'import test nettoyage'
  );
  source += `

test('le nettoyage refuse aussi un hash ancien corroboré après coup par Sonarr', () => {
  const oldHash = '1'.repeat(40);
  assert.equal(chooseExactCleanupTorrentId(
    [],
    [oldHash],
    [oldHash],
    oldHash
  ), null);
});

test('le nettoyage peut cibler un infohash exact qui n’existait pas avant la demande', () => {
  const newHash = '2'.repeat(40);
  assert.equal(chooseExactCleanupTorrentId(
    [],
    [],
    [],
    newHash
  ), newHash);
});
`;
  write(file, source);
}

fs.writeFileSync(selfPath, originalSelf, 'utf8');

const filesToCommit = [
  'src/features/downloads/episodePackSelection.ts',
  'src/features/downloads/episodeSeasonPackFallback.ts',
  'tests/episodePackSelection.test.ts',
  'scripts/sync-app-version.cjs'
];
execFileSync('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: root });
execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], { cwd: root });
execFileSync('git', ['add', '--', ...filesToCommit], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['commit', '-m', `fix(téléchargements): interdire tout nettoyage de torrent préexistant

- Centralise la sélection de l’identifiant autorisé pour le nettoyage d’un pack.
- Exclut un hash qBittorrent présent avant la demande même si Sonarr le corrobore ensuite.
- Ajoute les tests de non-régression correspondants pour SeenIt 1.4.73.

[skip ci]`], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['push'], { cwd: root, stdio: 'inherit' });
console.log('[1.4.73 safety] Nettoyage des packs verrouillé et poussé.');
