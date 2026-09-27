const fs = require('node:fs');

const CODEX_LOGINS = new Set([
  'chatgpt-codex-connector',
  'chatgpt-codex-connector[bot]'
]);
const FINDING_MARKER = 'seenit-codex-review-finding';
const ORIGIN_MARKER = 'seenit-codex-review-origin';

function isCodexAuthor(login = '') {
  return CODEX_LOGINS.has(String(login).toLowerCase());
}

function extractPriority(body = '') {
  const source = String(body);
  const badge = source.match(/\bP([1-4])\s+Badge\b/i);
  if (badge) return Number(badge[1]);
  const plain = source.match(/(?:^|[\s[(])P([1-4])(?=$|[\s\]):\-])/im);
  return plain ? Number(plain[1]) : null;
}

function findingKey(finding) {
  return `${finding.kind}:${finding.id}`;
}

function findingMarker(finding) {
  return `<!-- ${FINDING_MARKER} key=${findingKey(finding)} -->`;
}

function parseFindingMarkers(body = '') {
  const keys = new Set();
  for (const match of String(body).matchAll(/<!--\s*seenit-codex-review-finding\s+key=([^\s>]+)\s*-->/g)) {
    keys.add(match[1]);
  }
  return keys;
}

function compactBody(body, limit = 1200) {
  const normalized = String(body).replace(/\r/g, '').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function extractFindingTitle(body = '', fallback = 'Finding Codex') {
  const withoutImages = String(body)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_>#]/g, ' ')
    .replace(/\bP[1-4]\s+Badge\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const title = withoutImages || fallback;
  return title.length > 100 ? `${title.slice(0, 99).trimEnd()}…` : title;
}

function collectActionableFindings({ reviewComments = [], reviews = [], resolvedCommentIds = new Set() } = {}) {
  const findings = [];
  const append = (kind, item) => {
    if (!isCodexAuthor(item?.user?.login)) return;
    if (kind === 'comment' && resolvedCommentIds.has(Number(item?.id))) return;
    if (kind === 'review' && String(item?.state || '').toUpperCase() === 'DISMISSED') return;
    const priority = extractPriority(item?.body || '');
    if (![1, 2, 3, 4].includes(priority)) return;
    const finding = {
      kind,
      id: Number(item.id),
      priority,
      body: String(item.body || ''),
      url: item.html_url || item.url || null
    };
    if (!Number.isFinite(finding.id)) return;
    findings.push(finding);
  };
  reviewComments.forEach(item => append('comment', item));
  reviews.forEach(item => append('review', item));
  findings.sort((a, b) => a.priority - b.priority || a.id - b.id);
  return findings;
}

function buildDedicatedIssue({ pr, finding }) {
  const source = finding.url ? `- Source : ${finding.url}` : '- Source : lien indisponible';
  return {
    title: `[P${finding.priority}][Codex][PR #${pr.number}] ${extractFindingTitle(finding.body, `${finding.kind} ${finding.id}`)}`,
    body: [
      findingMarker(finding),
      `<!-- ${ORIGIN_MARKER} pr=${pr.number} -->`,
      '## Finding Codex à confirmer',
      '',
      `- Priorité signalée : **P${finding.priority}**`,
      `- PR source : ${pr.html_url || pr.url || `#${pr.number}`}`,
      source,
      '- État : **à confirmer** — ce ticket matérialise le backlog, il ne prouve pas à lui seul un bug.',
      '',
      '### Signal Codex',
      '',
      compactBody(finding.body),
      '',
      '### Critère de fin',
      '',
      '- finding confirmé → cause racine, portée complète, TNR puis correctif dans un chantier dédié ;',
      '- faux positif / déjà corrigé → preuve documentée puis fermeture de cette issue.',
      '',
      'La création de ce ticket ne déclenche automatiquement ni correctif, ni rollback, ni release APK.'
    ].join('\n')
  };
}

function repositoryParts(repository) {
  const [owner, name] = String(repository).split('/');
  if (!owner || !name) throw new Error(`Repository invalide : ${repository}`);
  return { owner, name };
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

async function githubGraphql(query, variables = {}) {
  const token = process.env.GITHUB_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
  const graphqlUrl = process.env.GITHUB_GRAPHQL_URL || `${apiUrl.replace(/\/api\/v3\/?$/, '/api/graphql').replace(/\/$/, '')}/graphql`;
  if (!token) throw new Error('GITHUB_TOKEN absent.');
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seenit-codex-review-triage'
    },
    body: JSON.stringify({ query, variables })
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok || parsed?.errors?.length) {
    throw new Error(`GitHub GraphQL -> ${response.status}: ${parsed?.errors?.map(item => item.message).join('; ') || text}`);
  }
  return parsed.data;
}

async function listAll(path, maxPages = 50) {
  const values = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await githubRequest(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`Réponse GitHub non paginable pour ${path}.`);
    values.push(...batch);
    if (batch.length < 100) break;
  }
  return values;
}

