import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { isObsoleteMediaAlert } from '../src/features/notifications/notificationLifecycle.ts';
import { INACTIVITY_ARCHIVE_DAYS, hasAiredUnseenEpisode, inactivityReArchivePatch, inactivityRestorePatch, isDormantSeries, isInactivityArchive, isNewInactivityArchive, looksFinished, reconcileArchive, seriesInactivity, reconcileSeriesStatus, selectFinishedShowsToRecheck, REVIVAL_RECHECK_MAX_PER_RUN } from '../src/features/shows/seriesRevival.ts';

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
  assert.equal(INACTIVITY_ARCHIVE_DAYS, 1095);
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
  assert.match(worker, /body: 'Série archivée automatiquement pour inactivité\.'/);
  assert.match(worker, /`\$\{archived\.length\} séries archivées`/, 'plusieurs séries : une seule notification groupée');
  assert.match(readFileSync('src/components/ShowNewsFeed.tsx', 'utf8'), /case 'AUTO_ARCHIVED':/);
});

test('SEENIT-DATA-008 retour du 27/11 : « Désarchiver » rend la série sans perdre sa progression, et elle n’est pas réarchivée', () => {
  const ago = (days: number) => now - days * DAY;
  const progress = { seenEpisodes: ['1x1', '1x2'], episodeRecords: { '1x1': { watchedAt: ago(1200) }, '1x2': { watchedAt: ago(1100) } } };
  // État écrit par la passe de masse : archivée pour inactivité il y a 10 jours.
  const archived = { id: 'tv-1', mediaType: 'tv' as const, status: 'watching' as const, createdAt: ago(2000), ...progress,
    nextEpisodeToWatch: { season_number: 1, episode_number: 3, air_date: '2020-01-15' },
    isArchived: true, archiveSource: 'inactivity' as const, inactivityArchivedAt: ago(10) };
  assert.equal(isInactivityArchive(archived), true, '« Désarchiver » proposé');
  assert.equal(isInactivityArchive({ ...archived, archiveSource: 'manual' as const }), false, 'archive manuelle : rien de nouveau');
  assert.equal(isInactivityArchive({ ...archived, isArchived: false }), false, 'déjà revenue : plus d’action');
  assert.equal(isInactivityArchive({ ...archived, mediaType: 'movie' as const }), false);

  const patch = inactivityRestorePatch(archived, now);
  assert.deepEqual(patch, { isArchived: false, archiveSource: undefined, inactivityArchivedAt: ago(10), updatedAt: now });
  assert.ok(!('seenEpisodes' in patch) && !('episodeRecords' in patch) && !('lastWatchedAt' in patch) && !('status' in patch), 'la progression n’est jamais touchée');

  // `updateShow` écrit `undefined` en `null` dans Firestore : les deux lectures doivent donner le même résultat.
  for (const restored of [{ ...archived, ...patch }, { ...archived, ...patch, archiveSource: null as never }]) {
    for (const later of [now + DAY, now + 400 * DAY, now + 4 * 365 * DAY]) {
      assert.equal(reconcileArchive(restored, computeAutoArchiveStatus(restored), { now: later, archiveInactive: true }), false, 'passe de masse : pas réarchivée pour la même inactivité');
      assert.equal(reconcileArchive(restored, false, { now: later }), false, 'synchro de fiche : pas réarchivée');
      assert.equal(isNewInactivityArchive(restored, false, later), false, 'aucune nouvelle annonce');
    }
  }
  // Ancienne fiche sans date d'archivage : la restauration en pose une, la série reste rendue.
  const legacy = { ...archived, inactivityArchivedAt: undefined };
  const legacyRestored = { ...legacy, ...inactivityRestorePatch(legacy, now) };
  assert.equal(legacyRestored.inactivityArchivedAt, now);
  assert.equal(reconcileArchive(legacyRestored, false, { now: now + DAY, archiveInactive: true }), false);

  // Annuler (toast) remet l'archive d'avant, sans nouvelle annonce.
  const undone = { ...archived, ...patch, ...inactivityReArchivePatch(archived, now + 1) };
  assert.equal(undone.inactivityArchivedAt, ago(10));
  assert.equal(reconcileArchive(undone, false, { now: now + DAY, archiveInactive: true }), true);
  assert.equal(isNewInactivityArchive(undone, true, now + DAY), false);

  // Un épisode vu après la restauration ouvre une nouvelle période : trois ans plus tard, elle peut être rangée à nouveau.
  const watchedAgain = { ...archived, ...patch, seenEpisodes: ['1x1', '1x2', '1x3'], episodeRecords: { ...progress.episodeRecords, '1x3': { watchedAt: now + DAY } },
    nextEpisodeToWatch: { season_number: 1, episode_number: 4, air_date: '2020-01-22' } };
  assert.equal(reconcileArchive(watchedAgain, false, { now: now + 1200 * DAY, archiveInactive: true }), true);
});

