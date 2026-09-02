import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('SEENIT-QUALITY-007 retire toute synchronisation Git embarquée du runtime SeenIt', () => {
  const server = readFileSync('server.ts', 'utf8');
  const settings = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
  const envExample = readFileSync('.env.example', 'utf8');

  assert.doesNotMatch(server, /\/api\/git\//);
  assert.doesNotMatch(server, /scripts\/pull\.sh/);
  assert.doesNotMatch(settings, /\/api\/git\//);
  assert.doesNotMatch(settings, /Pull depuis GitHub|Code GitHub \(Git Pull\)/);
  assert.doesNotMatch(envExample, /SEENIT_ADMIN_UIDS/);
  assert.equal(existsSync('scripts/pull.sh'), false);
  assert.equal(existsSync('src/features/admin/gitAdminPolicy.ts'), false);
});
