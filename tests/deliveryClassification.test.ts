import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  classifyDelivery,
  isBackendOnlyFile,
  isCopyOnlySourceChange,
  isNonRuntimeFile,
  isProcessOnlyFile
} = require('../scripts/classify-delivery.cjs') as {
  classifyDelivery: (input: {
    changes: Array<{ status: string; path: string }>;
    readBefore: (file: string) => string;
    readAfter: (file: string) => string;
    forcedMode?: string;
  }) => { mode: 'light' | 'backend' | 'apk'; reasons: string[]; dependenciesChanged: boolean };
  isBackendOnlyFile: (file: string) => boolean;
  isCopyOnlySourceChange: (file: string, before: string, after: string) => boolean;
  isNonRuntimeFile: (file: string) => boolean;
  isProcessOnlyFile: (file: string) => boolean;
};

test('SEENIT-QUALITY-006 classe un renommage de label JSX dans le parcours light', () => {
  const before = `export const Save = () => <button aria-label="Enregistrer">Enregistrer</button>;`;
  const after = `export const Save = () => <button aria-label="Sauvegarder">Sauvegarder</button>;`;
  assert.equal(isCopyOnlySourceChange('src/components/Save.tsx', before, after), true);
  assert.equal(
    classifyDelivery({
      changes: [{ status: 'M', path: 'src/components/Save.tsx' }],
      readBefore: () => before,
      readAfter: () => after
    }).mode,
    'light'
  );
});

test('SEENIT-QUALITY-006 reconnaît un libellé non JSX marqué explicitement par uiCopy', () => {
  const before = `export const label = uiCopy('Enregistrer');`;
  const after = `export const label = uiCopy('Sauvegarder');`;
  assert.equal(isCopyOnlySourceChange('src/content/actions.ts', before, after), true);
  assert.equal(
    isCopyOnlySourceChange(
      'src/content/actions.ts',
      before,
      `export const label = uiCopy('');`
    ),
    false
  );
});

test('SEENIT-QUALITY-006 refuse une URL ou une condition modifiée comme simple texte', () => {
  assert.equal(
    isCopyOnlySourceChange(
      'src/lib/api.ts',
      `export const endpoint = 'https://seenit.ai.studio/api';`,
      `export const endpoint = 'https://example.test/api';`
    ),
    false
  );
  assert.equal(
    isCopyOnlySourceChange(
      'src/components/Action.tsx',
      `export const Action = ({ ready }) => <button>{ready && 'Go'}</button>;`,
      `export const Action = ({ ready }) => <button>{!ready && 'Go'}</button>;`
    ),
    false
  );
});

test('SEENIT-QUALITY-006 refuse un label vidé et tout fichier natif ou ambigu', () => {
  assert.equal(
    isCopyOnlySourceChange(
      'src/components/Save.tsx',
      `export const Save = () => <button aria-label="Enregistrer">Enregistrer</button>;`,
      `export const Save = () => <button aria-label=""> </button>;`
    ),
    false
  );
  const result = classifyDelivery({
    changes: [{ status: 'M', path: 'android/app/src/main/AndroidManifest.xml' }],
    readBefore: () => '',
    readAfter: () => ''
  });
  assert.equal(result.mode, 'apk');
});

test('SEENIT-QUALITY-006 accepte documentation et tests sans publier un APK', () => {
  assert.equal(isNonRuntimeFile('docs/guide.md'), true);
  assert.equal(isNonRuntimeFile('tests/example.test.ts'), true);
  assert.equal(isProcessOnlyFile('.github/workflows/build-apk.yml'), true);
  assert.equal(isProcessOnlyFile('scripts/validate-change-contract.cjs'), true);
  assert.equal(isProcessOnlyFile('docs/specifications/requirements.json'), true);
  assert.equal(
    classifyDelivery({
      changes: [
        { status: 'M', path: 'README.md' },
        { status: 'M', path: '.github/workflows/build-apk.yml' },
        { status: 'M', path: 'scripts/classify-delivery.cjs' },
        { status: 'M', path: 'tests/example.test.ts' }
      ],
      readBefore: () => '',
      readAfter: () => ''
    }).mode,
    'light'
  );
});

test('SEENIT-QUALITY-006 classe server.ts seul en backend sans APK', () => {
  assert.equal(isBackendOnlyFile('server.ts'), true);
  assert.equal(isBackendOnlyFile('src/lib/firebase-admin.ts'), true);
  assert.equal(isBackendOnlyFile('src/features/runtime/backendRuntime.ts'), true);
  assert.equal(
    classifyDelivery({
      changes: [
        { status: 'M', path: 'server.ts' },
        { status: 'M', path: 'docs/runtime.md' }
      ],
      readBefore: () => 'ancien backend',
      readAfter: () => 'nouveau backend'
    }).mode,
    'backend'
  );
});

test('SEENIT-QUALITY-006 une modification frontend structurelle reste APK', () => {
  assert.equal(
    classifyDelivery({
      changes: [{ status: 'M', path: 'src/App.tsx' }],
      readBefore: () => `export const App = () => <main>SeenIt</main>;`,
      readAfter: () => `export const App = () => <main onClick={() => alert('x')}>SeenIt</main>;`
    }).mode,
    'apk'
  );
});

test('SEENIT-QUALITY-006 détecte les dépendances sans transformer les fichiers CI en APK', () => {
  const dependencyChange = classifyDelivery({
    changes: [{ status: 'M', path: 'package-lock.json' }],
    readBefore: () => '',
    readAfter: () => ''
  });
  assert.equal(dependencyChange.mode, 'apk');
  assert.equal(dependencyChange.dependenciesChanged, true);

  const ciChange = classifyDelivery({
    changes: [{ status: 'M', path: '.github/workflows/build-apk.yml' }],
    readBefore: () => '',
    readAfter: () => ''
  });
  assert.equal(ciChange.mode, 'light');
  assert.equal(ciChange.dependenciesChanged, false);
});

test('SEENIT-QUALITY-006 permet de forcer le parcours complet mais jamais le parcours light', () => {
  const input = {
    changes: [{ status: 'M', path: 'README.md' }],
    readBefore: () => '',
    readAfter: () => ''
  };
  assert.equal(classifyDelivery({ ...input, forcedMode: 'apk' }).mode, 'apk');
  assert.throws(() => classifyDelivery({ ...input, forcedMode: 'light' }), /invalide/);
});
