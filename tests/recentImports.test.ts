import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
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
  coveredByRecentImport: (imports: Item[], media: Record<string, unknown>) => boolean;
  recentImportsScope: (config: Record<string, unknown>) => string;
};

const now = new Date(2026, 10, 7, 18, 0).getTime(); // samedi 7 novembre, heure locale
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const config = { downloadsEnabled: true, sonarrUrl: 'http://sonarr/', sonarrApiKey: 's', radarrUrl: 'http://radarr', radarrApiKey: 'r' };

test('SEENIT-DOWNLOAD-013 Téléchargés : imports réels des 7 derniers jours, groupés par série, doublons et grabs ignorés', async () => {
  const urls: string[] = [];
  const get = async (url: string) => {
    urls.push(url);
    if (url.startsWith('http://sonarr')) return [
      { eventType: 'downloadFolderImported', date: hoursAgo(1), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 10 }, series: { title: 'Severance', tmdbId: 95396, images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/a.jpg' }] } },
      { eventType: 3, date: hoursAgo(2), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 9 }, series: { title: 'Severance', tmdbId: 95396 } },
      // Nouvelle version du même épisode : un seul épisode compté.
      { eventType: 'downloadFolderImported', date: hoursAgo(3), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 10 }, series: { title: 'Severance', tmdbId: 95396 } },
      // Un grab n'est pas un fichier dans la bibliothèque.
      { eventType: 'grabbed', date: hoursAgo(1), seriesId: 8, episode: { seasonNumber: 1, episodeNumber: 4 }, series: { title: 'A Knight of the Seven Kingdoms', tmdbId: 224372 } },
      { eventType: 'downloadFolderImported', date: hoursAgo(26), seriesId: 8, episode: { seasonNumber: 1, episodeNumber: 3 }, series: { title: 'A Knight of the Seven Kingdoms', tmdbId: 224372 } }
    ];
    return [{ eventType: 'downloadFolderImported', date: hoursAgo(120), movieId: 40, movie: { title: 'Le Chat Chapeauté', tmdbId: 1234 } }, { eventType: 'grabbed', date: hoursAgo(5), movieId: 41, movie: { title: 'Pas encore là', tmdbId: 99 } }];
  };
  const result = await recent.fetchRecentImports(config, { now, get });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.items.map(item => item.title), ['Severance', 'A Knight of the Seven Kingdoms', 'Le Chat Chapeauté']);
  assert.deepEqual(result.items[0].episodes, [{ season: 2, episode: 9 }, { season: 2, episode: 10 }]);
  assert.deepEqual(result.items.map(item => recent.recentImportLabel(item, now)), ['2 épisodes · S02E09–E10', 'S01E03 · hier', 'Film · lun.']);
  const since = encodeURIComponent(new Date(now - 7 * 86_400_000).toISOString());
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
  const disabled = await recent.fetchRecentImports({ ...config, downloadsEnabled: false }, { now, get: async () => { throw new Error('jamais appelé'); } });
  assert.deepEqual(disabled, { items: [], failures: [] });
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
  const get = async (url: string) => url.startsWith('http://sonarr')
    ? [{ eventType: 3, date: hoursAgo(1), seriesId: 7, episode: { seasonNumber: 1, episodeNumber: 1 }, series: { title: 'Severance', tmdbId: 95396, year: 2022, ratings: { value: 8.4 } } }]
    : [{ eventType: 3, date: hoursAgo(2), movieId: 40, movie: { title: 'Dune', tmdbId: 438631, year: 2021, ratings: { imdb: { value: 8 }, tmdb: { value: 7.8 } } } }];
  const { items } = await recent.fetchRecentImports(config, { now, get });
  assert.deepEqual(items.map(item => [item.key, (item as Record<string, unknown>).arrId, (item as Record<string, unknown>).year, (item as Record<string, unknown>).rating]), [['s7', 7, 2022, 8.4], ['m40', 40, 2021, 7.8]], 'note TMDB du film en priorité');

  const deleted: string[] = [];
  const episodes: Record<string, unknown> = { 7: [{ monitored: true, hasFile: true }, { monitored: false, hasFile: false }], 8: [{ monitored: true, hasFile: true }, { monitored: true, hasFile: false }] };
  const io = { get: async (url: string) => episodes[url.split('=').pop() || ''], del: async (url: string) => { deleted.push(url); } };
  const movie = { kind: 'movie' as const, key: 'm40', arrId: 40, title: 'Dune', date: now };
  const done = { kind: 'series' as const, key: 's7', arrId: 7, title: 'Severance', date: now, episodes: [] };
  const awaited = { kind: 'series' as const, key: 's8', arrId: 8, title: 'A Knight', date: now, episodes: [] };
  assert.equal(await recent.removeRecentImport(config, movie, io), 'removed');
  assert.equal(await recent.removeRecentImport(config, done, io), 'removed', 'plus rien d’attendu : sortie de Sonarr');
  assert.equal(await recent.removeRecentImport(config, awaited, io), 'kept', 'un épisode surveillé sans fichier : la série reste dans Sonarr');
  assert.deepEqual(deleted, ['http://radarr/api/v3/movie/40?deleteFiles=false&addImportExclusion=false', 'http://sonarr/api/v3/series/7?deleteFiles=false&addImportListExclusion=false']);
  assert.ok(deleted.every(url => isAllowedServiceProxyPath(url, 'DELETE')), 'suppression acceptée par le proxy PWA, fichiers gardés');
  assert.ok(isAllowedServiceProxyPath('http://sonarr/api/v3/episode?seriesId=8', 'GET'));
  // Épisodes illisibles : rien n'est retiré, l'erreur est remontée.
  await assert.rejects(recent.removeRecentImport(config, done, { ...io, get: async () => '<html>login</html>' }));
  assert.equal(deleted.length, 2);
  await assert.rejects(recent.removeRecentImport({ ...config, radarrUrl: '' }, movie, io), /Radarr n’est pas configuré/);
});
