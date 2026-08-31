import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateAndroidContract } = require('../scripts/validate-android-contract.cjs') as {
  validateAndroidContract: () => { contract: { applicationId: string; applicationVersion: string }; assetCount: number };
};

test('SEENIT-APK-001 verrouille l’identité, la version et la clé de signature de l’APK', () => {
  const result = validateAndroidContract();
  assert.equal(result.contract.applicationId, 'com.seenit.app');
  assert.equal(result.contract.applicationVersion, '1.4.81');
});

test('SEENIT-APK-002 conserve toutes les icônes du lanceur et leur identité visuelle', () => {
  const result = validateAndroidContract();
  assert.ok(result.assetCount >= 19);
});
