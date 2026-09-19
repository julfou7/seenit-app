import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getProfileAvatarUrl, getProfileInitials } from '../src/features/profile/profileAvatar.ts';

const profileSource = readFileSync('src/screens/ProfileScreen.tsx', 'utf8').replace(/\r\n/g, '\n');
const loginSource = readFileSync('src/screens/LoginScreen.tsx', 'utf8').replace(/\r\n/g, '\n');
const nativeAuthSource = readFileSync('android/app/src/main/java/com/seenit/app/SeenItAuthPlugin.kt', 'utf8').replace(/\r\n/g, '\n');

test('issue #421 génère un fallback avatar local déterministe', () => {
  assert.equal(getProfileInitials('Julian Fouillade', 'julian@example.com'), 'JF');
  assert.equal(getProfileInitials('Julian', 'julian@example.com'), 'J');
  assert.equal(getProfileInitials(null, 'julian@example.com'), 'J');
  assert.equal(getProfileInitials(null, null), '?');
});

test('issue #421 résout aussi la photo Google exposée dans providerData', () => {
  assert.equal(getProfileAvatarUrl({
    photoURL: null,
    providerData: [
      { providerId: 'password', photoURL: null },
      { providerId: 'google.com', photoURL: ' https://lh3.googleusercontent.com/avatar ' },
    ],
  }), 'https://lh3.googleusercontent.com/avatar');
  assert.equal(getProfileAvatarUrl({
    photoURL: ' https://example.com/direct.jpg ',
    providerData: [{ providerId: 'google.com', photoURL: 'https://example.com/provider.jpg' }],
  }), 'https://example.com/direct.jpg');
  assert.equal(getProfileAvatarUrl({ photoURL: null, providerData: [] }), null);
});

test('issue #421 ne laisse jamais une URL de fallback distante afficher une image cassée', () => {
  assert.doesNotMatch(profileSource, /images\.unsplash\.com/);
  assert.match(profileSource, /onError=\{\(\) => setAvatarLoadFailed\(true\)\}/);
  assert.match(profileSource, /getProfileAvatarUrl\(user\)/);
  assert.match(profileSource, /\[user\?\.uid, avatarUrl\]/);
  assert.match(profileSource, /avatarUrl && !avatarLoadFailed/);
  assert.match(profileSource, /\{avatarInitials\}/);
});

test('issue #421 conserve les métadonnées photo du Credential Manager jusqu’au profil Firebase', () => {
  assert.match(nativeAuthSource, /googleCredential\.profilePictureUri/);
  assert.match(nativeAuthSource, /result\.put\("photoURL", it\)/);
  assert.match(nativeAuthSource, /googleCredential\.displayName/);
  assert.match(loginSource, /nativeCredential\.photoURL/);
  assert.match(loginSource, /await updateProfile\(firebaseCredential\.user, profileUpdate\)/);
});
