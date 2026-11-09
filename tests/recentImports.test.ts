import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { isAllowedServiceProxyPath } from '../src/features/downloads/downloadBackendSecurity.ts';

// Vrai module de la rangée « Téléchargés » : seuls le transport et le gate sont remplacés.
const bundle = await build({ entryPoints: ['src/features/downloads/recentImports.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'imports-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:sonarrRadarr|downloadFeatureVisibility)$/ }, args => ({ path: args.path.split('/').at(-1) || '', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'sonarrRadarr'
      ? 'export const cleanUrl=u=>String(u).replace(/\\/+$/,"");export const executeGet=async()=>{throw new Error("réseau réel interdit")};export const executeDelete=async()=>{throw new Error("réseau réel interdit")};'
      : 'export const isDownloadFeatureEnabled=c=>c.downloadsEnabled===true;' }));
  } }] });
type Episode = { season: number; episode: number };
type Item = { kind: 'series' | 'movie'; key: string; tmdbId?: number; title: string; date: number; episodes?: Episode[] };
const recent = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  fetchRecentImports: (config: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ items: Item[]; failures: string[] }>;
  recentImportLabel: (item: Item, now: number) => string;
  importDayLabel: (time: number, now: number) => string;
  removeRecentImport: (config: Record<string, unknown>, item: Item & { arrId: number }, io: Record<string, unknown>) => Promise<'removed' | 'kept'>;
  recentImportServerKey: (config: Record<string, unknown>, item: Item) => string;
  visibleRecentImports: (items: Item[], clearedAt: number, removed?: Record<string, number>, keyOf?: (item: Item) => string) => Item[];
  coveredByRecentImport: (imports: Item[], media: Record<string, unknown>) => boolean;
  recentImportsScope: (config: Record<string, unknown>) => string;
};

const now = new Date(2026, 10, 7, 18, 0).getTime(); // samedi 7 novembre, heure locale
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const config = { downloadsEnabled: true, sonarrUrl: 'http://sonarr/', sonarrApiKey: 's', radarrUrl: 'http://radarr', radarrApiKey: 'r' };

// Retour terrain du 09/11 (« plus de limite à 7 jours, pour ne pas laisser de données orphelines dans Sonarr/Radarr ») :
// la bibliothèque fait la liste, l'historique (30 jours) ne fait que dater et détailler les imports récents.
const SONARR_LIBRARY = [
  { id: 7, title: 'Severance', tmdbId: 95396, monitored: true, added: '2025-01-02T00:00:00Z', statistics: { episodeFileCount: 3 }, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/a.jpg' }] },
  { id: 8, title: 'A Knight of the Seven Kingdoms', tmdbId: 224372, monitored: true, added: '2025-06-01T00:00:00Z', statistics: { episodeFileCount: 1 } },
  { id: 9, title: 'Ancienne série', tmdbId: 1399, monitored: false, added: '2025-03-01T00:00:00Z', statistics: { episodeFileCount: 40 } },
  { id: 10, title: 'Sans fichier', tmdbId: 555, monitored: false, added: '2025-04-01T00:00:00Z', statistics: { episodeFileCount: 0 } }
];
const SONARR_HISTORY = [
  { eventType: 'downloadFolderImported', date: hoursAgo(1), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 10 }, series: { title: 'Severance', tmdbId: 95396 } },
  { eventType: 3, date: hoursAgo(2), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 9 }, series: { title: 'Severance', tmdbId: 95396 } },
  // Nouvelle version du même épisode : un seul épisode compté.
  { eventType: 'downloadFolderImported', date: hoursAgo(3), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 10 }, series: { title: 'Severance', tmdbId: 95396 } },
  // Un grab n'est pas un fichier dans la bibliothèque.
  { eventType: 'grabbed', date: hoursAgo(1), seriesId: 8, episode: { seasonNumber: 1, episodeNumber: 4 }, series: { title: 'A Knight of the Seven Kingdoms', tmdbId: 224372 } },
  { eventType: 'downloadFolderImported', date: hoursAgo(26), seriesId: 8, episode: { seasonNumber: 1, episodeNumber: 3 }, series: { title: 'A Knight of the Seven Kingdoms', tmdbId: 224372 } }
];
const RADARR_LIBRARY = [
  { id: 40, title: 'Le Chat Chapeauté', tmdbId: 1234, monitored: true, hasFile: true, movieFile: { dateAdded: hoursAgo(300) } },
  { id: 41, title: 'Pas encore là', tmdbId: 99, monitored: true, hasFile: false, digitalRelease: '2027-02-01T00:00:00Z' },
  { id: 42, title: "A Dog's Perfect Christmas", tmdbId: 1100, monitored: false, hasFile: false, added: '2026-11-01T00:00:00Z' }
];
const RADARR_HISTORY = [{ eventType: 'downloadFolderImported', date: hoursAgo(120), movieId: 40, movie: { title: 'Le Chat Chapeauté', tmdbId: 1234 } }, { eventType: 'grabbed', date: hoursAgo(5), movieId: 41, movie: { title: 'Pas encore là', tmdbId: 99 } }];
const arrGet = (urls: string[] = []) => async (url: string) => {
  urls.push(url);
  if (url.includes('/history/since')) return url.startsWith('http://sonarr') ? SONARR_HISTORY : RADARR_HISTORY;
  return url.endsWith('/api/v3/series') ? SONARR_LIBRARY : RADARR_LIBRARY;
};

