import test from 'node:test';
import assert from 'node:assert/strict';
import { getUserLogStorageKey, sanitizeLogDetails } from '../src/features/logging/logPrivacy.ts';

test('SEENIT-DATA-003 isole les journaux techniques par UID sur chaque appareil', () => {
  assert.notEqual(getUserLogStorageKey('uid-a'), getUserLogStorageKey('uid-b'));
  assert.throws(() => getUserLogStorageKey(''));
});

test('SEENIT-SECURITY-003 masque les secrets avant de persister un journal', () => {
  const sanitized = sanitizeLogDetails({
    authorization: 'Bearer secret-token',
    nested: { apiKey: 'super-secret', url: 'https://example.test/?token=abc&ok=1' },
    message: 'X-Plex-Token: plex-secret'
  }) as any;
  assert.equal(sanitized.authorization, '[MASQUÉ]');
  assert.equal(sanitized.nested.apiKey, '[MASQUÉ]');
  assert.match(sanitized.nested.url, /token=\[MASQUÉ\]/);
  assert.doesNotMatch(JSON.stringify(sanitized), /secret-token|super-secret|plex-secret|token=abc/);
});
