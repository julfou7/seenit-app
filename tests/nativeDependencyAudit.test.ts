import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { nativeAuditFindings } = require('../scripts/audit-native-dependencies.cjs');

test('SEENIT-RELEASE-002 refuse les alertes natives même classées dev', () => {
  const report = { vulnerabilities: {
    '@capacitor/android': { name: '@capacitor/android', severity: 'critical', isDirect: true, nodes: ['node_modules/@capacitor/android'] },
    '@capacitor/ios': { name: '@capacitor/ios', severity: 'high' },
    sharp: { name: 'sharp', severity: 'high' },
  } };
  assert.deepEqual(nativeAuditFindings(report).map((finding: { name: string }) => finding.name), ['@capacitor/android', '@capacitor/ios']);
  assert.deepEqual(nativeAuditFindings({ vulnerabilities: { sharp: report.vulnerabilities.sharp } }), []);
});

test('SEENIT-RELEASE-002 refuse un rapport natif absent ou une erreur de registre', () => {
  for (const report of [null, {}, { error: { code: 'EAI_AGAIN' } }, { error: {}, vulnerabilities: {} }]) {
    assert.throws(() => nativeAuditFindings(report), /invalide/);
  }
  assert.deepEqual(nativeAuditFindings({ vulnerabilities: {} }), []);
});

test('SEENIT-RELEASE-002 branche le contrôle natif dans la validation et la release', () => {
  for (const file of ['scripts/validate-change.cjs', '.github/workflows/build-apk.yml']) {
    assert.match(readFileSync(file, 'utf8'), /scripts\/audit-native-dependencies\.cjs/);
  }
});
