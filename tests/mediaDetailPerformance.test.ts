import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoundedCache, getManifestRelationSnapshot } from '../src/features/shows/mediaRelations.ts';
import { readFeatureSource } from './featureSource.ts';

const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
const tmdbFacadeSource = readFileSync(new URL('../src/features/shows/tmdbCore.ts', import.meta.url), 'utf8');
const detailSource = readFeatureSource('showDetail');
const detailWrapperSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const watchListSource = readFeatureSource('watchList');
const presenceStoreSource = readFileSync(new URL('../src/store/mediaPresenceStore.ts', import.meta.url), 'utf8');
const plexAvailabilitySource = readFileSync(new URL('../src/features/plex/plexAvailability.ts', import.meta.url), 'utf8');

test('SEENIT-PERF-001 réutilise les détails et relations sans nouveau chargement', () => {
  const startedAt = performance.now();
  const first = getManifestRelationSnapshot('tv:1396');
  const second = getManifestRelationSnapshot('movie:559969');
  assert.deepEqual(first?.universe, second?.universe);
  assert.ok(performance.now() - startedAt < 150);
  assert.match(tmdbClientSource, /detailsCache = new BoundedCache<string, any>\(80\)/);
  assert.match(tmdbClientSource, /runPublicMetadataSingleFlight\('details', cacheKey/);
  assert.match(tmdbClientSource, /readPublicMetadataCache<any>\('details', cacheKey/);
  assert.doesNotMatch(tmdbClientSource, /detailsInFlight/, 'le single-flight commun remplace le registre local des fiches');
  assert.match(tmdbClientSource, /peekMediaDetails/);
  assert.match(tmdbClientSource, /peekUniverseAndCollection/);
});
test('SEENIT-PERF-001 sépare les caches movie et tv et borne leur taille', () => { const cache = new BoundedCache<string, string>(2); cache.set('movie:42', 'film'); cache.set('tv:42', 'série'); assert.equal(cache.get('movie:42'), 'film'); assert.equal(cache.get('tv:42'), 'série'); cache.set('movie:43', 'autre film'); assert.equal(cache.size, 2); assert.equal(cache.get('movie:42'), undefined); assert.equal(cache.get('tv:42'), 'série'); });
test('SEENIT-PERF-001 réserve les skeletons au chargement réellement froid', () => { assert.match(detailSource, /peekMediaDetails/); assert.match(detailSource, /peekUniverseAndCollection/); assert.match(detailSource, /setCollectionLoading\(!cachedRelations\)/); assert.match(detailSource, /loading="eager" decoding="async"[\s\S]{0,120}fetchPriority="high"/); });
test('SEENIT-PERF-001 charge le détail principal sans attendre les disponibilités secondaires', () => { assert.match(detailWrapperSource, /tmdb\.peekMediaDetails\(tmdbId, mediaType\)/); assert.match(detailWrapperSource, /void tmdb\.getWatchProviders\(tmdbId, mediaType\)\.catch/); assert.match(detailWrapperSource, /await tmdb\.getMediaDetails\(tmdbId, mediaType\)/); assert.doesNotMatch(detailWrapperSource, /getSeriesImdbData|omdbService|\/api\/media\/omdb/); assert.doesNotMatch(detailWrapperSource, /DETAIL_WARMUP_GRACE_MS|Promise\.race\(/); assert.match(detailWrapperSource, /data-seenit-detail-warmup="cold"/); assert.match(detailWrapperSource, /overflow-anchor: none/); });
test('SEENIT-PERF-001 affiche les repères déterministes pendant le skeleton froid', () => { assert.match(detailWrapperSource, /knownTitle/); assert.match(detailWrapperSource, /📺 SÉRIE/); assert.match(detailWrapperSource, /🎬 FILM/); assert.match(detailWrapperSource, />À propos</); assert.match(detailWrapperSource, />Épisodes</); assert.match(detailWrapperSource, />Synopsis</); assert.match(detailWrapperSource, />Catégories & Thèmes</); assert.match(detailWrapperSource, />Où regarder</); assert.match(detailWrapperSource, /Recherche Plex & streaming…/); });
test('SEENIT-PERF-001 garde le titre relationnel neutre sans transformer Où regarder en skeleton', () => { assert.match(detailWrapperSource, /h3\.mb-3:has\(\+ \.flex > \.animate-pulse\)[\s\S]{0,120}font-size: 0/); assert.match(detailWrapperSource, /h3\.mb-3:has\(\+ \.flex > \.animate-pulse\)::after[\s\S]{0,220}animation: pulse/); assert.doesNotMatch(detailWrapperSource, /h3:has\(\+ \.flex > \.animate-pulse\)/); });
test('SEENIT-PERF-001 unifie le chargement des disponibilités et expose un refresh Plex compact', () => { assert.match(detailSource, /Recherche Plex & streaming…/); assert.match(detailSource, /<h3[^>]*>Où regarder<\/h3><button/); assert.match(detailSource, /aria-label="Actualiser Plex"/); assert.match(detailSource, /className="inline-flex w-11 h-11/); assert.match(detailSource, /refreshPlexServers: true/); assert.match(presenceStoreSource, /refreshServers: refreshPlexServers/); assert.match(plexAvailabilitySource, /refreshServers/); assert.match(tmdbFacadeSource, /readWatchProviderCache/); assert.match(tmdbFacadeSource, /writeWatchProviderCache/); });
test('SEENIT-PERF-001 ouvre un épisode avant de charger ses détails distants', () => { const handlerStart = watchListSource.indexOf('const handleEpisodeClick'); const handlerEndMatch = /\r?\n\r?\n  useEffect\(\(\) => \{/.exec(watchListSource.slice(handlerStart)); const handlerEnd = handlerEndMatch ? handlerStart + handlerEndMatch.index : -1; assert.ok(handlerStart >= 0 && handlerEnd > handlerStart); const handlerSource = watchListSource.slice(handlerStart, handlerEnd); const modalOpenIndex = handlerSource.indexOf('setSelectedEpisodeModal({ show, season: seasonNumber, episode: epData })'); const historyIndex = handlerSource.indexOf('window.history.pushState'); const remoteFetchIndex = handlerSource.indexOf('tmdb.getEpisodeDetails'); assert.ok(modalOpenIndex >= 0 && remoteFetchIndex >= 0 && modalOpenIndex < remoteFetchIndex); assert.ok(historyIndex >= 0 && historyIndex < remoteFetchIndex); assert.doesNotMatch(handlerSource, /await\s+tmdb\.getEpisodeDetails/); assert.match(handlerSource, /openingEpisodeRef\.current/); assert.match(handlerSource, /episodeRequestRef\.current/); });

test('SEENIT-PERF-001 amorce le cache persistant avant d’ouvrir une fiche après redémarrage', () => {
  const primeStart = tmdbClientSource.indexOf('async primeMediaDetailsFromPersistentCache');
  const primeEnd = tmdbClientSource.indexOf('private async getCachedMediaDetails', primeStart);
  assert.ok(primeStart >= 0 && primeEnd > primeStart);
  const primeSource = tmdbClientSource.slice(primeStart, primeEnd);
  assert.match(primeSource, /readPublicMetadataCache<any>\('details', cacheKey\)/);
  assert.match(primeSource, /persisted\?\.fresh/);
  assert.doesNotMatch(primeSource, /authenticatedFetch|runPublicMetadataSingleFlight/);

  assert.match(appSource, /MEDIA_DETAIL_CACHE_PRIME_BUDGET_MS = 40/);
  const openStart = appSource.indexOf('const openShowSmooth');
  const openEnd = appSource.indexOf('const openLocalMedia', openStart);
  assert.ok(openStart >= 0 && openEnd > openStart);
  const openSource = appSource.slice(openStart, openEnd);
  const primeIndex = openSource.indexOf('primeMediaDetailsFromPersistentCache');
  const commitIndex = openSource.indexOf('openShow(id, type');
  assert.ok(primeIndex >= 0 && commitIndex > primeIndex);
  assert.match(openSource, /Promise\.race/);
  assert.match(openSource, /detailOpenRequestRef\.current/);
});
