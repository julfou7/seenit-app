import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {
  apiErrorMiddleware,
  backendHealthHandler,
  buildBackendHealthPayload,
  installAsyncRouteForwarding,
  seenItCorsMiddleware
} from '../src/features/runtime/backendRuntime.ts';

test('SEENIT-RUNTIME-001 garde un health-check indépendant et identifiable', () => {
  assert.deepEqual(buildBackendHealthPayload(), {
    status: 'ok',
    service: 'seenit-backend',
    identity: 'canonical'
  });
});

test('SEENIT-RUNTIME-001 contient les rejets async API sans terminer le backend', async () => {
  const app = express();
  installAsyncRouteForwarding(app);

  app.get('/api/fail', async () => {
    const error = new Error('secret à ne jamais exposer');
    Object.assign(error, { code: 'PERMISSION_DENIED' });
    throw error;
  });
  app.get('/api/health', backendHealthHandler);
  app.use('/api', apiErrorMiddleware);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;

    const failed = await fetch(`${origin}/api/fail`);
    assert.equal(failed.status, 500);
    assert.match(failed.headers.get('content-type') || '', /application\/json/);
    const failurePayload = await failed.json();
    assert.deepEqual(failurePayload, {
      error: 'BACKEND_REQUEST_FAILED',
      message: 'Le backend SeenIt a rencontré une erreur.'
    });
    assert.equal(JSON.stringify(failurePayload).includes('secret à ne jamais exposer'), false);

    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('x-seenit-backend'), 'canonical');
    assert.deepEqual(await health.json(), buildBackendHealthPayload());
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});


test('SEENIT-PLATFORM-001 autorise le preflight cross-origin avec les en-têtes SeenIt réellement émis', async t => {
  const app = express();
  app.use(seenItCorsMiddleware);
  app.get('/api/media/parental-ratings', (_req, res) => res.json({ ok: true }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const requestedHeaders = [
    'authorization',
    'x-plex-version',
    'x-seenit-request-id',
  ];

  const preflight = await fetch(`${origin}/api/media/parental-ratings`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://ais-dev-example.run.app',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': requestedHeaders.join(', '),
    },
  });

  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  const allowed = String(preflight.headers.get('access-control-allow-headers') || '')
    .toLowerCase()
    .split(',')
    .map(value => value.trim());
  for (const header of requestedHeaders) assert.ok(allowed.includes(header), `${header} doit être autorisé par CORS`);
});
