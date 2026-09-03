import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('SEENIT-DATA-005 verrouille la base Firestore canonique sur default', () => {
  const client = read('src/lib/firebase.ts');
  const admin = read('src/lib/firebase-admin.ts');
  const workspaceConfig = JSON.parse(read('firebase-applet-config.json'));
  assert.match(client, /export const FIRESTORE_DATABASE_ID = ['"]default['"]/);
  assert.match(client, /initializeFirestore[\s\S]*FIRESTORE_DATABASE_ID\s*\)/);
  assert.equal(client.includes('(default)'), false);
  assert.equal(client.includes('firestoreDatabaseId'), false);
  assert.match(admin, /getFirestore\(['"]default['"]\)/);
  assert.equal(/getFirestore\(\s*\)/.test(admin), false);
  assert.equal('firestoreDatabaseId' in workspaceConfig, false);
});

test('SEENIT-DATA-006 protège default contre une suppression accidentelle', () => {
  const agents = read('AGENTS.md');
  const specification = read('docs/specifications/seenit.md');
  const workflow = read('.github/workflows/build-apk.yml');
  const scripts = fs.readdirSync('scripts')
    .filter(name => name.endsWith('.cjs') || name.endsWith('.sh'))
    .map(name => read(`scripts/${name}`))
    .join('\n');
  assert.match(agents, /Delete Protection[^\n]*activée/i);
  assert.match(specification, /SEENIT-DATA-006[\s\S]*Delete Protection activée/);
  assert.equal(/--no-delete-protection|DELETE_PROTECTION_DISABLED/.test(`${workflow}\n${scripts}`), false);
});

test('SEENIT-APK-004 protège l’identité Firebase Android canonique générée', () => {
  execFileSync(process.execPath, ['scripts/materialize-android-config.cjs']);
  const contract = JSON.parse(read('docs/specifications/android-contract.json'));
  const googleServices = JSON.parse(read('android/app/google-services.json'));
  const gitignore = read('.gitignore');
  assert.match(gitignore, /android\/app\/google-services\.json/);
  assert.ok(contract.generatedFiles.includes('android/app/google-services.json'));
  assert.equal(contract.requiredFiles.includes('android/app/google-services.json'), false);
  assert.equal(googleServices.project_info.project_id, contract.firebase.projectId);
  const client = googleServices.client.find((item: any) =>
    item?.client_info?.android_client_info?.package_name === contract.firebase.androidPackageName
  );
  assert.ok(client, 'le client Firebase Android SeenIt doit être matérialisé');
  assert.equal(client.client_info.mobilesdk_app_id, contract.firebase.androidMobileSdkAppId);

  assert.equal(contract.firebase.androidOauthClients.length, 1);
  const [active] = contract.firebase.androidOauthClients;
  assert.equal(active.role, 'active');
  assert.equal(active.clientId, contract.firebase.activeAndroidOauthClientId);
  assert.equal(active.certificateHash, contract.firebase.activeAndroidCertificateHash);

  const androidOauth = client.oauth_client.filter((item: any) => item.client_type === 1);
  assert.equal(androidOauth.length, 1);
  assert.equal(androidOauth[0].client_id, active.clientId);
  assert.equal(androidOauth[0].android_info?.certificate_hash, active.certificateHash);
  assert.equal(androidOauth[0].android_info?.package_name, contract.firebase.androidPackageName);
  assert.equal(contract.firebase.androidOauthClients.some((item: any) => item.role !== 'active'), false);
  assert.ok(client.oauth_client.some((item: any) =>
    item.client_type === 3 && item.client_id === contract.firebase.webOauthClientId
  ));
});

test('SEENIT-QUALITY-005 traite AI Studio comme un transport non autoritatif', () => {
  const agents = read('AGENTS.md');
  const bootstrap = read('.agents/AGENTS.md');
  assert.match(agents, /Avant toute modification/);
  assert.match(agents, /AI Studio est un mécanisme de transport/);
  assert.match(agents, /Base Firestore canonique/);
  assert.match(agents, /firebase-applet-config\.json/);
  assert.match(bootstrap, /lire intégralement/);
  assert.match(bootstrap, /conserver l'état GitHub/);
});

test('SEENIT-QUALITY-005 matérialise Firebase Android et répare les droits Gradle', () => {
  execFileSync(process.execPath, ['scripts/materialize-android-config.cjs']);
  const contract = JSON.parse(read('docs/specifications/android-contract.json'));
  const gitignore = read('.gitignore');

  assert.equal(fs.existsSync('android/app/google-services.json'), true, 'google-services.json doit être généré');
  assert.match(gitignore, /android\/app\/seenit-release\.p12/);
  assert.ok(contract.generatedFiles.includes('android/app/seenit-release.p12'));
  assert.equal(contract.requiredFiles.includes('android/app/seenit-release.p12'), false);
  assert.equal(contract.signing.source, 'github-secret');
  assert.equal(contract.signing.secretName, 'SEENIT_ANDROID_RELEASE_KEYSTORE_B64');
  assert.equal(contract.signing.storePasswordSecretName, 'SEENIT_ANDROID_RELEASE_STORE_PASSWORD');
  assert.equal(contract.signing.keyPasswordSecretName, 'SEENIT_ANDROID_RELEASE_KEY_PASSWORD');

  if (process.platform !== 'win32') {
    assert.notEqual(fs.statSync('android/gradlew').mode & 0o111, 0, 'le matérialiseur doit rendre android/gradlew exécutable');
  }
});
