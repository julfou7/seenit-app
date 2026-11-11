import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { seriesAirStatus } from '../src/features/shows/seriesAirStatus.ts';
import { createMediaDetailRenderSnapshot } from '../src/features/shows/mediaDetailRenderSnapshot.ts';

const NOW = new Date(2026, 10, 11, 12).getTime();

test('SEENIT-UX-023 statut réel de diffusion : en diffusion, renouvelée, en cours, terminée, annulée', () => {
  assert.deepEqual(seriesAirStatus({ status: 'Ended' }, NOW), { label: 'Terminée', tone: 'ended', detail: null });
  assert.deepEqual(seriesAirStatus({ status: 'Canceled' }, NOW), { label: 'Annulée', tone: 'canceled', detail: null });
  assert.deepEqual(seriesAirStatus({ status: 'Returning Series', last_episode_to_air: { season_number: 2, air_date: '2026-11-04' }, next_episode_to_air: { season_number: 2, air_date: '2026-11-18' } }, NOW),
    { label: 'En diffusion', tone: 'airing', detail: 'prochain épisode le 18 nov.' });
  assert.deepEqual(seriesAirStatus({ status: 'Returning Series', last_episode_to_air: { season_number: 2, air_date: '2026-03-04' }, next_episode_to_air: { season_number: 3, air_date: '2027-03-12' } }, NOW),
    { label: 'Renouvelée', tone: 'renewed', detail: 'saison 3 le 12 mars 2027' });
  assert.deepEqual(seriesAirStatus({ status: 'Returning Series', next_episode_to_air: null }, NOW), { label: 'En cours', tone: 'ongoing', detail: 'pas de date annoncée' });
  assert.equal(seriesAirStatus({ status: 'In Production' }, NOW)?.label, 'En production');
  assert.equal(seriesAirStatus(null, NOW), null);
});

test('SEENIT-UX-023 la fiche série affiche le statut en pastille et le cache des fiches garde les épisodes diffusés', () => {
  const snapshot = createMediaDetailRenderSnapshot({ id: 7, status: 'Returning Series', last_air_date: '2026-11-04', next_episode_to_air: { air_date: '2026-11-18', season_number: 2, episode_number: 5, overview: 'long' }, last_episode_to_air: { air_date: '2026-11-04', season_number: 2, episode_number: 4 } }, 'tv') as Record<string, unknown>;
  assert.deepEqual(snapshot.next_episode_to_air, { air_date: '2026-11-18', season_number: 2, episode_number: 5 });
  assert.equal(snapshot.last_air_date, '2026-11-04');
  assert.equal(seriesAirStatus(snapshot as never, NOW)?.label, 'En diffusion');
  const view = readFileSync(new URL('../src/screens/ShowDetailView.tsx', import.meta.url), 'utf8');
  assert.match(view, /airStatus && <DetailChip/);
  assert.doesNotMatch(view, /statusText !== 'Terminée'/, 'la fin d’une série n’est plus masquée');
});
