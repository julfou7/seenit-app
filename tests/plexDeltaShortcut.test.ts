import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isPlexWatchlistAlreadyTracked, isUnchangedPlexDelta, plexWatchlistFingerprint } from '../src/features/plex/plexDeltaShortcut.ts';

const show = (tmdbId: number, type = 'show') => ({ type, title: `Titre ${tmdbId}`, Guid: [{ id: `tmdb://${tmdbId}` }] });
const shows = [{ tmdbId: 1, mediaType: 'tv' }, { tmdbId: 2, mediaType: 'movie' }, { tmdbId: 3 }];
const watchlist = [show(1), show(2, 'movie'), show(3)];

test('SEENIT-PLEX-011 une delta sans nouveauté s’arrête après Plex, sans relire la bibliothèque', () => {
  const fingerprint = plexWatchlistFingerprint(watchlist);
  assert.equal(fingerprint, plexWatchlistFingerprint([...watchlist].reverse()), 'l’ordre de la Watchlist ne change pas l’empreinte');
  assert.notEqual(fingerprint, plexWatchlistFingerprint(watchlist.slice(0, 2)), 'un retrait change l’empreinte');
  assert.notEqual(fingerprint, plexWatchlistFingerprint([...watchlist.slice(0, 2), show(4)]), 'un remplacement change l’empreinte');

  const base = { delta: true, history: [], libraryWatchStates: [], watchlist, watchlistComplete: true, collectionComplete: true, previousFingerprint: fingerprint, shows, resolutionCache: {} };
  assert.equal(isUnchangedPlexDelta(base), true, 'Watchlist identique, rien de neuf : raccourci');
  assert.equal(isUnchangedPlexDelta({ ...base, delta: false }), false, 'une synchro complète retraite toujours tout');
  assert.equal(isUnchangedPlexDelta({ ...base, history: [{}] }), false, 'un visionnage depuis la dernière delta est traité');
  assert.equal(isUnchangedPlexDelta({ ...base, libraryWatchStates: [{}] }), false, 'un état de bibliothèque est traité');
  assert.equal(isUnchangedPlexDelta({ ...base, watchlistComplete: false }), false, 'Watchlist partielle : pas de décision');
  assert.equal(isUnchangedPlexDelta({ ...base, collectionComplete: false }), false, 'collecte incomplète : pas de décision');
  assert.equal(isUnchangedPlexDelta({ ...base, previousFingerprint: undefined }), false, 'première delta : traitement complet');
  assert.equal(isUnchangedPlexDelta({ ...base, watchlist: [...watchlist, show(5)] }), false, 'un ajout Watchlist est traité');
  assert.equal(isUnchangedPlexDelta({ ...base, shows: shows.slice(0, 2) }), false, 'un titre Watchlist sans fiche est réimporté par le traitement complet');
});

test('SEENIT-PLEX-011 un titre Watchlist sans TMDB direct est reconnu par le cache de résolution', () => {
  const plexOnly = { type: 'show', Guid: [{ id: 'plex://show/abc' }] };
  assert.equal(isPlexWatchlistAlreadyTracked([plexOnly], shows, {}), false, 'identité inconnue : traitement complet');
  assert.equal(isPlexWatchlistAlreadyTracked([plexOnly], shows, { 'tv:plex:abc': { id: 3 } }), true);
  assert.equal(isPlexWatchlistAlreadyTracked([show(2)], shows, {}), false, 'une série ne correspond pas au film de même identifiant');
});

test('SEENIT-PLEX-011 l’empreinte n’est enregistrée qu’après une synchro entièrement validée', () => {
  const engine = readFileSync('src/features/plex/plexSyncEngine.ts', 'utf8');
  const commit = engine.slice(engine.indexOf('if (canCommitCursor) {'));
  assert.match(commit.slice(0, 600), /watchlistFingerprint: plexWatchlistFingerprint\(watchlist\)/, 'empreinte écrite avec le curseur validé');
  assert.ok(engine.indexOf('const unchangedDelta = isUnchangedPlexDelta(') < engine.indexOf('fetchAuthoritativeShowsForUser(user.uid)'), 'le raccourci précède la relecture Firestore');
  const cloud = readFileSync('src/features/plex/plexCloudState.ts', 'utf8');
  assert.match(cloud, /next\.watchlistFingerprint = values\.watchlistFingerprint/);
});

test('SEENIT-PLEX-011 le backend lance Watchlist, activité cloud et serveurs ensemble', () => {
  const server = readFileSync('server.ts', 'utf8');
  const serversStart = server.indexOf('const serversTask = getPlexServers(');
  const watchlistStart = server.indexOf('const watchlistTask = (async () => {');
  const cloudStart = server.indexOf('const cloudTask = (async () => {');
  const joined = server.indexOf('await Promise.all([watchlistTask, cloudTask]);');
  assert.ok(serversStart > 0 && serversStart < watchlistStart && watchlistStart < cloudStart && cloudStart < joined, 'les trois appels partent avant la première attente');
  assert.ok(joined < server.indexOf('const servers = await serversTask;'), 'les serveurs sont attendus après la Watchlist et le cloud');
  assert.match(server, /serversTask\.catch\(\(\) => undefined\)/, 'aucun rejet orphelin si la découverte échoue pendant l’attente');
  assert.match(server, /visitedSources\.unshift\(watchlistVisited\)/, 'la Watchlist reste la première source listée');
});
