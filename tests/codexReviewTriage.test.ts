import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildDedicatedIssue,
  collectActionableFindings,
  extractFindingTitle,
  extractPriority,
  findingKey,
  isCodexAuthor,
  parseFindingMarkers,
  pullNumberFromUrl
} = require('../scripts/codex-review-triage.cjs') as {
  buildDedicatedIssue: (input: { pr: { number: number; html_url: string }; finding: { kind: string; id: number; priority: number; body: string; url: string | null } }) => { title: string; body: string };
  collectActionableFindings: (input: { reviewComments?: unknown[]; reviews?: unknown[]; resolvedCommentIds?: Set<number> }) => Array<{ kind: string; id: number; priority: number; body: string; url: string | null }>;
  extractFindingTitle: (body: string, fallback?: string) => string;
  extractPriority: (body: string) => number | null;
  findingKey: (finding: { kind: string; id: number }) => string;
  isCodexAuthor: (login?: string) => boolean;
  parseFindingMarkers: (body: string) => Set<string>;
  pullNumberFromUrl: (url: string) => number | null;
};

test('SEENIT-QUALITY-004 matérialise chaque finding Codex non résolu en issue dédiée', () => {
  assert.equal(extractPriority('![P2 Badge](badge) Préservez la preuve exacte'), 2);
  assert.equal(extractPriority('[P1] Régression de sécurité'), 1);
  assert.equal(extractPriority('P3 Badge dette mineure'), 3);
  assert.equal(extractPriority('P4 Badge suggestion'), 4);
  assert.equal(extractPriority('### Codex Review\nAucun finding prioritaire.'), null);

  assert.equal(isCodexAuthor('chatgpt-codex-connector'), true);
  assert.equal(isCodexAuthor('chatgpt-codex-connector[bot]'), true);
  assert.equal(isCodexAuthor('chatgpt-codex-connector-evil'), false);
  assert.equal(isCodexAuthor('other-bot'), false);

  const findings = collectActionableFindings({
    resolvedCommentIds: new Set([42]),
    reviewComments: [
      { id: 41, user: { login: 'chatgpt-codex-connector[bot]' }, body: 'P4 Badge suggestion encore ouverte', html_url: 'https://github.test/finding/41' },
      { id: 42, user: { login: 'chatgpt-codex-connector[bot]' }, body: 'P2 Badge déjà résolu', html_url: 'https://github.test/finding/42' },
      { id: 43, user: { login: 'chatgpt-codex-connector-evil' }, body: 'P1 Badge faux bot' }
    ],
    reviews: [
      { id: 44, user: { login: 'chatgpt-codex-connector' }, body: '[P3] finding de review', html_url: 'https://github.test/review/44', state: 'COMMENTED' },
      { id: 45, user: { login: 'chatgpt-codex-connector' }, body: '[P1] review dismissed', html_url: 'https://github.test/review/45', state: 'DISMISSED' }
    ]
  });
  assert.deepEqual(findings.map(finding => `${finding.kind}:${finding.id}:P${finding.priority}`), [
    'review:44:P3',
    'comment:41:P4'
  ]);

  const finding = findings[0];
  const dedicated = buildDedicatedIssue({
    pr: { number: 575, html_url: 'https://github.test/pr/575' },
    finding
  });
  assert.match(dedicated.title, /^\[P3\]\[Codex\]\[PR #575\]/);
  assert.match(dedicated.body, /seenit-codex-review-finding key=review:44/);
  assert.match(dedicated.body, /à confirmer/i);
  assert.match(dedicated.body, /ne déclenche automatiquement ni correctif, ni rollback, ni release APK/i);
  assert.deepEqual([...parseFindingMarkers(dedicated.body)], ['review:44']);
  assert.equal(findingKey(finding), 'review:44');

  assert.equal(pullNumberFromUrl('https://api.github.com/repos/julfou7/seenit-app/pulls/579'), 579);
  assert.equal(pullNumberFromUrl('https://github.com/julfou7/seenit-app/pull/579'), null);
  assert.equal(extractFindingTitle('<sub>P2 Badge</sub>  Conserver la priorité erreur'), 'Conserver la priorité erreur');

  const workflow = fs.readFileSync('.github/workflows/codex-review-triage.yml', 'utf8');
  const script = fs.readFileSync('scripts/codex-review-triage.cjs', 'utf8');
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const delivery = fs.readFileSync('docs/process/delivery.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  const registry = fs.readFileSync('docs/requests/registry.md', 'utf8');
  const normalize = (source: string) => source.replace(/\s+/g, ' ');

  assert.match(workflow, /pull_request_review:[\s\S]*submitted/);
  assert.match(workflow, /pull_request:[\s\S]*closed/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /concurrency:\s*[\s\S]*group:\s*seenit-codex-review-triage\s*[\s\S]*cancel-in-progress:\s*false/);
  assert.doesNotMatch(workflow, /seenit-codex-review-triage-\$\{\{/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /pull-requests:\s*read/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /startsWith\(github\.event\.review\.user\.login/);
  assert.match(workflow, /github\.event\.review\.user\.login == 'chatgpt-codex-connector\[bot\]'/);
  assert.match(workflow, /github\.event\.review\.user\.login == 'chatgpt-codex-connector'/);

  assert.match(script, /pulls\/comments\?sort=created&direction=asc/);
  assert.match(script, /reviewThreads\(first:\s*100/);
  assert.match(script, /isResolved/);
  assert.match(script, /Backfill terminé/);
  assert.doesNotMatch(script, /resolveTargetIssue|extractReferencedIssueNumbers/);

  for (const source of [agents, bootstrap, delivery, spec].map(normalize)) {
    assert.match(source, /Code Reviews? Codex|revue Codex/i);
    assert.match(source, /non bloquant(?:e)?|ne .*bloqu/i);
    assert.match(source, /P1[\s\S]*P2[\s\S]*P3[\s\S]*P4/i);
    assert.match(source, /issue dédiée/i);
    assert.match(source, /finding[^.]*non résolu/i);
    assert.match(source, /historique|backfill/i);
    assert.match(source, /idempot/i);
    assert.match(source, /à confirmer|confirmer/i);
  }

  assert.match(registry, /USR-2026-09-27-001/);
  assert.match(registry, /superseded by USR-2026-09-27-001/);
});
