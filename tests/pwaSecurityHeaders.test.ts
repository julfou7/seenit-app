import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applySeenItServiceWorkerHeaders,
  buildSeenItDocumentCsp,
  buildSeenItSecurityHeaders,
  buildSeenItServiceWorkerCsp
} from '../src/features/runtime/pwaSecurityHeaders.ts';

test('SEENIT-SECURITY-004 applique les en-têtes de sécurité PWA sans casser Google Auth ni les médias distants', () => {
  const headers = buildSeenItSecurityHeaders('production');
  const csp = headers['Content-Security-Policy'];

  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
  assert.equal(headers['Strict-Transport-Security'], 'max-age=31536000');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' https:\/\/apis\.google\.com https:\/\/www\.gstatic\.com/);
  assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
  assert.match(csp, /font-src 'self' data: https:\/\/fonts\.gstatic\.com/);
  assert.match(csp, /img-src 'self' data: blob: https:/);
  assert.match(csp, /connect-src 'self' https:/);
  assert.match(csp, /frame-src .*firebaseapp\.com.*youtube\.com/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('SEENIT-SECURITY-004 garde Vite compatible uniquement en développement', () => {
  const development = buildSeenItDocumentCsp('development');
  const production = buildSeenItDocumentCsp('production');

  assert.match(development, /script-src [^;]*'unsafe-eval'/);
  assert.match(development, /connect-src [^;]*ws: wss:/);
  assert.doesNotMatch(production, /unsafe-eval|ws:/);
});

test('SEENIT-SECURITY-004 donne au worker une CSP et un cache indépendants du document', () => {
  const headers = new Map<string, string>();
  applySeenItServiceWorkerHeaders({
    setHeader(name: string, value: number | string | readonly string[]) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      return this;
    }
  }, 'production');

  const workerCsp = headers.get('Content-Security-Policy') || '';
  assert.equal(workerCsp, buildSeenItServiceWorkerCsp());
  assert.match(workerCsp, /script-src 'self' https:\/\/www\.gstatic\.com/);
  assert.equal(headers.get('Cache-Control'), 'no-cache, no-store, must-revalidate');
  assert.equal(headers.get('Service-Worker-Allowed'), '/');
  assert.equal(headers.get('Content-Type'), 'application/javascript; charset=utf-8');
});

test('SEENIT-SECURITY-004 est réellement branché sur le serveur canonique', () => {
  const server = readFileSync('server.ts', 'utf8');
  assert.match(server, /createSeenItSecurityHeadersMiddleware/);
  assert.match(server, /applySeenItServiceWorkerHeaders/);
  assert.match(server, /Cache-Control', 'no-cache'/);
});
