import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rootFile = (name: string) => new URL(`../${name}`, import.meta.url);

test('AI Studio ne reçoit aucune déclaration de secret projet', () => {
  const envExample = fs.readFileSync(rootFile('.env.example'), 'utf8');
  const declaredEnvironmentVariables = envExample
    .split(/\r?\n/)
    .filter(line => /^[A-Z][A-Z0-9_]*\s*=/.test(line.trim()));

  assert.deepEqual(declaredEnvironmentVariables, []);
});

test('SeenIt ne déclare aucune capability AI Studio', () => {
  const metadata = JSON.parse(fs.readFileSync(rootFile('metadata.json'), 'utf8'));
  assert.deepEqual(metadata.majorCapabilities ?? [], []);
});
