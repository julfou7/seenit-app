import type { RequestHandler, Response } from 'express';

export type SeenItSecurityHeadersMode = 'development' | 'production';

const DOCUMENT_SCRIPT_SOURCES = [
  "'self'",
  'https://apis.google.com',
  'https://www.gstatic.com'
];

const FRAME_SOURCES = [
  "'self'",
  'https://accounts.google.com',
  'https://*.firebaseapp.com',
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com'
];

function joinDirective(name: string, sources: string[]): string {
  return `${name} ${sources.join(' ')}`;
}

export function buildSeenItDocumentCsp(mode: SeenItSecurityHeadersMode): string {
  const scriptSources = [...DOCUMENT_SCRIPT_SOURCES];
  const connectSources = ["'self'", 'https:'];
  if (mode === 'development') {
    scriptSources.push("'unsafe-eval'");
    connectSources.push('ws:', 'wss:');
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    joinDirective('script-src', scriptSources),
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    joinDirective('connect-src', connectSources),
    joinDirective('frame-src', FRAME_SOURCES),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'"
  ].join('; ');
}

export function buildSeenItServiceWorkerCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'self' https://www.gstatic.com",
    "connect-src 'self' https:",
    "img-src 'self' data: blob: https:"
  ].join('; ');
}

export function buildSeenItSecurityHeaders(mode: SeenItSecurityHeadersMode): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': buildSeenItDocumentCsp(mode),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
  if (mode === 'production') {
    headers['Strict-Transport-Security'] = 'max-age=31536000';
  }
  return headers;
}

export function applySeenItSecurityHeaders(
  response: Pick<Response, 'setHeader'>,
  mode: SeenItSecurityHeadersMode
): void {
  for (const [name, value] of Object.entries(buildSeenItSecurityHeaders(mode))) {
    response.setHeader(name, value);
  }
}

export function applySeenItServiceWorkerHeaders(
  response: Pick<Response, 'setHeader'>,
  mode: SeenItSecurityHeadersMode
): void {
  applySeenItSecurityHeaders(response, mode);
  response.setHeader('Content-Security-Policy', buildSeenItServiceWorkerCsp());
  response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  response.setHeader('Service-Worker-Allowed', '/');
}

export function createSeenItSecurityHeadersMiddleware(mode: SeenItSecurityHeadersMode): RequestHandler {
  return (_req, res, next) => {
    applySeenItSecurityHeaders(res, mode);
    next();
  };
}
