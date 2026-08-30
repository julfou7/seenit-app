import test from 'node:test';
import assert from 'node:assert/strict';
import { extractQbitSessionCookie, isQbitAuthError } from '../src/features/downloads/qbitNativeSession.ts';

test('extrait le SID qBittorrent depuis Set-Cookie natif', () => {
  assert.equal(
    extractQbitSessionCookie({ 'Set-Cookie': 'SID=abc123; HttpOnly; path=/' }),
    'SID=abc123'
  );
  assert.equal(
    extractQbitSessionCookie({ 'set-cookie': ['SID=xyz789; path=/', 'foo=bar'] }),
    'SID=xyz789'
  );
});

test('reconnaît uniquement les erreurs nécessitant un relogin qBittorrent', () => {
  assert.equal(isQbitAuthError(new Error('Accès refusé (403)')), true);
  assert.equal(isQbitAuthError(new Error('qBittorrent HTTP 401')), true);
  assert.equal(isQbitAuthError(new Error('Erreur HTTP 500')), false);
});
