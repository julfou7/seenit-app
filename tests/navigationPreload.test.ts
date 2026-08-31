import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCachedAsyncLoader, preloadInBackground } from '../src/features/navigation/screenPreload.ts';

test('SEENIT-UX-003 précharge et déduplique les écrans privés avant la première navigation', async () => {
  let calls = 0;
  const loader = createCachedAsyncLoader(async () => {
    calls += 1;
    return { ready: true };
  });

  const first = loader();
  const second = loader();
  assert.equal(first, second);
  await preloadInBackground([loader, loader]);
  assert.equal(calls, 1);
  assert.deepEqual(await first, { ready: true });
});

test('SEENIT-UX-003 réessaie un chunk dont le premier préchargement a échoué', async () => {
  let calls = 0;
  const loader = createCachedAsyncLoader(async () => {
    calls += 1;
    if (calls === 1) throw new Error('chunk indisponible');
    return 'ok';
  });

  await assert.rejects(loader(), /chunk indisponible/);
  assert.equal(await loader(), 'ok');
  assert.equal(calls, 2);
});

test('SEENIT-UX-003 conserve l’écran courant pendant le chargement d’un nouvel écran lazy', () => {
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /const ProfileScreen = lazy\(loadProfileScreen\)/);
  assert.match(appSource, /preloadInBackground\(privateScreenPreloaders\)/);
  assert.match(appSource, /startTransition\(\(\) => \{\s*setMountedTabs/s);
  assert.match(appSource, /startTransition\(\(\) => \{\s*openShow\(/s);
  assert.match(appSource, /onTabChange=\{handleTabChange\}/);
});
