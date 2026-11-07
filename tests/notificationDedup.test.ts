import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { receivedEpisode, releaseReminderAlreadyReceived } from '../src/features/notifications/notificationDedup.ts';

const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10);
const at = (date: string) => Date.parse(`${date}T09:00:00Z`);

test('Retour terrain 07/11 : un rappel de sortie déjà reçu n’apparaît pas une seconde fois', () => {
  const e08 = { season_number: 2, episode_number: 8 };
  // Cas MobLand : la notification native de S02E08 a été reçue → le rappel calculé ne s'ajoute pas.
  assert.equal(releaseReminderAlreadyReceived(e08, [{ data: { season: 2, episode: 8 }, receivedAt: at('2026-11-06') }], '2026-11-07', dayOf), true);
  // Un autre épisode reçu ne masque pas le rappel de E08.
  assert.equal(releaseReminderAlreadyReceived(e08, [{ data: { season: 2, episode: 7 }, receivedAt: at('2026-11-07') }], '2026-11-07', dayOf), false);
  // Sans numéro d'épisode : seule une notification du même jour vaut.
  assert.equal(releaseReminderAlreadyReceived(e08, [{ data: {}, receivedAt: at('2026-11-07') }], '2026-11-07', dayOf), true);
  assert.equal(releaseReminderAlreadyReceived(e08, [{ data: {}, receivedAt: at('2026-11-05') }], '2026-11-07', dayOf), false);
  assert.equal(releaseReminderAlreadyReceived(e08, [], '2026-11-07', dayOf), false);
  assert.deepEqual(receivedEpisode({ data: { season: '2', episode: '8' }, receivedAt: 0 }), { season: 2, episode: 8 });
  // Avec du retard : le rappel de S02E08 vise S02E07 à reprendre ; la sortie annoncée fait foi (constat Codex #892).
  const late = { data: { season: 2, episode: 7, releasedSeason: 2, releasedEpisode: 8 }, receivedAt: at('2026-11-06') };
  assert.deepEqual(receivedEpisode(late), { season: 2, episode: 8 });
  assert.equal(releaseReminderAlreadyReceived(e08, [late], '2026-11-07', dayOf), true);
  const inbox = readFileSync('src/features/notifications/notificationInbox.ts', 'utf8');
  assert.match(inbox, /'releasedSeason','releasedEpisode'/, 'la boîte de réception conserve la sortie annoncée');
  assert.equal(receivedEpisode({ data: { season: 2 }, receivedAt: 0 }), undefined);
});

test('Retour terrain 07/11 : une notification d’épisode montre l’image de cet épisode', () => {
  const list = readFileSync('src/components/HomeNotifications.tsx', 'utf8');
  const page = readFileSync('src/components/HomeNotificationsPage.tsx', 'utf8');
  assert.match(list, /if \(upcoming && show\.notificationsEnabled && upcoming\.air_date === today && !alreadyReceived\)/);
  assert.match(list, /episode: show\.mediaType === 'tv' \? receivedEpisode\(item\) : undefined/);
  // Image d'épisode TMDB en priorité, visuel de la série en repli.
  assert.match(page, /return still \|\| notice\.show\?\.backdropPath \|\| notice\.show\?\.posterPath \|\| null;/);
  assert.match(page, /tmdb\.getSeasonDetails\(tmdbId, season\)/);
});
