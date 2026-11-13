import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import {
  SEENIT_HASHED_ASSET_CACHE_CONTROL,
  SEENIT_SHELL_CACHE_CONTROL,
  createSeenItFrontendRouter,
  isSeenItFileRequestPath
} from '../src/features/runtime/staticFrontend.ts';

const BUILD_EPOCH = new Date('1980-01-01T00:00:01Z');

function writeBuild(root: string, entry: string): string {
  const dist = path.join(root, entry);
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': `<!doctype html><script type="module" src="/assets/${entry}.js"></script>`,
    [`assets/${entry}.js`]: 'export {};',
    'manifest.json': '{}'
  };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dist, name);
    writeFileSync(file, content);
    // Reproduit l'image Cloud Run : toutes les dates de fichiers sont figées.
    utimesSync(file, BUILD_EPOCH, BUILD_EPOCH);
  }
  return dist;
}

async function serve(dist: string) {
  const app = express();
  app.use(createSeenItFrontendRouter(dist));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    url: (pathname: string) => `http://127.0.0.1:${port}${pathname}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

test('SEENIT-QUALITY-001 un nouveau déploiement de même taille et même date invalide le shell en cache', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'seenit-static-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Deux builds : noms hashés de même longueur, donc index.html de même taille.
  const oldBuild = await serve(writeBuild(root, 'index-DMRssWPr'));
  const first = await fetch(oldBuild.url('/'));
  const oldEtag = first.headers.get('etag');
  await first.text();
  await oldBuild.close();
  assert.ok(oldEtag);

  const newBuild = await serve(writeBuild(root, 'index-CaM0KRHI'));
  t.after(() => newBuild.close());
  const revalidated = await fetch(newBuild.url('/'), { headers: { 'If-None-Match': oldEtag! } });
  assert.equal(revalidated.status, 200, 'le serveur ne doit pas répondre 304 avec un ancien shell');
  assert.match(await revalidated.text(), /index-CaM0KRHI\.js/);
  assert.notEqual(revalidated.headers.get('etag'), oldEtag);
  assert.equal(revalidated.headers.get('cache-control'), SEENIT_SHELL_CACHE_CONTROL);

  // http.get plutôt que fetch : fetch ajoute « Cache-Control: no-cache » aux requêtes
  // conditionnelles, ce qu'un navigateur ne fait pas lors d'une revalidation ordinaire.
  const unchangedStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(newBuild.url('/'), { headers: { 'If-None-Match': revalidated.headers.get('etag')! } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(unchangedStatus, 304, 'un shell identique reste revalidable à moindre coût');
});

test('SEENIT-QUALITY-001 un chunk supprimé répond 404 au lieu de servir index.html', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'seenit-static-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = await serve(writeBuild(root, 'index-CaM0KRHI'));
  t.after(() => app.close());

  const missingChunk = await fetch(app.url('/assets/index-DMRssWPr.js'));
  assert.equal(missingChunk.status, 404);
  assert.doesNotMatch(missingChunk.headers.get('content-type') || '', /text\/html/);

  const missingPublicFile = await fetch(app.url('/brand/absent.svg'));
  assert.equal(missingPublicFile.status, 404);

  const chunk = await fetch(app.url('/assets/index-CaM0KRHI.js'));
  assert.equal(chunk.status, 200);
  assert.match(chunk.headers.get('content-type') || '', /javascript/);
  assert.equal(chunk.headers.get('cache-control'), SEENIT_HASHED_ASSET_CACHE_CONTROL);

  const manifest = await fetch(app.url('/manifest.json'));
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('cache-control'), SEENIT_SHELL_CACHE_CONTROL);
  assert.equal(manifest.headers.get('etag'), null, 'pas d’ETag taille+date trompeur sur un fichier public non hashé');
  assert.equal(manifest.headers.get('last-modified'), null);

  const deepLink = await fetch(app.url('/tv/connect'));
  assert.equal(deepLink.status, 200);
  assert.match(await deepLink.text(), /index-CaM0KRHI\.js/);
});

test('SEENIT-QUALITY-001 distingue une route de l’application d’un fichier', () => {
  assert.equal(isSeenItFileRequestPath('/assets/index-DMRssWPr.js'), true);
  assert.equal(isSeenItFileRequestPath('/icon-192.png'), true);
  assert.equal(isSeenItFileRequestPath('/tv/connect'), false);
  assert.equal(isSeenItFileRequestPath('/'), false);
});
