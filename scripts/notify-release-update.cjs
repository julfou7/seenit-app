const endpoint = (process.env.RELEASE_NOTIFICATION_ENDPOINT || 'https://seenit.ai.studio/api/releases/notify').trim();
const repository = (process.env.RELEASE_REPOSITORY || '').trim();
const runId = Number(process.env.RELEASE_RUN_ID || '');
const headSha = (process.env.RELEASE_HEAD_SHA || '').trim();
const maxAttempts = 3;
const runPollLimit = 30;
const runPollDelayMs = 2_000;
const CONTROL_ISSUE = 102;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function validateInputs() {
  if (endpoint !== 'https://seenit.ai.studio/api/releases/notify') {
    throw new Error('Endpoint de notification de release non canonique');
  }
  if (repository !== 'julfou7/seenit-app') {
    throw new Error('Dépôt de release non canonique');
  }
  if (!Number.isSafeInteger(runId) || runId <= 0 || !/^[0-9a-f]{40}$/i.test(headSha)) {
    throw new Error('Identité du run de release invalide');
  }
}

function validateSourceRun(run, expected = { repository, headSha }) {
  if (
    run?.repository?.full_name !== expected.repository ||
    run?.path !== '.github/workflows/build-apk.yml' ||
    run?.event !== 'workflow_dispatch' ||
    run?.head_branch !== 'main' ||
    run?.head_sha !== expected.headSha
  ) {
    throw new Error('Le run source ne correspond pas à une release SeenIt canonique');
  }
  if (run.status === 'completed' && run.conclusion !== 'success') {
    throw new Error(`Le run source est terminé avec le statut ${String(run.conclusion || 'inconnu')}`);
  }
  return run.status === 'completed' && run.conclusion === 'success';
}

