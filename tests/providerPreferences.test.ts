import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  hydratePreferredProviderIds,
  normalizePreferredProviderIds,
  resetProviderPreferenceHydrationForTests,
} from '../src/features/providers/providerPreferences.ts';

test('#337 normalise les IDs Mes plateformes sans dépendre de l’ordre de stockage', () => {
  assert.deepEqual(normalizePreferredProviderIds([531, '8', 531, 0, 'x']), [8, 531]);
});

test('#337 hydrate la préférence cloud même si Réglages n’a jamais été monté', async () => {
  resetProviderPreferenceHydrationForTests();
  let local: number[] = [];
  let cloudReads = 0;
  const result = await hydratePreferredProviderIds('user-1', {
    readLocal: () => local,
    writeLocal: (_uid, ids) => { local = ids; },
    readCloud: async () => {
      cloudReads += 1;
      return [531];
    },
  });

  assert.deepEqual(result, [531]);
  assert.deepEqual(local, [531]);
  assert.equal(cloudReads, 1);
});

test('#337 déduplique l’hydratation cloud par UID pendant la session', async () => {
  resetProviderPreferenceHydrationForTests();
  let local: number[] = [];
  let cloudReads = 0;
  const dependencies = {
    readLocal: () => local,
    writeLocal: (_uid: string, ids: number[]) => { local = ids; },
    readCloud: async () => {
      cloudReads += 1;
      await Promise.resolve();
      return [531];
    },
  };

  const [first, second] = await Promise.all([
    hydratePreferredProviderIds('user-2', dependencies),
    hydratePreferredProviderIds('user-2', dependencies),
  ]);
  assert.deepEqual(first, [531]);
  assert.deepEqual(second, [531]);
  assert.equal(cloudReads, 1);
});

test('#337 le hook passif hydrate les préférences sans dépendre de SettingsScreen', () => {
  const source = readFileSync('src/hooks/usePassiveWatchProvider.ts', 'utf8');
  assert.match(source, /hydratePreferredProviderIds\(currentUid\)/);
  assert.match(source, /subscribeUserScopedStorageField\(currentUid, 'platforms'/);
});