test('SEENIT-DATA-008 retour du 27/11 : la notification d’archivage reste tant que la série est archivée, et disparaît une fois désarchivée', () => {
  const uid = 'owner';
  const show = { id: 'tv-1', userId: uid, mediaType: 'tv', isArchived: true, status: 'watching', seenEpisodes: ['1x1'] } as never;
  const announce = { id: 1, extra: { ownerUid: uid, notificationScope: 'media', showId: 'tv-1', mediaType: 'tv', reminderPurpose: 'inactivity_archive' } };
  assert.equal(isObsoleteMediaAlert(announce, uid, [show]), false, 'archivée : l’annonce et son bouton « Désarchiver » restent');
  assert.equal(isObsoleteMediaAlert(announce, uid, [{ ...(show as object), isArchived: false } as never]), true, 'revenue : l’annonce est retirée');
  const episodeAlert = { id: 2, extra: { ownerUid: uid, notificationScope: 'media', showId: 'tv-1', mediaType: 'tv', season: 1, episode: 2 } };
  assert.equal(isObsoleteMediaAlert(episodeAlert, uid, [show]), true, 'les autres alertes d’une série archivée restent retirées');
});

test('SEENIT-DATA-008 retour du 27/11 : « Désarchiver » est câblé sur l’actualité, la notification et la fiche', () => {
  const feed = readFileSync('src/components/ShowNewsFeed.tsx', 'utf8');
  assert.match(feed, /newsItem\.type === 'AUTO_ARCHIVED'\s*\? shows\.find\(s => isInactivityArchive\(s\)/, 'actualité « ARCHIVÉE » d’une série encore archivée');
  assert.match(feed, /restoreInactivityArchive\(inactivityArchivedShow\(newsItem\), updateShow\)/);
  assert.match(feed, /if \(restored\) await markNewsAsRead\(newsItem\.id\);/, 'l’actualité quitte le fil une fois la série rendue');
  assert.match(feed, /<ArchiveRestore size=\{18\} className="stroke-\[2\.5\]" \/>\s*Désarchiver/);

  const worker = readFileSync('src/hooks/useDetailsSyncWorker.ts', 'utf8');
  assert.match(worker, /mediaType: 'tv', allowUnarchive: true, reminderPurpose: 'inactivity_archive' \}\);/, 'notification d’une série : bouton « Désarchiver »');
  const reminder = readFileSync('src/features/notifications/mediaReminderNotification.ts', 'utf8');
  assert.match(reminder, /options\.allowUnarchive \? \[\{ id: 'unarchive', title: 'Désarchiver', foreground: true \}\]/);
  assert.match(reminder, /actionTypeId: hasActions \?/);
  assert.match(readFileSync('src/lib/firebase.ts', 'utf8'), /actionId === 'unarchive' \? 'QUICK_ACTION_UNARCHIVE'/);
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /data\.type === 'QUICK_ACTION_UNARCHIVE' && data\.ownerUid === auth\.currentUser\?\.uid/);
  assert.match(app, /restoreInactivityArchive\(show, updateShow\)/);

  const detail = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  const restoreCta = detail.indexOf('if (isInactivityArchive(show)) return <GoldCta');
  assert.ok(restoreCta > 0 && restoreCta < detail.indexOf('if (show.isArchived) return <GoldCta tone="done" label="Revoir la série"'), 'la fiche propose « Désarchiver » avant « Revoir », qui remettrait tout à zéro');
  assert.match(detail, /isInactivityArchive\(show\) \? <button type="button" role="menuitem"[^\n]*restoreShow\(\)[^\n]*Désarchiver la série/);
  const action = readFileSync('src/features/shows/restoreInactivityArchive.ts', 'utf8');
  assert.match(action, /await updateShow\(show\.id, inactivityRestorePatch\(show\) as Partial<Show>\);/);
  assert.match(action, /showToast\(`« \$\{show\.title\} » est de retour dans ta liste\.`, 'success', target, async \(\) => \{/, 'toast avec Annuler');
});
