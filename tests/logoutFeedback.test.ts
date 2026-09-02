import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
const start = source.indexOf('const handleLogout = async () => {');
const end = source.indexOf('const triggerTestNotif', start);
const handler = source.slice(start, end);

test('la déconnexion affiche immédiatement un feedback avant les opérations asynchrones', () => {
  const toast = handler.indexOf('showToast(\"Déconnexion en cours...\", \"info\")');
  const revoke = handler.indexOf('await revokeCurrentDeviceNotifications()');
  const signout = handler.indexOf('await signOut(auth)');

  assert.ok(toast >= 0, 'le toast de déconnexion doit être présent');
  assert.ok(revoke > toast, 'le toast doit précéder la révocation des notifications');
  assert.ok(signout > toast, 'le toast doit précéder signOut');
});
