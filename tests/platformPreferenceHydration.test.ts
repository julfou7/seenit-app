import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hydratePlatformPreferences } from '../src/features/providers/platformPreferenceHydration.ts';
import { readUserScopedJson, writeUserScopedJson, subscribeUserScopedStorageField } from '../src/lib/userIsolation.ts';

function environment() {
  const values = new Map<string, string>();
  const before = { window: globalThis.window, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { window: new EventTarget(), localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  return () => Object.assign(globalThis, before);
}

test('SEENIT-PROVIDER-001 hydrate sans Réglages, déduplique par UID et notifie les cartes', async () => {
  const restore = environment();
  try {
    let settle: (value: unknown) => void = () => {};
    let reads = 0, updates = 0;
    const response = new Promise(resolve => { settle = resolve; });
    const cloud = { read: () => { reads++; return response; }, save: async () => {} };
    const stop = subscribeUserScopedStorageField('account-a', 'platforms', () => { updates++; });
    const first = hydratePlatformPreferences('account-a', cloud);
    const second = hydratePlatformPreferences('account-a', cloud);
    assert.equal(first, second);
    await Promise.resolve();
    assert.equal(reads, 1);
    settle([531]);
    await first;
    assert.deepEqual(readUserScopedJson('account-a', 'platforms', []), [531]);
    assert.deepEqual(readUserScopedJson('account-b', 'platforms', []), []);
    assert.equal(updates, 1);
    stop();
    for (const file of ['App.tsx', 'screens/SettingsScreenCore.tsx']) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      assert.match(source, /await hydratePlatformPreferences\(/);
    }
  } finally { restore(); }
});

test('SEENIT-PROVIDER-001 préserve une bascule locale pendant l’hydratation', async () => {
  const restore = environment();
  try {
    for (const toggles of [false, true]) {
      writeUserScopedJson('account-a', 'platforms', [531]);
      let settle: (value: unknown) => void = () => {};
      const response = new Promise(resolve => { settle = resolve; });
      const saved: number[][] = [];
      const pending = hydratePlatformPreferences('account-a', { read: () => response, save: async ids => { saved.push(ids); } });
      writeUserScopedJson('account-a', 'platforms', []);
      if (toggles) writeUserScopedJson('account-a', 'platforms', [531]);
      settle(toggles ? [] : [531]);
      await pending;
      const expected = toggles ? [531] : [];
      assert.deepEqual(readUserScopedJson('account-a', 'platforms', []), expected);
      assert.deepEqual(saved, [expected]);
    }
    await assert.rejects(hydratePlatformPreferences('account-a', { read: async () => { throw new Error('offline'); }, save: async () => {} }), /offline/);
    assert.deepEqual(readUserScopedJson('account-a', 'platforms', []), [531]);
    await hydratePlatformPreferences('account-a', { read: async () => [], save: async () => {} });
    assert.deepEqual(readUserScopedJson('account-a', 'platforms', [531]), []);
  } finally { restore(); }
});
