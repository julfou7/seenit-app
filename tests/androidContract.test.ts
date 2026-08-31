import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateAndroidContract } = require('../scripts/validate-android-contract.cjs') as {
  validateAndroidContract: () => {
    contract: {
      applicationId: string;
      applicationVersion: string;
      gradleWrapper: { sha256: string; distributionSha256Sum: string };
    };
    assetCount: number;
  };
};

test('SEENIT-APK-001 verrouille l’identité, la version et la clé de signature de l’APK', () => {
  const result = validateAndroidContract();
  assert.equal(result.contract.applicationId, 'com.seenit.app');
  assert.equal(result.contract.applicationVersion, '1.4.82');
  assert.equal(result.contract.gradleWrapper.sha256, '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172');
  assert.equal(result.contract.gradleWrapper.distributionSha256Sum, 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c');
});

test('SEENIT-APK-002 conserve toutes les icônes du lanceur et leur identité visuelle', () => {
  const result = validateAndroidContract();
  assert.ok(result.assetCount >= 19);
});
