import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('issue #14 conserve les frontières paresseuses des trois écrans volumineux', () => {
  const app = read('src/App.tsx');

  for (const screen of ['ShowDetailScreen', 'DiscoverScreen', 'WatchListScreen']) {
    assert.match(
      app,
      new RegExp(`createCachedAsyncLoader\\(\\(\\) => import\\('\\./screens/${screen}'\\)`),
      `${screen} doit rester chargé à la demande depuis son point d'entrée stable`,
    );
    assert.match(app, new RegExp(`const ${screen} = lazy\\(load${screen}\\)`));
  }
});

test('issue #14 fige le contrat public du service Sonarr/Radarr avant extraction', () => {
  const source = read('src/services/sonarrRadarr.ts');
  const publicSymbols = [
    'SonarrRadarrConfig',
    'cleanUrl',
    'isLocalNetworkUrl',
    'invalidateQbitCache',
    'executeGet',
    'executePost',
    'executeDelete',
    'resolveQualityProfileId',
    'fetchQualityProfiles',
    'loginQBittorrent',
    'testServiceConnection',
    'searchAndDownloadInSonarr',
    'searchAndDownloadInRadarr',
    'pushReleaseDirectly',
    'LiveDownloadItem',
    'extractQualityFromTitle',
    'formatBytes',
    'formatSpeed',
    'formatSecondsToETA',
    'formatCleanMediaInfo',
    'matchShowDownload',
    'matchMovieDownload',
    'LiveDownloadSourceState',
    'LiveDownloadSourceHealth',
    'getLastLiveDownloadSourceHealth',
    'fetchLiveDownloadsQueue',
    'deleteLiveDownloadItem',
  ];

  for (const symbol of publicSymbols) {
    assert.match(source, new RegExp(`\\b${symbol}\\b`), `export public manquant : ${symbol}`);
  }
});

test('issue #14 fige le contrat public Plex avant extraction', () => {
  const source = read('src/features/plex/syncPlex.ts');
  const publicSymbols = [
    'PlexSyncResult',
    'getPlexGuid',
    'extractExternalIdsFromPlex',
    'resolveMovieToTmdb',
    'resolveShowToTmdb',
    'resolveSeasonShowToTmdb',
    'resolveEpisodeShowToTmdb',
    'resolvePlexItem',
    'performPlexSync',
    'getPlexClientIdentifier',
    'getPlexHeaders',
    'openPlexWatchUrl',
    'purgeAllPlexSlugsInDb',
  ];

  for (const symbol of publicSymbols) {
    assert.match(source, new RegExp(`\\b${symbol}\\b`), `export public manquant : ${symbol}`);
  }
});

test('issue #14 conserve les points d’entrée React publics', () => {
  assert.match(read('src/screens/ShowDetailScreen.tsx'), /export function ShowDetailScreen\b/);
  assert.match(read('src/screens/DiscoverScreen.tsx'), /export function DiscoverScreen\b/);
  assert.match(read('src/screens/WatchListScreen.tsx'), /export function WatchListScreen\b/);
});

test('issue #14 borne les modules extraits et documente l’exception Plex', () => {
  const boundedModules = [
    'src/screens/ShowDetailScreen.tsx',
    'src/screens/ShowDetailScreenCore.tsx',
    'src/screens/ShowDetailView.tsx',
    'src/screens/showDetailPresentation.ts',
    'src/screens/DiscoverScreen.tsx',
    'src/screens/DiscoverView.tsx',
    'src/screens/DiscoverHero.tsx',
    'src/screens/discoverPresentation.tsx',
    'src/screens/WatchListScreen.tsx',
    'src/screens/WatchListView.tsx',
    'src/screens/watchListPresentation.tsx',
    'src/services/sonarrRadarr.ts',
    'src/services/sonarrRadarrTransport.ts',
    'src/services/sonarrRadarrSearch.ts',
    'src/services/sonarrRadarrLive.ts',
    'src/features/plex/syncPlex.ts',
    'src/features/plex/plexResolution.ts',
    'src/features/plex/plexLinks.ts',
  ];

  for (const path of boundedModules) {
    const lineCount = read(path).split(/\r?\n/).length;
    assert.ok(lineCount <= 1_000, `${path} dépasse la borne de 1 000 lignes (${lineCount})`);
  }

  const plexEngineLines = read('src/features/plex/plexSyncEngine.ts').split(/\r?\n/).length;
  assert.ok(plexEngineLines <= 1_150, `l’exception Plex dépasse sa borne de 1 150 lignes (${plexEngineLines})`);
  assert.match(
    read('docs/architecture/large-module-boundaries.md'),
    /Exception bornée[^\n]*`plexSyncEngine\.ts`[^\n]*1 150 lignes/,
  );
});

test('issue #14 interdit aux modules extraits de réimporter leurs façades', () => {
  for (const path of [
    'src/services/sonarrRadarrTransport.ts',
    'src/services/sonarrRadarrSearch.ts',
    'src/services/sonarrRadarrLive.ts',
  ]) {
    assert.doesNotMatch(read(path), /from ['"]\.\/sonarrRadarr['"]/, `${path} créerait un cycle avec la façade`);
  }

  for (const path of [
    'src/features/plex/plexResolution.ts',
    'src/features/plex/plexSyncEngine.ts',
    'src/features/plex/plexLinks.ts',
  ]) {
    assert.doesNotMatch(read(path), /from ['"]\.\/syncPlex['"]/, `${path} créerait un cycle avec la façade`);
  }

  assert.doesNotMatch(read('src/screens/DiscoverView.tsx'), /from ['"]\.\/DiscoverScreen['"]/);
  assert.doesNotMatch(read('src/screens/DiscoverHero.tsx'), /from ['"]\.\/DiscoverScreen['"]/);
  assert.doesNotMatch(read('src/screens/WatchListView.tsx'), /from ['"]\.\/WatchListScreen['"]/);
  assert.doesNotMatch(read('src/screens/ShowDetailView.tsx'), /from ['"]\.\/ShowDetailScreenCore['"]/);
});
