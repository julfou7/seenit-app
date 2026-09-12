import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  readClassification,
  resolveNpmInvocation,
  writeGithubOutput
} = require('../scripts/validate-change.cjs') as {
  readClassification: (outputPath: string) => { mode: string; dependenciesChanged: boolean };
  resolveNpmInvocation: (
    platform?: string,
    commandInterpreter?: string
  ) => { command: string; prefix: string[] };
  writeGithubOutput: (
    classification: { mode: string; dependenciesChanged: boolean },
    outputPath?: string
  ) => void;
};

test('SEENIT-QUALITY-007 lance npm via l’interpréteur natif sous Windows', () => {
  assert.deepEqual(resolveNpmInvocation('win32', 'C:\\Windows\\System32\\cmd.exe'), {
    command: 'C:\\Windows\\System32\\cmd.exe',
    prefix: ['/d', '/s', '/c', 'npm']
  });
  assert.deepEqual(resolveNpmInvocation('linux'), { command: 'npm', prefix: [] });
});

test('SEENIT-QUALITY-007 relit la classification produite par le classificateur', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seenit-validation-'));
  const outputPath = path.join(directory, 'classification.out');
  try {
    fs.writeFileSync(outputPath, 'DELIVERY_MODE=backend\nDEPENDENCIES_CHANGED=false\n', 'utf8');
    assert.deepEqual(readClassification(outputPath), {
      mode: 'backend',
      dependenciesChanged: false
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-007 transmet la classification à GitHub Actions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seenit-validation-'));
  const outputPath = path.join(directory, 'github.out');
  try {
    fs.writeFileSync(outputPath, 'EXISTING=value\n', 'utf8');
    writeGithubOutput({ mode: 'light', dependenciesChanged: false }, outputPath);
    const output = fs.readFileSync(outputPath, 'utf8');
    assert.match(output, /EXISTING=value/);
    assert.match(output, /DELIVERY_MODE=light/);
    assert.match(output, /DEPENDENCIES_CHANGED=false/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SEENIT-QUALITY-007 conserve l’audit de dépendances dans la sortie CI', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seenit-validation-'));
  const outputPath = path.join(directory, 'github.out');
  try {
    writeGithubOutput({ mode: 'apk', dependenciesChanged: true }, outputPath);
    const output = fs.readFileSync(outputPath, 'utf8');
    assert.match(output, /DELIVERY_MODE=apk/);
    assert.match(output, /DEPENDENCIES_CHANGED=true/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
