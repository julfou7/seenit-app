import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLibraryStateSignature,
  getUserScopedStorageKey,
  purgeLegacyUnscopedUserData,
  readUserScopedJson,
  writeUserScopedJson
} from '../src/lib/userIsolation.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
}

test.beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage();
});

test('isole strictement chaque cache local par UID', () => {
  writeUserScopedJson('user-a', 'shows_v2', [{ id: 'tv_1' }]);
  writeUserScopedJson('user-b', 'shows_v2', [{ id: 'movie_2' }]);

  assert.deepEqual(readUserScopedJson('user-a', 'shows_v2', []), [{ id: 'tv_1' }]);
  assert.deepEqual(readUserScopedJson('user-b', 'shows_v2', []), [{ id: 'movie_2' }]);
  assert.notEqual(getUserScopedStorageKey('user-a', 'shows_v2'), getUserScopedStorageKey('user-b', 'shows_v2'));
});

test('ne migre jamais un ancien cache utilisateur sans propriétaire prouvé', () => {
  localStorage.setItem('cached_shows_v1', JSON.stringify([{ id: 'inconnu' }]));
  localStorage.setItem('user_platforms', '[8]');
  purgeLegacyUnscopedUserData();

  assert.equal(localStorage.getItem('cached_shows_v1'), null);
  assert.equal(localStorage.getItem('user_platforms'), null);
  assert.deepEqual(readUserScopedJson('user-a', 'shows_v2', []), []);
});

test('préserve les préférences locales quand le dernier UID prouve leur propriétaire', () => {
  localStorage.setItem('last_active_uid', 'user-a');
  localStorage.setItem('user_platforms', '[8,337]');
  localStorage.setItem('favorite-people-storage', JSON.stringify({ state: { people: [{ id: 7, name: 'Actrice' }] } }));

  purgeLegacyUnscopedUserData('user-a');

  assert.deepEqual(readUserScopedJson('user-a', 'platforms', []), [8, 337]);
  assert.deepEqual(readUserScopedJson('user-a', 'favorite_people', []), [{ id: 7, name: 'Actrice' }]);
  assert.deepEqual(readUserScopedJson('user-b', 'platforms', []), []);
});

test('produit la même empreinte quel que soit l’ordre reçu', () => {
  const first = [
    { id: 'tv_2', tmdbId: 2, mediaType: 'tv', seenEpisodes: ['1x2', '1x1'] },
    { id: 'movie_1', tmdbId: 1, mediaType: 'movie', seenEpisodes: [] }
  ];
  const reordered = [
    { id: 'movie_1', tmdbId: 1, mediaType: 'movie', seenEpisodes: [] },
    { id: 'tv_2', tmdbId: 2, mediaType: 'tv', seenEpisodes: ['1x1', '1x2'] }
  ];

  assert.equal(buildLibraryStateSignature(first), buildLibraryStateSignature(reordered));
  assert.notEqual(
    buildLibraryStateSignature(first),
    buildLibraryStateSignature([{ ...first[0], seenEpisodes: ['1x1'] }, first[1]])
  );
  assert.notEqual(
    buildLibraryStateSignature(first),
    buildLibraryStateSignature([{ ...first[0], userRating: 9 }, first[1]])
  );
});
