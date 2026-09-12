import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dedupeFavoritePeople,
  favoritePeopleCollectionPath,
  mergeFavoritePeopleForDisplay,
  selectLocalFavoritesToMigrate,
} from '../src/store/favoritePeopleSync.ts';

const localPeople = [
  { id: 10, name: 'Local A' },
  { id: 20, name: 'Local B' },
];

test('isole strictement la collection Firestore par UID', () => {
  assert.deepEqual(favoritePeopleCollectionPath('user-a'), ['users', 'user-a', 'favoritePeople']);
  assert.deepEqual(favoritePeopleCollectionPath('user-b'), ['users', 'user-b', 'favoritePeople']);
  assert.notDeepEqual(favoritePeopleCollectionPath('user-a'), favoritePeopleCollectionPath('user-b'));
  assert.throws(() => favoritePeopleCollectionPath(''), /UID requis/);
});

test('déduplique exclusivement par ID TMDB et jamais par nom', () => {
  const people = dedupeFavoritePeople([
    { id: 10, name: 'Même nom' },
    { id: 20, name: 'Même nom' },
    { id: 10, name: 'Nom actualisé' },
  ]);

  assert.deepEqual(people, [
    { id: 10, name: 'Nom actualisé' },
    { id: 20, name: 'Même nom' },
  ]);
});

test('migration idempotente: seuls les IDs absents du cloud sont importés', () => {
  const candidates = selectLocalFavoritesToMigrate(localPeople, [10, 30]);
  assert.deepEqual(candidates, [{ id: 20, name: 'Local B' }]);
  assert.deepEqual(selectLocalFavoritesToMigrate(candidates, [10, 20, 30]), []);
});

test('un tombstone cloud gagne sur un ancien favori local concurrent', () => {
  const visible = mergeFavoritePeopleForDisplay(localPeople, [
    { id: 10, data: { id: 10, name: 'Local A', active: false, updatedAt: 2, schemaVersion: 1 } },
  ]);

  assert.deepEqual(visible, [{ id: 20, name: 'Local B' }]);
});

test('fusionne les favoris cloud actifs avec les favoris locaux réellement absents', () => {
  const visible = mergeFavoritePeopleForDisplay(localPeople, [
    { id: 10, data: { id: 10, name: 'Cloud A', active: true, updatedAt: 2, schemaVersion: 1 } },
    { id: 30, data: { id: 30, name: 'Cloud C', active: true, updatedAt: 2, schemaVersion: 1 } },
  ]);

  assert.deepEqual(visible, [
    { id: 10, name: 'Cloud A', profile_path: null, known_for_department: undefined },
    { id: 30, name: 'Cloud C', profile_path: null, known_for_department: undefined },
    { id: 20, name: 'Local B' },
  ]);
});
