import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { decodeKeystorePayload } = require('../scripts/materialize-android-keystore.cjs') as {
  decodeKeystorePayload: (encodedValue: string | undefined, expectedSha256: string) => Buffer;
};

const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

test('SEENIT-APK-001 refuse toute clé matérialisée dont l’empreinte diffère du contrat', () => {
  const fixture = Buffer.from('seenit-keystore-historique-fixture', 'utf8');
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
