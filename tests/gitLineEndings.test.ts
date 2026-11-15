import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

test('#654 un checkout Windows (core.autocrlf=true) garde les artefacts canoniques en LF', () => {
  const root = mkdtempSync(join(tmpdir(), 'seenit-eol-'));
  try {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'seenit-test@example.invalid');
    git(root, 'config', 'user.name', 'SeenIt Test');
    git(root, 'config', 'core.autocrlf', 'false');
    copyFileSync('.gitattributes', join(root, '.gitattributes'));
    mkdirSync(join(root, 'docs'));
    const json = '{\n  "requirements": []\n}\n';
    writeFileSync(join(root, 'docs', 'requirements.json'), json);
    writeFileSync(join(root, 'source.ts'), 'export const a = 1;\nexport const b = 2;\n');
    writeFileSync(join(root, 'gradlew.bat'), '@echo off\r\nexit /b 0\r\n');
    writeFileSync(join(root, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'fixture');

    // Paramètres Git usuels d'un poste Windows, puis checkout propre.
    git(root, 'config', 'core.autocrlf', 'true');
    for (const file of ['docs/requirements.json', 'source.ts', 'gradlew.bat', 'icon.png']) rmSync(join(root, file));
    git(root, 'checkout', '--', '.');

    assert.equal(readFileSync(join(root, 'docs', 'requirements.json'), 'utf8'), json, 'JSON canonique identique octet pour octet');
    assert.doesNotMatch(readFileSync(join(root, 'source.ts'), 'utf8'), /\r/, 'source lue par les TNR sans CR');
    assert.equal(readFileSync(join(root, 'gradlew.bat'), 'utf8'), '@echo off\r\nexit /b 0\r\n', 'script Windows conservé');
    assert.deepEqual([...readFileSync(join(root, 'icon.png'))], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'binaire intact');
    assert.equal(git(root, 'status', '--porcelain'), '', 'aucun diff parasite après checkout');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('#654 aucun fichier texte suivi n’est stocké en CRLF ou mixte, hormis le wrapper Windows', () => {
  const offenders = git('.', 'ls-files', '--eol').split('\n')
    .filter(line => /^i\/(crlf|mixed)\s/.test(line))
    .map(line => line.split('\t').at(-1));
  assert.deepEqual(offenders, ['android/gradlew.bat']);
});
