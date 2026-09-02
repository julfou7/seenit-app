import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { apiErrorMiddleware, backendHealthHandler, buildBackendHealthPayload } from '../src/features/runtime/backendRuntime.ts';

test('SEENIT-RUNTIME-001 garde un health-check indépendant et identifiable', () => {
  assert.deepEqual(buildBackendHealthPayload(), {
    status: 'ok',
    service: 'seenit-backend',
    identity: 'canonical'
  });
});

test('SEENIT-RUNTIME-001 transforme une erreur API en JSON générique', () => {
  const error = Object.assign(new Error('secret à ne jamais exposer'), { code: 'PERMISSION_DENIED' });
  const request = { method: 'GET' } as any;
  let statusCode = 200;
  let payload: unknown;
  const response = {
    headersSent: false,
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    }
  } as any;

  apiErrorMiddleware(error, request, response, (() => undefined) as any);

  assert.equal(statusCode, 500);
  assert.deepEqual(payload, {
    error: 'BACKEND_REQUEST_FAILED',
    message: 'Le backend SeenIt a rencontré une erreur.'
  });
  assert.equal(JSON.stringify(payload).includes('secret à ne jamais exposer'), false);
});

test('SEENIT-RUNTIME-001 expose le health handler sans Firestore ni service tiers', () => {
  const headers = new Map<string, string>();
  let payload: unknown;
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    json(value: unknown) {
      payload = value;
      return this;
    }
  } as any;

  backendHealthHandler({} as any, response, (() => undefined) as any);

  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('x-seenit-backend'), 'canonical');
  assert.deepEqual(payload, buildBackendHealthPayload());
});
