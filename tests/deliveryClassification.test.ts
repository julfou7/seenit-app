import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  classifyDelivery,
  isCopyOnlySourceChange,
  isNonRuntimeFile
} = require('../scripts/classify-delivery.cjs') as {
  classifyDelivery: (input: {
    changes: Array<{ status: string; path: string }>;
    readBefore: (file: string) => string;
    readAfter: (file: string) => string;
    forcedMode?: string;
  }) => { mode: 'light' | 'apk'; reasons: string[] };
  isCopyOnlySourceChange: (file: string, before: string, after: string) => boolean;
  isNonRuntimeFile: (file: string) => boolean;
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
  assert.equal(isNonRuntimeFile('docs/specifications/requirements.json'), false);
  assert.equal(
    classifyDelivery({
      changes: [
        { status: 'M', path: 'README.md' },
        { status: 'M', path: 'tests/example.test.ts' }
      ],
      readBefore: () => '',
      readAfter: () => ''
    }).mode,
    'light'
  );
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
