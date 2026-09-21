import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoundedCache, getManifestRelationSnapshot } from '../src/features/shows/mediaRelations.ts';
import { readFeatureSource } from './featureSource.ts';

const tmdbClientSource = readFileSync(new URL('../src/features/shows/tmdbClient.ts', import.meta.url), 'utf8');
const tmdbFacadeSource = readFileSync(new URL('../src/features/shows/tmdbCore.ts', import.meta.url), 'utf8');
const detailSource = readFeatureSource('showDetail');
const detailWrapperSource = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
const detailColdShellSource = readFileSync(new URL('../src/screens/MediaDetailColdShell.tsx', import.meta.url), 'utf8');
const episodeDetailSource = readFileSync(new URL('../src/screens/EpisodeDetailModalCore.tsx', import.meta.url), 'utf8');
const watchListViewSource = readFileSync(new URL('../src/screens/WatchListView.tsx', import.meta.url), 'utf8');
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
  assert.match(tmdbClientSource, /peekRenderableMediaDetails/);
  assert.match(tmdbClientSource, /peekUniverseAndCollection/);
});
test('SEENIT-PERF-001 sépare les caches movie et tv et borne leur taille', () => { const cache = new BoundedCache<string, string>(2); cache.set('movie:42', 'film'); cache.set('tv:42', 'série'); assert.equal(cache.get('movie:42'), 'film'); assert.equal(cache.get('tv:42'), 'série'); cache.set('movie:43', 'autre film'); assert.equal(cache.size, 2); assert.equal(cache.get('movie:42'), undefined); assert.equal(cache.get('tv:42'), 'série'); });
test('SEENIT-PERF-001 réserve les skeletons au chargement réellement froid', () => {
  assert.match(detailSource, /peekRenderableMediaDetails/);
  assert.match(detailSource, /peekUniverseAndCollection/);
  const predicateStart = tmdbClientSource.indexOf('shouldLoadUniverseAndCollection(media: any)');
  const predicateEnd = tmdbClientSource.indexOf('async getUniverseAndCollection', predicateStart);
  assert.ok(predicateStart >= 0 && predicateEnd > predicateStart);
  const predicateSource = tmdbClientSource.slice(predicateStart, predicateEnd);
  assert.match(predicateSource, /getManifestRelationSnapshot\(mediaKey\)/);
  assert.match(predicateSource, /mediaType === 'movie'/);
  assert.match(predicateSource, /belongs_to_collection/);
  assert.match(detailSource, /setCollectionLoading\(tmdb\.shouldLoadUniverseAndCollection/);
  assert.doesNotMatch(detailSource, /setCollectionLoading\(!cachedRelations\)/);
  assert.match(detailSource, /loading="eager" decoding="async"[\s\S]{0,120}fetchPriority="high"/);
});
test('SEENIT-PERF-001 charge le détail principal sans attendre les disponibilités secondaires', () => { assert.match(detailWrapperSource, /tmdb\.peekRenderableMediaDetails\(tmdbId, mediaType\)/); assert.match(detailWrapperSource, /void tmdb\.getWatchProviders\(tmdbId, mediaType\)\.catch/); assert.match(detailWrapperSource, /await tmdb\.getMediaDetails\(tmdbId, mediaType\)/); assert.doesNotMatch(detailWrapperSource, /getSeriesImdbData|omdbService|\/api\/media\/omdb/); assert.doesNotMatch(detailWrapperSource, /DETAIL_WARMUP_GRACE_MS|Promise\.race\(/); assert.match(detailColdShellSource, /data-seenit-detail-warmup="cold"/); assert.match(detailWrapperSource, /overflow-anchor: none/); });
test('SEENIT-PERF-001 affiche les repères déterministes pendant le skeleton froid', () => { assert.match(detailColdShellSource, /knownTitle/); assert.match(detailColdShellSource, /📺 SÉRIE/); assert.match(detailColdShellSource, /🎬 FILM/); assert.match(detailColdShellSource, />À propos</); assert.match(detailColdShellSource, />Épisodes</); assert.match(detailColdShellSource, />Casting</); assert.match(detailColdShellSource, />Synopsis</); assert.match(detailColdShellSource, />Catégories & Thèmes</); assert.match(detailColdShellSource, />Où regarder</); assert.match(detailColdShellSource, /Recherche Plex & streaming…/); assert.match(detailColdShellSource, /data-seenit-cold-shell="calm"/); assert.doesNotMatch(detailColdShellSource, /animate-pulse/); });

test('SEENIT-PERF-001 garde la structure À propos Épisodes Casting indépendante des crédits', () => {
  assert.match(detailSource, /<button onClick=\{\(\) => \{ handleTabChange\('casting'\); setShowAllCast\(false\); \}\}[\s\S]{0,260}>Casting<\/button>/);
  assert.doesNotMatch(detailSource, /\(tmdbDetails\?\.aggregate_credits\?\.cast \|\| tmdbDetails\?\.credits\?\.cast\)\?\.length > 0\) && <button[\s\S]{0,260}>Casting<\/button>/);
  assert.match(detailSource, /id="section-casting"[\s\S]{0,700}data-seenit-casting-loading="true"/);
  assert.match(detailSource, /castingPayloadKnown[\s\S]{0,900}Aucun casting disponible\./);
});
test('SEENIT-PERF-001 garde le loader Relations à la géométrie des cartes finales', () => {
  assert.match(detailWrapperSource, /\[data-seenit-relation-loading\] > h3[\s\S]{0,120}font-size: 0/);
  assert.match(detailWrapperSource, /\[data-seenit-relation-loading\] > h3::after[\s\S]{0,220}animation: pulse/);
  assert.doesNotMatch(detailWrapperSource, /h3\.mb-3:has\(/);
  assert.match(detailSource, /data-seenit-relation-loading="true"[\s\S]{0,420}w-\[120px\] sm:w-\[140px\][\s\S]{0,180}aspect-\[2\/3\]/);
  assert.doesNotMatch(detailSource, /saga_loader_[\s\S]{0,160}w-\[110px\]/);
});
test('SEENIT-PERF-001 unifie le chargement des disponibilités et expose un refresh Plex compact', () => { assert.match(detailSource, /Recherche Plex & streaming…/); assert.match(detailSource, /<h3[^>]*>Où regarder<\/h3><button/); assert.match(detailSource, /aria-label="Actualiser Plex"/); assert.match(detailSource, /className="inline-flex w-11 h-11/); assert.match(detailSource, /refreshPlexServers: true/); assert.match(presenceStoreSource, /refreshServers: refreshPlexServers/); assert.match(plexAvailabilitySource, /refreshServers/); assert.match(tmdbFacadeSource, /readWatchProviderCache/); assert.match(tmdbFacadeSource, /writeWatchProviderCache/); });
test('SEENIT-PERF-001 ouvre un épisode avec cache ou shell stable sans contenu provisoire', () => {
  const handlerStart = watchListSource.indexOf('const handleEpisodeClick');
  const handlerEnd = watchListSource.indexOf('const openEpisodeParentNow', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handlerSource = watchListSource.slice(handlerStart, handlerEnd);
  assert.match(handlerSource, /tmdb\.peekEpisodeDetails/);
  assert.match(handlerSource, /cachedEpisode \|\|/);
  assert.match(handlerSource, /isHydrating: false/);
  assert.match(tmdbClientSource, /peekEpisodeDetails\(id: number, seasonNumber: number, episodeNumber: number\)/);
  const hydrationStart = episodeDetailSource.indexOf('key="episode-hydrating"');
  const hydrationEnd = episodeDetailSource.indexOf(') : (', hydrationStart);
  assert.ok(hydrationStart >= 0 && hydrationEnd > hydrationStart);
  const hydrationSource = episodeDetailSource.slice(hydrationStart, hydrationEnd);
  assert.match(hydrationSource, /aria-busy="true"/);
  assert.doesNotMatch(hydrationSource, /currentEpisode\.name/);
  assert.match(episodeDetailSource, /useLayoutEffect\(\(\) => \{[\s\S]{0,180}setCurrentEpisode\(initialEpisode\)/);
});

test('SEENIT-PERF-001 bascule épisode vers série sans réafficher l’écran inférieur', () => {
  assert.match(watchListSource, /pendingEpisodeParentRef/);
  assert.match(watchListSource, /pendingEpisodeParentRef\.current = target;[\s\S]{0,120}window\.history\.back\(\)/);
  assert.match(watchListSource, /openEpisodeParentNow\(pendingParent\)/);
  assert.match(appSource, /const openLocalMediaImmediate[\s\S]{0,220}openShow\(id, 'local', mediaType\)/);
  assert.match(appSource, /onEpisodeParentClick=\{openLocalMediaImmediate\}/);
  const modalStart = watchListViewSource.indexOf('<EpisodeDetailModal');
  const modalEnd = watchListViewSource.indexOf('{selectedPersonId &&', modalStart);
  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  const modalSource = watchListViewSource.slice(modalStart, modalEnd);
  assert.match(modalSource, /handleEpisodeParentClick\(selectedEpisodeModal\.show, tmdbId\)/);
  const showHandlerStart = modalSource.indexOf('onShowClick=');
  const closeHandlerStart = modalSource.indexOf('onClose=', showHandlerStart);
  const showHandlerSource = modalSource.slice(showHandlerStart, closeHandlerStart);
  assert.doesNotMatch(showHandlerSource, /setTimeout|window\.history\.back/);
});

test('SEENIT-PERF-001 unifie le shell froid média sans double animation', () => {
  assert.match(detailWrapperSource, /MediaDetailColdShell/);
  assert.match(detailSource, /MediaDetailColdShell/);
  assert.match(appSource, /animate-in slide-in-from-right duration-300/);
  assert.doesNotMatch(appSource, /slide-in-from-bottom-6|animate-overlay-in/);
  assert.doesNotMatch(detailSource, /animate-in slide-in-from-right duration-300/);
  assert.match(episodeDetailSource, /initial=\{\{ y: 18, opacity: 0 \}\}/);
  assert.match(episodeDetailSource, /initial=\{\{ opacity: 0 \}\}[\s\S]{0,160}animate=\{\{ opacity: 1 \}\}/);
});

test('SEENIT-PERF-001 amorce le cache persistant avant d’ouvrir une fiche après redémarrage', () => {
  const primeStart = tmdbClientSource.indexOf('async primeMediaRenderSnapshotFromPersistentCache');
  const primeEnd = tmdbClientSource.indexOf('async primeMediaDetailsFromPersistentCache', primeStart);
  assert.ok(primeStart >= 0 && primeEnd > primeStart);
  const primeSource = tmdbClientSource.slice(primeStart, primeEnd);
  assert.match(primeSource, /readPublicMetadataCache<any>\('detail_render', cacheKey\)/);
  assert.match(primeSource, /readPublicMetadataCache<any>\('details', cacheKey\)/);
  assert.match(primeSource, /renderSnapshot\?\.fresh/);
  assert.match(primeSource, /seenit_render_schema_version === MEDIA_DETAIL_RENDER_SCHEMA_VERSION/);
  assert.match(primeSource, /persistedDetails\?\.fresh[\s\S]{0,260}cacheMediaDetailRenderSnapshot/);
  assert.doesNotMatch(primeSource, /authenticatedFetch|runPublicMetadataSingleFlight/);

  const openStart = appSource.indexOf('const openShowSmooth');
  const openEnd = appSource.indexOf('const openLocalMedia', openStart);
  assert.ok(openStart >= 0 && openEnd > openStart);
  const openSource = appSource.slice(openStart, openEnd);
  const primeIndex = openSource.indexOf('primeMediaRenderSnapshotFromPersistentCache');
  const commitIndex = openSource.indexOf('commitOpen();', primeIndex);
  assert.ok(primeIndex >= 0 && commitIndex > primeIndex);
  assert.doesNotMatch(openSource, /Promise\.race|MEDIA_DETAIL_CACHE_PRIME_BUDGET_MS/);
  assert.match(openSource, /detailOpenRequestRef\.current/);
  assert.match(detailWrapperSource, /peekRenderableMediaDetails/);
  assert.match(detailSource, /peekRenderableMediaDetails/);
});
