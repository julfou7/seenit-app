import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { decodeKeystorePayload, requireSecretValue } = require('../scripts/materialize-android-keystore.cjs') as {
  decodeKeystorePayload: (encodedValue: string | undefined, expectedSha256: string) => Buffer;
  requireSecretValue: (secretName: string, label: string) => string;
};

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

test('SEENIT-APK-001 refuse toute clé matérialisée dont l’empreinte diffère du contrat', () => {
  const fixture = Buffer.from('seenit-keystore-release-fixture', 'utf8');
  const encoded = fixture.toString('base64');
  const expected = sha256(fixture);

  assert.deepEqual(decodeKeystorePayload(encoded, expected), fixture);
  assert.throws(
    () => decodeKeystorePayload(encoded, '0'.repeat(64)),
    /Empreinte du keystore Android inattendue/
  );
  assert.throws(
    () => decodeKeystorePayload('%%%pas-du-base64%%%', expected),
    /Base64 invalide/
  );
  assert.throws(
    () => decodeKeystorePayload('', expected),
    /Secret de keystore Android absent/
  );
});

test('SEENIT-APK-001 exige les mots de passe de la clé release sans les exposer', () => {
  const secretName = 'SEENIT_TEST_SIGNING_PASSWORD';
  const previous = process.env[secretName];
  try {
    delete process.env[secretName];
    assert.throws(
      () => requireSecretValue(secretName, 'Mot de passe test'),
      new RegExp(`${secretName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );
    process.env[secretName] = 'valeur-test-non-persistée';
    assert.equal(requireSecretValue(secretName, 'Mot de passe test'), 'valeur-test-non-persistée');
  } finally {
    if (previous === undefined) delete process.env[secretName];
    else process.env[secretName] = previous;
  }
});
