import assert from 'node:assert/strict';
import test from 'node:test';
import { executeIdempotentMutation, type TimedMutationResult } from '../src/features/downloads/downloadIdempotency.ts';

test('deux mutations concurrentes de même identité ne sont exécutées qu’une fois', async () => {
  const cache = new Map<string, TimedMutationResult<string>>();
  const inFlight = new Map<string, Promise<string>>();
  let executions = 0;
  let release!: (value: string) => void;
  const remoteResult = new Promise<string>(resolve => { release = resolve; });
  const operation = () => {
    executions += 1;
    return remoteResult;
  };

  const first = executeIdempotentMutation({ key: 'uid:request', cache, inFlight, operation, ttlMs: 60_000 });
  const second = executeIdempotentMutation({ key: 'uid:request', cache, inFlight, operation, ttlMs: 60_000 });
  release('ok');

  assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);
  assert.equal(executions, 1);
});

test('le résultat idempotent est relu sans rejouer la mutation', async () => {
  const cache = new Map<string, TimedMutationResult<number>>();
  const inFlight = new Map<string, Promise<number>>();
  let executions = 0;
  const operation = async () => ++executions;

  assert.equal(await executeIdempotentMutation({ key: 'same', cache, inFlight, operation, ttlMs: 60_000 }), 1);
  assert.equal(await executeIdempotentMutation({ key: 'same', cache, inFlight, operation, ttlMs: 60_000 }), 1);
  assert.equal(executions, 1);
});

test('une mutation en échec reste relançable', async () => {
  const cache = new Map<string, TimedMutationResult<string>>();
  const inFlight = new Map<string, Promise<string>>();
  let executions = 0;
  const operation = async () => {
    executions += 1;
    if (executions === 1) throw new Error('échec distant');
    return 'ok';
  };

  await assert.rejects(() => executeIdempotentMutation({ key: 'retry', cache, inFlight, operation, ttlMs: 60_000 }));
  assert.equal(await executeIdempotentMutation({ key: 'retry', cache, inFlight, operation, ttlMs: 60_000 }), 'ok');
  assert.equal(executions, 2);
});
