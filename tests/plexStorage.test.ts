import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activatePlexUserScope,
  getPlexLastSyncTimestamp,
  getStoredPlexToken,
  setPlexLastSyncTimestamp,
  storePlexCredentials
} from '../src/features/plex/plexStorage.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

test.beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
});

test('isole le jeton et le curseur Plex par UID SeenIt', () => {
  activatePlexUserScope('user-a');
  storePlexCredentials('user-a', 'token-a');
  setPlexLastSyncTimestamp('user-a', 1000);

  assert.equal(activatePlexUserScope('user-a'), false);

  assert.equal(getStoredPlexToken('user-a'), 'token-a');
  assert.equal(getStoredPlexToken('user-b'), null);
  assert.equal(getPlexLastSyncTimestamp('user-a'), 1000);
  assert.equal(getPlexLastSyncTimestamp('user-b'), undefined);
});

test("purge le jeton Plex précédent lors d'un changement de compte", () => {
  activatePlexUserScope('user-a');
  storePlexCredentials('user-a', 'token-a');
  localStorage.setItem('plex_auth_token', 'legacy-token');

  assert.equal(activatePlexUserScope('user-b'), true);
  assert.equal(getStoredPlexToken('user-a'), null);
  assert.equal(getStoredPlexToken('user-b'), null);
  assert.equal(localStorage.getItem('plex_auth_token'), null);
});
