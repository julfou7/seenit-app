import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subscribeUserScopedStorageField,
  writeUserScopedJson,
} from '../src/lib/userIsolation.ts';

test('#337 une écriture Mes plateformes réveille les consommateurs déjà montés du même UID', () => {
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalCustomEvent = (globalThis as any).CustomEvent;
  const values = new Map<string, string>();

  class TestCustomEvent<T> extends Event {
    detail: T;

    constructor(type: string, init: { detail: T }) {
      super(type);
      this.detail = init.detail;
    }
  }

  (globalThis as any).window = new EventTarget();
  (globalThis as any).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  if (!originalCustomEvent) (globalThis as any).CustomEvent = TestCustomEvent;

  try {
    let notifications = 0;
    const unsubscribe = subscribeUserScopedStorageField('uid-a', 'platforms', () => {
      notifications += 1;
    });

    assert.equal(writeUserScopedJson('uid-a', 'platforms', [531]), true);
    assert.equal(notifications, 1);

    writeUserScopedJson('uid-a', 'notifications', { enabled: true });
    writeUserScopedJson('uid-b', 'platforms', [531]);
    assert.equal(notifications, 1);

    unsubscribe();
    writeUserScopedJson('uid-a', 'platforms', [8]);
    assert.equal(notifications, 1);
  } finally {
    if (originalWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = originalWindow;
    if (originalLocalStorage === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = originalLocalStorage;
    if (originalCustomEvent === undefined) delete (globalThis as any).CustomEvent;
    else (globalThis as any).CustomEvent = originalCustomEvent;
  }
});
