import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const spec = readFileSync('docs/specifications/seenit.md', 'utf8');
const requirementsSource = readFileSync('docs/specifications/requirements.json', 'utf8');
const delivery = readFileSync('docs/process/delivery.md', 'utf8');
const runbook = readFileSync('docs/process/play-protect-sideload.md', 'utf8');
const contract = JSON.parse(readFileSync('docs/specifications/android-contract.json', 'utf8'));

test('SEENIT-APK-006 distingue la vérification développeur de la réputation Play Protect hors Play', () => {
  assert.match(spec, /SEENIT-APK-006/);
  assert.match(requirementsSource, /"id": "SEENIT-APK-006"/);
  assert.match(delivery, /play-protect-sideload\.md/);

  assert.match(runbook, /Android Developer Verification/);
  assert.match(runbook, /Google Play Protect/);
  assert.match(runbook, /Analyse d'appli recommandée/);
  assert.match(runbook, /ne\s+garantit pas|aucune.*garanti/is);
  assert.match(runbook, /ne jamais désactiver Play Protect/i);

  assert.equal(contract.applicationId, 'com.seenit.app');
  assert.equal(
    contract.signing.certificateSha256,
    'c8f9245671c6e4e73baf55281280ada35ff80bbe7dce800b29d2bb7d7f247853',
  );
  assert.match(runbook, new RegExp(contract.applicationId.replaceAll('.', '\\.'), 'g'));
  assert.match(runbook, new RegExp(contract.signing.certificateSha256, 'g'));
});
