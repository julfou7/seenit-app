import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const envExample = readFileSync('.env.example', 'utf8');
const gitignore = readFileSync('.gitignore', 'utf8');
const seenitConfig = readFileSync('src/config/seenit.ts', 'utf8');
const capacitorConfig = readFileSync('capacitor.config.ts', 'utf8');
const firebaseAdmin = readFileSync('src/lib/firebase-admin.ts', 'utf8');
const seenitApi = readFileSync('src/lib/seenitApi.ts', 'utf8');

test('SEENIT-QUALITY-001 conserve npm comme gestionnaire unique et exclut les artefacts de travail', () => {
  assert.match(packageJson.packageManager, /^npm@/);
  assert.ok(existsSync('package-lock.json'));
  assert.equal(existsSync('bun.lock'), false);
  assert.match(gitignore, /^bun\.lock$/m);
  for (const path of ['github_output.txt', 'notes.txt', 'test.js']) {
    assert.equal(existsSync(path), false, `${path} ne doit pas être suivi`);
  }
});

test('SEENIT-QUALITY-001 utilise un nettoyage Node portable', () => {
  assert.equal(packageJson.scripts.clean, 'node scripts/clean.cjs');
  const cleanScript = readFileSync('scripts/clean.cjs', 'utf8');
  assert.match(cleanScript, /rmSync/);
  assert.doesNotMatch(cleanScript, /rm\s+-rf/);
});

test('SEENIT-NOTIFICATION-001 documente les webhooks personnels sans secret global', () => {
  assert.match(envExample, /PUBLIC_APP_URL=/);
  assert.match(envExample, /x-seenit-webhook-secret/);
  assert.doesNotMatch(envExample, /^WEBHOOK_SECRET=/m);
  assert.doesNotMatch(envExample, /^APP_URL=/m);
  assert.doesNotMatch(envExample, /^GEMINI_API_KEY=/m);
});

test('SEENIT-PLATFORM-001 centralise les identités techniques non secrètes partagées', () => {
  assert.match(seenitConfig, /SEENIT_APP_ID/);
  assert.match(seenitConfig, /SEENIT_API_ORIGIN/);
  assert.match(seenitConfig, /SEENIT_FIREBASE_PROJECT_ID/);
  assert.match(seenitConfig, /SEENIT_FIRESTORE_DATABASE_ID/);
  assert.match(capacitorConfig, /SEENIT_APP_ID/);
  assert.match(capacitorConfig, /SEENIT_FIREBASE_PROJECT_ID/);
  assert.match(firebaseAdmin, /SEENIT_FIREBASE_PROJECT_ID/);
  assert.match(firebaseAdmin, /SEENIT_FIRESTORE_DATABASE_ID/);
  assert.match(seenitApi, /SEENIT_API_ORIGIN/);
});
