import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };
const { validateAndroidContract } = require('../scripts/validate-android-contract.cjs') as {
  validateAndroidContract: () => {
    contract: {
      applicationId: string;
      applicationVersion: string;
      signing: { path: string; source: string; secretName: string; sha256: string };
      gradleWrapper: { sha256: string; distributionSha256Sum: string };
      generatedFiles: string[];
    };
    assetCount: number;
    signingMaterialized: boolean;
  };
};

test('SEENIT-APK-001 verrouille l’identité, la version et la clé de signature de l’APK', () => {
  const result = validateAndroidContract();
  assert.equal(result.contract.applicationId, 'com.seenit.app');
  assert.equal(result.contract.applicationVersion, packageJson.version);
  assert.equal(result.contract.signing.path, 'android/app/debug.keystore');
  assert.equal(result.contract.signing.source, 'github-secret');
  assert.equal(result.contract.signing.secretName, 'SEENIT_ANDROID_KEYSTORE_B64');
  assert.equal(result.contract.signing.sha256, '184991ec7f1d7db579676e4896fa0d438725c2d1d026827db5bb471693955673');
  assert.ok(result.contract.generatedFiles.includes(result.contract.signing.path));
  assert.equal(result.contract.gradleWrapper.sha256, '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172');
  assert.equal(result.contract.gradleWrapper.distributionSha256Sum, 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c');
});

test('SEENIT-APK-002 conserve toutes les icônes du lanceur et leur identité visuelle', () => {
  const result = validateAndroidContract();
  assert.ok(result.assetCount >= 19);
});
