import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSeenItGitAdmin, parseSeenItAdminUids } from '../src/features/admin/gitAdminPolicy.ts';

test('SEENIT-SECURITY-002 refuse les opérations Git sans allowlist administrateur', () => {
  assert.equal(isSeenItGitAdmin('uid-admin', undefined), false);
  assert.equal(isSeenItGitAdmin('uid-admin', ''), false);
  assert.equal(isSeenItGitAdmin(undefined, 'uid-admin'), false);
});

test('SEENIT-SECURITY-002 compare exactement les UID administrateurs côté serveur', () => {
  const allowlist = parseSeenItAdminUids(' uid-a,uid-b\nuid-c ; uid-d ');
  assert.deepEqual([...allowlist], ['uid-a', 'uid-b', 'uid-c', 'uid-d']);
  assert.equal(isSeenItGitAdmin('uid-b', 'uid-a,uid-b'), true);
  assert.equal(isSeenItGitAdmin('uid', 'uid-admin'), false);
  assert.equal(isSeenItGitAdmin('UID-B', 'uid-b'), false);
});

test('SEENIT-SECURITY-002 protège les routes Git et masque les outils aux non-administrateurs', () => {
  const server = readFileSync('server.ts', 'utf8');
  const settings = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
  assert.match(server, /app\.get\('\/api\/git\/status', requireAuth, requireGitAdmin,/);
  assert.match(server, /app\.post\('\/api\/git\/pull', requireAuth, requireGitAdmin,/);
  assert.match(server, /status\(403\)\.json\(\{ error: "Accès administrateur requis" \}\)/);
  assert.match(settings, /res\.status === 403/);
  assert.match(settings, /gitAccess === 'allowed'/);
  assert.doesNotMatch(settings, /SEENIT_ADMIN_UIDS/);
});
