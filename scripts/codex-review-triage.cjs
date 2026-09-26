const fs = require('node:fs');

const CODEX_LOGIN_PREFIX = 'chatgpt-codex-connector';
const TRIAGE_MARKER = 'seenit-codex-review-triage';
const TARGET_MARKER = 'seenit-codex-review-target';

function isCodexAuthor(login = '') {
  return String(login).toLowerCase().startsWith(CODEX_LOGIN_PREFIX);
}

function extractPriority(body = '') {
  const source = String(body);
  const badge = source.match(/\bP([1-4])\s+Badge\b/i);
  if (badge) return Number(badge[1]);
  const plain = source.match(/(?:^|[\s[(])P([1-4])(?=$|[\s\]):\-])/im);
  return plain ? Number(plain[1]) : null;
}

function extractReferencedIssueNumbers(body = '', prNumber = null) {
  const seen = new Set();
  const numbers = [];
  const referencePattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|traite|référence|issue)\s*:?\s*#(\d+)/gi;
  for (const match of String(body).matchAll(referencePattern)) {
    const value = Number(match[1]);
    if (!Number.isInteger(value) || value <= 0 || value === Number(prNumber) || seen.has(value)) continue;
    seen.add(value);
    numbers.push(value);
  }
  return numbers;
}

function findingKey(finding) {
  return `${finding.kind}:${finding.id}`;
}

function parseTriageState(comments = []) {
  const tracked = new Set();
  let targetIssueNumber = null;
  for (const comment of comments) {
    const body = String(comment?.body || '');
    for (const match of body.matchAll(/<!--\s*seenit-codex-review-triage\s+finding=([^\s>]+)\s*-->/g)) {
      tracked.add(match[1]);
    }
    const target = body.match(/<!--\s*seenit-codex-review-target\s+issue=(\d+)\s*-->/);
    if (target) targetIssueNumber = Number(target[1]);
  }
  return { tracked, targetIssueNumber };
}

function collectActionableFindings({ reviewComments = [], reviews = [], tracked = new Set() } = {}) {
  const findings = [];
  const append = (kind, item) => {
    if (!isCodexAuthor(item?.user?.login)) return;
    const priority = extractPriority(item?.body || '');
    if (priority !== 1 && priority !== 2) return;
    const finding = {
      kind,
      id: Number(item.id),
      priority,
      body: String(item.body || ''),
      url: item.html_url || item.url || null
    };
    if (!Number.isFinite(finding.id) || tracked.has(findingKey(finding))) return;
    findings.push(finding);
  };
  reviewComments.forEach(item => append('comment', item));
  reviews.forEach(item => append('review', item));
  findings.sort((a, b) => a.priority - b.priority || a.id - b.id);
  return findings;
}

function highestPriority(findings) {
  return findings.reduce((current, finding) => Math.min(current, finding.priority), 4);
}

