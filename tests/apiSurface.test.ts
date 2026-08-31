import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('SEENIT-SECURITY-002 le diagnostic Git exige une session SeenIt et passe par le transport APK', () => {
  const server = readFileSync('server.ts', 'utf8');
  const settings = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
  assert.match(server, /app\.get\('\/api\/git\/status', requireAuth/);
  assert.match(server, /app\.post\('\/api\/git\/pull', requireAuth/);
  assert.match(settings, /authenticatedFetch\('\/api\/git\/status'\)/);
  assert.match(settings, /authenticatedFetch\('\/api\/git\/pull'/);
});
