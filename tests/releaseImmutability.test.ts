import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  evaluateReleaseCandidate,
  parseAndroidVersion,
  selectBaseRef
} = require('../scripts/validate-release-immutability.cjs') as {
  evaluateReleaseCandidate: (input: {
    current: { versionName: string; versionCode: number };
    previous: { versionName: string; versionCode: number };
    tagExists?: boolean;
    releaseExists?: boolean;
  }) => { ok: boolean; errors: string[] };
  parseAndroidVersion: (source: string) => { versionName: string; versionCode: number };
  selectBaseRef: (value?: string) => string;
};

const previous = { versionName: '1.4.86', versionCode: 104086 };
const next = { versionName: '1.4.87', versionCode: 104087 };
const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
const agentRules = readFileSync('AGENTS.md', 'utf8');

test('SEENIT-RELEASE-004 refuse une release quand son tag ou sa publication existe déjà', () => {
  const withTag = evaluateReleaseCandidate({ current: next, previous, tagExists: true });
  const withRelease = evaluateReleaseCandidate({ current: next, previous, releaseExists: true });
  assert.equal(withTag.ok, false);
  assert.match(withTag.errors.join(' '), /tag v1\.4\.87 existe déjà/);
  assert.equal(withRelease.ok, false);
  assert.match(withRelease.errors.join(' '), /release v1\.4\.87 existe déjà/);
});

test('SEENIT-RELEASE-004 refuse un push documentaire à version inchangée ou régressive', () => {
  const unchanged = evaluateReleaseCandidate({ current: previous, previous });
  const lowerCode = evaluateReleaseCandidate({
    current: { versionName: '1.4.87', versionCode: 104085 },
    previous
  });
  assert.equal(unchanged.ok, false);
  assert.match(unchanged.errors.join(' '), /strictement supérieure/);
  assert.match(unchanged.errors.join(' '), /strictement supérieur/);
  assert.equal(lowerCode.ok, false);
});

test('SEENIT-RELEASE-004 accepte uniquement une progression N vers N+1 cohérente', () => {
  assert.deepEqual(parseAndroidVersion('versionCode 104087\nversionName "1.4.87"'), next);
  assert.equal(evaluateReleaseCandidate({ current: next, previous }).ok, true);
  assert.equal(
    evaluateReleaseCandidate({
      current: { versionName: '1.4.87', versionCode: 104999 },
      previous
    }).ok,
    false
  );
  assert.equal(selectBaseRef('0'.repeat(40)), 'HEAD^');
});

test('SEENIT-RELEASE-004 sépare le build de la publication et vérifie la paire APK SHA-256', () => {
  assert.match(workflow, /^permissions:\s+contents: read/m);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /^\s{2}build:/m);
  assert.match(workflow, /^\s{2}publish:/m);
  assert.match(workflow, /publish:[\s\S]+needs: \[build, android_upgrade_smoke\]/);
  assert.match(workflow, /publish:[\s\S]+permissions:\s+contents: write/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /sha256sum --check/);
  assert.match(workflow, /overwrite_files: false/);
  assert.match(workflow, /fail_on_unmatched_files: true/);
  assert.equal((workflow.match(/validate-release-immutability\.cjs/g) || []).length, 2);
  assert.match(agentRules, /ne le contournez jamais/);
  assert.match(agentRules, /n'autorisez jamais l'écrasement/);
});