function compactBody(body, limit = 900) {
  const normalized = String(body).replace(/\r/g, '').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function buildFindingsMarkdown(findings) {
  return findings.map(finding => {
    const link = finding.url ? ` — ${finding.url}` : '';
    return `### P${finding.priority} · ${finding.kind} ${finding.id}${link}\n\n${compactBody(finding.body)}`;
  }).join('\n\n');
}

function buildIssueComment({ pr, findings }) {
  const priority = highestPriority(findings);
  return [
    `## Code Review Codex post-merge — P${priority} à confirmer`,
    '',
    `La PR #${pr.number} est déjà mergée. Codex a publié ${findings.length} finding(s) P1/P2 non encore routé(s).`,
    '',
    '**Ce signalement n’est pas une preuve de bug.** Il doit être confirmé sur le chemin de production avant correction. S’il est valide : cause racine + portée complète + TNR ciblé, puis PR corrective. S’il est faux : documenter la preuve et résoudre le thread Codex.',
    '',
    buildFindingsMarkdown(findings),
    '',
    `PR : ${pr.html_url}`
  ].join('\n');
}

function buildPrTrackingComment({ targetIssueNumber, findings }) {
  const markers = findings.map(finding => `<!-- ${TRIAGE_MARKER} finding=${findingKey(finding)} -->`).join('\n');
  return [
    markers,
    `<!-- ${TARGET_MARKER} issue=${targetIssueNumber} -->`,
    `Codex post-merge : ${findings.length} nouveau(x) finding(s) P1/P2 routé(s) vers #${targetIssueNumber}. Le merge n’a pas été bloqué ; le finding reste à confirmer avant correction.`
  ].join('\n');
}

function buildDedicatedIssue({ pr, findings }) {
  const priority = highestPriority(findings);
  return {
    title: `[P${priority}][Code Review] Trier les findings Codex post-merge PR #${pr.number}`,
    body: [
      `<!-- seenit-codex-review-origin pr=${pr.number} -->`,
      '## Triage requis',
      '',
      `La PR #${pr.number} est mergée et aucun ticket **ouvert** référencé par la PR n’est disponible pour recevoir ce suivi.`,
      '',
      '**Les findings Codex sont des signaux à confirmer, pas des bugs prouvés.**',
      '',
      buildFindingsMarkdown(findings),
      '',
      `PR : ${pr.html_url}`,
      '',
      '## Critère de fin',
      '- finding confirmé → cause racine, portée complète, TNR et PR corrective ;',
      '- faux positif → preuve documentée et thread Codex résolu.'
    ].join('\n')
  };
}

async function githubRequest(path, { method = 'GET', body } = {}) {
  const token = process.env.GITHUB_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
  if (!token) throw new Error('GITHUB_TOKEN absent.');
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seenit-codex-review-triage'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(`GitHub API ${method} ${path} -> ${response.status}: ${parsed?.message || text}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

async function listAll(path) {
  const values = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await githubRequest(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`Réponse GitHub non paginable pour ${path}.`);
    values.push(...batch);
    if (batch.length < 100) break;
  }
  return values;
}

async function getIssue(repository, number) {
  try {
    return await githubRequest(`/repos/${repository}/issues/${number}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function resolveTargetIssue({ repository, pr, prComments }) {
  const { targetIssueNumber } = parseTriageState(prComments);
  if (targetIssueNumber) {
    const prior = await getIssue(repository, targetIssueNumber);
    if (prior && prior.state === 'open' && !prior.pull_request) return prior;
  }

  for (const number of extractReferencedIssueNumbers(pr.body || '', pr.number)) {
    const issue = await getIssue(repository, number);
    if (issue && issue.state === 'open' && !issue.pull_request) return issue;
  }
  return null;
}

async function triage({ repository, prNumber }) {
  const pr = await githubRequest(`/repos/${repository}/pulls/${prNumber}`);
  if (!pr.merged_at) {
    console.log(`[Codex Review Triage] PR #${prNumber} non mergée : aucun suivi post-merge créé.`);
    return { status: 'not-merged', findings: [] };
  }

  const [reviewComments, reviews, prComments] = await Promise.all([
    listAll(`/repos/${repository}/pulls/${prNumber}/comments`),
    listAll(`/repos/${repository}/pulls/${prNumber}/reviews`),
    listAll(`/repos/${repository}/issues/${prNumber}/comments`)
  ]);

  const state = parseTriageState(prComments);
  const findings = collectActionableFindings({ reviewComments, reviews, tracked: state.tracked });
  if (!findings.length) {
    console.log(`[Codex Review Triage] PR #${prNumber} : aucun nouveau finding Codex P1/P2 à router.`);
    return { status: 'nothing-to-do', findings: [] };
  }

  let target = await resolveTargetIssue({ repository, pr, prComments });
  let created = false;
  if (!target) {
    const issue = buildDedicatedIssue({ pr, findings });
    target = await githubRequest(`/repos/${repository}/issues`, {
      method: 'POST',
      body: issue
    });
    created = true;
  }

  await githubRequest(`/repos/${repository}/issues/${target.number}/comments`, {
    method: 'POST',
    body: { body: buildIssueComment({ pr, findings }) }
  });
  await githubRequest(`/repos/${repository}/issues/${pr.number}/comments`, {
    method: 'POST',
    body: { body: buildPrTrackingComment({ targetIssueNumber: target.number, findings }) }
  });

  console.log(`[Codex Review Triage] PR #${prNumber} : ${findings.length} finding(s) routé(s) vers #${target.number}${created ? ' (issue créée)' : ''}.`);
  return { status: 'routed', findings, targetIssueNumber: target.number, created };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repository || !eventPath) throw new Error('GITHUB_REPOSITORY/GITHUB_EVENT_PATH absent.');
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const prNumber = Number(event?.pull_request?.number || event?.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('Numéro de PR introuvable dans l’événement GitHub.');
  await triage({ repository, prNumber });
}

module.exports = {
  CODEX_LOGIN_PREFIX,
  TRIAGE_MARKER,
  TARGET_MARKER,
  buildDedicatedIssue,
  buildIssueComment,
  buildPrTrackingComment,
  collectActionableFindings,
  extractPriority,
  extractReferencedIssueNumbers,
  findingKey,
  highestPriority,
  isCodexAuthor,
  parseTriageState,
  resolveTargetIssue,
  triage
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[Codex Review Triage] ❌ ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
