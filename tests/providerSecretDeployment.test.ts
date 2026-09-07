import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sanitizer = readFileSync(new URL('../scripts/prepare-cloud-run-candidate.cjs', import.meta.url), 'utf8');
const providerSpec = readFileSync(new URL('../docs/specifications/media-providers.md', import.meta.url), 'utf8');

test('SEENIT-SECURITY-001 injecte les trois fournisseurs depuis Secret Manager', () => {
  assert.match(sanitizer, /forceSingleContainerSecretEnv/);
  assert.match(sanitizer, /secretKeyRef/);
  assert.match(sanitizer, /version = 'latest'/);

  for (const name of ['TMDB_API_KEY', 'OMDB_API_KEY', 'TVDB_API_KEY']) {
    assert.match(sanitizer, new RegExp(name));
    assert.match(providerSpec, new RegExp(name));
  }

  assert.match(providerSpec, /Secret Manager Secret Accessor/);
  assert.doesNotMatch(providerSpec, /VITE_(?:TMDB|OMDB|TVDB)_API_KEY/);
});
