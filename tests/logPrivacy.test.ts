import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('SEENIT-UX-004 les journaux Plex visibles normalisent les anciens libellés vers non vu', () => {
  const logStoreSource = fs.readFileSync(new URL('../src/store/logStore.ts', import.meta.url), 'utf8');
  assert.match(logStoreSource, /category === 'plex' \? normalizePlexNonVuWording\(value\) : value/);
  assert.match(logStoreSource, /message:\s*String\(sanitizeLogDetails\(normalizeVisibleLogMessage\(category, message\)\)\)/);
  assert.match(logStoreSource, /message:\s*normalizeVisibleLogMessage\(entry\.category, entry\.message\)/);
});
