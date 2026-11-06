import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('#876 la bannière de mise à jour charge les notes de version à l’ouverture, pas au démarrage', () => {
  const banner = readFileSync('src/components/AppUpdateBanner.tsx', 'utf8');
  assert.doesNotMatch(banner, /^import [^;]*from '\.\/ChangelogViewer';/m, 'aucun import statique du rendu Markdown');
  assert.match(banner, /const ReleaseChangelogViewer = lazy\(\(\) => import\('\.\/ChangelogViewer'\)/);
  assert.match(banner, /<Suspense fallback=\{[^}]*\}><ReleaseChangelogViewer release=\{latestRelease\} \/><\/Suspense>/);
});

test('#876 react-markdown reste confiné au visualiseur de notes chargé à la demande', () => {
  const importers = sources('src').filter(path => /from 'react-markdown'/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(importers, [join('src', 'components', 'ChangelogViewer.tsx')]);
  // Les seuls consommateurs statiques restants sont des écrans déjà chargés à la demande.
  const staticConsumers = sources('src').filter(path => /^import [^;]*from '[./]*(?:components\/)?ChangelogViewer';/m.test(readFileSync(path, 'utf8')));
  assert.deepEqual(staticConsumers, [join('src', 'screens', 'SettingsScreenCore.tsx')]);
});
