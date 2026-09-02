import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  isVersionOnlyPatch,
  isPureVersionAlignment,
  requiresSpecification
} = require('../scripts/validate-change-contract.cjs') as {
  isVersionOnlyPatch: (file: string, patch: string) => boolean;
  isPureVersionAlignment: (files: string[], readPatch: (file: string) => string) => boolean;
  requiresSpecification: (file: string) => boolean;
};

test('le contrat SPEC reconnaît un alignement version:sync complet comme non comportemental', () => {
  const patches: Record<string, string> = {
    'android/app/build.gradle': '@@ -10,2 +10,2 @@\n- versionCode 104083\n- versionName "1.4.83"\n+ versionCode 104084\n+ versionName "1.4.84"',
    'docs/specifications/android-contract.json': '@@ -2,2 +2,2 @@\n- "applicationVersion": "1.4.83",\n- "versionCode": 104083,\n+ "applicationVersion": "1.4.84",\n+ "versionCode": 104084,',
    'docs/specifications/requirements.json': '@@ -2 +2 @@\n- "applicationVersion": "1.4.83",\n+ "applicationVersion": "1.4.84",',
    'docs/specifications/seenit.md': '@@ -4 +4 @@\n-Version applicative : **1.4.83**\n+Version applicative : **1.4.84**',
    'package-lock.json': '@@ -3 +3 @@\n- "version": "1.4.83",\n+ "version": "1.4.84",',
    'package.json': '@@ -4 +4 @@\n- "version": "1.4.83",\n+ "version": "1.4.84",',
    'server.ts': "@@ -560 +560 @@\n- 'X-Plex-Version': '1.4.83',\n+ 'X-Plex-Version': '1.4.84',",
    'src/store/updateStore.ts': "@@ -12 +12 @@\n-export const CURRENT_APP_VERSION = '1.4.83';\n+export const CURRENT_APP_VERSION = '1.4.84';"
  };

  assert.equal(
    isPureVersionAlignment(Object.keys(patches), file => patches[file]),
    true
  );
});

test('le contrat SPEC refuse d’exempter une vraie modification de server.ts mêlée au numéro de version', () => {
  const patch = "@@ -560,2 +560,2 @@\n- 'X-Plex-Version': '1.4.83',\n- timeout: 5000\n+ 'X-Plex-Version': '1.4.84',\n+ timeout: 15000";
  assert.equal(isVersionOnlyPatch('server.ts', patch), false);
});

test('le contrat SPEC refuse tout fichier inconnu même si sa ligne ressemble à une version', () => {
  assert.equal(
    isPureVersionAlignment(
      ['src/lib/firebase.ts'],
      () => "@@ -1 +1 @@\n-export const VERSION = '1.4.83';\n+export const VERSION = '1.4.84';"
    ),
    false
  );
});

test('SEENIT-QUALITY-001 réserve la SPEC complète aux zones sensibles ou règles durables', () => {
  assert.equal(requiresSpecification('src/lib/firebase.ts'), true);
  assert.equal(requiresSpecification('src/lib/apiAuth.ts'), true);
  assert.equal(requiresSpecification('src/features/plex/plexIdentity.ts'), true);
  assert.equal(requiresSpecification('android/app/src/main/AndroidManifest.xml'), true);
  assert.equal(requiresSpecification('capacitor.config.ts'), true);

  assert.equal(requiresSpecification('server.ts'), false);
  assert.equal(requiresSpecification('src/components/Toast.tsx'), false);
  assert.equal(requiresSpecification('src/screens/WatchListScreen.tsx'), false);
});
