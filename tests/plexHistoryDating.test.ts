import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { datePlexWatchedRecord, describePlexDatingSkip, readPlexAccountProgress, summarizePlexDatingSkips, withPlexDate } from '../src/features/plex/plexDating.ts';
import { buildPlexActivityDatingItems, collectPlexActivityDates, isExcludedAccountHistoryEntry, isOwnerPmsHistoryEntry, normalizePlexAccountHistoryNode, pickPlexProvenViewedAt, reconcileAccountHistoryWithLibraries, readPlexAccountHistoryDate, readPlexActivityDates, PLEX_ACCOUNT_HISTORY_DATED_QUERY, PLEX_ACTIVITY_FEED_MAX_PAGES, PLEX_ACTIVITY_FEED_QUERY, type PlexActivityDate } from '../src/features/plex/plexAccountHistory.ts';

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
  // Décision du 12/11/2026 : seul un état courant explicitement non vu écarte l'événement (hors datation seule, v1.4.304).
  assert.match(server, /if \(isExcludedAccountHistoryEntry\(entry\)\) continue;/);
  assert.equal(isExcludedAccountHistoryEntry({ sourceKind: 'account-history', accountCurrentWatched: false }), true);
  assert.equal(isExcludedAccountHistoryEntry({ sourceKind: 'account-history', accountCurrentWatched: null }), false);
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
  assert.equal(datePlexWatchedRecord({ watchedAt: 9, plexImported: true, watchedTimeKnown: true }, VIEWED), null, 'Vu Plex déjà daté à l’heure prouvée');
  // Retour v1.4.302 : un ancien Vu sans étiquette ni heure prouvée est daté ; seule une heure prouvée le protège.
  assert.equal(datePlexWatchedRecord({ watchedAt: 9 }, VIEWED)?.watchedAt, VIEWED);
  assert.equal(datePlexWatchedRecord({ watchedAt: 9, watchedTimeKnown: true }, VIEWED), null, 'heure prouvée sans étiquette : inchangé');
  assert.equal(datePlexWatchedRecord(undefined, null), null);
  assert.equal('plexImported' in (datePlexWatchedRecord(undefined, VIEWED) || {}), false, 'la date ne donne pas à Plex la propriété du Vu');
  const show = { episodeRecords: { movie: { watchedAt: 1, source: 'tvtime' } }, lastWatchedAt: 1 };
  const dated = withPlexDate(show, 'movie', VIEWED);
  assert.equal(dated?.lastWatchedAt, VIEWED);
  assert.equal(withPlexDate({ episodeRecords: { movie: { watchedAt: 9, source: 'seenit' } } }, 'movie', VIEWED), null);
  assert.deepEqual(readPlexAccountProgress({ plexAccountHistoryItems: 340, plexAccountCurrentUnwatched: 2 }), { history: 340, unwatched: 2, dated: false, datedCount: 0, mode: 'inconnu' });
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
  // Retour v1.4.301 : un Vu Plex d'une ancienne synchro (heure non prouvée, souvent l'instant de l'import) est daté ;
  // un Vu Plex à l'heure prouvée ne bouge plus.
  assert.equal(datePlexWatchedRecord({ watchedAt: 5, plexImported: true }, VIEWED)?.watchedAt, VIEWED);
  assert.equal(datePlexWatchedRecord({ watchedAt: 5, source: 'plex' }, VIEWED)?.watchedTimeKnown, true);
  assert.equal(datePlexWatchedRecord({ watchedAt: 5, plexImported: true, watchedTimeKnown: true }, VIEWED), null);
  assert.equal(datePlexWatchedRecord({ watchedAt: 5 }, VIEWED)?.source, 'plex', 'origine inconnue sans heure prouvée : daté par Plex (journal v1.4.302)');
  assert.equal(datePlexWatchedRecord({ watchedAt: 5, watchedTimeKnown: true, source: 'tvtime' }, VIEWED)?.watchedAt, VIEWED, 'un import TV Time est toujours daté');
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

