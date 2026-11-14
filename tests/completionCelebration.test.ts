import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { celebrationCopy, detectCompletionCelebration, useCelebrationStore } from '../src/features/shows/completionCelebration.ts';

const season2 = [
  { episode_number: 1, air_date: '2026-01-01' },
  { episode_number: 2, air_date: '2026-01-08' },
  { episode_number: 3, air_date: '2026-01-15' },
];
const base = { season: 2, wasSeen: false, seasonEpisodes: season2, today: '2026-11-14', nextEpisodeToWatch: { season_number: 3, episode_number: 1 }, seriesEnded: false };

test('#436 la fin réelle d’une saison célèbre exactement une fois', () => {
  const previousSeen = ['2x1', '2x2'];
  const nextSeen = new Set([...previousSeen, '2x3']);
  assert.deepEqual(detectCompletionCelebration({ ...base, previousSeen, nextSeen }), { kind: 'season', season: 2 });
  // Déjà complète avant (re-marquage) : rien.
  assert.equal(detectCompletionCelebration({ ...base, previousSeen: ['2x1', '2x2', '2x3'], nextSeen: new Set(['2x1', '2x2', '2x3']) }), null);
});

test('#436 aucun faux positif : épisode manquant, décochage, saison inconnue, épisode non diffusé', () => {
  // Le final est vu mais 2x1 manque encore.
  assert.equal(detectCompletionCelebration({ ...base, previousSeen: ['2x2'], nextSeen: new Set(['2x2', '2x3']) }), null);
  // Décocher ne célèbre jamais.
  assert.equal(detectCompletionCelebration({ ...base, wasSeen: true, previousSeen: ['2x1', '2x2', '2x3'], nextSeen: new Set(['2x1', '2x2']) }), null);
  // Liste d'épisodes inconnue : pas d'heuristique sur le numéro.
  assert.equal(detectCompletionCelebration({ ...base, seasonEpisodes: null, previousSeen: ['2x1', '2x2'], nextSeen: new Set(['2x1', '2x2', '2x3']) }), null);
  // 2x4 pas encore diffusé : finir les 3 diffusés suffit ; un épisode futur ne bloque pas.
  const withFuture = [...season2, { episode_number: 4, air_date: '2026-12-01' }];
  assert.deepEqual(detectCompletionCelebration({ ...base, seasonEpisodes: withFuture, previousSeen: ['2x1', '2x2'], nextSeen: new Set(['2x1', '2x2', '2x3']) }), { kind: 'season', season: 2 });
  // Spéciaux (saison 0) exclus.
  assert.equal(detectCompletionCelebration({ ...base, season: 0, seasonEpisodes: [{ episode_number: 1, air_date: '2020-01-01' }], previousSeen: [], nextSeen: new Set(['0x1']) }), null);
});

test('#436 final absolu : série terminée seulement si plus rien à voir et série finie', () => {
  const previousSeen = ['2x1', '2x2'];
  const nextSeen = new Set([...previousSeen, '2x3']);
  assert.deepEqual(detectCompletionCelebration({ ...base, previousSeen, nextSeen, nextEpisodeToWatch: null, seriesEnded: true }), { kind: 'series' });
  // Plus rien à voir mais la série continue : fin de saison seulement.
  assert.deepEqual(detectCompletionCelebration({ ...base, previousSeen, nextSeen, nextEpisodeToWatch: null, seriesEnded: false }), { kind: 'season', season: 2 });
});

test('#436 textes, store et branchement sur le marquage individuel uniquement', () => {
  const store = useCelebrationStore.getState();
  store.celebrate(null, 'Rien');
  assert.equal(useCelebrationStore.getState().current, null);
  store.celebrate({ kind: 'season', season: 2 }, 'MobLand');
  const entry = useCelebrationStore.getState().current!;
  assert.deepEqual(celebrationCopy(entry).heading, 'Saison 2 terminée !');
  assert.equal(celebrationCopy({ ...entry, celebration: { kind: 'series' } }).heading, 'Série terminée !');
  useCelebrationStore.getState().dismiss();
  assert.equal(useCelebrationStore.getState().current, null);

  const core = readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8');
  const toggleEpisode = core.slice(core.indexOf('const toggleEpisodeSeen'), core.indexOf('const toggleSeasonSeen'));
  const toggleSeason = core.slice(core.indexOf('const toggleSeasonSeen'), core.indexOf('const toggleSeasonSeen') + 4000);
  assert.match(toggleEpisode, /useCelebrationStore\.getState\(\)\.celebrate\(detectCompletionCelebration\(\{ season, wasSeen,/);
  assert.doesNotMatch(toggleSeason, /celebrate/, 'l’action de masse ne célèbre pas');
  assert.match(readFileSync('src/App.tsx', 'utf8'), /<CompletionCelebration \/>/);
  const popup = readFileSync('src/components/CompletionCelebration.tsx', 'utf8');
  assert.match(popup, /motion-safe:animate-in/, 'animation coupée par prefers-reduced-motion');
  assert.match(popup, /aria-label="Fermer la célébration"/);
});