async function waitForSuccessfulSourceRun({
  fetchImpl = fetch,
  sleepImpl = sleep,
  repositoryName = repository,
  sourceRunId = runId,
  sourceHeadSha = headSha,
  token = String(process.env.GITHUB_TOKEN || '').trim(),
  pollLimit = runPollLimit,
  pollDelayMs = runPollDelayMs
} = {}) {
  if (!token) throw new Error('GITHUB_TOKEN absent pour vérifier le run source');

  for (let attempt = 0; attempt < pollLimit; attempt += 1) {
    const response = await fetchImpl(`https://api.github.com/repos/${repositoryName}/actions/runs/${sourceRunId}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SeenIt-Release-Workflow'
      }
    });
    if (!response.ok) throw new Error(`Vérification du run source refusée (${response.status})`);
    if (validateSourceRun(await response.json(), { repository: repositoryName, headSha: sourceHeadSha })) return;
    if (attempt + 1 < pollLimit) await sleepImpl(pollDelayMs);
  }

  throw new Error('Le run source n’est pas terminé dans la fenêtre bornée de 60 s');
}

async function githubRequest(path, {
  fetchImpl = fetch,
  token = String(process.env.GITHUB_TOKEN || '').trim(),
  method = 'GET',
  body,
  repositoryName = repository
} = {}) {
  if (!token) throw new Error('GITHUB_TOKEN absent pour le checkpoint de release');
  const response = await fetchImpl(`https://api.github.com/repos/${repositoryName}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SeenIt-Release-Workflow'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`GitHub API ${method} ${path} -> ${response.status}: ${detail}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function findOfficialReleaseForHead({ request = githubRequest, sourceHeadSha = headSha } = {}) {
  const releases = await request('/releases?per_page=30');
  const release = (Array.isArray(releases) ? releases : []).find(item => item?.target_commitish === sourceHeadSha);
  if (!release) throw new Error(`Release officielle introuvable pour le SHA ${sourceHeadSha}`);
  return release;
}

function getReleaseAssetEvidence(release) {
  const version = String(release?.tag_name || '').replace(/^v/, '');
  const apkName = version ? `SeenIt-v${version}.apk` : '';
  const apk = (release?.assets || []).find(asset => asset?.name === apkName) || null;
  return {
    version,
    apkName: apk?.name || apkName || null,
    apkUrl: apk?.browser_download_url || null,
    digest: apk?.digest || null
  };
}

function sanitizeFailure(error) {
  const message = error instanceof Error ? error.message : String(error || 'échec inconnu');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer ***').replace(/\s+/g, ' ').slice(0, 240);
}

function buildFinalReleaseSummary({ release, sourceRunId, sourceHeadSha, notification, notificationError = null }) {
  const evidence = getReleaseAssetEvidence(release);
  const marker = `<!-- seenit-release-summary:${sourceRunId} -->`;
  const notificationLine = notificationError
    ? `- Notification Android : ❌ ${sanitizeFailure(notificationError)}`
    : notification?.status === 'none'
      ? '- Notification Android : ⚠️ aucune alerte envoyée (backend sans release correspondante).'
      : `- Notification Android : ✅ ${Number(notification?.sent || 0)} envoyée(s), ${Number(notification?.alreadySent || 0)} déjà traitée(s), ${Number(notification?.invalid || 0)} token(s) invalide(s).`;
  const heading = notificationError
    ? `### ⚠️ Release v${evidence.version || '?'} publiée — notification en échec`
    : `### ✅ Release v${evidence.version || '?'} finalisée`;

  return [
    marker,
    heading,
    '',
    `- SHA main : \`${sourceHeadSha}\``,
    `- Run release : https://github.com/${repository || 'julfou7/seenit-app'}/actions/runs/${sourceRunId}`,
    '- Smoke Android 36 : ✅',
    evidence.apkUrl ? `- APK : ${evidence.apkUrl}` : `- APK : ${evidence.apkName || 'introuvable'}`,
    evidence.digest ? `- SHA-256 APK : \`${String(evidence.digest).replace(/^sha256:/, '')}\`` : '- SHA-256 APK : ⚠️ indisponible',
    notificationLine
  ].join('\n');
}

async function upsertFinalReleaseSummary({ request = githubRequest, body, sourceRunId = runId } = {}) {
  const marker = `<!-- seenit-release-summary:${sourceRunId} -->`;
  const comments = await request(`/issues/${CONTROL_ISSUE}/comments?per_page=100`);
  const existing = (Array.isArray(comments) ? comments : []).find(comment => String(comment?.body || '').includes(marker));
  if (existing?.id) {
    return request(`/issues/comments/${existing.id}`, { method: 'PATCH', body: { body } });
  }
  return request(`/issues/${CONTROL_ISSUE}/comments`, { method: 'POST', body: { body } });
}

async function postAttempt() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'SeenIt-Release-Workflow'
      },
      body: JSON.stringify({ repository, runId, headSha }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function notifyAndroidRelease() {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await postAttempt();
      if (response.status === 204) {
        console.log('Aucune release APK officielle ne correspond à ce run ; aucune alerte envoyée.');
        return { status: 'none', sent: 0, alreadySent: 0, invalid: 0 };
      }

      let body = {};
      try { body = await response.json(); } catch { body = {}; }

      if (response.ok) {
        const result = {
          status: 'sent',
          version: String(body.version || ''),
          sent: Number(body.sent || 0),
          alreadySent: Number(body.alreadySent || 0),
          invalid: Number(body.invalid || 0)
        };
        console.log(
          `Alerte APK v${result.version || '?'}: ${result.sent} envoyée(s), ` +
          `${result.alreadySent} déjà traitée(s), ${result.invalid} token(s) invalide(s).`
        );
        return result;
      }

      const retryable = response.status === 429 || response.status >= 500;
      lastError = new Error(`Backend de notification refusé (${response.status}, ${String(body.error || 'unknown')})`);
      if (!retryable || attempt === maxAttempts) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
    await sleep(attempt * 5_000);
  }
  throw lastError || new Error('Échec de notification Android');
}

async function main() {
  validateInputs();
  if (process.env.RELEASE_WAIT_FOR_COMPLETION === 'true') await waitForSuccessfulSourceRun();

  const release = await findOfficialReleaseForHead();
  let notification = null;
  let notificationError = null;
  try {
    notification = await notifyAndroidRelease();
  } catch (error) {
    notificationError = error;
  }

  const summary = buildFinalReleaseSummary({
    release,
    sourceRunId: runId,
    sourceHeadSha: headSha,
    notification,
    notificationError
  });
  await upsertFinalReleaseSummary({ body: summary });

  if (notificationError) throw notificationError;
}

module.exports = {
  CONTROL_ISSUE,
  buildFinalReleaseSummary,
  findOfficialReleaseForHead,
  getReleaseAssetEvidence,
  maxAttempts,
  runPollDelayMs,
  runPollLimit,
  sanitizeFailure,
  upsertFinalReleaseSummary,
  validateSourceRun,
  waitForSuccessfulSourceRun
};

if (require.main === module) {
  main().catch(error => {
    console.error('Échec de la notification Android post-release:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
