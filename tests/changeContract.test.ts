import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  analyzeRequirementsChurn,
  isVersionOnlyJsonChange,
  isVersionOnlyPatch,
  isPureVersionAlignment,
  requiresSpecification
} = require('../scripts/validate-change-contract.cjs') as {
  analyzeRequirementsChurn: (before: string, after: string) => {
    excessive: boolean;
    lineChurn: number;
    lineBudget: number;
    changedRequirements: string[];
  };
  isVersionOnlyJsonChange: (file: string, before: string, after: string) => boolean;
  isVersionOnlyPatch: (file: string, patch: string) => boolean;
  isPureVersionAlignment: (
    files: string[],
    readPatch: (file: string) => string,
    readBefore?: (file: string) => string,
    readAfter?: (file: string) => string
  ) => boolean;
  requiresSpecification: (file: string) => boolean;
};

test('SEENIT-QUALITY-009 refuse un reformatage massif du catalogue pour un changement ciblé', () => {
  const before = readFileSync('docs/specifications/requirements.json', 'utf8');
  const parsed = JSON.parse(before);
  const extraRequirement = {
    id: 'SEENIT-TEST-999',
    title: 'Fixture de test',
    targets: ['ci'],
    tests: [{ file: 'tests/changeContract.test.ts', contains: 'fixture' }]
  };
  const reformatted = `${JSON.stringify({
    ...parsed,
    requirements: [...parsed.requirements, extraRequirement]
  }, null, 4)}\n`;
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const closingIndex = before.lastIndexOf(`${eol}  ]`);
  assert.ok(closingIndex > 0, 'la fin du tableau requirements doit être trouvée');
  const targeted = `${before.slice(0, closingIndex)},${eol}    ${JSON.stringify(extraRequirement)}${before.slice(closingIndex)}`;

  const excessive = analyzeRequirementsChurn(before, reformatted);
  assert.equal(excessive.changedRequirements.length, 1);
  assert.equal(excessive.excessive, true);
  assert.ok(excessive.lineChurn > excessive.lineBudget);

  const bounded = analyzeRequirementsChurn(before, targeted);
  assert.equal(bounded.changedRequirements.length, 1);
  assert.equal(bounded.excessive, false);
});

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

test('le contrat SPEC tolère une différence de fin de fichier sans effet pendant le bump de version', () => {
  const patch = '@@ -4 +4 @@\n-Version applicative : **1.4.112**\n+Version applicative : **1.4.113**\n@@ -714 +714 @@\n-- TNR : invariant inchangé.\n+- TNR : invariant inchangé.\n\\ No newline at end of file';
  assert.equal(isVersionOnlyPatch('docs/specifications/seenit.md', patch), true);

  const samePatchWithoutMarker = patch.replace('\n\\ No newline at end of file', '');
  assert.equal(isVersionOnlyPatch('docs/specifications/seenit.md', samePatchWithoutMarker), false);
});

test('le contrat SPEC accepte un reformatage JSON si seuls les champs de version changent', () => {
  const before: Record<string, string> = {
    'docs/specifications/android-contract.json': '{"applicationVersion":"1.4.111","versionCode":104111,"androidPackageName":"com.seenit.app"}',
    'docs/specifications/requirements.json': '{"schemaVersion":1,"applicationVersion":"1.4.111","requirements":[{"id":"SEENIT-APK-001"}]}'
  };
  const after: Record<string, string> = {
    'docs/specifications/android-contract.json': JSON.stringify({
      applicationVersion: '1.4.112',
      versionCode: 104112,
      androidPackageName: 'com.seenit.app'
    }, null, 2),
    'docs/specifications/requirements.json': JSON.stringify({
      schemaVersion: 1,
      applicationVersion: '1.4.112',
      requirements: [{ id: 'SEENIT-APK-001' }]
    }, null, 2)
  };

  assert.equal(
    isPureVersionAlignment(
      Object.keys(before),
      () => '',
      file => before[file],
      file => after[file]
    ),
    true
  );
});

test('le contrat SPEC refuse un reformatage JSON qui masque un changement sémantique', () => {
  const before = '{"schemaVersion":1,"applicationVersion":"1.4.111","requirements":[{"id":"SEENIT-APK-001"}]}';
  const after = JSON.stringify({
    schemaVersion: 1,
    applicationVersion: '1.4.112',
    requirements: [{ id: 'SEENIT-APK-999' }]
  }, null, 2);

  assert.equal(
    isVersionOnlyJsonChange('docs/specifications/requirements.json', before, after),
    false
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
