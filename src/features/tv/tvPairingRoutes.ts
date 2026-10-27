import type { Application, Request, RequestHandler } from 'express';
import { createTvPairingService, TvPairingError, type TvLinkStore } from './tvPairing.ts';

interface PhoneRequest extends Request { user?: { uid: string; name?: unknown } }
export interface TvPairingRoutesPorts {
  store: TvLinkStore;
  authenticate: RequestHandler;
  rateLimit: (name: string, limit: number, windowMs: number) => RequestHandler;
  library: (uid: string) => Promise<unknown[]>;
}
export function registerTvPairingRoutes(app: Application, ports: TvPairingRoutesPorts) {
  const service = createTvPairingService(ports.store);
  const noStore: RequestHandler = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };
  const bodyText = (value: unknown) => typeof value === 'string' ? value : '';
  const linkId = (req: Request) => String(req.params.linkId || '');
  const secret = (req: Request) => /^Bearer [a-f0-9]{64}$/.test(req.headers.authorization || '') ? String(req.headers.authorization).slice(7) : '';
  const run = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      if (error instanceof TvPairingError) { res.status(error.status).json({ error: error.code }); return; }
      // Do not include provider errors, request bodies or secrets in diagnostics/responses.
      res.status(503).json({ error: 'TV_SERVICE_UNAVAILABLE' });
    }
  };
  app.post('/api/tv/links', noStore, ports.rateLimit('tv-pair-create', 6, 60 * 60_000), run(async (req, res) => {
    res.status(201).json(await service.create({ profile: req.body?.profile, deviceName: req.body?.deviceName }));
  }));
  app.post('/api/tv/links/:linkId/inspect', noStore, ports.authenticate, ports.rateLimit('tv-pair-inspect', 30, 60_000), run(async (req: PhoneRequest, res) => {
    res.json(await service.inspect(linkId(req), bodyText(req.body?.code), req.user?.uid || ''));
  }));
  app.post('/api/tv/links/:linkId/approve', noStore, ports.authenticate, ports.rateLimit('tv-pair-approve', 12, 60_000), run(async (req: PhoneRequest, res) => {
    res.json(await service.approve(linkId(req), bodyText(req.body?.code), { uid: req.user?.uid || '', name: req.user?.name }));
  }));
  app.post('/api/tv/links/:linkId/status', noStore, ports.rateLimit('tv-pair-status', 24, 60_000), run(async (req, res) => {
    res.json(await service.status(linkId(req), secret(req)));
  }));
  app.post('/api/tv/links/:linkId/bootstrap', noStore, ports.rateLimit('tv-bootstrap', 6, 60_000), run(async (req, res) => {
    const link = await service.device(linkId(req), secret(req), true);
    const items = await ports.library(link.ownerUid || '');
    res.json({ state: 'active', profile: link.profile, accountName: link.accountName, syncedAt: Date.now(), items });
  }));
  app.delete('/api/tv/links/:linkId', noStore, ports.rateLimit('tv-pair-revoke', 12, 60_000), run(async (req, res) => {
    res.json(await service.revoke(linkId(req), secret(req)));
  }));
}