async function getResolvedCommentIds(repository, prNumber) {
  const { owner, name } = repositoryParts(repository);
  const resolved = new Set();
  let after = null;
  do {
    const data = await githubGraphql(`
      query SeenItCodexReviewThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                isResolved
                comments(first: 100) {
                  nodes { databaseId }
                }
              }
            }
          }
        }
      }
    `, { owner, name, number: prNumber, after });
    const threads = data?.repository?.pullRequest?.reviewThreads;
    if (!threads) throw new Error(`Threads de review introuvables pour PR #${prNumber}.`);
    for (const thread of threads.nodes || []) {
      if (!thread?.isResolved) continue;
      for (const comment of thread.comments?.nodes || []) {
        if (Number.isFinite(Number(comment?.databaseId))) resolved.add(Number(comment.databaseId));
      }
    }
    after = threads.pageInfo?.hasNextPage ? threads.pageInfo.endCursor : null;
  } while (after);
  return resolved;
}

async function loadFindingIssueIndex(repository) {
  const issues = await listAll(`/repos/${repository}/issues?state=all&sort=created&direction=asc`);
  const index = new Map();
  for (const issue of issues) {
    if (issue.pull_request) continue;
    for (const key of parseFindingMarkers(issue.body || '')) {
      if (!index.has(key)) index.set(key, issue);
    }
  }
  return index;
}

async function ensureFindingIssue({ repository, pr, finding, issueIndex }) {
  const key = findingKey(finding);
  const existing = issueIndex.get(key);
  if (existing) return { created: false, issue: existing };
  const issue = await githubRequest(`/repos/${repository}/issues`, {
    method: 'POST',
    body: buildDedicatedIssue({ pr, finding })
  });
  issueIndex.set(key, issue);
  return { created: true, issue };
}

async function triage({ repository, prNumber, issueIndex = null }) {
  const pr = await githubRequest(`/repos/${repository}/pulls/${prNumber}`);
  if (!pr.merged_at) {
    console.log(`[Codex Review Triage] PR #${prNumber} non mergée : aucun ticket post-merge créé.`);
    return { status: 'not-merged', created: 0, existing: 0, skippedResolved: 0 };
  }

  const [reviewComments, reviews, resolvedCommentIds] = await Promise.all([
    listAll(`/repos/${repository}/pulls/${prNumber}/comments`),
    listAll(`/repos/${repository}/pulls/${prNumber}/reviews`),
    getResolvedCommentIds(repository, prNumber)
  ]);
  const allCodexPriorities = [...reviewComments, ...reviews]
    .filter(item => isCodexAuthor(item?.user?.login) && [1, 2, 3, 4].includes(extractPriority(item?.body || ''))).length;
  const findings = collectActionableFindings({ reviewComments, reviews, resolvedCommentIds });
  if (!findings.length) {
    console.log(`[Codex Review Triage] PR #${prNumber} : aucun finding Codex non résolu à matérialiser.`);
    return { status: 'nothing-to-do', created: 0, existing: 0, skippedResolved: allCodexPriorities };
  }

  const index = issueIndex || await loadFindingIssueIndex(repository);
  let created = 0;
  let existing = 0;
  for (const finding of findings) {
    const result = await ensureFindingIssue({ repository, pr, finding, issueIndex: index });
    if (result.created) created += 1;
    else existing += 1;
  }
  console.log(`[Codex Review Triage] PR #${prNumber} : ${created} issue(s) créée(s), ${existing} déjà présente(s), ${allCodexPriorities - findings.length} finding(s) résolu(s)/ignoré(s).`);
  return { status: created ? 'routed' : 'already-routed', created, existing, skippedResolved: allCodexPriorities - findings.length };
}

