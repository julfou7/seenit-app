const fs = require('node:fs');

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`${label} introuvable`);
  return source.replace(before, after);
}

let app = fs.readFileSync('src/App.tsx', 'utf8');
app = replaceOnce(
  app,
  "import { lazy, Suspense, useState, useEffect, useRef } from 'react';",
  "import { lazy, Suspense, startTransition, useCallback, useState, useEffect, useRef } from 'react';",
  'import React'
);
app = replaceOnce(
  app,
  "import { activateLogUserScope } from './store/logStore';",
  "import { activateLogUserScope } from './store/logStore';\nimport { createCachedAsyncLoader, preloadInBackground } from './features/navigation/screenPreload';",
  'import screenPreload'
);

const oldLazy = `const ProfileScreen = lazy(() => import('./screens/ProfileScreen').then(module => ({ default: module.ProfileScreen })));
const ShowDetailScreen = lazy(() => import('./screens/ShowDetailScreen').then(module => ({ default: module.ShowDetailScreen })));
const WatchListScreen = lazy(() => import('./screens/WatchListScreen').then(module => ({ default: module.WatchListScreen })));
const DiscoverScreen = lazy(() => import('./screens/DiscoverScreen').then(module => ({ default: module.DiscoverScreen })));
const DownloadsScreen = lazy(() => import('./screens/DownloadsScreen').then(module => ({ default: module.DownloadsScreen })));`;
const newLazy = `const loadProfileScreen = createCachedAsyncLoader(() => import('./screens/ProfileScreen').then(module => ({ default: module.ProfileScreen })));
const loadShowDetailScreen = createCachedAsyncLoader(() => import('./screens/ShowDetailScreen').then(module => ({ default: module.ShowDetailScreen })));
const loadWatchListScreen = createCachedAsyncLoader(() => import('./screens/WatchListScreen').then(module => ({ default: module.WatchListScreen })));
const loadDiscoverScreen = createCachedAsyncLoader(() => import('./screens/DiscoverScreen').then(module => ({ default: module.DiscoverScreen })));
const loadDownloadsScreen = createCachedAsyncLoader(() => import('./screens/DownloadsScreen').then(module => ({ default: module.DownloadsScreen })));

const ProfileScreen = lazy(loadProfileScreen);
const ShowDetailScreen = lazy(loadShowDetailScreen);
const WatchListScreen = lazy(loadWatchListScreen);
const DiscoverScreen = lazy(loadDiscoverScreen);
const DownloadsScreen = lazy(loadDownloadsScreen);

const privateScreenPreloaders = [
  loadWatchListScreen,
  loadProfileScreen,
  loadDiscoverScreen,
  loadDownloadsScreen,
  loadShowDetailScreen
];

const tabScreenPreloaders: Record<string, () => Promise<unknown>> = {
  watchlist: loadWatchListScreen,
  library: loadWatchListScreen,
  profile: loadProfileScreen,
  settings: loadProfileScreen,
  discover: loadDiscoverScreen,
  downloads: loadDownloadsScreen
};`;
app = replaceOnce(app, oldLazy, newLazy, 'bloc lazy');
app = replaceOnce(
  app,
  '  const isReady = currentUser !== undefined;\n',
  `  const isReady = currentUser !== undefined;\n\n  useEffect(() => {\n    if (!currentUser) return;\n    void preloadInBackground(privateScreenPreloaders);\n  }, [currentUser]);\n`,
  'isReady'
);

