import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Vrai module de la rangée « Téléchargés » : seuls le transport et le gate sont remplacés.
const bundle = await build({ entryPoints: ['src/features/downloads/recentImports.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'imports-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:sonarrRadarr|downloadFeatureVisibility)$/ }, args => ({ path: args.path.split('/').at(-1) || '', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'sonarrRadarr'
      ? 'export const cleanUrl=u=>String(u).replace(/\\/+$/,"");export const executeGet=async()=>{throw new Error("réseau réel interdit")};'
      : 'export const isDownloadFeatureEnabled=c=>c.downloadsEnabled===true;' }));
  } }] });
type Episode = { season: number; episode: number };
type Item = { kind: 'series' | 'movie'; key: string; tmdbId?: number; title: string; date: number; episodes?: Episode[] };
const recent = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  fetchRecentImports: (config: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ items: Item[]; failures: string[] }>;
  recentImportLabel: (item: Item, now: number) => string;
  importDayLabel: (time: number, now: number) => string;
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
