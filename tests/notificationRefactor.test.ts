import { androidPushPresentation } from '../src/features/notifications/androidPushPresentation.ts';
import { nextTonightReminder } from '../src/features/notifications/tonightReminder.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeNotificationPreferences } from '../src/features/notifications/notificationPreferences.ts';
import { isObsoleteMediaAlert, isSameVisibleMediaAlert } from '../src/features/notifications/notificationLifecycle.ts';
import { buildTvEpisodeReminderCopy } from '../src/features/notifications/tvReminderCopy.ts';
import { buildDownloadWebhookPresentation } from '../src/features/downloads/downloadWebhookNotification.ts';
import type { Show } from '../src/types.ts';

const show: Show = { id: 'tv-42', userId: 'alice', tmdbId: 42, title: 'Une série', mediaType: 'tv',
  posterPath: null, backdropPath: null, status: 'watching', isArchived: false, updatedAt: 0, createdAt: 0,
  seenEpisodes: ['1x1'], episodeRecords: {}, totalAiredEpisodes: 3,
  nextEpisodeToWatch: { season_number: 1, episode_number: 2, name: 'La suite', air_date: '2026-10-27' } };
const released = { season_number: 1, episode_number: 3, name: 'Le dernier', air_date: '2026-10-28' };

test('SEENIT-NOTIFICATION-005 unifie les textes sans emoji ni code répété', () => {
  const episode = buildTvEpisodeReminderCopy(show, released, '2026-10-28');
  const download = buildDownloadWebhookPresentation('sonarr', { eventType: 'Download', series: { title: show.title, tmdbId: 42 },
    episodes: [{ seasonNumber: 0, episodeNumber: 1 }], downloadId: 'transfer-a' });
  assert.equal(episode.summaryText, 'Nouvel épisode');
  assert.match(episode.body, /2 épisodes t’attendent/);
  assert.equal((episode.body.match(/S\d+ \| E\d+/g) || []).length, 1);
  assert.equal(episode.detailText?.split('\n').length, 2);
  assert.equal(download.notification.title, show.title);
  assert.equal(download.notification.body, 'S00 | E01 · Import terminé');
  for (const text of [episode.summaryText, episode.body, episode.detailText, download.notification.body]) {
    assert.doesNotMatch(text || '', /\p{Extended_Pictographic}/u);
  }
});

test('SEENIT-NOTIFICATION-006 fusionne les préférences sans écraser les choix', () => {
  assert.equal(mergeNotificationPreferences(null).news, false);
  assert.equal(mergeNotificationPreferences({ release_today_tv: false }).release_today_tv, false);
  assert.equal(mergeNotificationPreferences({ release_today_tv: false }).news, true);
  assert.equal(mergeNotificationPreferences({ news: false }).news, false);
  assert.equal(mergeNotificationPreferences({ movie_theater: 'false' }).movie_theater, true);
  const firebase = readFileSync('src/lib/firebase.ts', 'utf8');
  assert.match(firebase, /void ensureSeenItNotificationChannels\(\)/);
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /default_notification_icon" android:resource="@drawable\/ic_stat_seenit/);
});

test('SEENIT-NOTIFICATION-007 retire seulement les alertes exactes vues ou archivées', () => {
  const alert = { id: 123, extra: { ownerUid: 'alice', notificationScope: 'media', showId: show.id, mediaType: 'tv', season: 1, episode: 1 } };
  assert.equal(isObsoleteMediaAlert(alert, 'alice', [show]), true);
  assert.equal(isObsoleteMediaAlert(alert, 'bob', [show]), false);
  assert.equal(isObsoleteMediaAlert({ ...alert, extra: { ...alert.extra, episode: 2 } }, 'alice', [show]), false);
  assert.equal(isObsoleteMediaAlert({ ...alert, extra: { ...alert.extra, notificationScope: 'download' } }, 'alice', [show]), false);
  assert.equal(isSameVisibleMediaAlert(alert, { ...alert, id: 456, extra: { ...alert.extra, episode: 3 } }), true);
  assert.equal(isSameVisibleMediaAlert(alert, { ...alert, extra: { ...alert.extra, ownerUid: 'bob' } }), false);
  assert.equal(isObsoleteMediaAlert({ ...alert, extra: { ...alert.extra, season: 0, episode: 1 } }, 'alice', [{ ...show, seenEpisodes: ['0x1'] }]), true);
});

