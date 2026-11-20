import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { nativeAuditFindings, main, NATIVE_AUDIT_TIMEOUT_MS } = require('../scripts/audit-native-dependencies.cjs');

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

test('SEENIT-RELEASE-002 borne et diagnostique les audits natifs indisponibles sans secret', () => {
  const secret = 'CANARY_PRIVATE_TOKEN';
  const message = `https://user:${secret}@registry.example/private Bearer ${secret}`;
  const cases = [
    { result: { error: { code: 'ETIMEDOUT', message } }, expected: /120 s.*ETIMEDOUT.*délai dépassé/ },
    { result: { error: { code: 'ENOENT', message } }, expected: /ENOENT.*introuvable/ },
    { result: { error: { code: secret, message } }, expected: /erreur npm non reconnue/ },
    { result: { status: 1, stdout: message }, expected: /JSON absent ou illisible/ },
    { result: { status: 1, stdout: JSON.stringify({ error: { code: 'EAI_AGAIN', summary: message, detail: message } }) }, expected: /EAI_AGAIN.*DNS/ },
    { result: { status: 5, stdout: JSON.stringify({ error: { code: 'E503', summary: message } }) }, expected: /E503.*indisponible/ },
    { result: { status: 1, stdout: JSON.stringify({ error: { code: secret, summary: message } }) }, expected: /détail externe masqué/ },
    { result: { status: 2, stdout: '{"vulnerabilities":{}}' }, expected: /code 2/ },
    { result: { status: null, stdout: '{"vulnerabilities":{}}' }, expected: /interrompu/ },
    { result: { status: 0, stdout: '{}' }, expected: /invalide/ },
  ];
  for (const { result, expected } of cases) {
    let calls = 0;
    assert.throws(() => main((_command: string, args: string[], options: { timeout: number; killSignal: string }) => {
      calls++;
      assert.deepEqual(args.slice(-2), ['audit', '--json']);
      assert.equal(options.timeout, 120_000);
      assert.equal(options.killSignal, 'SIGKILL');
      return { stderr: message, ...result };
    }), (error: Error) => {
      assert.match(error.message, expected);
      assert.ok(error.message.length < 220);
      assert.ok(!error.message.includes(secret));
      assert.ok(!error.message.includes('registry.example'));
      return true;
    });
    assert.equal(calls, 1, 'aucune relance automatique');
  }
});

test('SEENIT-RELEASE-002 interrompt réellement un processus natif bloqué', () => {
  const started = Date.now();
  assert.throws(() => main((_command: string, _args: string[], options: { timeout: number }) => {
    assert.equal(options.timeout, NATIVE_AUDIT_TIMEOUT_MS);
    // Même spawn et mêmes options que la CLI, avec une échéance courte pour ce TNR.
    return spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { ...options, timeout: 100 });
  }), /ETIMEDOUT/);
  assert.ok(Date.now() - started < 10_000);
});

test('SEENIT-RELEASE-002 conserve le verdict natif au point d’entrée CLI', () => {
  for (const severity of ['high', 'critical']) {
    const report = { vulnerabilities: { '@capacitor/android': { name: '@capacitor/android', severity } } };
    assert.throws(() => main(() => ({ status: 1, stdout: JSON.stringify(report) })), new RegExp(`@capacitor/android: ${severity}`));
  }
  // npm retourne 1 pour une alerte d'outillage hors du runtime natif ciblé.
  assert.doesNotThrow(() => main(() => ({ status: 1, stdout: JSON.stringify({ vulnerabilities: { tool: { name: 'tool', severity: 'high' } } }) })));
  assert.doesNotThrow(() => main(() => ({ status: 0, stdout: '{"vulnerabilities":{}}' })));
});
