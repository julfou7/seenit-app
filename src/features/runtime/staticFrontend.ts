import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type Router } from 'express';
import { acceptsGzip, gzipBuffer, isCompressibleAssetPath } from './responseCompression.ts';

// Les assets Vite de dist/assets portent un hash de contenu : une URL donnée ne change jamais.
export const SEENIT_HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
// Le shell et les fichiers publics non hashés gardent la même URL d'un déploiement à l'autre.
export const SEENIT_SHELL_CACHE_CONTROL = 'no-cache';

/**
 * ETag fort calculé sur le contenu. L'ETag par défaut d'Express (taille + date de
 * modification) est identique entre deux builds lorsque l'image remet les dates à 1980
 * et que les noms hashés gardent la même longueur : le navigateur recevait alors 304
 * et gardait un index.html pointant vers des chunks supprimés.
 */
export function computeSeenItContentEtag(content: Buffer | string): string {
  return `"${createHash('sha256').update(content).digest('base64url')}"`;
}

/** Une URL qui désigne un fichier (extension finale) n'est jamais une route de l'application. */
export function isSeenItFileRequestPath(pathname: string): boolean {
  return /\.[A-Za-z0-9]{1,10}$/.test(path.posix.basename(pathname));
}

function sendNotFound(res: Response): void {
  res.status(404).type('text/plain').setHeader('Cache-Control', SEENIT_SHELL_CACHE_CONTROL);
  res.send('Not found');
}

/**
 * Sert le frontend PWA de production : shell avec ETag de contenu, assets hashés
 * immuables, fichiers publics sans validateurs trompeurs et 404 réel pour tout fichier
 * absent (jamais index.html servi à la place d'un script).
 */
export function createSeenItFrontendRouter(distPath: string): Router {
  const router = express.Router();
  const shell = readFileSync(path.join(distPath, 'index.html'));
  const shellEtag = computeSeenItContentEtag(shell);

  const sendShell = (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', SEENIT_SHELL_CACHE_CONTROL);
    res.setHeader('ETag', shellEtag);
    res.removeHeader('Last-Modified');
    res.type('html').send(shell);
  };

  router.get(['/', '/index.html'], sendShell);

  // SEENIT-COST-001 : assets hashés immuables, compressés une seule fois puis servis depuis la mémoire.
  const assetsPath = path.join(distPath, 'assets');
  const gzippedAssets = new Map<string, { body: Buffer; etag: string } | null>();
  router.get('/assets/:file', (req, res, next) => {
    const file = req.params.file;
    if (!/^[\w.-]+$/.test(file) || !isCompressibleAssetPath(file) || !acceptsGzip(req)) { next(); return; }
    let entry = gzippedAssets.get(file);
    if (entry === undefined) {
      try {
        const body = gzipBuffer(readFileSync(path.join(assetsPath, file)));
        entry = { body, etag: computeSeenItContentEtag(body) };
      } catch {
        entry = null;
      }
      gzippedAssets.set(file, entry);
    }
    if (!entry) { next(); return; }
    res.setHeader('Cache-Control', SEENIT_HASHED_ASSET_CACHE_CONTROL);
    res.setHeader('ETag', entry.etag);
    res.vary('Accept-Encoding');
    if (req.headers['if-none-match'] === entry.etag) { res.status(304).end(); return; }
    res.setHeader('Content-Encoding', 'gzip');
    res.type(path.extname(file)).send(entry.body);
  });

  router.use('/assets', express.static(path.join(distPath, 'assets'), {
    index: false,
    redirect: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', SEENIT_HASHED_ASSET_CACHE_CONTROL);
    }
  }));
  router.use('/assets', (_req, res) => sendNotFound(res));

  router.use(express.static(distPath, {
    index: false,
    redirect: false,
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', SEENIT_SHELL_CACHE_CONTROL);
    }
  }));

  router.get('*', (req, res) => {
    if (isSeenItFileRequestPath(req.path)) {
      sendNotFound(res);
      return;
    }
    sendShell(req, res);
  });

  return router;
}
