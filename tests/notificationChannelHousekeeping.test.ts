import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planChannelHousekeeping } from '../src/features/notifications/notificationChannels.ts';

// Demande du 15/11 : « Default » et « Miscellaneous » n'avaient aucun sens dans les catégories Android de SeenIt.
test('ménage des catégories : Miscellaneous supprimée, Default renommée Autres en gardant son importance', () => {
  const plan = planChannelHousekeeping([
    { id: 'default', name: 'Default', importance: 2 },
    { id: 'fcm_fallback_notification_channel', name: 'Miscellaneous', importance: 3 },
    { id: 'seenit_app', name: 'Application', importance: 2 },
  ]);
  assert.deepEqual(plan.remove, ['fcm_fallback_notification_channel']);
  assert.deepEqual(plan.rename, [{ id: 'default', name: 'Autres', importance: 2, description: 'Notifications sans catégorie dédiée' }]);
  assert.deepEqual(planChannelHousekeeping([{ id: 'default', name: 'Autres', importance: 1 }]), { remove: [], rename: [] }, 'déjà fait : rien');
  assert.deepEqual(planChannelHousekeeping([{ id: 'seenit_app', name: 'Application', importance: 2 }]), { remove: [], rename: [] }, 'catégories SeenIt jamais touchées');

  const source = readFileSync('src/features/notifications/notificationChannels.ts', 'utf8');
  assert.match(source, /for \(const id of housekeeping\.remove\) await LocalNotifications\.deleteChannel\(\{ id \}\)\.catch\(\(\) => undefined\);/);
  assert.match(source, /for \(const channel of housekeeping\.rename\) await LocalNotifications\.createChannel\(channel\)\.catch\(\(\) => undefined\);/);
});