function pullNumberFromUrl(url = '') {
  const match = String(url).match(/\/pulls\/(\d+)(?:$|[/?#])/);
  return match ? Number(match[1]) : null;
}

async function listMergedPrReviews(repository) {
  const { owner, name } = repositoryParts(repository);
  const merged = new Map();
  let after = null;
  do {
    const data = await githubGraphql(`
      query SeenItMergedPullRequests($owner: String!, $name: String!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequests(states: MERGED, first: 50, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
            pageInfo { hasNextPage endCursor }
            nodes {
              number
              url
              reviews(first: 100) {
                pageInfo { hasNextPage }
                nodes {
                  databaseId
                  body
                  url
                  state
                  author { login }
                }
              }
            }
          }
        }
      }
    `, { owner, name, after });
    const prs = data?.repository?.pullRequests;
    if (!prs) throw new Error('Liste des PR mergées introuvable.');
    for (const pr of prs.nodes || []) {
      let reviews = (pr.reviews?.nodes || []).map(review => ({
        id: review.databaseId,
        body: review.body,
        url: review.url,
        html_url: review.url,
        state: review.state,
        user: { login: review.author?.login || '' }
      }));
      if (pr.reviews?.pageInfo?.hasNextPage) {
        reviews = await listAll(`/repos/${repository}/pulls/${pr.number}/reviews`);
      }
      merged.set(pr.number, { number: pr.number, html_url: pr.url, reviews });
    }
    after = prs.pageInfo?.hasNextPage ? prs.pageInfo.endCursor : null;
  } while (after);
  return merged;
}

async function listBackfillPrNumbers(repository) {
  const [mergedPrs, globalReviewComments] = await Promise.all([
    listMergedPrReviews(repository),
    listAll(`/repos/${repository}/pulls/comments?sort=created&direction=asc`)
  ]);
  const candidatePrNumbers = new Set();
  for (const comment of globalReviewComments) {
    if (!isCodexAuthor(comment?.user?.login)) continue;
    if (![1, 2, 3, 4].includes(extractPriority(comment?.body || ''))) continue;
    const prNumber = pullNumberFromUrl(comment.pull_request_url || '');
    if (prNumber && mergedPrs.has(prNumber)) candidatePrNumbers.add(prNumber);
  }
  for (const [prNumber, pr] of mergedPrs) {
    if (pr.reviews.some(review => isCodexAuthor(review?.user?.login) && [1, 2, 3, 4].includes(extractPriority(review?.body || '')))) {
      candidatePrNumbers.add(prNumber);
    }
  }
  return [...candidatePrNumbers].sort((a, b) => a - b);
}

async function backfill({ repository }) {
  const [issueIndex, mergedPrs, globalReviewComments] = await Promise.all([
    loadFindingIssueIndex(repository),
    listMergedPrReviews(repository),
    listAll(`/repos/${repository}/pulls/comments?sort=created&direction=asc`)
  ]);

  const commentsByPr = new Map();
  for (const comment of globalReviewComments) {
    if (!isCodexAuthor(comment?.user?.login)) continue;
    if (![1, 2, 3, 4].includes(extractPriority(comment?.body || ''))) continue;
    const prNumber = pullNumberFromUrl(comment.pull_request_url || '');
    if (!prNumber || !mergedPrs.has(prNumber)) continue;
    if (!commentsByPr.has(prNumber)) commentsByPr.set(prNumber, []);
    commentsByPr.get(prNumber).push(comment);
  }

  const candidatePrNumbers = new Set(commentsByPr.keys());
  for (const [prNumber, pr] of mergedPrs) {
    if (pr.reviews.some(review => isCodexAuthor(review?.user?.login) && [1, 2, 3, 4].includes(extractPriority(review?.body || '')))) {
      candidatePrNumbers.add(prNumber);
    }
  }

  let created = 0;
  let existing = 0;
  let skippedResolved = 0;
  let findingsSeen = 0;
  for (const prNumber of [...candidatePrNumbers].sort((a, b) => a - b)) {
    const pr = mergedPrs.get(prNumber);
    const reviewComments = commentsByPr.get(prNumber) || [];
    const resolvedCommentIds = reviewComments.length ? await getResolvedCommentIds(repository, prNumber) : new Set();
    findingsSeen += reviewComments.length + pr.reviews.filter(review => isCodexAuthor(review?.user?.login) && [1, 2, 3, 4].includes(extractPriority(review?.body || ''))).length;
    const findings = collectActionableFindings({ reviewComments, reviews: pr.reviews, resolvedCommentIds });
    skippedResolved += (reviewComments.length + pr.reviews.filter(review => isCodexAuthor(review?.user?.login) && [1, 2, 3, 4].includes(extractPriority(review?.body || ''))).length) - findings.length;
    for (const finding of findings) {
      const result = await ensureFindingIssue({ repository, pr, finding, issueIndex });
      if (result.created) created += 1;
      else existing += 1;
    }
  }

  console.log(`[Codex Review Triage] Backfill terminé : ${mergedPrs.size} PR mergées parcourues, ${findingsSeen} finding(s) Codex P1-P4 détecté(s), ${skippedResolved} résolu(s)/ignoré(s), ${created} issue(s) créée(s), ${existing} déjà présente(s).`);
  return { mergedPrs: mergedPrs.size, findingsSeen, skippedResolved, created, existing };
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const args = process.argv.slice(2);
  if (!repository) throw new Error('GITHUB_REPOSITORY absent.');

  if (args.includes('--list-backfill-prs')) {
    const prNumbers = await listBackfillPrNumbers(repository);
    process.stdout.write(JSON.stringify(prNumbers));
    return;
  }

  const prArgIndex = args.indexOf('--pr');
  if (prArgIndex >= 0) {
    const prNumber = Number(args[prArgIndex + 1]);
    if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('Numéro de PR invalide pour --pr.');
    await triage({ repository, prNumber });
    return;
  }

  if (!eventPath) throw new Error('GITHUB_EVENT_PATH absent.');
  if (eventName === 'workflow_dispatch') {
    await backfill({ repository });
    return;
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const prNumber = Number(event?.pull_request?.number || event?.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('Numéro de PR introuvable dans l’événement GitHub.');
  await triage({ repository, prNumber });
}

module.exports = {
  CODEX_LOGINS,
  FINDING_MARKER,
  ORIGIN_MARKER,
  backfill,
  buildDedicatedIssue,
  collectActionableFindings,
  ensureFindingIssue,
  extractFindingTitle,
  extractPriority,
  findingKey,
  findingMarker,
  isCodexAuthor,
  listBackfillPrNumbers,
  parseFindingMarkers,
  pullNumberFromUrl,
  repositoryParts,
  triage
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[Codex Review Triage] ❌ ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
