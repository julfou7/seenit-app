import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getProfileInitials } from '../src/features/profile/profileAvatar.ts';

const profileSource = readFileSync('src/screens/ProfileScreen.tsx', 'utf8').replace(/\r\n/g, '\n');

test('issue #421 génère un fallback avatar local déterministe', () => {
  assert.equal(getProfileInitials('Julian Fouillade', 'julian@example.com'), 'JF');
  assert.equal(getProfileInitials('Julian', 'julian@example.com'), 'J');
  assert.equal(getProfileInitials(null, 'julian@example.com'), 'J');
  assert.equal(getProfileInitials(null, null), '?');
});

test('issue #421 ne laisse jamais une URL de fallback distante afficher une image cassée', () => {
  assert.doesNotMatch(profileSource, /images\.unsplash\.com/);
  assert.match(profileSource, /onError=\{\(\) => setAvatarLoadFailed\(true\)\}/);
  assert.match(profileSource, /\[user\?\.uid, user\?\.photoURL\]/);
  assert.match(profileSource, /avatarUrl && !avatarLoadFailed/);
  assert.match(profileSource, /\{avatarInitials\}/);
});
