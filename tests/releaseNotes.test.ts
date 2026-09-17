import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildReleaseBody,
  extractCommitNotes,
  findPreviousReleaseTag,
  generateReleaseNotes
} = require('../scripts/generate-release-notes.cjs') as {
  buildReleaseBody: (commits: Array<{ hash: string; message: string }>) => string;
  extractCommitNotes: (message: string) => string[];
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
      'Changelog:\n- L’APK conserve son identité lors des mises à jour\n- Les mises à jour restent vérifiables par empreinte SHA-256\n\nDétails techniques:\n- protège identité, signature et actifs Android'
    );
    commitFile(
      cwd,
      'fix',
      'fix(ci): valider le wrapper Gradle officiel',
      'Changelog:\n- Les mises à jour Android utilisent le wrapper Gradle officiel\n- La distribution Gradle reste vérifiée avant la construction\n\nDétails techniques:\n- vérifie la distribution Gradle par SHA-256'
    );

    const notes = generateReleaseNotes({ version: '1.4.81', cwd });

    assert.match(notes, /L’APK conserve son identité lors des mises à jour\./);
    assert.match(notes, /Les mises à jour restent vérifiables par empreinte SHA-256\./);
    assert.match(notes, /Les mises à jour Android utilisent le wrapper Gradle officiel\./);
    assert.match(notes, /La distribution Gradle reste vérifiée avant la construction\./);
    assert.doesNotMatch(notes, /protège identité|Détails techniques/i);
    assert.ok(
      notes.indexOf('L’APK conserve') < notes.indexOf('Les mises à jour Android'),
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
    commitFile(cwd, 'release', 'fix: correctif 1.4.81', 'Changelog:\n- Le correctif restaure le comportement attendu.');
    git(cwd, 'tag', 'v1.4.81');

    assert.equal(findPreviousReleaseTag('1.4.81', cwd), 'v1.4.80');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('SEENIT-RELEASE-003 sépare le changelog public des détails techniques', () => {
  const notes = extractCommitNotes(`fix(plex): fiabiliser la réconciliation des non vus

Changelog:
- La synchronisation Plex conserve les éléments vus lorsqu’une source temporaire est indisponible
- Les éléments réellement marqués non vus sont mieux réconciliés avec SeenIt.

Détails techniques:
- conserve les ratingKey dans la baseline du même UID
- hydrate le cache de résolution avant la comparaison`);

  assert.deepEqual(notes, [
    '- La synchronisation Plex conserve les éléments vus lorsqu’une source temporaire est indisponible.',
    '- Les éléments réellement marqués non vus sont mieux réconciliés avec SeenIt.'
  ]);
  assert.doesNotMatch(notes.join('\n'), /ratingKey|baseline|UID|cache/i);
  assert.deepEqual(
    extractCommitNotes('docs: actualiser le processus\n\nChangelog: aucun\n\n- détail interne'),
    []
  );
  assert.deepEqual(
    extractCommitNotes('chore: préparer la release\n\nChangelog: aucun.\n\nDétails techniques:\n- aligne les versions'),
    []
  );
  assert.deepEqual(
    extractCommitNotes('ci: ajuster la publication\n\nChangelog:\n- Aucun.\n\nDétails techniques:\n- ajuste le workflow'),
    []
  );
  assert.deepEqual(
    extractCommitNotes('docs(release): documenter le fallback navigateur\n\n- ajoute le fallback navigateur GitHub\n- ajoute le TNR interne'),
    []
  );
});

test('SEENIT-RELEASE-003 n’expose jamais les sujets ou puces techniques sans Changelog explicite', () => {
  const body = buildReleaseBody([
    {
      hash: 'v157',
      message: 'fix(notifications): matérialiser les images\n\n- Materialize notification media directory.\n- Isolate progressive parental batch.'
    },
    {
      hash: 'v156',
      message: 'fix(#326): accélérer le filtre âge\n\n- Fix #326 unblock safe age results within first batch.\n- Test #326 field regression inside parental batch.\n- Distinguish immediate and scheduled notifications.\n- Deliver due media reminders immediately.'
    }
  ]);

  assert.equal(body, '');
});

test('SEENIT-RELEASE-003 bloque une note explicite manifestement anglaise avant publication', () => {
  assert.throws(
    () => extractCommitNotes('fix(notifications): corriger les images\n\nChangelog:\n- Materialize notification media directory.'),
    /doit être rédigée en français/i
  );
  assert.throws(
    () => extractCommitNotes('fix(age): accélérer le filtre\n\nChangelog:\n- Fix safe age results within first batch.'),
    /doit être rédigée en français/i
  );
});

test('SEENIT-RELEASE-003 refuse les notes vagues et les références internes', () => {
  assert.throws(
    () => extractCommitNotes('fix(ui): ajuster l’interface\n\nChangelog:\n- Améliorations générales.'),
    /trop vague/i
  );
  assert.throws(
    () => extractCommitNotes('fix(age): corriger le filtre\n\nChangelog:\n- Le filtre âge corrige #326.'),
    /référence d.issue/i
  );
});

test('SEENIT-RELEASE-003 ne publie jamais les marqueurs de changelog vide', () => {
  const body = buildReleaseBody([
    {
      hash: 'visible',
      message: 'fix(notifications): restaurer les rappels\n\nChangelog:\n- Les rappels média retrouvent leur visuel.'
    },
    {
      hash: 'release',
      message: 'chore: préparer la release\n\nChangelog: aucun.'
    },
    {
      hash: 'ci',
      message: 'ci: fiabiliser le workflow\n\nChangelog:\n- Néant !'
    },
    {
      hash: 'legacy-docs',
      message: 'docs(release): rendre le déclenchement autonome\n\n- ajoute le fallback navigateur GitHub\n- inscrit la règle dans la SPEC'
    }
  ]);

  assert.match(body, /Les rappels média retrouvent leur visuel\./);
  assert.doesNotMatch(body, /Aucun|Néant|None|N\/A/i);
  assert.doesNotMatch(body, /fallback navigateur|SPEC/i);
});

test('SEENIT-RELEASE-003 échoue fermé si une version ne contient aucune note publique explicite', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'seenit-release-empty-'));

  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.email', 'seenit-tests@example.test');
    git(cwd, 'config', 'user.name', 'SeenIt Tests');

    commitFile(cwd, 'base', 'chore: base 1.4.80');
    git(cwd, 'tag', 'v1.4.80');
    commitFile(
      cwd,
      'fix',
      'fix(notifications): changer la matérialisation',
      '- Materialize notification media directory.\n- Isolate progressive parental batch.'
    );

    assert.throws(
      () => generateReleaseNotes({ version: '1.4.81', cwd }),
      /Aucune note de version publique valide/i
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('SEENIT-RELEASE-003 documente un format public court et homogène', () => {
  const agents = readFileSync(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const specification = readFileSync(new URL('../docs/specifications/seenit.md', import.meta.url), 'utf8');
  const delivery = readFileSync(new URL('../docs/process/delivery.md', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../src/components/ChangelogViewer.tsx', import.meta.url), 'utf8');

  for (const source of [agents, specification, delivery]) {
    assert.match(source, /### 🛠️ Ce qui a été fait/);
    assert.match(source, /deux à cinq/i);
    assert.match(source, /Changelog:/);
    assert.match(source, /Détails techniques:/);
  }

  assert.doesNotMatch(viewer, /\\bs\\s\+\(\[aáàâ/);
  assert.match(viewer, /\(\^\|\[\\s\(«“\]\)/);
});
