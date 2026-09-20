import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { installAsyncRouteForwarding } from '../src/features/runtime/backendRuntime.ts';

async function withPlexServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  installAsyncRouteForwarding(app);
  app.post(['/api/plex/history', '/api/plex-sync'], (_req, res) => {
    res.json({
      history: [],
      watchlist: [],
      libraryWatchStates: Array.from({ length: 200 }, (_, index) => ({
        mediaType: 'episode',
        parentTmdbId: 123,
        seasonNumber: 1,
        episodeNumber: index + 1,
        watched: true
      }))
    });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

test('SEENIT-COST-001 compresse les réponses Plex volumineuses sans modifier leur contrat', async () => {
  await withPlexServer(async (baseUrl) => {
    for (const route of ['/api/plex/history', '/api/plex-sync']) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'Accept-Encoding': 'gzip' }
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-encoding'), 'gzip');
      assert.match(response.headers.get('vary') || '', /Accept-Encoding/i);
      assert.ok(Number(response.headers.get('content-length')) < 2_000);
      const payload = await response.json() as any;
      assert.equal(payload.libraryWatchStates.length, 200);
    }
  });
});

test('SEENIT-COST-001 respecte les clients Plex qui refusent la compression', async () => {
  await withPlexServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/plex/history`, {
      method: 'POST',
      headers: { 'Accept-Encoding': 'identity' }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), null);
    const payload = await response.json() as any;
    assert.equal(payload.libraryWatchStates.length, 200);
  });
});
