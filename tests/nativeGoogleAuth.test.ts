import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plugin = readFileSync('android/app/src/main/java/com/seenit/app/SeenItAuthPlugin.kt', 'utf8');
const mainActivity = readFileSync('android/app/src/main/java/com/seenit/app/MainActivity.java', 'utf8');
const appGradle = readFileSync('android/app/build.gradle', 'utf8');
const rootGradle = readFileSync('android/build.gradle', 'utf8');
const login = readFileSync('src/screens/LoginScreen.tsx', 'utf8');
const bridge = readFileSync('src/lib/auth/SeenItAuth.ts', 'utf8');

test('SEENIT-AUTH-001 ouvre le sélecteur Google natif Credential Manager comme ATHIA', () => {
  assert.match(plugin, /@CapacitorPlugin\(name = "SeenItAuth"\)/);
  assert.match(plugin, /CredentialManager\.create\(context\)/);
  assert.match(plugin, /GetGoogleIdOption\.Builder\(\)/);
  assert.match(plugin, /setFilterByAuthorizedAccounts\(false\)/);
  assert.match(plugin, /setAutoSelectEnabled\(false\)/);
  assert.match(plugin, /"default_web_client_id"/);
  assert.match(plugin, /GoogleIdTokenCredential\.createFrom/);
  assert.match(mainActivity, /registerPlugin\(SeenItAuthPlugin\.class\);[\s\S]*super\.onCreate/);
  assert.match(bridge, /registerPlugin<SeenItAuthPlugin>\('SeenItAuth'\)/);
  assert.match(rootGradle, /kotlin-gradle-plugin:2\.1\.21/);
  assert.match(appGradle, /androidx\.credentials:credentials:1\.3\.0/);
  assert.match(appGradle, /credentials-play-services-auth:1\.3\.0/);
  assert.match(appGradle, /identity\.googleid:googleid:1\.1\.1/);
});

test('SEENIT-AUTH-001 conserve le même compte Firebase et un fallback natif propre', () => {
  const primary = login.indexOf('SeenItAuth.signInWithGoogle()');
  const fallback = login.indexOf('GoogleAuth.initialize');
  assert.ok(primary >= 0 && fallback > primary, 'Credential Manager doit être tenté avant l’ancien fallback');
  assert.match(login, /GoogleAuthProvider\.credential\(idToken\)/);
  assert.match(login, /signInWithCredential\(auth, credential\)/);
  assert.match(login, /signInWithPopup\(auth, googleAuthProvider\)/);
});

test('SEENIT-AUTH-001 traite l’annulation Google comme une sortie non bloquante', () => {
  assert.match(plugin, /GetCredentialCancellationException/);
  assert.match(plugin, /AUTH_GOOGLE_CANCELLED/);
  assert.match(login, /if \(isGoogleAuthCancellation\(credentialError\)\) return;/);
  assert.match(login, /if \(isGoogleAuthCancellation\(fallbackError\)\) return;/);
});
