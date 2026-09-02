import type { Application, ErrorRequestHandler, RequestHandler } from 'express';

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

function wrapRouteHandler(handler: any): any {
  if (Array.isArray(handler)) return handler.map(wrapRouteHandler);
  if (typeof handler !== 'function' || handler.length === 4) return handler;

  return function seenItAsyncRouteGuard(this: unknown, req: any, res: any, next: any) {
    try {
      const result = handler.call(this, req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(next);
      }
      return result;
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Express 4 ne relaie pas nativement les rejets des handlers async vers next(error).
 * On enveloppe les routes de cette instance avant leur déclaration, sans modifier
 * les middlewares de sécurité ni dépendre d'un patch global du framework.
 */
export function installAsyncRouteForwarding(app: Application): void {
  const methods = ['all', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put'] as const;

  for (const method of methods) {
    const original = (app as any)[method].bind(app);
    (app as any)[method] = (...args: any[]) => {
      // app.get('setting') est aussi un getter Express : ne pas l'altérer.
      if (method === 'get' && args.length === 1) return original(...args);
      if (args.length <= 1) return original(...args);
      return original(args[0], ...args.slice(1).map(wrapRouteHandler));
    };
  }
}

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