test('SEENIT-DOWNLOAD-013 Téléchargés : tout ce que Sonarr/Radarr détiennent avec un fichier, sans limite de date ; imports récents datés et détaillés', async () => {
  const urls: string[] = [];
  const result = await recent.fetchRecentImports(config, { now, get: arrGet(urls) }) as Awaited<ReturnType<typeof recent.fetchRecentImports>> & { pending: Array<Item & { monitored: boolean }> };
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.items.map(item => item.title), ['Severance', 'A Knight of the Seven Kingdoms', 'Le Chat Chapeauté', 'Ancienne série'], 'une série importée il y a un an reste listée');
  assert.deepEqual(result.items[0].episodes, [{ season: 2, episode: 9 }, { season: 2, episode: 10 }]);
  assert.deepEqual(result.items.map(item => recent.recentImportLabel(item, now)), ['2 épisodes · S02E09–E10', 'S01E03 · hier', 'Film · lun.', 'Série']);
  assert.equal(result.items[3].date, Date.parse('2025-03-01T00:00:00Z'), 'sans import récent : date d’ajout');
  assert.deepEqual(result.pending.map(item => [item.key, item.monitored]), [['m42', false], ['s10', false], ['m41', true]], 'sans fichier : Programmés ou « À décider »');
  const since = encodeURIComponent(new Date(now - 30 * 86_400_000).toISOString());
  assert.ok(urls.includes('http://sonarr/api/v3/series') && urls.includes('http://radarr/api/v3/movie'), 'bibliothèques lues');
  assert.ok(urls.includes(`http://sonarr/api/v3/history/since?date=${since}&eventType=3&includeSeries=true&includeEpisode=true`));
  assert.ok(urls.includes(`http://radarr/api/v3/history/since?date=${since}&eventType=3&includeMovie=true`));
  // En PWA, ces lectures passent par le proxy serveur : il doit les accepter (sinon « injoignable » à tort).
  assert.ok(urls.every(url => isAllowedServiceProxyPath(url, 'GET')), urls.join(' '));
});

test('SEENIT-DOWNLOAD-013 Téléchargés : une source injoignable est dite, jamais lue comme « rien de téléchargé »', async () => {
  const get = async (url: string) => {
    if (url.startsWith('http://sonarr')) return '<html>Connexion</html>';
    throw new Error('503');
  };
  const result = await recent.fetchRecentImports(config, { now, get });
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.failures.sort(), ['Radarr', 'Sonarr']);
  // Revue Codex #923 : deux lectures indépendantes — un historique en panne ne vide pas la bibliothèque.
  const historyDown = await recent.fetchRecentImports(config, { now, get: async (url: string) => { if (url.includes('/history/')) throw new Error('503'); return arrGet()(url); } });
  assert.deepEqual(historyDown.failures, []);
  assert.equal(historyDown.items.length, 4);
  const disabled = await recent.fetchRecentImports({ ...config, downloadsEnabled: false }, { now, get: async () => { throw new Error('jamais appelé'); } });
  assert.deepEqual(disabled, { items: [], failures: [], pending: [] });
  assert.notEqual(recent.recentImportsScope(config), recent.recentImportsScope({ ...config, sonarrUrl: 'http://autre' }));
});

test('SEENIT-DOWNLOAD-013 Téléchargés : libellés de jour calendaires et plage multi-saison', () => {
  assert.equal(recent.importDayLabel(now - 3_600_000, now), "aujourd'hui");
  assert.equal(recent.importDayLabel(new Date(2026, 10, 6, 23, 30).getTime(), now), 'hier');
  assert.equal(recent.importDayLabel(new Date(2026, 10, 4, 9).getTime(), now), 'mer.');
  const multi: Item = { kind: 'series', key: 's1', tmdbId: 1, title: 'X', date: now, episodes: [{ season: 1, episode: 10 }, { season: 2, episode: 1 }] };
  assert.equal(recent.recentImportLabel(multi, now), '2 épisodes · S01E10–S02E01');
});