test('SEENIT-NOTIFICATION-008 actualise la reprise sans inventer de disponibilité', () => {
  const next = buildTvEpisodeReminderCopy({ ...show, seenEpisodes: ['1x1', '1x2'], nextEpisodeToWatch: released }, released, '2026-10-28');
  assert.match(next.body, /S01 \| E03/);
  assert.doesNotMatch(next.body, /t’attendent/);
  const done = buildTvEpisodeReminderCopy({ ...show, seenEpisodes: ['1x1', '1x2', '1x3'], nextEpisodeToWatch: null }, released, '2026-10-28');
  assert.match(done.body, /^À jour/);
  assert.doesNotMatch(done.body, /Netflix|Plex|min/);
  const source = readFileSync('src/App.tsx', 'utf8');
  assert.match(source, /markEpisodeWatched[\s\S]*?then\(async success/);
  assert.match(source, /notificationId: data.notificationId/);
  assert.match(source, /silent: true/);
});

test('#778 la déduplication native arrive à la livraison et ne transporte pas de bitmap', () => {
  const source = readFileSync('scripts/patch-notification-subtext.cjs', 'utf8');
  assert.match(source, /activeNotifications.take\(100\)/);
  assert.match(source, /seenitOwner/);
  assert.match(source, /seenitMediaType/);
  assert.match(source, /publisher.replace\(anchor, dedupCode/);
  assert.match(source, /setSilent\(true\)/);
  assert.doesNotMatch(source, /Base64|BitmapFactory|data:image/);
});

test('#778 Ce soir garde 20:30 local et passe au lendemain si cette heure est atteinte', () => {
  const before = nextTonightReminder(new Date(2026, 9, 28, 19, 15));
  assert.equal(before.getDate(), 28); assert.equal(before.getHours(), 20); assert.equal(before.getMinutes(), 30);
  const after = nextTonightReminder(new Date(2026, 9, 28, 20, 30));
  assert.equal(after.getDate(), 29); assert.equal(after.getHours(), 20); assert.equal(after.getMinutes(), 30);
});

test('#778 les reçus de demandes distinctes gardent leur canal et des identités distinctes', () => {
  const a = androidPushPresentation('alice', { type: 'DOWNLOAD_EVENT', eventKey: 'sonarr:transfer-a:s0e1' });
  assert.equal(a.channelId, 'seenit_downloads');
  assert.equal(a.icon, 'ic_stat_seenit');
  assert.equal(a.tag, androidPushPresentation('alice', { type: 'DOWNLOAD_EVENT', eventKey: 'sonarr:transfer-a:s0e1' }).tag);
  assert.notEqual(a.tag, androidPushPresentation('alice', { type: 'DOWNLOAD_EVENT', eventKey: 'sonarr:transfer-a:s0e2' }).tag);
  assert.notEqual(a.tag, androidPushPresentation('bob', { type: 'DOWNLOAD_EVENT', eventKey: 'sonarr:transfer-a:s0e1' }).tag);
});

test('#778 Grab porte le média et le scope exacts sans prétendre à un transfert démarré', () => {
  const event = buildDownloadWebhookPresentation('sonarr', { eventType: 'Grab', series: { title: 'Une série', tmdbId: 42 },
    downloadId: 'download-a', episodes: [{ seasonNumber: 0, episodeNumber: 2 }] });
  assert.equal(event.data.tmdbId, '42'); assert.equal(event.data.season, '0'); assert.equal(event.data.episode, '2');
  assert.equal(event.notification.body, 'Envoyé au client de téléchargement.');
  assert.equal(event.plexAvailabilityData, null);
});
