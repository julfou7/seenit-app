import type { ErrorRequestHandler, RequestHandler } from 'express';

export const SEENIT_BACKEND_IDENTITY = 'canonical';

export function buildBackendHealthPayload() {
  return {
    status: 'ok' as const,
    service: 'seenit-backend' as const,
    identity: SEENIT_BACKEND_IDENTITY
  };
}

export const backendHealthHandler: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-SeenIt-Backend', SEENIT_BACKEND_IDENTITY);
  res.json(buildBackendHealthPayload());
};

export const apiErrorMiddleware: ErrorRequestHandler = (error: any, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const code = String(error?.code ?? error?.name ?? 'API_ERROR').slice(0, 80);
  // Ne jamais journaliser le message ou les entêtes : ils peuvent contenir une URL ou un secret tiers.
  console.error('[API Error]', { method: req.method, code });
  res.status(500).json({
    error: 'BACKEND_REQUEST_FAILED',
    message: 'Le backend SeenIt a rencontré une erreur.'
  });
};
