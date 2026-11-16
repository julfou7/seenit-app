import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { HARNESSES, buildAllBrowserHarnesses } = require('../scripts/build-browser-harnesses.cjs') as {
  HARNESSES: Array<[string, (root: string) => Promise<void>]>;
  buildAllBrowserHarnesses: (root: string) => Promise<void>;
};

// #1065 : un export manquant dans une fixture du smoke (ex. downloadsRuntime.ts) ne cassait le harnais qu'en CI.
test('validate:change construit les harnais du smoke navigateur après le build', () => {
  const validate = readFileSync('scripts/validate-change.cjs', 'utf8');
  assert.match(validate, /runNpm\(\['run', 'build'\][\s\S]*?run\('node', \['scripts\/build-browser-harnesses\.cjs'\]/, 'après le build Web (feuilles de style)');
});

test('tout harnais construit par le smoke PWA est aussi construit en local', () => {
  const smoke = readFileSync('scripts/pwa-browser-smoke.cjs', 'utf8');
  const built = [...smoke.matchAll(/await (build\w+Harness)\(root\)/g)].map(match => match[1]);
  const local = HARNESSES.map(([, build]) => build.name);
  assert.ok(built.length >= 10);
  for (const name of built) assert.ok(local.includes(name), `${name} absent de build-browser-harnesses.cjs`);
});

test('un harnais non constructible fait échouer la construction avec son nom et la cause', async () => {
  const saved = HARNESSES.splice(0, HARNESSES.length);
  try {
    HARNESSES.push(['Téléchargements', async () => {
      throw Object.assign(new Error('Build failed'), { errors: [{ text: 'No matching export in "tests/fixtures/downloadsRuntime.ts" for import "executePost"', location: { file: 'src/x.ts', line: 3 } }] });
    }]);
    await assert.rejects(buildAllBrowserHarnesses('.'), /Harnais « Téléchargements » non constructible :\n  No matching export in "tests\/fixtures\/downloadsRuntime\.ts" for import "executePost" \(src\/x\.ts:3\)/);
  } finally {
    HARNESSES.splice(0, HARNESSES.length, ...saved);
  }
});
