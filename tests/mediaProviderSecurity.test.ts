import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const clientFiles = [
  'src/features/shows/tmdbClient.ts',
  'src/features/shows/tmdb.ts',
  'src/features/shows/omdbService.ts',
  'src/services/tvdb.ts',
];

const forbiddenClientPatterns = [
  /VITE_(?:TMDB|OMDB|TVDB)_API_KEY/,
  /localStorage[^\n]*(?:TMDB|OMDB|TVDB)_API_KEY/i,
  /api\.themoviedb\.org/i,
  /omdbapi\.com/i,
  /api4\.thetvdb\.com/i,
  /(?:TMDB|OMDB|TVDB)_API_KEY\s*=\s*['"][^'"]+['"]/,
];

test('issue #12 garde les secrets TMDB OMDb TVDB exclusivement côté backend', () => {
  for (const relativePath of clientFiles) {
    const source = read(relativePath);
    assert.match(source, /authenticatedFetch/, `${relativePath} doit passer par le transport authentifié SeenIt`);
    for (const pattern of forbiddenClientPatterns) {
      assert.doesNotMatch(source, pattern, `${relativePath} réintroduit une donnée fournisseur interdite côté client`);
    }
  }

  assert.match(read('src/features/shows/tmdbClient.ts'), /\/api\/media\/tmdb/);
  assert.match(read('src/features/shows/omdbService.ts'), /\/api\/media\/omdb/);
  assert.match(read('src/services/tvdb.ts'), /\/api\/media\/tvdb\/franchise/);

  const envExample = read('.env.example');
  assert.match(envExample, /^TMDB_API_KEY=$/m);
  assert.match(envExample, /^OMDB_API_KEY=$/m);
  assert.match(envExample, /^TVDB_API_KEY=$/m);
  assert.doesNotMatch(envExample, /^VITE_(?:TMDB|OMDB|TVDB)_API_KEY=/m);
});

test('issue #12 borne et authentifie la façade fournisseurs', () => {
  const backend = read('src/features/providers/mediaProviderBackend.ts');
  assert.match(backend, /process\.env\.TMDB_API_KEY/);
  assert.match(backend, /process\.env\.OMDB_API_KEY/);
  assert.match(backend, /process\.env\.TVDB_API_KEY/);
  assert.match(backend, /adminAuth\.verifyIdToken/);
  assert.match(backend, /providerRateLimit\('provider-tmdb'/);
  assert.match(backend, /providerRateLimit\('provider-omdb'/);
  assert.match(backend, /providerRateLimit\('provider-tvdb'/);
  assert.match(backend, /ALLOWED_TMDB_ROOTS/);
  assert.match(backend, /OMITTED_PROVIDER_QUERY_KEYS/);
  assert.match(backend, /redirect: 'error'/);

  const runtime = read('src/features/runtime/backendRuntime.ts');
  assert.match(runtime, /registerMediaProviderRoutes\(app\)/);
});
