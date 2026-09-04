import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/store/parentalRatingStore.ts', 'utf8');

test('SEENIT-PARENTAL-001 synchronise les choix personnels sous le même UID Firestore', () => {
  assert.match(source, /doc\(db, 'users', uid, 'settings', 'preferences'\)/);
  assert.match(source, /parentalRatingOverrides/);
  assert.match(source, /onSnapshot\(preferencesRef/);
  assert.match(source, /auth\.currentUser\?\.uid !== uid/);
  assert.match(source, /parentalRatingKey\(mediaType, tmdbId\)/);
  assert.match(source, /readUserScopedJson<ParentalRatingOverrides>\(uid/);
  assert.match(source, /writeUserScopedJson\(uid/);
  assert.doesNotMatch(source, /title|originalTitle|release_date|firstAirDate/,
    'la persistance d’un override ne doit jamais utiliser titre ou année comme identité');
});
