import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  findPreviousReleaseTag,
  generateReleaseNotes
} = require('../scripts/generate-release-notes.cjs') as {
  findPreviousReleaseTag: (version: string, cwd?: string) => string | null;
  generateReleaseNotes: (options?: { version?: string; cwd?: string }) => string;
};

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  }).trim();
}

function commitFile(cwd: string, value: string, subject: string, body?: string) {
  writeFileSync(join(cwd, 'state.txt'), value, 'utf8');
  git(cwd, 'add', 'state.txt');
  const args = ['commit', '-m', subject];
  if (body) args.push('-m', body);
  git(cwd, ...args);
}

test('SEENIT-RELEASE-003 agrège tous les commits de la version au lieu du seul dernier commit', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'seenit-release-notes-'));

  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.email', 'seenit-tests@example.test');
    git(cwd, 'config', 'user.name', 'SeenIt Tests');

    commitFile(cwd, 'base', 'chore: base 1.4.80');
    git(cwd, 'tag', 'v1.4.80');

    commitFile(
      cwd,
      'feature',
      'feat(qualité): verrouiller la fiabilité de l’APK SeenIt',
      '- protège identité, signature et actifs Android\n- fiabilise les mises à jour APK avec SHA-256'
    );
    commitFile(
      cwd,
      'fix',
      'fix(ci): valider le wrapper Gradle officiel',
      '- remplace le wrapper non reconnu par Gradle officiel\n- vérifie la distribution Gradle par SHA-256'
    );

    const notes = generateReleaseNotes({ version: '1.4.81', cwd });

    assert.match(notes, /protège identité, signature et actifs Android/);
    assert.match(notes, /fiabilise les mises à jour APK avec SHA-256/);
    assert.match(notes, /remplace le wrapper non reconnu par Gradle officiel/);
    assert.match(notes, /vérifie la distribution Gradle par SHA-256/);
    assert.ok(
      notes.indexOf('protège identité') < notes.indexOf('remplace le wrapper'),
      'les notes doivent conserver l’ordre chronologique des commits de la version'
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('SEENIT-RELEASE-003 ignore le tag de la version courante pour retrouver la vraie version précédente', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'seenit-release-tag-'));

  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.email', 'seenit-tests@example.test');
    git(cwd, 'config', 'user.name', 'SeenIt Tests');

    commitFile(cwd, 'base', 'chore: base 1.4.80');
    git(cwd, 'tag', 'v1.4.80');
    commitFile(cwd, 'release', 'fix: correctif 1.4.81', '- corrige le comportement');
    git(cwd, 'tag', 'v1.4.81');

    assert.equal(findPreviousReleaseTag('1.4.81', cwd), 'v1.4.80');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
