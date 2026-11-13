import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { hasAiredUnseenEpisode, looksFinished, reconcileArchive, reconcileSeriesStatus, selectFinishedShowsToRecheck, REVIVAL_RECHECK_MAX_PER_RUN } from '../src/features/shows/seriesRevival.ts';

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
  assert.match(worker, /const computedArchived = reconcileArchive\(s, computeAutoArchiveStatus\(s\)\);/, 'la passe de masse respecte l’archive manuelle');
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
