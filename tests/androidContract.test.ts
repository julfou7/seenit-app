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
      signing: {
        path: string;
        source: string;
        secretName: string;
        storePasswordSecretName: string;
        keyPasswordSecretName: string;
        storeType: string;
        keyAlias: string;
        sha256: string;
        certificateSha1: string;
        certificateSha256: string;
        migration: {
          mode: string;
          legacySignerSha256: string;
          currentSignerSha256: string;
        };
      };
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
  assert.equal(result.contract.signing.path, 'android/app/seenit-release.p12');
  assert.equal(result.contract.signing.source, 'github-secret');
  assert.equal(result.contract.signing.secretName, 'SEENIT_ANDROID_RELEASE_KEYSTORE_B64');
  assert.equal(result.contract.signing.storePasswordSecretName, 'SEENIT_ANDROID_RELEASE_STORE_PASSWORD');
  assert.equal(result.contract.signing.keyPasswordSecretName, 'SEENIT_ANDROID_RELEASE_KEY_PASSWORD');
  assert.equal(result.contract.signing.storeType, 'PKCS12');
  assert.equal(result.contract.signing.keyAlias, 'seenit');
  assert.equal(result.contract.signing.sha256, 'c3717020614206f9934c46f9206b5639df5d473c7d2b51d83f60b7a7e9f5c57b');
  assert.equal(result.contract.signing.certificateSha1, '012e70194ababcdbe5bb5994d1cbe0944fd21f73');
  assert.equal(result.contract.signing.certificateSha256, 'c8f9245671c6e4e73baf55281280ada35ff80bbe7dce800b29d2bb7d7f247853');
  assert.equal(result.contract.signing.migration.mode, 'reinstall-once');
  assert.equal(result.contract.signing.migration.legacySignerSha256, 'ab3897d47a966e0386824ea6c5c90e617738e8b9ac6216a268411715289988cd');
  assert.equal(result.contract.signing.migration.currentSignerSha256, result.contract.signing.certificateSha256);
  assert.ok(result.contract.generatedFiles.includes(result.contract.signing.path));
  assert.equal(result.contract.gradleWrapper.sha256, '7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172');
  assert.equal(result.contract.gradleWrapper.distributionSha256Sum, 'ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c');
});

test('SEENIT-APK-002 conserve toutes les icônes du lanceur et leur identité visuelle', () => {
  const result = validateAndroidContract();
  assert.ok(result.assetCount >= 19);
});