test('SEENIT-DOWNLOAD-013 Téléchargés : un terminé n’est couvert que par le même TMDB et le même épisode, jamais par le titre', () => {
  const imports: Item[] = [
    { kind: 'series', key: 's7', tmdbId: 95396, title: 'Severance', date: now, episodes: [{ season: 2, episode: 9 }] },
    { kind: 'movie', key: 'm40', tmdbId: 4, title: 'Dune', date: now }
  ];
  assert.equal(recent.coveredByRecentImport(imports, { mediaType: 'tv', tmdbId: 95396, seasonNumber: 2, episodeNumber: 9 }), true);
  assert.equal(recent.coveredByRecentImport(imports, { mediaType: 'tv', tmdbId: 95396, seasonNumber: 2, episodeNumber: 10 }), false);
  assert.equal(recent.coveredByRecentImport(imports, { mediaType: 'movie', tmdbId: 4 }), true);
  assert.equal(recent.coveredByRecentImport(imports, { mediaType: 'tv', tmdbId: 4, seasonNumber: 1, episodeNumber: 1 }), false);
  assert.equal(recent.coveredByRecentImport(imports, { mediaType: 'movie', title: 'Dune' }), false);
});

// Retour terrain et décisions du propriétaire du 09/11 : Téléchargés reprend la carte d'Explorer, et « Retirer »
// sort le titre de Radarr/Sonarr en gardant les fichiers ; une série encore attendue reste dans Sonarr.
test('SEENIT-DOWNLOAD-021 Téléchargés : identifiant, année et note de la carte ; Retirer garde les fichiers et les séries encore programmées', async () => {
  const get = async (url: string) => url.includes('/history/since') ? []
    : url.startsWith('http://sonarr') ? [{ id: 7, title: 'Severance', tmdbId: 95396, year: 2022, ratings: { value: 8.4 }, added: hoursAgo(1), statistics: { episodeFileCount: 1 } }]
    : [{ id: 40, title: 'Dune', tmdbId: 438631, year: 2021, hasFile: true, movieFile: { dateAdded: hoursAgo(2) }, ratings: { imdb: { value: 8 }, tmdb: { value: 7.8 } } }];
  const { items } = await recent.fetchRecentImports(config, { now, get });
  assert.deepEqual(items.map(item => [item.key, (item as Record<string, unknown>).arrId, (item as Record<string, unknown>).year, (item as Record<string, unknown>).rating]), [['s7', 7, 2022, 8.4], ['m40', 40, 2021, 7.8]], 'note TMDB du film en priorité');

  const deleted: string[] = [];
  const episodes: Record<string, unknown> = { 7: [{ monitored: true, hasFile: true }, { monitored: false, hasFile: false }], 8: [{ monitored: true, hasFile: true }, { monitored: true, hasFile: false }] };
  // Revue Codex #933 : la surveillance de la série compte — 9 est non surveillée mais garde un épisode coché.
  const seriesMonitored: Record<string, boolean> = { 7: true, 8: true, 9: false };
  episodes[9] = [{ monitored: true, hasFile: false }];
  const reads: string[] = [];
  const io = { get: async (url: string) => { reads.push(url); const series = url.match(/\/series\/(\d+)$/); return series ? { id: Number(series[1]), monitored: seriesMonitored[series[1]] } : episodes[url.split('=').pop() || '']; }, del: async (url: string) => { deleted.push(url); } };
  const movie = { kind: 'movie' as const, key: 'm40', arrId: 40, title: 'Dune', date: now };
  const done = { kind: 'series' as const, key: 's7', arrId: 7, title: 'Severance', date: now, episodes: [] };
  const awaited = { kind: 'series' as const, key: 's8', arrId: 8, title: 'A Knight', date: now, episodes: [] };
  assert.equal(await recent.removeRecentImport(config, movie, io), 'removed');
  assert.equal(await recent.removeRecentImport(config, done, io), 'removed', 'plus rien d’attendu : sortie de Sonarr');
  assert.equal(await recent.removeRecentImport(config, awaited, io), 'kept', 'un épisode surveillé sans fichier : la série reste dans Sonarr');
  assert.deepEqual(deleted, ['http://radarr/api/v3/movie/40?deleteFiles=false&addImportExclusion=false', 'http://sonarr/api/v3/series/7?deleteFiles=false&addImportListExclusion=false']);
  const unmonitored = { kind: 'series' as const, key: 's9', arrId: 9, title: 'Non surveillée', date: now, episodes: [] };
  assert.equal(await recent.removeRecentImport(config, unmonitored, io), 'removed', 'série non surveillée : rien n’arrivera, elle est retirée au lieu d’être masquée');
  assert.equal(deleted.at(-1), 'http://sonarr/api/v3/series/9?deleteFiles=false&addImportListExclusion=false');
  reads.length = 0;
  assert.equal(await recent.removeRecentImport(config, awaited, { ...io, keepAwaited: false }), 'removed', '« À décider » : toujours retiré, sans lecture');
  assert.deepEqual(reads, []);
  assert.equal(deleted.at(-1), 'http://sonarr/api/v3/series/8?deleteFiles=false&addImportListExclusion=false');
  deleted.splice(2);
  assert.ok(isAllowedServiceProxyPath('http://sonarr/api/v3/series/8', 'GET'), 'fiche de série lue par le proxy PWA');
  assert.ok(deleted.every(url => isAllowedServiceProxyPath(url, 'DELETE')), 'suppression acceptée par le proxy PWA, fichiers gardés');
  assert.ok(isAllowedServiceProxyPath('http://sonarr/api/v3/episode?seriesId=8', 'GET'));
  // Série ou épisodes illisibles : rien n'est retiré, l'erreur est remontée.
  await assert.rejects(recent.removeRecentImport(config, done, { ...io, get: async () => '<html>login</html>' }));
  await assert.rejects(recent.removeRecentImport(config, done, { ...io, get: async (url: string) => url.endsWith('/series/7') ? { monitored: true } : '<html>login</html>' }));
  assert.equal(deleted.length, 2);
  await assert.rejects(recent.removeRecentImport({ ...config, radarrUrl: '' }, movie, io), /Radarr n’est pas configuré/);
});

