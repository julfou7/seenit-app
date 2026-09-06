import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const stub = fs.readFileSync(path.join(rootDir, 'scripts', 'vite-production-stub.ts'), 'utf8');
const smoke = fs.readFileSync(path.join(rootDir, 'scripts', 'smoke-built-server.cjs'), 'utf8');

const buildScript = String(packageJson.scripts?.build || '');

test('SEENIT-RUNTIME-001 n’embarque pas le runtime Vite dans le bootstrap CJS de production', () => {
  assert.match(buildScript, /--format=cjs/);
  assert.match(buildScript, /--packages=external/);
  assert.match(buildScript, /--alias:vite=\.\/scripts\/vite-production-stub\.ts/);
  assert.match(stub, /ne doit pas être initialisé depuis le bundle backend de production/);
});

test('SEENIT-RUNTIME-001 smoke le bundle serveur compilé en NODE_ENV=production', () => {
  const esbuildIndex = buildScript.indexOf('esbuild server.ts');
  const smokeIndex = buildScript.indexOf('node scripts/smoke-built-server.cjs');

  assert.ok(esbuildIndex >= 0);
  assert.ok(smokeIndex > esbuildIndex);
  assert.match(smoke, /NODE_ENV: 'production'/);
  assert.match(smoke, /127\.0\.0\.1:3000\/api\/health/);
  assert.match(smoke, /seenit-backend/);
  assert.match(smoke, /x-seenit-backend/);
});
