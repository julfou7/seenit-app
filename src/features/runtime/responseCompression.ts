import { gzipSync } from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';

/**
 * SEENIT-COST-001 / #23 : Cloud Run ne compresse pas les réponses et chaque octet servi vers
 * l'Europe est facturé. Les réponses JSON de l'API (TMDB en tête, ~74 % des octets mesurés)
 * et les assets texte du frontend sont donc compressés en gzip par le serveur.
 */
export const SEENIT_GZIP_MIN_BYTES = 1024;
const GZIP_LEVEL = 6;
const COMPRESSIBLE_ASSET = /\.(?:js|mjs|css|svg|json|webmanifest|txt|html|map)$/i;

export function acceptsGzip(req: Request): boolean {
  return typeof req.acceptsEncodings === 'function' && req.acceptsEncodings('gzip') === 'gzip';
}

export function isCompressibleAssetPath(pathname: string): boolean {
  return COMPRESSIBLE_ASSET.test(pathname);
}

/** Compresse un buffer avec un niveau fixe ; exposé pour les assets mis en cache. */
export function gzipBuffer(content: Buffer | string): Buffer {
  return gzipSync(typeof content === 'string' ? Buffer.from(content) : content, { level: GZIP_LEVEL });
}

/**
 * Enveloppe `res.send` pour gzipper les corps JSON d'au moins 1 Kio. Les réponses déjà
 * encodées (Plex), les flux (`res.write`) et les autres types restent inchangés.
 */
export function createJsonGzipMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'HEAD' || !acceptsGzip(req)) { next(); return; }
    const originalSend = res.send.bind(res);
    res.send = ((body?: unknown) => {
      const type = String(res.getHeader('Content-Type') || '');
      const payload = typeof body === 'string' ? Buffer.from(body) : Buffer.isBuffer(body) ? body : null;
      if (!payload || !/\bjson\b/i.test(type) || res.getHeader('Content-Encoding')
        || payload.byteLength < SEENIT_GZIP_MIN_BYTES || res.statusCode === 204 || res.statusCode === 304) {
        return originalSend(body as never);
      }
      res.vary('Accept-Encoding');
      res.setHeader('Content-Encoding', 'gzip');
      res.removeHeader('Content-Length');
      return originalSend(gzipBuffer(payload));
    }) as Response['send'];
    next();
  };
}
