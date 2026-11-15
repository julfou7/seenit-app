import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNewsNotificationVisual } from '../src/features/notifications/newsNotificationVisual.ts';

// Retour terrain du 15/11 : « Loups garous · Actualité » développée montrait l'affiche entre deux bandes noires
// et perdait le texte « La saison 3 a été annoncée… ».
test('SEENIT-NOTIFICATION-003 actualité : image paysage en grand, affiche en vignette, repli affiche', () => {
  assert.deepEqual(buildNewsNotificationVisual('/loups.jpg', '/loups-large.jpg'), {
    icon: 'https://image.tmdb.org/t/p/w342/loups.jpg',
    image: 'https://image.tmdb.org/t/p/w780/loups-large.jpg',
  });
  assert.deepEqual(buildNewsNotificationVisual('/loups.jpg', null), { icon: 'https://image.tmdb.org/t/p/w342/loups.jpg' }, 'sans paysage : affiche seule (repli contain)');
  assert.deepEqual(buildNewsNotificationVisual(null, undefined), {}, 'sans image : texte seul');
  assert.equal(buildNewsNotificationVisual('https://image.tmdb.org/t/p/w500/a.jpg', null).icon, 'https://image.tmdb.org/t/p/w500/a.jpg');

  const worker = readFileSync('src/hooks/useDetailsSyncWorker.ts', 'utf8');
  assert.match(worker, /buildNewsNotificationVisual\(showToSync\.posterPath, showToSync\.backdropPath \|\| details\.backdrop_path\)/);
  assert.equal((worker.match(/\.\.\.newsVisual,/g) || []).length, 2, 'saison annoncée et série renouvelée');
  assert.doesNotMatch(worker, /notif_\$\{showId\}_news`,\s*icon:/, 'plus d’affiche seule en dur pour l’actualité');

  const reminder = readFileSync('src/features/notifications/mediaReminderNotification.ts', 'utf8');
  assert.match(reminder, /summaryText: attachments \? \(detailText \|\| options\.body \|\| undefined\) : undefined/, 'le corps reste lisible une fois développée');
});
