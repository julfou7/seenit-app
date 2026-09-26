import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildDedicatedIssue,
  collectActionableFindings,
  extractPriority,
  extractReferencedIssueNumbers,
  parseTriageState
} = require('../scripts/codex-review-triage.cjs') as {
  buildDedicatedIssue: (input: { pr: { number: number; html_url: string }; findings: Array<{ kind: string; id: number; priority: number; body: string; url: string | null }> }) => { title: string; body: string };
  collectActionableFindings: (input: { reviewComments?: unknown[]; reviews?: unknown[]; tracked?: Set<string> }) => Array<{ kind: string; id: number; priority: number }>;
  extractPriority: (body: string) => number | null;
  extractReferencedIssueNumbers: (body: string, prNumber?: number | null) => number[];
  parseTriageState: (comments: unknown[]) => { tracked: Set<string>; targetIssueNumber: number | null };
};

test('SEENIT-QUALITY-004 route les reviews Codex P1/P2 post-merge sans bloquer le merge', () => {
  assert.equal(extractPriority('![P2 Badge](badge) Préservez la preuve exacte'), 2);
  assert.equal(extractPriority('[P1] Régression de sécurité'), 1);
  assert.equal(extractPriority('### Codex Review\nAucun finding prioritaire.'), null);
  assert.deepEqual(extractReferencedIssueNumbers('Closes #570\nRefs #430\nRefs #430', 575), [570, 430]);

  const state = parseTriageState([
    { body: '<!-- seenit-codex-review-triage finding=comment:41 -->\n<!-- seenit-codex-review-target issue=428 -->' }
  ]);
  assert.equal(state.targetIssueNumber, 428);
  assert.deepEqual([...state.tracked], ['comment:41']);

  const findings = collectActionableFindings({
    tracked: state.tracked,
    reviewComments: [
      { id: 41, user: { login: 'chatgpt-codex-connector[bot]' }, body: 'P2 Badge déjà routé' },
      { id: 42, user: { login: 'chatgpt-codex-connector[bot]' }, body: 'P2 Badge finding utile', html_url: 'https://github.test/finding/42' },
      { id: 43, user: { login: 'other-bot' }, body: 'P1 Badge autre bot' },
      { id: 44, user: { login: 'chatgpt-codex-connector[bot]' }, body: 'P3 Badge non routé' }
    ],
    reviews: [
      { id: 45, user: { login: 'chatgpt-codex-connector' }, body: '[P1] finding de review', html_url: 'https://github.test/review/45' }
    ]
  });
  assert.deepEqual(findings.map(finding => `${finding.kind}:${finding.id}:P${finding.priority}`), [
    'review:45:P1',
    'comment:42:P2'
  ]);

  const dedicated = buildDedicatedIssue({
    pr: { number: 575, html_url: 'https://github.test/pr/575' },
    findings: [
      { kind: 'comment', id: 42, priority: 2, body: 'P2 Badge finding utile', url: 'https://github.test/finding/42' }
    ]
  });
  assert.match(dedicated.title, /^\[P2\]\[Code Review\].*#575$/);
  assert.match(dedicated.body, /à confirmer|signaux à confirmer/i);

  const workflow = fs.readFileSync('.github/workflows/codex-review-triage.yml', 'utf8');
  const agents = fs.readFileSync('AGENTS.md', 'utf8');
  const bootstrap = fs.readFileSync('.agents/AGENTS.md', 'utf8');
  const delivery = fs.readFileSync('docs/process/delivery.md', 'utf8');
  const spec = fs.readFileSync('docs/specifications/seenit.md', 'utf8');
  const registry = fs.readFileSync('docs/requests/registry.md', 'utf8');
  const normalize = (source: string) => source.replace(/\s+/g, ' ');

  assert.match(workflow, /pull_request_review:[\s\S]*submitted/);
  assert.match(workflow, /pull_request:[\s\S]*closed/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /pull-requests:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);

  for (const source of [agents, bootstrap, delivery, spec].map(normalize)) {
    assert.match(source, /Codex Review|revue Codex/i);
    assert.match(source, /ne (?:doit|devient) pas[^.]*bloqu|non bloquante/i);
    assert.match(source, /P1[\s\S]*P2/);
    assert.match(source, /P3[\s\S]*P4/);
    assert.match(source, /issue ouverte[\s\S]*référencée|issue.*ouverte.*PR/i);
    assert.match(source, /idempot/i);
    assert.match(source, /à confirmer|confirmer/i);
  }
  assert.match(registry, /USR-2026-09-26-003/);
});
