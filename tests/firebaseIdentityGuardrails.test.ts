import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const firebaseClient = readFileSync('src/lib/firebase.ts', 'utf8');
const firebaseAdmin = readFileSync('src/lib/firebase-admin.ts', 'utf8');
const appletConfig = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
const googleServices = JSON.parse(readFileSync('android/app/google-services.json', 'utf8'));
const androidContract = JSON.parse(readFileSync('docs/specifications/android-contract.json', 'utf8'));
const agentRules = readFileSync('AGENTS.md', 'utf8');
const agentBootstrap = readFileSync('.agents/AGENTS.md', 'utf8');

const canonicalProjectId = 'gen-lang-client-0201895414';
const canonicalDatabaseId = 'default';
const canonicalPackageName = 'com.seenit.app';
const canonicalAndroidAppId = '1:799043440232:android:729435c4ab36bc039275dd';

test('SEENIT-DATA-005 verrouille Firestore sur la base default sans suivre les métadonnées AI Studio', () => {
  assert.match(firebaseClient, /FIRESTORE_DATABASE_ID\s*=\s*['"]default['"]/);
  assert.match(firebaseClient, /initializeFirestore[\s\S]+FIRESTORE_DATABASE_ID/);
  assert.doesNotMatch(firebaseClient, /firestoreDatabaseId/);
  assert.doesNotMatch(firebaseClient, /['"]\(default\)['"]/);

  assert.match(firebaseAdmin, /getFirestore\(\s*['"]default['"]\s*\)/);
  assert.doesNotMatch(firebaseAdmin, /getFirestore\(\s*\)/);
  assert.doesNotMatch(firebaseAdmin, /firestoreDatabaseId/);
  assert.doesNotMatch(firebaseAdmin, /['"]\(default\)['"]/);

  assert.equal(appletConfig.firestoreDatabaseId, 'ai-studio-seenit-05204624-d504-4df8-a680-ef24c8c05fcd');
  assert.notEqual(appletConfig.firestoreDatabaseId, canonicalDatabaseId,
    'Le test doit prouver que la métadonnée AI Studio diffère bien de la base canonique SeenIt.');
  assert.equal(androidContract.firebase.firestoreDatabaseId, canonicalDatabaseId);
});

test('SEENIT-APK-004 verrouille l’identité Firebase Android et google-services.json', () => {
  assert.equal(androidContract.firebase.projectId, canonicalProjectId);
  assert.equal(androidContract.firebase.androidPackageName, canonicalPackageName);
  assert.equal(androidContract.firebase.androidAppId, canonicalAndroidAppId);
  assert.ok(androidContract.requiredFiles.includes('android/app/google-services.json'));

  assert.equal(googleServices.project_info.project_id, canonicalProjectId);
  const client = googleServices.client.find((entry: any) =>
    entry?.client_info?.android_client_info?.package_name === canonicalPackageName
  );
  assert.ok(client, 'Le client Android SeenIt doit exister dans google-services.json.');
  assert.equal(client.client_info.mobilesdk_app_id, canonicalAndroidAppId);
});

test('SEENIT-QUALITY-005 traite l’import et la synchronisation AI Studio comme un transport non autoritatif', () => {
  assert.match(agentRules, /Première action obligatoire/);
  assert.match(agentRules, /Lisez ce fichier intégralement avant toute autre action/);
  assert.match(agentRules, /Import et synchronisation AI Studio — transport non autoritatif/);
  assert.match(agentRules, /Base Firestore canonique\s*:\s*`default`/);
  assert.match(agentRules, /firestoreDatabaseId[\s\S]+n'est pas la source de vérité/);
  assert.match(agentRules, /google-services\.json[\s\S]+Ne le supprimez/);
  assert.match(agentBootstrap, /lire intégralement.*AGENTS\.md/s);
  assert.match(agentBootstrap, /source de vérité.*AGENTS\.md/s);
});
