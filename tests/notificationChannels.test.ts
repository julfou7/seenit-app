import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const channels = readFileSync('src/features/notifications/notificationChannels.ts', 'utf8');
const reminder = readFileSync('src/features/notifications/mediaReminderNotification.ts', 'utf8');
const patch = readFileSync('scripts/patch-notification-subtext.cjs', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

test('SEENIT-NOTIFICATION-006 crée les huit canaux de la refonte sans recréer seenit_downloads', () => {
  for (const id of [
    'seenit_episodes',
    'seenit_reminders',
    'seenit_movies',
    'seenit_summary',
    'seenit_plex',
    'seenit_news',
    'seenit_app',
    'seenit_updates',
    'seenit_downloads',
  ]) {
    assert.match(channels, new RegExp(id));
  }

  assert.equal((channels.match(/\{ id: SEENIT_NOTIFICATION_CHANNELS\./g) || []).length, 8);
  assert.doesNotMatch(channels, /\{ id: SEENIT_NOTIFICATION_CHANNELS\.downloads/);
  assert.match(channels, /listChannels\(\)/);
  assert.match(channels, /if \(!ids\.has\(channel\.id\)\)/);
  assert.match(channels, /importance: 4/);
  assert.match(channels, /importance: 3/);
  assert.match(channels, /importance: 2/);
});

// #909 (retour terrain du 08/11 : « pour les notifs de release, mon téléphone ne vibre pas, rien ») : la nouvelle
// version partait sur `seenit_app`, en importance basse (silencieuse) ; Android interdit de relever l'importance
// d'un canal existant, d'où un canal dédié en importance haute.
test('SEENIT-NOTIFICATION-006 #909 la nouvelle version sonne et vibre : canal dédié en importance haute, partout', async () => {
  assert.match(channels, /\{ id: SEENIT_NOTIFICATION_CHANNELS\.updates, name: 'Mises à jour de SeenIt', description: 'Nouvelle version disponible ou téléchargée', importance: 4, vibration: true \}/);
  assert.match(channels, /\{ id: SEENIT_NOTIFICATION_CHANNELS\.app, name: 'Application', importance: 2 \}/, 'seenit_app reste tel quel : ses réglages utilisateur sont conservés');
  const { buildReleaseUpdatePushMessage } = await import('../src/features/release/releaseUpdatePushCore.ts');
  const message = buildReleaseUpdatePushMessage('1.4.278');
  assert.equal(message.android.notification.channelId, 'seenit_updates', 'message serveur de nouvelle version');
  assert.equal(message.android.priority, 'high');
  assert.match(readFileSync('src/features/release/updateDownloadNotification.ts', 'utf8'), /channelId: 'seenit_updates',/, 'mise à jour téléchargée et vérifiée');
  assert.match(readFileSync('src/screens/SettingsScreenCore.tsx', 'utf8'), /\{ channelId: 'seenit_updates', icon: Package, label: 'Mise à jour de SeenIt'/, 'les Réglages ouvrent ce canal');
});

test('SEENIT-NOTIFICATION-005 transporte le type via subText et garde summaryText au détail BigPicture', () => {
  assert.match(reminder, /subText: options\.summaryText/);
  assert.match(reminder, /summaryText: attachments && detailText \? detailText : undefined/);
  assert.match(reminder, /channelId: resolveChannelId\(options\)/);
  assert.match(reminder, /smallIcon: 'ic_stat_seenit'/);
  assert.match(reminder, /'✓ Vu'/);
});

test('SEENIT-NOTIFICATION-005 patch Capacitor Kotlin est idempotent et branché au postinstall', () => {
  assert.match(patch, /LocalNotification\.kt/);
  assert.match(patch, /LocalNotificationManager\.kt/);
  assert.match(patch, /SEENIT_NOTIFICATION_SUBTEXT_PATCH/);
  assert.match(patch, /var subText: String\? = null/);
  assert.match(patch, /setSubText\(localNotification\.subText\)/);
  assert.match(packageJson.scripts.postinstall, /patch-local-notifications\.cjs/);
  assert.match(packageJson.scripts.postinstall, /patch-notification-subtext\.cjs/);
});