app = app.replaceAll('openShow(', 'openShowSmooth(');
const oldNav = `  const { currentTab, changeTab, selectedShow, openShow, closeShow } = useNavigation();
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(['watchlist']));
`;
const newNav = `  const { currentTab, changeTab, selectedShow, openShow, closeShow } = useNavigation();
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(['watchlist', currentTab]));

  const handleTabChange = useCallback((tab: Parameters<typeof changeTab>[0]) => {
    void tabScreenPreloaders[tab]?.();
    startTransition(() => {
      setMountedTabs(previous => {
        if (previous.has(tab)) return previous;
        const next = new Set(previous);
        next.add(tab);
        return next;
      });
      changeTab(tab);
    });
  }, [changeTab]);

  const openShowSmooth = useCallback((
    id: any,
    type: 'local' | 'tmdb' = 'local',
    mediaType?: 'tv' | 'movie',
    tmdbId?: number,
    initialSeason?: number,
    initialEpisode?: number
  ) => {
    void loadShowDetailScreen();
    startTransition(() => {
      openShow(id, type, mediaType, tmdbId, initialSeason, initialEpisode);
    });
  }, [openShow]);
`;
app = replaceOnce(app, oldNav, newNav, 'bloc navigation');
app = app.replaceAll('[openShow, updateShow, showToast]', '[openShowSmooth, updateShow, showToast]');
app = app.replaceAll('onTabChange={changeTab}', 'onTabChange={handleTabChange}');
app = app.replaceAll('fallback={<div className="flex-1 bg-[#040406]" aria-label="Chargement de l’écran" />}', 'fallback={<div className="flex-1 bg-premium-ambient" aria-label="Chargement de l’écran" />}');
app = app.replaceAll('fallback={<div className="flex-1 bg-black" aria-label="Chargement de la fiche" />}', 'fallback={<div className="flex-1 bg-premium-ambient" aria-label="Chargement de la fiche" />}');
fs.writeFileSync('src/App.tsx', app);

fs.writeFileSync('src/features/navigation/screenPreload.ts', `export function createCachedAsyncLoader<T>(loader: () => Promise<T>): () => Promise<T> {
  let cachedPromise: Promise<T> | null = null;

  return () => {
    if (!cachedPromise) {
      cachedPromise = loader().catch(error => {
        cachedPromise = null;
        throw error;
      });
    }
    return cachedPromise;
  };
}

export async function preloadInBackground(loaders: Array<() => Promise<unknown>>): Promise<void> {
  await Promise.allSettled(loaders.map(loader => loader()));
}
`);

fs.writeFileSync('tests/navigationPreload.test.ts', `import test from 'node:test';
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
  assert.match(appSource, /const ProfileScreen = lazy\\(loadProfileScreen\\)/);
  assert.match(appSource, /preloadInBackground\\(privateScreenPreloaders\\)/);
  assert.match(appSource, /startTransition\\(\\(\\) => \\{\\s*setMountedTabs/s);
  assert.match(appSource, /startTransition\\(\\(\\) => \\{\\s*openShow\\(/s);
  assert.match(appSource, /onTabChange=\\{handleTabChange\\}/);
});
`);

let spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
const ux2 = `- **SEENIT-UX-002** — La clé de rendu et l'affiche d'un téléchargement restent stables pendant
  la transition intention → transfert distant afin d'éviter les clignotements.
`;
const ux3 = ux2 + `- **SEENIT-UX-003** — La première navigation vers un écran privé chargé paresseusement ne
  remplace jamais l'écran courant par un écran vide ou noir. Les chunks des onglets et des fiches
  média restent séparés du bundle initial, sont préchargés en arrière-plan pendant le splash et les
  changements d'écran sont engagés dans une transition React afin de conserver le contenu déjà
  affiché jusqu'à ce que la prochaine vue soit prête.
`;
spec = replaceOnce(spec, ux2, ux3, 'SEENIT-UX-002');
fs.writeFileSync('docs/specifications/seenit.md', spec);

const requirementsPath = 'docs/specifications/requirements.json';
const requirements = JSON.parse(fs.readFileSync(requirementsPath, 'utf8'));
if (requirements.requirements.some(item => item.id === 'SEENIT-UX-003')) throw new Error('SEENIT-UX-003 existe déjà');
requirements.requirements.push({
  id: 'SEENIT-UX-003',
  title: 'Navigation lazy sans flash noir au premier accès',
  targets: ['pwa', 'apk'],
  tests: [
    {
      file: 'tests/navigationPreload.test.ts',
      contains: 'SEENIT-UX-003 précharge et déduplique les écrans privés avant la première navigation'
    },
    {
      file: 'tests/navigationPreload.test.ts',
      contains: 'SEENIT-UX-003 conserve l’écran courant pendant le chargement d’un nouvel écran lazy'
    }
  ]
});
fs.writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2) + '\n');

let gradle = fs.readFileSync('android/app/build.gradle', 'utf8');
gradle = replaceOnce(gradle, 'versionCode 104084', 'versionCode 104085', 'versionCode');
gradle = replaceOnce(gradle, 'versionName "1.4.84"', 'versionName "1.4.85"', 'versionName');
fs.writeFileSync('android/app/build.gradle', gradle);
