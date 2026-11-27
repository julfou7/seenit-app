import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { INACTIVITY_ARCHIVE_YEARS, hasAiredUnseenEpisode, inactivityArchiveNotification, inactivityCutoff, isDormantSeries, isNewInactivityArchive, looksFinished, reconcileArchive, seriesInactivity, reconcileSeriesStatus, selectFinishedShowsToRecheck, REVIVAL_RECHECK_MAX_PER_RUN } from '../src/features/shows/seriesRevival.ts';

// Vrai calcul d'archive automatique de `utils.ts` (seul `logStore` est remplacé : il tire le navigateur).
const bundle = await build({ entryPoints: ['src/lib/utils.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'utils-ports', setup(builder) {
    builder.onResolve({ filter: /store\/logStore$/ }, () => ({ path: 'logStore', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const appLogger={info(){},warn(){},error(){},debug(){}};' }));
  } }] });
const { computeAutoArchiveStatus } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as { computeAutoArchiveStatus: (show: Record<string, unknown>) => boolean };

const DAY = 86_400_000;
const today = '2026-09-14';
const now = Date.parse('2026-09-14T12:00:00Z');

// Signalement terrain du 14/09 (#333) : S1 entièrement vue puis auto-archivée ; TMDB expose ensuite S02E01 et
// S02E02 déjà diffusés. Aucun traitement par titre : seule l'identité `mediaType + tmdbId` compte.
test('SEENIT-DATA-008 une série terminée ou archivée qui reprend l’antenne redevient active, sans perdre sa progression', () => {
  const finished = { id: 'a', mediaType: 'tv' as const, tmdbId: 1, status: 'completed' as const, isArchived: true, seriesEnded: true, tmdbStatus: 'Ended', lastSyncedAt: now - 30 * DAY, seenEpisodes: ['1x1', '1x2', '1x3'] };
  // Données TMDB fraîches après revérification : la série « revient », S02E01 est diffusé aujourd'hui et non vu.
  const next = { air_date: today };
  const upcoming = { air_date: '2026-09-28' };
  const archivedNow = computeAutoArchiveStatus({ ...finished, status: 'completed', tmdbStatus: 'Returning Series', seriesEnded: false, nextEpisodeToWatch: next, nextEpisodeToAir: upcoming });
  assert.equal(archivedNow, false, 'le calcul automatique frais ne l’archive plus');
  assert.equal(reconcileArchive(finished, archivedNow), false, 'archive automatique levée');
  assert.equal(reconcileSeriesStatus(finished.status, next, today), 'watching', 'plus `completed` par inertie');
  assert.deepEqual(finished.seenEpisodes, ['1x1', '1x2', '1x3'], 'progression conservée : aucun « Revoir » implicite');

  // Idempotence : une seconde passe sur l'état déjà réconcilié ne change rien.
  assert.equal(reconcileSeriesStatus('watching', next, today), 'watching');
  assert.equal(reconcileArchive({ isArchived: false }, false), false);

  // Cas voisins et négatifs.
  assert.equal(reconcileSeriesStatus('completed', upcoming, today), 'completed', 'épisode seulement annoncé : rien ne se réactive (#304)');
  assert.equal(reconcileSeriesStatus('completed', { air_date: null }, today), 'completed', 'sans date : aucune disponibilité inventée');
  assert.equal(reconcileSeriesStatus('completed', null, today), 'completed', 'série vraiment finie : reste `completed`');
  assert.equal(reconcileSeriesStatus('dropped', next, today), 'dropped', 'abandonnée : intention préservée');
  assert.equal(reconcileSeriesStatus('plan_to_watch', next, today), 'plan_to_watch');
  assert.equal(hasAiredUnseenEpisode({ air_date: '2026-09-13' }, today), true, 'diffusé hier');
  assert.equal(hasAiredUnseenEpisode({ air_date: '2026-09-14' }, today), true, 'diffusé aujourd’hui');
  assert.equal(hasAiredUnseenEpisode({ air_date: '2026-09-15' }, today), false, 'demain');
  assert.equal(hasAiredUnseenEpisode(undefined, today), false);

  // Archive manuelle : intention de l'utilisateur, jamais levée par la synchronisation.
  assert.equal(reconcileArchive({ isArchived: true, archiveSource: 'manual' }, false), true);
  assert.equal(reconcileArchive({ isArchived: true }, false), false, 'archive historique sans provenance : traitée comme automatique');
  assert.equal(reconcileArchive({ isArchived: false, archiveSource: 'manual' }, true), true, 'une série complète reste archivable automatiquement');
});

test('SEENIT-DATA-008 la revérification des séries finies est périodique, bornée et ne touche ni films ni abandonnées', () => {
  const base = { mediaType: 'tv' as const, status: 'completed' as const, isArchived: true, seriesEnded: true, tmdbStatus: 'Ended' as string | undefined };
  const shows = [
    { ...base, id: 'old', lastSyncedAt: now - 60 * DAY },
    { ...base, id: 'never', lastSyncedAt: undefined },
    { ...base, id: 'recent', lastSyncedAt: now - 3 * DAY },
    { ...base, id: 'movie', mediaType: 'movie' as const, lastSyncedAt: now - 90 * DAY },
    { ...base, id: 'dropped', status: 'dropped' as const, isArchived: false, seriesEnded: false, tmdbStatus: undefined, lastSyncedAt: now - 90 * DAY },
    { ...base, id: 'airing', status: 'watching' as const, isArchived: false, seriesEnded: false, tmdbStatus: 'Returning Series', lastSyncedAt: now - 90 * DAY },
  ];
  assert.deepEqual(selectFinishedShowsToRecheck(shows, now).map(show => show.id), ['never', 'old'], 'les plus anciennes d’abord ; une série récente, un film, une abandonnée ou en cours ne sont pas revérifiés ici');
  const many = Array.from({ length: 40 }, (_, index) => ({ ...base, id: `s${index}`, lastSyncedAt: now - (20 + index) * DAY }));
  const picked = selectFinishedShowsToRecheck(many, now);
  assert.equal(picked.length, REVIVAL_RECHECK_MAX_PER_RUN, 'coût TMDB borné par passage');
  assert.equal(picked[0].id, 's39', 'la plus ancienne en tête');
  assert.equal(looksFinished({ status: 'watching', isArchived: false, seriesEnded: false, tmdbStatus: 'Returning Series' }), false);
});

test('SEENIT-DATA-008 la synchronisation et les archivages explicites utilisent la réconciliation', () => {
  const worker = readFileSync('src/hooks/useDetailsSyncWorker.ts', 'utf8');
  assert.match(worker, /const computedArchived = reconcileArchive\(s, computeAutoArchiveStatus\(s\), \{ now: passNow, archiveInactive: true \}\);/, 'la passe de masse respecte l’archive manuelle');
  assert.match(worker, /if \(finishedToRecheck\.has\(String\(s\.id\)\)\) return true;/, 'les séries finies sont revérifiées');
  assert.match(worker, /const reconciledStatus = reconcileSeriesStatus\(showToSync\.status, nextEpisodeToWatch, todayStr2\);/, 'la synchronisation manuelle d’une série aussi');
  assert.match(worker, /const finalStatus = reconcileSeriesStatus\(showToSync\.status, nextEpisodeToWatch, todayStr2\);/);
  assert.match(worker, /isArchived: finalArchived,\n\s+\.\.\.\(hasStatusChanged \? \{ status: finalStatus \} : \{\}\)/, 'status écrit avec les détails');
  assert.match(worker, /!hasStatusChanged\) \{/, 'un changement de statut seul est écrit, même sans autre delta');
  assert.match(readFileSync('src/screens/WatchListScreen.tsx', 'utf8'), /isArchived: true,\n\s+archiveSource: 'manual',/, 'archivage depuis l’accueil = intention manuelle');
  const detail = readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8');
  assert.match(detail, /isArchived: newArchived, archiveSource: newArchived \? 'manual' : undefined/, 'archivage depuis la fiche = intention manuelle');
  assert.match(detail, /isArchived: false, archiveSource: undefined, lastWatchedAt: now/, '« Revoir » efface la provenance');
});

test('SEENIT-DATA-008 retour du 25/11 : trois ans sans activité archivent la série, avec une seule annonce', () => {
  const ago = (days: number) => now - days * DAY;
  const started = (lastSeenDaysAgo: number, extra: Record<string, unknown> = {}) => ({
    id: 'tv-1', mediaType: 'tv' as const, status: 'watching' as const, isArchived: false, createdAt: ago(2000),
    seenEpisodes: ['1x1'], episodeRecords: { '1x1': { watchedAt: ago(lastSeenDaysAgo) } },
    nextEpisodeToWatch: { season_number: 1, episode_number: 2, air_date: '2020-01-08' }, ...extra,
  });
  assert.equal(INACTIVITY_ARCHIVE_YEARS, 3);
  // Inactivité : un épisode diffusé reste à voir et rien n'est vu depuis plus de 3 ans.
  assert.equal(seriesInactivity(started(1100), now).inactive, true);
  assert.equal(seriesInactivity(started(1000), now).inactive, false, 'sous 3 ans : rien');
  assert.equal(seriesInactivity(started(1100, { status: 'dropped' }), now).inactive, false, 'abandonnée : déjà rangée par l’utilisateur');
  assert.equal(seriesInactivity(started(1100, { nextEpisodeToWatch: { season_number: 2, episode_number: 1, air_date: '2027-01-01' } }), now).inactive, false, 'à jour, épisode seulement annoncé : pas une inactivité');
  assert.equal(seriesInactivity({ ...started(1100), seenEpisodes: [], episodeRecords: {} }, now).inactive, false, 'jamais commencée : jamais archivée pour inactivité');
  // Seule la passe de masse archive une première fois, et elle annonce.
  assert.equal(reconcileArchive(started(1100), false, { now }), false, 'une synchro de fiche n’archive pas en silence');
  assert.equal(reconcileArchive(started(1100), false, { now, archiveInactive: true }), true);
  assert.equal(isNewInactivityArchive(started(1100), true, now), true);
  // Déjà archivée pour inactivité : reste archivée sans nouvelle annonce, même si TMDB annonce une suite.
  const archived = started(1100, { isArchived: true, archiveSource: 'inactivity', inactivityArchivedAt: ago(10) });
  assert.equal(reconcileArchive(archived, false, { now }), true);
  assert.equal(isNewInactivityArchive(archived, true, now), false);
  // Désarchivée à la main sans rien regarder depuis : jamais réarchivée pour la même inactivité.
  const unarchived = { ...archived, isArchived: false, archiveSource: undefined };
  assert.equal(reconcileArchive(unarchived, false, { now, archiveInactive: true }), false);
  // Un épisode vu ensuite efface l'inactivité : la série revient.
  const resumed = { ...archived, episodeRecords: { '1x1': { watchedAt: ago(5) } } };
  assert.equal(reconcileArchive(resumed, false, { now, archiveInactive: true }), false);
  // L'archive manuelle reste prioritaire.
  assert.equal(reconcileArchive({ ...started(10), isArchived: true, archiveSource: 'manual' }, false, { now }), true);
});

test('SEENIT-DATA-008 retour du 25/11 : une série dormante depuis 3 ans est rangée en silence, un nouvel épisode la réactive', () => {
  const dormant = { mediaType: 'tv' as const, status: 'watching' as const, tmdbStatus: 'Returning Series', nextEpisodeToWatch: null, nextEpisodeToAir: null,
    seasonProgress: { '2': { season_number: 2, last_known_episode_air_date: '2023-05-01' } } } as never;
  assert.equal(isDormantSeries(dormant, now), true);
  assert.equal(reconcileArchive(dormant, false, { now }), true);
  assert.equal(isDormantSeries({ ...(dormant as object), nextEpisodeToAir: { season_number: 3, episode_number: 1, air_date: '2027-01-01' } } as never, now), false, 'une suite annoncée la réactive');
  assert.equal(isDormantSeries({ ...(dormant as object), seasonProgress: { '2': { season_number: 2, last_known_episode_air_date: '2025-05-01' } } } as never, now), false, 'diffusée il y a moins de 3 ans');
  assert.equal(isDormantSeries({ ...(dormant as object), seasonProgress: {} } as never, now), false, 'date inconnue : rien deviné');
  assert.equal(isDormantSeries({ ...(dormant as object), tmdbStatus: 'Ended' } as never, now), false, 'finie : déjà gérée par l’archive automatique');
  // Codex #1108 : ancien document dormant + réponse TMDB fraîche annonçant un épisode → réactivée dès cette synchro.
  const stale = { ...(dormant as object), isArchived: true } as never;
  assert.equal(reconcileArchive({ ...(stale as object), nextEpisodeToAir: { season_number: 3, episode_number: 1, air_date: '2027-01-01' } } as never, false, { now }), false);
  const worker = readFileSync('src/hooks/useDetailsSyncWorker.ts', 'utf8');
  const fresh = /reconcileArchive\(\{ \.\.\.showToSync, nextEpisodeToWatch, nextEpisodeToAir, tmdbStatus: details\.status, seriesEnded: isEnded, seasonProgress \}, shouldBeArchived\)/g;
  assert.equal(worker.match(fresh)?.length, 2, 'les deux synchros de fiche réconcilient avec l’état TMDB frais');
  assert.doesNotMatch(worker, /reconcileArchive\(showToSync, /, 'jamais avec l’ancien document seul');
});

test('SEENIT-DATA-008 retour du 25/11 : la passe de masse archive, marque et annonce une seule fois par inactivité', () => {
  const worker = readFileSync('src/hooks/useDetailsSyncWorker.ts', 'utf8');
  assert.match(worker, /reconcileArchive\(s, computeAutoArchiveStatus\(s\), \{ now: passNow, archiveInactive: true \}\)/);
  assert.match(worker, /forInactivity \? \{ archiveSource: 'inactivity', inactivityArchivedAt: passNow \}/);
  assert.match(worker, /if \(inactivityArchived\.length\) await announceInactivityArchives\(userUid, inactivityArchived\);/);
  assert.match(worker, /type: 'AUTO_ARCHIVED'[^\n]*message: 'Archivée automatiquement pour inactivité'/);
  assert.match(worker, /const notification = inactivityArchiveNotification\(archived\);/, 'une seule notification, composée par la fonction testée');
  assert.match(readFileSync('src/components/ShowNewsFeed.tsx', 'utf8'), /case 'AUTO_ARCHIVED':/);
});

// Cas limites de l'archivage pour inactivité (PR #1108) : bornes des trois ans, séries terminées ou jamais
// commencées, et passe de masse qui range plusieurs séries d'un coup.
test('SEENIT-DATA-008 archivage pour inactivité : bornes des trois ans, séries finies ou jamais commencées, annonce groupée', () => {
  const at = (iso: string) => Date.parse(iso);
  const show = (watchedAt: number, extra: Record<string, unknown> = {}) => ({
    id: 'tv-7', title: 'Série', mediaType: 'tv' as const, status: 'watching' as const, isArchived: false, createdAt: watchedAt - 30 * DAY,
    seenEpisodes: ['1x1'], episodeRecords: { '1x1': { watchedAt } },
    nextEpisodeToWatch: { season_number: 1, episode_number: 2, air_date: '2020-01-08' }, ...extra,
  });
  const watched = at('2023-11-27T12:00:00Z');

  // Juste avant / juste après trois ans civils (le 29/02/2024 est dans l'intervalle : 1 095 jours ≠ 3 ans).
  assert.equal(seriesInactivity(show(watched), at('2026-11-26T12:00:00Z')).inactive, false, 'la veille de l’anniversaire : pas encore 3 ans');
  assert.equal(seriesInactivity(show(watched), at('2026-11-27T11:59:59Z')).inactive, false, 'une seconde avant 3 ans : rien');
  assert.equal(seriesInactivity(show(watched), at('2026-11-27T12:00:00Z')).inactive, true, 'trois ans pile : archivable');
  assert.equal(seriesInactivity(show(watched), at('2026-11-28T12:00:00Z')).inactive, true, 'le lendemain : archivable');
  assert.equal(reconcileArchive(show(watched), false, { now: at('2026-11-26T12:00:00Z'), archiveInactive: true }), false, 'la passe de masse n’archive pas avant 3 ans');
  assert.equal(reconcileArchive(show(watched), false, { now: at('2026-11-27T12:00:00Z'), archiveInactive: true }), true);
  // Le seuil ne dépend que du dernier épisode vu, pas du plus ancien.
  const twoSeen = show(watched, { seenEpisodes: ['1x1', '1x2'], episodeRecords: { '1x1': { watchedAt: at('2020-01-01T12:00:00Z') }, '1x2': { watchedAt: watched } }, nextEpisodeToWatch: { season_number: 1, episode_number: 3, air_date: '2020-01-15' } });
  assert.equal(seriesInactivity(twoSeen, at('2026-11-26T12:00:00Z')).inactive, false, 'dernier épisode vu il y a moins de 3 ans');
  // 29 février : trois ans plus tôt n'existe pas, le seuil retombe au 28 février (jamais au 1er mars).
  assert.equal(inactivityCutoff(at('2028-02-29T12:00:00Z')), at('2025-02-28T12:00:00Z'));
  assert.equal(inactivityCutoff(at('2027-03-01T08:00:00Z')), at('2024-03-01T08:00:00Z'));
  // La même borne vaut pour la série dormante (dernier épisode diffusé).
  const dormant = { mediaType: 'tv' as const, status: 'watching' as const, tmdbStatus: 'Returning Series', nextEpisodeToWatch: null, nextEpisodeToAir: null,
    seasonProgress: { '1': { season_number: 1, last_known_episode_air_date: '2023-11-27' } } } as never;
  assert.equal(isDormantSeries(dormant, at('2026-11-26T12:00:00Z')), false, 'série dormante : la veille des 3 ans');
  assert.equal(isDormantSeries(dormant, at('2026-11-27T12:00:00Z')), true, 'série dormante : 3 ans pile');

  const late = at('2027-06-01T12:00:00Z');
  // Série terminée sans épisode restant : pas d'inactivité, donc ni archive pour inactivité ni annonce (même si
  // l'archive automatique habituelle la range parce qu'elle est finie).
  const finished = show(watched, { seriesEnded: true, tmdbStatus: 'Ended', nextEpisodeToWatch: null, nextEpisodeToAir: null });
  assert.equal(seriesInactivity(finished, late).inactive, false);
  assert.equal(seriesInactivity({ ...finished, status: 'completed' }, late).inactive, false, '« Vue » : jamais une inactivité');
  assert.equal(isNewInactivityArchive(finished, true, late), false, 'rangée par l’archive habituelle : aucune annonce « inactivité »');
  assert.equal(reconcileArchive(finished, false, { now: late, archiveInactive: true }), false, 'aucune archive pour inactivité de son fait');
  // Épisode restant seulement annoncé ou sans date : rien n'est diffusé, donc pas une inactivité.
  assert.equal(seriesInactivity(show(watched, { nextEpisodeToWatch: { season_number: 2, episode_number: 1, air_date: null } }), late).inactive, false);

  // Jamais commencée, même ajoutée il y a 5 ans avec des épisodes diffusés : jamais archivée pour inactivité.
  const neverStarted = show(watched, { seenEpisodes: [], episodeRecords: {}, createdAt: at('2021-01-01T12:00:00Z'), nextEpisodeToWatch: { season_number: 1, episode_number: 1, air_date: '2020-01-01' } });
  assert.equal(seriesInactivity(neverStarted, late).inactive, false);
  assert.equal(reconcileArchive(neverStarted, false, { now: late, archiveInactive: true }), false);
  assert.equal(isNewInactivityArchive(neverStarted, true, late), false);
  // Commencée sans aucune date de visionnage connue : rien deviné.
  assert.equal(seriesInactivity(show(watched, { episodeRecords: {}, lastWatchedAt: undefined }), late).inactive, false);
  // Un ancien enregistrement d'un épisode qui n'est plus vu ne compte pas comme activité.
  assert.equal(seriesInactivity(show(watched, { episodeRecords: { '1x1': { watchedAt: watched }, '1x9': { watchedAt: late - DAY } } }), late).inactive, true);

  // Plusieurs séries archivées dans la même passe : une seule notification, groupée.
  const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
  const batch = titles.map((title, i) => show(watched, { id: `tv-${i}`, title }));
  const archivedNow = batch.filter(s => { const archived = reconcileArchive(s, false, { now: late, archiveInactive: true }); return isNewInactivityArchive(s, archived, late); });
  assert.equal(archivedNow.length, 4, 'les quatre séries sont rangées et à annoncer');
  assert.deepEqual(inactivityArchiveNotification(archivedNow), { title: '4 séries archivées', body: 'Archivées automatiquement pour inactivité : Alpha, Bravo, Charlie…', tag: 'notif_inactivity_archive' });
  assert.deepEqual(inactivityArchiveNotification(archivedNow.slice(0, 2)), { title: '2 séries archivées', body: 'Archivées automatiquement pour inactivité : Alpha, Bravo', tag: 'notif_inactivity_archive' });
  assert.deepEqual(inactivityArchiveNotification(archivedNow.slice(0, 1)), { title: 'Alpha', body: 'Série archivée automatiquement pour inactivité.', tag: 'notif_tv-0_inactivity', showId: 'tv-0' });
  assert.equal(inactivityArchiveNotification([]), null, 'rien d’archivé : aucune notification');
  // Passe suivante : déjà archivées pour inactivité, plus rien à annoncer.
  const nextPass = batch.map(s => ({ ...s, isArchived: true, archiveSource: 'inactivity' as const, inactivityArchivedAt: late }));
  assert.equal(nextPass.filter(s => isNewInactivityArchive(s, reconcileArchive(s, false, { now: late + DAY, archiveInactive: true }), late + DAY)).length, 0);
  // Côté synchronisation : un seul appel d'annonce par passe, et une seule notification envoyée par cet appel.
  const worker = readFileSync('src/hooks/useDetailsSyncWorker.ts', 'utf8');
  const announce = worker.slice(worker.indexOf('async function announceInactivityArchives'), worker.indexOf('export function useDetailsSyncWorker'));
  assert.equal(announce.match(/sendNativeNotification\(/g)?.length, 1, 'un seul envoi de notification');
  assert.doesNotMatch(announce, /for \([^)]*\)[^}]*sendNativeNotification/, 'jamais une notification par série');
  assert.equal(worker.match(/announceInactivityArchives\(userUid, inactivityArchived\)/g)?.length, 1);
});
