import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BoundedCache,
  getManifestRelationSnapshot,
} from '../src/features/shows/mediaRelations.ts';

const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
const tmdbFacadeSource = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/screens/ShowDetailScreenCore.tsx', import.meta.url), 'utf8');
const detailWrapperSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
const watchListSource = readFileSync(new URL('../src/screens/WatchListScreen.tsx', import.meta.url), 'utf8');
const presenceStoreSource = readFileSync(new URL('../src/store/mediaPresenceStore.ts', import.meta.url), 'utf8');
const plexAvailabilitySource = readFileSync(new URL('../src/features/plex/plexAvailability.ts', import.meta.url), 'utf8');

test('SEENIT-PERF-001 réutilise les détails et relations sans nouveau chargement', () => {
  const startedAt = performance.now();
  const first = getManifestRelationSnapshot('tv:1396');
  const second = getManifestRelationSnapshot('movie:559969');
  assert.deepEqual(first?.universe, second?.universe);
  assert.ok(performance.now() - startedAt < 150);
  assert.match(tmdbClientSource, /detailsCache = new BoundedCache<string, any>\(80\)/);
  assert.match(tmdbClientSource, /detailsInFlight\.get\(cacheKey\)/);
  assert.match(tmdbClientSource, /if \(existingRequest\) return existingRequest/);
  assert.match(tmdbClientSource, /peekMediaDetails/);
  assert.match(tmdbClientSource, /peekUniverseAndCollection/);
});

test('SEENIT-PERF-001 sépare les caches movie et tv et borne leur taille', () => {
  const cache = new BoundedCache<string, string>(2);
  cache.set('movie:42', 'film');
  cache.set('tv:42', 'série');
  assert.equal(cache.get('movie:42'), 'film');
  assert.equal(cache.get('tv:42'), 'série');

  cache.set('movie:43', 'autre film');
  assert.equal(cache.size, 2);
  assert.equal(cache.get('movie:42'), undefined);
  assert.equal(cache.get('tv:42'), 'série');
});

test('SEENIT-PERF-001 réserve les skeletons au chargement réellement froid', () => {
  assert.match(detailSource, /peekMediaDetails/);
  assert.match(detailSource, /peekUniverseAndCollection/);
  assert.match(detailSource, /setCollectionLoading\(!cachedRelations\)/);
  assert.match(detailSource, /loading="eager" decoding="async"[\s\S]{0,120}fetchPriority="high"/);
});

test('SEENIT-PERF-001 regroupe le chargement froid avant de monter la fiche complète', () => {
  assert.match(detailWrapperSource, /DETAIL_WARMUP_GRACE_MS = 300/);
  assert.match(detailWrapperSource, /tmdb\.peekMediaDetails\(tmdbId, mediaType\)/,
    'un cache détail chaud doit court-circuiter le gate');
  assert.match(detailWrapperSource, /const providersPromise = tmdb\.getWatchProviders\(tmdbId, mediaType\)/,
    'les plateformes doivent partir en parallèle du détail principal');
  assert.match(detailWrapperSource, /await tmdb\.getMediaDetails\(tmdbId, mediaType\)/,
    'le détail principal doit être chaud avant de monter la fiche complète');
  assert.match(detailWrapperSource, /getSeriesImdbData\(imdbId\)/,
    'IMDb doit être préchauffé pendant la courte fenêtre secondaire');
  assert.match(detailWrapperSource, /Promise\.race\(/,
    'les enrichissements secondaires ne doivent jamais bloquer la fiche sans borne');
  assert.match(detailWrapperSource, /data-seenit-detail-warmup="cold"/,
    'le chargement froid doit utiliser un shell unique et stable');
  assert.match(detailWrapperSource, /overflow-anchor: none/,
    'les placeholders ne doivent pas devenir des ancres de scroll pendant leur remplacement');
});

test('SEENIT-PERF-001 garde le titre relationnel neutre sans transformer Où regarder en skeleton', () => {
  assert.match(
    detailWrapperSource,
    /h3\.mb-3:has\(\+ \.flex > \.animate-pulse\)[\s\S]{0,120}font-size: 0/,
    'le skeleton de titre doit rester limité au heading relationnel mb-3',
  );
  assert.match(
    detailWrapperSource,
    /h3\.mb-3:has\(\+ \.flex > \.animate-pulse\)::after[\s\S]{0,220}animation: pulse/,
    'le titre relationnel froid doit conserver une géométrie de skeleton stable',
  );
  assert.doesNotMatch(
    detailWrapperSource,
    /h3:has\(\+ \.flex > \.animate-pulse\)/,
    'un sélecteur global ne doit plus masquer le titre stable Où regarder',
  );
});

test('SEENIT-PERF-001 unifie le chargement des disponibilités et expose un refresh Plex explicite', () => {
  assert.match(detailWrapperSource, /PROVIDER_LOADING_LABEL = 'Recherche Plex & streaming…'/);
  assert.match(detailWrapperSource, /node\.textContent\?\.trim\(\) === 'Où regarder'/);
  assert.match(detailWrapperSource, /aria-label="Actualiser les serveurs Plex"/);
  assert.match(detailWrapperSource, /refreshPlexServers: true/);
  assert.match(presenceStoreSource, /refreshServers: refreshPlexServers/);
  assert.match(plexAvailabilitySource, /refreshServers/);
  assert.match(tmdbFacadeSource, /readWatchProviderCache/);
  assert.match(tmdbFacadeSource, /writeWatchProviderCache/);
});

test('SEENIT-PERF-001 ouvre un épisode avant de charger ses détails distants', () => {
  const handlerStart = watchListSource.indexOf('const handleEpisodeClick');
  const handlerEnd = watchListSource.indexOf('\n\n  useEffect(() => {', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'le handler épisode doit être détectable');

  const handlerSource = watchListSource.slice(handlerStart, handlerEnd);
  const modalOpenIndex = handlerSource.indexOf('setSelectedEpisodeModal({ show, season: seasonNumber, episode: epData })');
  const historyIndex = handlerSource.indexOf('window.history.pushState');
  const remoteFetchIndex = handlerSource.indexOf('tmdb.getEpisodeDetails');

  assert.ok(modalOpenIndex >= 0 && remoteFetchIndex >= 0 && modalOpenIndex < remoteFetchIndex,
    'la modale doit être visible avant le chargement TMDB');
  assert.ok(historyIndex >= 0 && historyIndex < remoteFetchIndex,
    'l’état de navigation doit être engagé avant le chargement TMDB');
  assert.doesNotMatch(handlerSource, /await\s+tmdb\.getEpisodeDetails/,
    'le réseau ne doit plus être dans le chemin critique du clic');
  assert.match(handlerSource, /openingEpisodeRef\.current/,
    'une garde synchrone doit absorber un double tap avant le prochain rendu React');
  assert.match(handlerSource, /episodeRequestRef\.current/,
    'une réponse obsolète ne doit jamais remplacer une autre modale épisode');
});
