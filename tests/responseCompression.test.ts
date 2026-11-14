import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import express from 'express';
import { createJsonGzipMiddleware } from '../src/features/runtime/responseCompression.ts';
import { createSeenItFrontendRouter } from '../src/features/runtime/staticFrontend.ts';

type Raw = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

async function listen(app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  // http.get : aucune décompression implicite, on observe les octets réellement servis.
  const raw = (pathname: string, headers: Record<string, string> = {}) => new Promise<Raw>((resolve, reject) => {
    get(`http://127.0.0.1:${port}${pathname}`, { headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
  return { raw, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

const tmdbLike = { results: Array.from({ length: 40 }, (_, id) => ({ id, title: `Titre ${id}`, overview: 'Résumé '.repeat(20) })) };

test('SEENIT-COST-001 les réponses JSON de l’API sont servies en gzip', async (t) => {
  const app = express();
  app.use('/api', createJsonGzipMiddleware());
  app.get('/api/media/tmdb/discover', (_req, res) => { res.type('json').send(JSON.stringify(tmdbLike)); });
  app.get('/api/json', (_req, res) => { res.json(tmdbLike); });
  app.get('/api/small', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/text', (_req, res) => { res.type('text').send('x'.repeat(5000)); });
  app.get('/api/encoded', (_req, res) => { res.setHeader('Content-Encoding', 'gzip'); res.type('json').send(Buffer.from([1, 2, 3])); });
  const server = await listen(app);
  t.after(() => server.close());
  const plain = Buffer.byteLength(JSON.stringify(tmdbLike));

  for (const route of ['/api/media/tmdb/discover', '/api/json']) {
    const response = await server.raw(route, { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(response.headers['content-encoding'], 'gzip', route);
    assert.match(String(response.headers.vary), /Accept-Encoding/);
    assert.deepEqual(JSON.parse(gunzipSync(response.body).toString()), tmdbLike);
    assert.ok(response.body.byteLength < plain / 3, `${route} : ${response.body.byteLength} octets servis pour ${plain}`);
  }

  const identity = await server.raw('/api/json');
  assert.equal(identity.headers['content-encoding'], undefined, 'client sans gzip : corps intact');
  assert.equal(identity.body.byteLength, plain);
  assert.equal((await server.raw('/api/small', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], undefined);
  assert.equal((await server.raw('/api/text', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], undefined);
  const encoded = await server.raw('/api/encoded', { 'Accept-Encoding': 'gzip' });
  assert.deepEqual([...encoded.body], [1, 2, 3], 'une réponse déjà compressée n’est jamais recompressée');
});

test('SEENIT-COST-001 les assets texte immuables sont servis en gzip avec revalidation', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'seenit-gzip-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'assets'));
  const script = `export const data = ${JSON.stringify(tmdbLike)};`;
  writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
  writeFileSync(path.join(root, 'assets', 'index-CaM0KRHI.js'), script);
  writeFileSync(path.join(root, 'assets', 'logo-Ab12.png'), Buffer.from([137, 80, 78, 71]));
  const app = express();
  app.use(createSeenItFrontendRouter(root));
  const server = await listen(app);
  t.after(() => server.close());

  const gz = await server.raw('/assets/index-CaM0KRHI.js', { 'Accept-Encoding': 'gzip' });
  assert.equal(gz.status, 200);
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.match(String(gz.headers['content-type']), /javascript/);
  assert.equal(gz.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(gunzipSync(gz.body).toString(), script);
  assert.ok(gz.body.byteLength < Buffer.byteLength(script) / 3);

  const revalidated = await server.raw('/assets/index-CaM0KRHI.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': String(gz.headers.etag) });
  assert.equal(revalidated.status, 304);

  const identity = await server.raw('/assets/index-CaM0KRHI.js');
  assert.equal(identity.headers['content-encoding'], undefined);
  assert.equal(identity.body.toString(), script);

  const image = await server.raw('/assets/logo-Ab12.png', { 'Accept-Encoding': 'gzip' });
  assert.equal(image.headers['content-encoding'], undefined, 'les images déjà compressées restent servies telles quelles');
  assert.equal((await server.raw('/assets/absent-X.js', { 'Accept-Encoding': 'gzip' })).status, 404);
  assert.equal((await server.raw('/assets/..%2Findex.html', { 'Accept-Encoding': 'gzip' })).status, 404);
});
