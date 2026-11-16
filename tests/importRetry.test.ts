import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { isAllowedServiceProxyPath } from '../src/features/downloads/downloadBackendSecurity.ts';
import { waitingRetryLaunch } from '../src/features/downloads/waitingRetry.ts';

// Retour terrain du 16/11 (Dexter S02E02 bloqué dans qBittorrent faute de place sur D:) : « je ne peux pas relancer
// l'import Plex manuellement si je libère de la place ».
const bundle = await build({ entryPoints: ['src/features/downloads/importRetry.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:sonarrRadarr|sonarrRadarrTransport)$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const cleanUrl=u=>String(u).replace(/\\/+$/,"");export const executeArrInteractivePost=async()=>{throw new Error("réseau réel interdit")};' }));
  } }] });
const retry = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as typeof import('../src/features/downloads/importRetry.ts');
const gib = 1024 ** 3;
const blocked = { id: 'q1', mediaType: 'tv' as const, title: 'Dexter : Résurrection', seriesTitle: 'Dexter : Résurrection', tmdbId: 259909, seasonNumber: 2, episodeNumber: 2,
  size: 1.5 * gib, sizeleft: 0, progress: 100, status: 'error', statusText: 'Erreur', errorMessage: 'Disque plein : espace de stockage insuffisant',
  downloadId: 'abcdef0123456789abcdef0123456789abcdef01', transferPath: 'D:\\Downloads\\Dexter.Resurrection.S02E02.2160p', downloadClient: 'Sonarr' };

test('relancer l’import d’un téléchargement terminé bloqué faute de place, jamais une recherche', async () => {
  assert.equal(retry.canRetryImport(blocked), true);
  assert.equal(retry.canRetryImport({ ...blocked, progress: 40, sizeleft: 100 }), false, 'transfert pas fini');
  assert.equal(retry.canRetryImport({ ...blocked, errorMessage: 'Recherche impossible : timeout' }), false, 'autre échec');
  assert.equal(retry.canRetryImport({ ...blocked, transferPath: undefined }), false, 'dossier inconnu');
  const posts: Array<[string, unknown]> = [];
  await retry.retryImport({ sonarrUrl: 'http://nas:8989/', sonarrApiKey: 's' }, blocked, async (url, body) => { posts.push([url, body]); return {}; });
  assert.deepEqual(posts, [['http://nas:8989/api/v3/command', { name: 'DownloadedEpisodesScan', path: blocked.transferPath, downloadClientId: blocked.downloadId.toUpperCase(), importMode: 'Auto' }]]);
  assert.ok(isAllowedServiceProxyPath(posts[0][0], 'POST'));
  // Place insuffisante : il manque la taille du fichier plus 100 Mo de marge.
  assert.equal(retry.missingSpace(blocked, 0.9 * gib) > 0, true);
  assert.equal(retry.missingSpace(blocked, 3 * gib), 0);
  assert.match(retry.missingSpaceMessage(0.7 * gib), /^Il manque encore 0,7 Go sur le disque/);
  // La carte « À régler » de cet import ne propose pas « Relancer la recherche ».
  assert.equal(waitingRetryLaunch(blocked), null);
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(screen, /onRetryImport=\{canRetryImport\(item\) \? \(\) => void handleRetryImport\(item\) : undefined\}/);
  assert.match(screen, /if \(missing > 0\) \{ showToast\(\{ title, action: missingSpaceMessage\(missing\)/);
  // Revue Codex #1064 : portée figée au départ, rien n'est envoyé si elle a changé.
  assert.match(screen, /const scope = arrSyncKey\(\);\n\s+const scopedConfig = useDownloadConfigStore\.getState\(\);[\s\S]*?if \(arrSyncKey\(\) !== scope\) \{[\s\S]*?return; \}\n\s+await retryImport\(scopedConfig, item\);/);
  // Revue Codex #1064 : dans la carte de saison, un import en attente le dit (et cite le disque).
  const season = readFileSync('src/components/SeasonDownloadCard.tsx', 'utf8');
  assert.match(season, /if \(importPending\(item\)\) return 'active';/);
  assert.match(season, /if \(kind === 'active' && importPending\(item\)\) return importDiskNote \? `Téléchargé · import en attente : \$\{importDiskNote\}` : 'Téléchargé · import Plex en cours';/);
  assert.match(screen, /importDiskNote=\{importDiskNote\('tv'\)\} \/>/);
});

// Retour terrain du 16/11 (S02E01 sur Plex) : « déjà disponible » n'est ni un échec à relancer ni une carte « À régler ».
test('déjà disponible : demande fermée, jamais relançable', () => {
  assert.equal(waitingRetryLaunch({ ...blocked, downloadId: undefined, transferPath: undefined, progress: 0, size: 0, errorMessage: 'Cet épisode est déjà disponible. Choisis explicitement son remplacement.', releaseTitle: 'Dexter • 4K' }), null);
  const launch = readFileSync('src/features/downloads/downloadLaunch.ts', 'utf8');
  assert.match(launch, /\} else if \(isAlreadyAvailableMessage\(result\.message\)\) \{[\s\S]*?notify\('Déjà disponible : rien n’a été lancé\.', 'info'\);\n\s+dismissDownloadRequest\(requestId, result\.message\);/);
  const lifecycle = readFileSync('src/features/downloads/downloadLifecycle.ts', 'utf8');
  assert.match(lifecycle, /export function dismissDownloadRequest[\s\S]*?if \(item\) void store\.removeDownload\(item\);/);
});
