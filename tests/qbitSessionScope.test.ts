import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQbitSessionScopeKey } from '../src/features/downloads/qbitSessionScope.ts';

test('la session qBittorrent est distincte par UID URL et utilisateur', () => {
  const base = buildQbitSessionScopeKey('uid-a', 'HTTPS://QBIT.EXAMPLE/', 'Julia');
  assert.equal(base, buildQbitSessionScopeKey('uid-a', 'https://qbit.example', 'julia'));
  assert.notEqual(base, buildQbitSessionScopeKey('uid-b', 'https://qbit.example', 'julia'));
  assert.notEqual(base, buildQbitSessionScopeKey('uid-a', 'https://qbit-2.example', 'julia'));
  assert.notEqual(base, buildQbitSessionScopeKey('uid-a', 'https://qbit.example', 'rudy'));
});