test('SEENIT-PLEX-005 retour v1.4.298 : les dates du fil Activité de Plex datent l’historique du compte par GUID exact', () => {
  // Journal terrain du 12/11 : 27 lignes d'historique serveur sans identité (médias supprimés), historique du compte sans heure.
  assert.match(PLEX_ACTIVITY_FEED_QUERY, /activityFeed\(first: \$first, after: \$after, types: \[WATCH_HISTORY\]\)/);
  assert.match(PLEX_ACTIVITY_FEED_QUERY, /\.\.\. on ActivityWatchHistory \{\n\s+id\n\s+date\n\s+metadataItem \{ id guid type \}/);
  const payload = { data: { activityFeed: { nodes: [
    { __typename: 'ActivityWatchHistory', date: '2026-10-28T20:15:00.000Z', metadataItem: { guid: 'plex://movie/spider' } },
    { __typename: 'ActivityWatchHistory', date: null, metadataItem: { guid: 'plex://movie/sans-date' } },
    { __typename: 'ActivityRating', metadataItem: { guid: 'plex://movie/note' } },
  ] } } };
  assert.deepEqual(readPlexActivityDates(payload), [{ guid: 'plex://movie/spider', viewedAt: VIEWED, type: '' }]);
  assert.deepEqual(readPlexActivityDates(null), []);
  const server = read('server.ts');
  assert.match(server, /if \(!item\.viewedAt && dated\) item\.viewedAt = dated\.viewedAt;/);
  // Revue Codex #963 : une page suivante en échec garde les dates déjà lues (retour { dates, error }).
  assert.match(server, /return \{ dates, error: activityCaught instanceof Error \? activityCaught\.message : String\(activityCaught\) \};/);
  assert.match(server, /sourceStats\.plexAccountHistoryDateError = \[accountHistory\.datedError, accountHistory\.activityError\]/);
  assert.deepEqual(readPlexAccountProgress({ plexAccountHistoryItems: 75, plexAccountHistoryDated: 60, plexAccountHistoryMode: 'activity' }), { history: 75, unwatched: 0, dated: true, datedCount: 60, mode: 'activity' });
  assert.equal(readPlexAccountProgress({ plexAccountHistoryItems: 75, plexAccountHistoryDateError: 'Cannot query field "date"' })?.dateError, 'Cannot query field "date"');
  // Terrain v1.4.299 : le journal (150 lignes) perdait la ligne écrite au début ; elle suit désormais le bilan, et la raison s'affiche dans le panneau.
  const engine = read('src/features/plex/plexSyncEngine.ts');
  assert.ok(engine.indexOf('[Plex Sync] Historique du compte :') > engine.indexOf('[Plex Sync] Bilan :'));
  assert.match(read('src/components/HomeSyncIndicator.tsx'), /Plex ne donne pas l’heure : \{progress\.account\.dateError\.slice\(0, 140\)\}/);
});

test('SEENIT-PLEX-005 retour v1.4.304 : le fil Activité complet date un Vu connu même absent du Watch History', () => {
  // Relevé du 13/11 : watchHistory = 80 visionnages depuis 01/2023 ; fil Activité = 2025 depuis 05/2018, dont Coco
  // (15/07/2018) et Dunkerque (01/07/2020), présents non vus sur le serveur d'un ami et absents du Watch History.
  const COCO = Date.parse('2018-07-15T00:13:16.000Z');
  const COCO_REVU = Date.parse('2021-03-01T20:00:00.000Z');
  const dates = new Map<string, PlexActivityDate>();
  collectPlexActivityDates(dates, { data: { activityFeed: { nodes: [
    { __typename: 'ActivityWatchHistory', date: '2026-11-12T18:17:00.000Z', metadataItem: { guid: 'plex://movie/mario', type: 'MOVIE' } },
    { __typename: 'ActivityWatchHistory', date: '2021-03-01T20:00:00.000Z', metadataItem: { guid: 'plex://movie/coco', type: 'MOVIE' } },
    { __typename: 'ActivityWatchHistory', date: '2020-01-01T10:00:00.000Z', metadataItem: { guid: 'plex://episode/e1', type: 'EPISODE' } },
    { __typename: 'ActivityWatchHistory', date: '2019-01-01T10:00:00.000Z', metadataItem: { guid: 'plex://season/s1', type: 'SEASON' } },
  ] } } });
  // Page suivante (plus ancienne) : la lecture la plus récente déjà vue reste celle retenue.
  collectPlexActivityDates(dates, { data: { activityFeed: { nodes: [
    { __typename: 'ActivityWatchHistory', date: '2018-07-15T00:13:16.000Z', metadataItem: { guid: 'plex://movie/coco', type: 'MOVIE' } },
    { __typename: 'ActivityWatchHistory', date: '2018-08-01T10:00:00.000Z', metadataItem: { guid: 'plex://movie/supprime', type: 'MOVIE' } },
  ] } } });
  assert.equal(dates.get('plex://movie/coco')?.viewedAt, COCO_REVU);
  assert.notEqual(COCO, COCO_REVU);

  const items = buildPlexActivityDatingItems([{ guid: 'plex://movie/mario' }], dates);
  assert.deepEqual(items.map(item => [item.guid, item.type, item.accountActivityOnly]), [
    ['plex://movie/coco', 'movie', true],
    ['plex://episode/e1', 'episode', true],
    ['plex://movie/supprime', 'movie', true],
  ], 'déjà dans le Watch History ou saison : pas de doublon');
  assert.ok(items.every(item => item.title === ''), 'aucun titre transporté : identité par GUID exact uniquement');

  // Filtre par bibliothèque : présent non vu → datation seule ; vu → la bibliothèque porte sa date ; absent → écarté.
  const entries: Array<{ sourceKind: string; raw: { guid: string; viewedAt?: number }; datingOnly?: boolean; accountActivityOnly?: boolean }> = [
    ...items.map(item => ({ sourceKind: 'account-history', raw: { guid: item.guid, viewedAt: item.viewedAt }, datingOnly: true, accountActivityOnly: true })),
    { sourceKind: 'library-watched', raw: { guid: 'plex://episode/e1' } },
    { sourceKind: 'account-history', raw: { guid: 'plex://movie/hors-bibliotheque', viewedAt: VIEWED } },
  ];
  const reconciled = reconcileAccountHistoryWithLibraries(entries, new Set(['plex://movie/coco', 'plex://episode/e1']));
  assert.deepEqual(reconciled.entries.map(entry => [entry.raw.guid, entry.sourceKind, entry.datingOnly === true]), [
    ['plex://movie/coco', 'account-history', true],
    ['plex://episode/e1', 'library-watched', false],
    ['plex://movie/hors-bibliotheque', 'account-history', false],
  ]);
  assert.equal(reconciled.activityDropped, 1);
  assert.equal(reconciled.removed, 0, 'un doublon du fil Activité ne réduit pas le compte du Watch History');
  // Sans bibliothèque lue, aucune entrée du seul fil Activité ne survit ; le Watch History reste inchangé.
  assert.deepEqual(reconcileAccountHistoryWithLibraries(entries, new Set()).entries.map(entry => entry.raw.guid), ['plex://episode/e1', 'plex://movie/hors-bibliotheque']);

  // Coco est non vu au compte aujourd'hui (viewCount 0) : la datation seule passe quand même, sans jamais créer de Vu.
  assert.equal(isExcludedAccountHistoryEntry({ sourceKind: 'account-history', accountCurrentWatched: false, datingOnly: true }), false);
  assert.equal(isExcludedAccountHistoryEntry({ sourceKind: 'account-history', accountCurrentWatched: false }), true);
  assert.equal(isExcludedAccountHistoryEntry({ sourceKind: 'library-watched', accountCurrentWatched: false }), false);

  const server = read('server.ts');
  assert.match(server, /const activityTask = fetchPlexActivityFeedDates\(\);/, 'le fil est lu à chaque full, pas seulement sans date');
  assert.match(server, /for \(let page = 0; page < PLEX_ACTIVITY_FEED_MAX_PAGES; page\+\+\)/);
  assert.match(server, /throw new Error\(`Fil Activité Plex plafonné/);
  assert.equal(PLEX_ACTIVITY_FEED_MAX_PAGES >= 100, true);
  assert.match(server, /if \(entry\?\.accountActivityOnly === true\) continue;/, 'jamais d’état courant depuis le seul fil');
  assert.match(server, /if \(isExcludedAccountHistoryEntry\(entry\)\) continue;/);
  assert.match(server, /if \(!delta\) \{\n\s+const reconciled = reconcileAccountHistoryWithLibraries\(allRawItems, currentLibraryGuids\);/);
  assert.equal(readPlexAccountProgress({ plexAccountHistoryItems: 80, plexAccountActivityItems: 1945, plexAccountHistoryMode: 'dated' })?.activity, 1945);
  assert.match(read('src/features/plex/plexSyncEngine.ts'), /lu\(s\) dans le seul fil Activité/);
});

test('SEENIT-PLEX-005 retour v1.4.304 : la date de l’historique du compte prime sur le lastViewedAt du provider', () => {
  // Coco au provider Plex : lastViewedAt 04/09/2026 (marquage), viewCount 0 ; lecture réelle du fil : 15/07/2018.
  const COCO = Date.parse('2018-07-15T00:13:16.000Z');
  const PROVIDER = 1788511364;
  const enriched = { guid: 'plex://movie/coco', lastViewedAt: PROVIDER, viewedAt: COCO };
  assert.equal(pickPlexProvenViewedAt({ sourceKind: 'account-history', accountViewedAt: COCO }, enriched, enriched), COCO);
  // Sans date d'événement, le provider reste le repli ; les autres sources gardent leur ordre de preuve.
  assert.equal(pickPlexProvenViewedAt({ sourceKind: 'account-history' }, enriched, enriched), PROVIDER);
  assert.equal(pickPlexProvenViewedAt({ sourceKind: 'library-watched', accountViewedAt: COCO }, { lastViewedAt: 1 }, {}), 1);
  assert.equal(pickPlexProvenViewedAt({ sourceKind: 'pms-history' }, {}, { viewedAt: 2 }), 2);
  assert.equal(pickPlexProvenViewedAt({ sourceKind: 'pms-history' }, {}, { createdAt: 3 }), undefined, 'createdAt ne prouve jamais une lecture');
  const server = read('server.ts');
  assert.match(server, /entry = \{ \.\.\.entry, raw, accountCurrentWatched, accountViewedAt: originalRaw\.viewedAt \};/);
  assert.match(server, /const provenViewed = pickPlexProvenViewedAt\(entry, meta, raw\);/);
});

test('SEENIT-PLEX-005 retour v1.4.300 : un film présent mais non vu chez un ami garde la date de sa lecture faite ailleurs', () => {
  // Terrain du 12/11 : « 75 daté(s) » dans l'historique du compte, mais « 0 Vu daté(s) » : Coco, vu sur PC-JULIAN puis
  // supprimé, existe encore (non vu) dans la bibliothèque d'Émile ; son événement daté était retiré comme doublon.
  const entries: Array<{ sourceKind: string; raw: { guid: string; viewedAt?: number; lastViewedAt?: number }; datingOnly?: boolean }> = [
    { sourceKind: 'account-history', raw: { guid: 'plex://movie/coco', viewedAt: VIEWED } },
    { sourceKind: 'account-history', raw: { guid: 'plex://movie/vu-ailleurs', viewedAt: VIEWED } },
    { sourceKind: 'account-history', raw: { guid: 'plex://movie/supprime', viewedAt: VIEWED } },
    { sourceKind: 'library-watched', raw: { guid: 'plex://movie/vu-ailleurs', lastViewedAt: VIEWED / 1000 } },
    { sourceKind: 'pms-history', raw: { guid: 'plex://movie/coco' } },
  ];
  const libraries = new Set(['plex://movie/coco', 'plex://movie/vu-ailleurs']);
  const result = reconcileAccountHistoryWithLibraries(entries, libraries);
  assert.equal(result.removed, 1, 'vu dans une bibliothèque : la bibliothèque porte déjà la date');
  assert.equal(result.datingOnly, 1);
  assert.deepEqual(result.entries.map(entry => [entry.raw.guid, entry.sourceKind, entry.datingOnly === true]), [
    ['plex://movie/coco', 'account-history', true],
    ['plex://movie/supprime', 'account-history', false],
    ['plex://movie/vu-ailleurs', 'library-watched', false],
    ['plex://movie/coco', 'pms-history', false],
  ]);
  assert.equal(reconcileAccountHistoryWithLibraries(entries, new Set()).entries.length, entries.length);
  // Côté client, datingOnly date un Vu connu et n'en crée jamais (sinon l'état non vu de la bibliothèque le retirerait).
  const engine = read('src/features/plex/plexSyncEngine.ts');
  // Revue Codex #969 : l'entrée passe d'abord par le cache de résolution et TMDB (GUID Plex/IMDb seul), puis s'arrête
  // juste avant toute création de Vu, une fois pour les épisodes et une fois pour les films.
  const guard = /\n\s+if \(item\.datingOnly === true\) continue;[^\n]*\n\s+if \((matchedShow|matchedMovie)\) \{/g;
  assert.deepEqual([...engine.matchAll(guard)].map(match => match[1]), ['matchedShow', 'matchedMovie']);
  assert.ok(engine.indexOf('if (item.datingOnly === true) continue;') > engine.indexOf('tmdbData = await resolveAndCachePlexItem(cacheKey, item);'));
  assert.doesNotMatch(engine, /provenViewedAt\) \|\| item\.datingOnly/);
  const server = read('server.ts');
  assert.match(server, /reconcileAccountHistoryWithLibraries\(allRawItems, currentLibraryGuids\)/);
  assert.match(server, /\.\.\.\(entry\.datingOnly === true \? \{ datingOnly: true \} : \{\}\)/);
  assert.doesNotMatch(server, /if \(guid && currentLibraryGuids\.has\(guid\)\) \{\n\s+allRawItems\.splice/);
  assert.equal(readPlexAccountProgress({ plexAccountHistoryItems: 75, plexAccountHistoryDatingOnly: 40, plexAccountHistoryMode: 'dated' })?.datingOnly, 40);
  // Un Vu daté par Plex ne devient pas un Vu Plex : l'état non vu de la bibliothèque ne peut donc pas le retirer.
  assert.equal('plexImported' in (datePlexWatchedRecord({ watchedAt: 1, watchedTimeKnown: false }, VIEWED) || {}), false);
});

test('SEENIT-PLEX-005 retour v1.4.301 : un Vu Plex créé note si son heure est prouvée, et le bilan dit pourquoi un Vu reste sans date', () => {
  const engine = read('src/features/plex/plexSyncEngine.ts');
  assert.equal((engine.match(/plexImported: true, watchedTimeKnown: provenViewedAt !== null,/g) || []).length, 4, 'les quatre créations de Vu Plex');
  assert.match(engine, /\$\{datedCount\} Vu daté\(s\) par Plex\.\$\{summarizePlexDatingSkips\(notDated\)\}/);
  assert.equal(describePlexDatingSkip('Coco', { watchedAt: 9, watchedTimeKnown: true, plexImported: true }, VIEWED), 'Coco : heure déjà prouvée (plex)');
  assert.equal(describePlexDatingSkip('Le Robot sauvage', { watchedAt: 9, source: 'seenit' }, VIEWED), 'Le Robot sauvage : Vu SeenIt');
  assert.equal(describePlexDatingSkip('Mario', undefined, null), 'Mario : sans date Plex prouvée');
  assert.equal(summarizePlexDatingSkips([]), '');
  assert.equal(summarizePlexDatingSkips(['A : Vu SeenIt', 'B : Vu SeenIt', 'C : sans date Plex prouvée'], 2), ' Non datés : 2 Vu SeenIt, 1 sans date Plex prouvée — A : Vu SeenIt ; B : Vu SeenIt ; …');
});
