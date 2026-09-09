import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const serverSource = readFileSync('server.ts', 'utf8');

test('issue #225 retire complètement Multer du runtime backend', () => {
  assert.equal(packageJson.dependencies?.multer, undefined);
  assert.equal(packageJson.devDependencies?.['@types/multer'], undefined);
  assert.equal(packageLock.packages?.['node_modules/multer'], undefined);
  assert.equal(packageLock.packages?.['node_modules/@types/multer'], undefined);
  assert.doesNotMatch(serverSource, /\bmulter\b/i);
});

test('issue #225 force qs sur la première version corrigée', () => {
  assert.equal(packageJson.overrides?.qs, '6.16.0');
  assert.equal(packageLock.packages?.['node_modules/qs']?.version, '6.16.0');
});
