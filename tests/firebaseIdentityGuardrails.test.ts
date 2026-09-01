import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('SEENIT-DATA-005 verrouille la base Firestore canonique sur default', () => {
  const client = read('src/lib/firebase.ts');
  const admin = read('src/lib/firebase-admin.ts');
  assert.match(client, /export const FIRESTORE_DATABASE_ID = ['"]default['"]/);
  assert.match(client, /initializeFirestore[\s\S]*FIRESTORE_DATABASE_ID\s*\)/);
  assert.equal(client.includes('(default)'), false);
  assert.equal(client.includes('firestoreDatabaseId'), false);
  assert.match(admin, /getFirestore\(['"]default['"]\)/);
  assert.equal(/getFirestore\(\s*\)/.test(admin), false);
});
test('SEENIT-APK-004 protège l’identité Firebase Android canonique', () => {
  const contract = JSON.parse(read('docs/specifications/android-contract.json'));
  const googleServices = JSON.parse(read('android/app/google-services.json'));
  assert.equal(contract.firebase.projectId, 'gen-lang-client-0201895414');
  assert.equal(contract.firebase.firestoreDatabaseId, 'default');
  assert.equal(contract.firebase.androidPackageName, 'com.seenit.app');
  assert.equal(googleServices.project_info.project_id, contract.firebase.projectId);
  const client = googleServices.client.find((item: any) => item?.client_info?.android_client_info?.package_name === contract.firebase.androidPackageName);
  assert.ok(client, 'le client Firebase Android SeenIt doit exister');
  assert.equal(client.client_info.mobilesdk_app_id, contract.firebase.androidMobileSdkAppId);
});

test('SEENIT-QUALITY-005 traite AI Studio comme un transport non autoritatif', () => {
  const agents = read('AGENTS.md');
  const bootstrap = read('.agents/AGENTS.md');
  assert.match(agents, /Première action obligatoire/);
  assert.match(agents, /transport non autoritatif/);
  assert.match(agents, /Base Firestore canonique/);
  assert.match(agents, /firebase-applet-config\.json/);
  assert.match(bootstrap, /lire intégralement/);
  assert.match(bootstrap, /conserver l'état GitHub/);
});