// Revue Codex #923 : `s7` et `m40` ne valent que sur leur serveur ; un retrait mémorisé ne masque jamais
// l'élément de même identifiant d'un autre Sonarr/Radarr du même compte.
test('SEENIT-DOWNLOAD-021 Téléchargés : un retrait mémorisé est lié au serveur d’origine', () => {
  const series: Item = { kind: 'series', key: 's7', title: 'Severance', date: now - 1000 };
  const movie: Item = { kind: 'movie', key: 'm40', title: 'Dune', date: now - 1000 };
  const serverA = config, serverB = { ...config, sonarrUrl: 'http://autre-sonarr/', radarrUrl: 'http://autre-radarr' };
  assert.equal(recent.recentImportServerKey(serverA, series), 'http://sonarr|s7');
  assert.equal(recent.recentImportServerKey(serverA, movie), 'http://radarr|m40', 'film : adresse du Radarr');
  assert.ok(!recent.recentImportServerKey(serverA, series).includes('s|') && !recent.recentImportServerKey(serverA, series).includes(String(config.sonarrApiKey) + '|'), 'jamais la clé d’API');
  const removed = { [recent.recentImportServerKey(serverA, series)]: now - 1000 };
  assert.deepEqual(recent.visibleRecentImports([series, movie], 0, removed, item => recent.recentImportServerKey(serverA, item)).map(item => item.key), ['m40'], 'masqué sur son serveur');
  assert.deepEqual(recent.visibleRecentImports([series, movie], 0, removed, item => recent.recentImportServerKey(serverB, item)).map(item => item.key), ['s7', 'm40'], 'visible sur un autre serveur');
  const newer = { ...series, date: now };
  assert.deepEqual(recent.visibleRecentImports([newer], 0, removed, item => recent.recentImportServerKey(serverA, item)).map(item => item.key), ['s7'], 'un nouvel import du titre revient');
  const rail = readFileSync('src/components/RecentImportsRail.tsx', 'utf8');
  assert.match(rail, /const keyOf = \(item: RecentImport\) => recentImportServerKey\(config, item\);\n\s+const visible = visibleRecentImports\(items, 0, removed, keyOf\);/);
  assert.match(rail, /\[keyOf\(item\)\]: item\.date \}/, 'retrait mémorisé sous la clé du serveur');
  // v1.4.289 : plus de « Vider » (masquage local qui laissait des titres orphelins dans Sonarr/Radarr).
  assert.doesNotMatch(rail, />Vider<|clearedAt|CLEARED_FIELD/);
  assert.match(rail, /<LoadMore previews=\{visible\.slice\(limit, limit \+ 3\)/, 'grille paginée par le seul « Afficher plus » de l’app');
});
