const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'docs/specifications/android-contract.json');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodeKeystorePayload(encodedValue, expectedSha256) {
  const normalized = String(encodedValue || '').replace(/\s+/g, '');
  if (!normalized) {
    throw new Error('Secret de keystore Android absent.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('Secret de keystore Android : Base64 invalide.');
  }

  const payload = Buffer.from(normalized, 'base64');
  if (!payload.length || payload.toString('base64') !== normalized) {
    throw new Error('Secret de keystore Android : Base64 invalide.');
  }

  const actualSha256 = sha256(payload);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Empreinte du keystore Android inattendue : ${actualSha256}.`);
  }
  return payload;
}

function loadSigningContract() {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const signing = contract.signing || {};
  if (signing.source !== 'github-secret') {
    throw new Error('Source de signature Android invalide : github-secret attendu.');
  }
  const required = [
    'secretName', 'storePasswordSecretName', 'keyPasswordSecretName', 'path',
    'storeType', 'keyAlias', 'sha256', 'certificateSha1', 'certificateSha256'
  ];
  for (const key of required) {
    if (!signing[key]) throw new Error(`Contrat de signature Android incomplet : ${key}.`);
  }
  if (signing.storeType !== 'PKCS12' || signing.keyAlias !== 'seenit') {
    throw new Error('Contrat de signature Android invalide : PKCS12 / alias seenit attendus.');
  }
  if (!/^[a-f0-9]{64}$/i.test(signing.sha256)
      || !/^[a-f0-9]{40}$/i.test(signing.certificateSha1)
      || !/^[a-f0-9]{64}$/i.test(signing.certificateSha256)) {
    throw new Error('Empreintes du contrat de signature Android invalides.');
  }
  return signing;
}

function requireSecretValue(secretName, label) {
  const value = String(process.env[secretName] || '');
  if (!value) throw new Error(`${label} absent (${secretName}).`);
  return value;
}

function materializeAndroidKeystore() {
  const signing = loadSigningContract();
  const payload = decodeKeystorePayload(process.env[signing.secretName], signing.sha256);
  requireSecretValue(signing.storePasswordSecretName, 'Mot de passe du keystore Android');
  requireSecretValue(signing.keyPasswordSecretName, 'Mot de passe de la clé Android');

  const outputPath = path.resolve(root, signing.path);
  if (!outputPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Chemin de keystore hors dépôt refusé : ${signing.path}.`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, payload, { mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(outputPath, 0o600);
  }

  return {
    path: signing.path,
    sha256: signing.sha256,
    secretName: signing.secretName,
    storeType: signing.storeType,
    keyAlias: signing.keyAlias
  };
}

if (require.main === module) {
  try {
    const result = materializeAndroidKeystore();
    console.log(`[Android Signing] Keystore release ${result.storeType}/${result.keyAlias} matérialisé dans ${result.path} et empreinte vérifiée.`);
  } catch (error) {
    console.error(`[Android Signing] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  decodeKeystorePayload,
  loadSigningContract,
  materializeAndroidKeystore,
  requireSecretValue,
  sha256
};
