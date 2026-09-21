const HEALTH_MARKER = 'seenit-log-auditor-health:v1';
const HEALTH_TITLE = '[P1][Observabilité] Auditeur de logs indisponible';
const HEALTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const AUTO_CREATED_MARKER = 'Créée automatiquement par le watchdog de l’auditeur SeenIt';

const EXPECTED_OUTCOMES = Object.freeze([
  ['auth', 'SEENIT_AUDITOR_AUTH_OUTCOME', 'success'],
  ['gcloud', 'SEENIT_AUDITOR_GCLOUD_OUTCOME', 'success'],
  ['collect_structured', 'SEENIT_AUDITOR_COLLECT_OUTCOME', 'success'],
  ['summarize_tmdb', 'SEENIT_AUDITOR_TMDB_SUMMARY_OUTCOME', 'success'],
  ['summarize_traffic', 'SEENIT_AUDITOR_TRAFFIC_SUMMARY_OUTCOME', 'success'],
  ['audit_engine', 'SEENIT_AUDITOR_ENGINE_OUTCOME', 'success'],
]);

const EXPECTED_SOURCES = Object.freeze([
  ['structured_source', 'SEENIT_AUDITOR_STRUCTURED_SOURCE_STATUS', 'ok'],
  ['tmdb_source', 'SEENIT_AUDITOR_TMDB_SOURCE_STATUS', 'ok'],
  ['traffic_source', 'SEENIT_AUDITOR_TRAFFIC_SOURCE_STATUS', 'ok'],
]);

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'live' || mode === 'off' ? mode : 'dry-run';
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9_-]{0,31}$/.test(status) ? status : 'unknown';
}

function evaluateAuditorHealth(env = process.env) {
  const mode = normalizeMode(env.SEENIT_LOG_AUDITOR_MODE);
  if (mode !== 'live') {
    return { degraded: false, enabled: false, mode, reasons: [] };
  }

  const reasons = [];
  for (const [surface, key, expected] of [...EXPECTED_OUTCOMES, ...EXPECTED_SOURCES]) {
    const actual = normalizeStatus(env[key]);
    if (actual !== expected) reasons.push({ surface, actual, expected });
  }

  return { degraded: reasons.length > 0, enabled: true, mode, reasons };
}

function safeRunUrl(env = process.env) {
  const server = String(env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
  const repository = String(env.GITHUB_REPOSITORY || '').replace(/[^A-Za-z0-9_.\/-]/g, '');
  const runId = String(env.GITHUB_RUN_ID || '').replace(/\D/g, '');
  return repository && runId ? `${server}/${repository}/actions/runs/${runId}` : 'indisponible';
}

function safeSha(env = process.env) {
  const sha = String(env.GITHUB_SHA || '').trim();
  return /^[a-f0-9]{40}$/i.test(sha) ? sha : 'indisponible';
}

function buildHealthIssueBody(health, env = process.env) {
  const reasonLines = health.reasons.map(
    reason => `- \`${reason.surface}\` : \`${reason.actual}\` (attendu : \`${reason.expected}\`)`
  );
  return [
    `<!-- ${HEALTH_MARKER} -->`,
    `_${AUTO_CREATED_MARKER}._`,
    '',
    '## État',
    '',
    `- Run : ${safeRunUrl(env)}`,
    `- SHA : \`${safeSha(env)}\``,
    `- Mode : \`${health.mode}\``,
    '',
    '## Surface(s) indisponible(s)',
    '',
    ...reasonLines,
    '',
    '## Impact',
    '',
    'SeenIt continue de fonctionner, mais l’amélioration continue automatique peut être aveugle ou incomplète tant que cet incident persiste.',
    '',
    '## Action attendue',
    '',
    'Diagnostiquer le workflow `Audit Structured SeenIt Logs`, restaurer les sources/étapes en défaut puis valider un run live sain.',
    '',
    '> Aucun log brut, token, UID, email, URL applicative ou payload utilisateur n’est copié dans cette issue. Cette issue n’est jamais fermée automatiquement.'
  ].join('\n');
}

function buildHealthUpdateComment(health, env = process.env) {
  return [
    `<!-- ${HEALTH_MARKER} -->`,
    `Nouvelle dégradation détectée par le watchdog sur ${safeRunUrl(env)}.`,
    '',
    ...health.reasons.map(reason => `- \`${reason.surface}\` : \`${reason.actual}\``),
    '',
    `SHA : \`${safeSha(env)}\`.`
  ].join('\n');
}

function isWithinCooldown(updatedAt, now = new Date()) {
  const updatedMs = Date.parse(String(updatedAt || ''));
  return Number.isFinite(updatedMs) && now.getTime() - updatedMs < HEALTH_COOLDOWN_MS;
}

function createGithubClient({ fetchImpl = globalThis.fetch, repository, token }) {
  if (!fetchImpl) throw new Error('Fetch GitHub indisponible.');
  if (!repository || !token) throw new Error('GitHub repository/token manquant pour le watchdog.');

  const api = 'https://api.github.com';
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`${api}/repos/${repository}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) }
    });
    if (!response.ok) throw new Error(`GitHub watchdog HTTP ${response.status}`);
    if (response.status === 204) return null;
    return response.json();
  };

  return {
    async findOpenIssue() {
      const issues = await request('/issues?state=open&per_page=100&sort=updated&direction=desc');
      return (Array.isArray(issues) ? issues : []).find(
        issue => !issue.pull_request && String(issue.body || '').includes(`<!-- ${HEALTH_MARKER} -->`)
      ) || null;
    },
    async createIssue(body) {
      return request('/issues', { method: 'POST', body: JSON.stringify({ title: HEALTH_TITLE, body }) });
    },
    async commentIssue(number, body) {
      return request(`/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    }
  };
}

async function reportAuditorHealth({ health, github, env = process.env, now = new Date() }) {
  if (!health.enabled || !health.degraded) return { decision: 'healthy_no_action' };
  const existing = await github.findOpenIssue();
  if (!existing) {
    const created = await github.createIssue(buildHealthIssueBody(health, env));
    return { decision: 'created', issueNumber: created?.number || null };
  }
  if (isWithinCooldown(existing.updated_at || existing.updatedAt, now)) {
    return { decision: 'cooldown', issueNumber: existing.number };
  }
  await github.commentIssue(existing.number, buildHealthUpdateComment(health, env));
  return { decision: 'updated', issueNumber: existing.number };
}

async function main() {
  const health = evaluateAuditorHealth(process.env);
  if (!health.enabled) {
    console.log(`[AuditorWatchdog] mode=${health.mode} désactivé pour les écritures de santé.`);
    return;
  }
  if (!health.degraded) {
    console.log('[AuditorWatchdog] état=sain action=aucune');
    return;
  }

  const github = createGithubClient({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN
  });
  const result = await reportAuditorHealth({ health, github, env: process.env });
  console.log(`[AuditorWatchdog] état=dégradé action=${result.decision} issue=${result.issueNumber || 'aucune'}`);
  process.exitCode = 2;
}

module.exports = {
  AUTO_CREATED_MARKER,
  HEALTH_COOLDOWN_MS,
  HEALTH_MARKER,
  HEALTH_TITLE,
  buildHealthIssueBody,
  buildHealthUpdateComment,
  createGithubClient,
  evaluateAuditorHealth,
  isWithinCooldown,
  reportAuditorHealth
};

if (require.main === module) {
  main().catch(error => {
    console.error(`[AuditorWatchdog] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
