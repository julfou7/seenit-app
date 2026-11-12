import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { datePlexWatchedRecord, readPlexAccountProgress, withPlexDate } from '../src/features/plex/plexDating.ts';
import { isOwnerPmsHistoryEntry, normalizePlexAccountHistoryNode, readPlexAccountHistoryDate, PLEX_ACCOUNT_HISTORY_DATED_QUERY } from '../src/features/plex/plexAccountHistory.ts';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const VIEWED = Date.UTC(2026, 9, 28, 20, 15);

test('SEENIT-PLEX-005 #954 : le Watch History du compte apporte la date de lecture, même d’un film supprimé du serveur', () => {
  assert.match(PLEX_ACCOUNT_HISTORY_DATED_QUERY, /nodes \{\n\s+id\n\s+date\n/);
  assert.equal(readPlexAccountHistoryDate('2026-10-28T20:15:00.000Z'), VIEWED);
  assert.equal(readPlexAccountHistoryDate(VIEWED / 1000), VIEWED);
  assert.equal(readPlexAccountHistoryDate(null), null);
  const node = normalizePlexAccountHistoryNode({ id: 'h1', date: '2026-10-28T20:15:00.000Z', metadataItem: { type: 'movie', guid: 'plex://movie/abc', title: 'Spider-Man: Brand New Day' } });
  assert.equal(node.viewedAt, VIEWED);
  assert.equal('viewedAt' in normalizePlexAccountHistoryNode({ id: 'h2', metadataItem: { type: 'movie', guid: 'plex://movie/def' } }), false, 'sans date, aucune date inventée');
  const server = read('server.ts');
  // Décision du 12/11/2026 : seul un état courant explicitement non vu écarte l'événement.
  assert.match(server, /entry\?\.sourceKind === 'account-history' && entry\?\.accountCurrentWatched === false\) continue;/);
  assert.doesNotMatch(server, /entry\?\.sourceKind === 'account-history' && entry\?\.accountCurrentWatched !== true\) continue;/);
  assert.match(server, /runQuery\(PLEX_ACCOUNT_HISTORY_DATED_QUERY, 'dated'\)/);
  assert.match(server, /viewedAtKnown: Boolean\(provenViewed\)/);
});

test('SEENIT-PLEX-005 #954 : un Vu déjà connu sans date prouvée reçoit la date Plex, jamais un Vu SeenIt', () => {
  // Film importé de TV Time sans enregistrement « movie » : daté par Plex.
  assert.deepEqual(datePlexWatchedRecord(undefined, VIEWED), { watchedAt: VIEWED, watchedTimeKnown: true, source: 'plex' });
  // Import TV Time daté à l'instant de l'import : la lecture Plex le remplace.
  assert.equal(datePlexWatchedRecord({ watchedAt: 1, source: 'tvtime' }, VIEWED)?.watchedAt, VIEWED);
  assert.equal(datePlexWatchedRecord({ watchedAt: 1, importedFrom: 'tvtime' }, VIEWED)?.watchedAt, VIEWED);
  // Heure inconnue : datée.
  assert.equal(datePlexWatchedRecord({ watchedAt: 5, watchedTimeKnown: false }, VIEWED)?.watchedTimeKnown, true);
  // Jamais : un Vu SeenIt, un Vu déjà Plex, un ancien Vu daté, ou sans date Plex prouvée.
  assert.equal(datePlexWatchedRecord({ watchedAt: 9, source: 'seenit' }, VIEWED), null);
  assert.equal(datePlexWatchedRecord({ watchedAt: 9, plexImported: true }, VIEWED), null, 'Vu Plex déjà daté à l’heure connue');
  assert.equal(datePlexWatchedRecord({ watchedAt: 9 }, VIEWED), null);
  assert.equal(datePlexWatchedRecord(undefined, null), null);
  assert.equal('plexImported' in (datePlexWatchedRecord(undefined, VIEWED) || {}), false, 'la date ne donne pas à Plex la propriété du Vu');
  const show = { episodeRecords: { movie: { watchedAt: 1, source: 'tvtime' } }, lastWatchedAt: 1 };
  const dated = withPlexDate(show, 'movie', VIEWED);
  assert.equal(dated?.lastWatchedAt, VIEWED);
  assert.equal(withPlexDate({ episodeRecords: { movie: { watchedAt: 9, source: 'seenit' } } }, 'movie', VIEWED), null);
  assert.deepEqual(readPlexAccountProgress({ plexAccountHistoryItems: 340, plexAccountCurrentUnwatched: 2 }), { history: 340, unwatched: 2, dated: false });
  assert.equal(readPlexAccountProgress({ plexAccountHistoryItems: 75, plexAccountHistoryMode: 'dated' })?.dated, true);
  assert.equal(readPlexAccountProgress({}), undefined);
  const engine = read('src/features/plex/plexSyncEngine.ts');
  assert.match(engine, /const provenViewedAt = rawViewed && item\.viewedAtKnown !== false \? viewedTimestamp : null;/);
  assert.equal((engine.match(/skipAlreadyWatchedEpisode\(matchedShow, seasonNum, episodeNum, provenViewedAt\)/g) || []).length, 3);
  assert.equal((engine.match(/skipAlreadyWatchedMovie\(matchedMovie, provenViewedAt\)/g) || []).length, 3);
  assert.match(read('src/components/HomeSyncIndicator.tsx'), /<strong>Historique du compte<\/strong>/);
});

test('SEENIT-PLEX-005 retour v1.4.296 : la complète lit aussi l’historique de ses serveurs, filtré sur le titulaire', () => {
  // 29 lectures en rapide contre 14 médias en complète : l'historique PMS garde les films supprimés après lecture.
  const server = read('server.ts');
  assert.match(server, /if \(delta \|\| usePmsHistoryInFull \|\| owned\) \{/);
  assert.match(server, /const ownItems = items\.filter\(item => isOwnerPmsHistoryEntry\(item, owned\)\);/);
  // L'historique d'un serveur dont on est titulaire contient les lectures de ses amis : seul le compte local 1 est le sien.
  assert.equal(isOwnerPmsHistoryEntry({ accountID: 1 }, true), true);
  assert.equal(isOwnerPmsHistoryEntry({ accountID: '1' }, true), true);
  assert.equal(isOwnerPmsHistoryEntry({ accountID: 2 }, true), false);
  assert.equal(isOwnerPmsHistoryEntry({}, true), true, 'sans compte, l’entrée reste (ancien comportement)');
  assert.equal(isOwnerPmsHistoryEntry({ accountID: 7 }, false), true, 'serveur partagé : Plex ne renvoie que l’historique du jeton');
  // Un Vu Plex resté en « heure inconnue » est redaté par la lecture prouvée ; un Vu Plex à l'heure connue ne bouge pas.
  assert.equal(datePlexWatchedRecord({ watchedAt: 5, watchedTimeKnown: false, plexImported: true }, VIEWED)?.watchedAt, VIEWED);
  assert.equal(datePlexWatchedRecord({ watchedAt: 5, plexImported: true }, VIEWED), null);
});

test('SEENIT-PLEX-012 retour v1.4.297 : % de serveur stable (tailles de section connues d’emblée) et diagnostic de l’historique du compte', () => {
  const server = read('server.ts');
  assert.match(server, /X-Plex-Container-Start=0&X-Plex-Container-Size=0/);
  assert.match(server, /if \(totalsKnown\) syncProgress\.serverItems\(serverId, 0, sizes\.flat\(\)\.reduce/);
  assert.match(server, /syncProgress\.serverItems\(serverId, count, ctx\.totalsKnown \? undefined : totalSize\)/);
  assert.match(server, /sourceStats\.plexAccountHistoryMode = accountHistory\.queryMode;/);
  assert.match(read('src/components/HomeSyncIndicator.tsx'), /progress\.account\.dated === false \? ' · sans heure' : ''/);
  assert.match(read('src/features/plex/plexSyncEngine.ts'), /appLogger\.info\('plex', `\[Plex Sync\] \$\{history\?\.length \|\| 0\} visionnage\(s\)/);
});
