const endpoint = (process.env.RELEASE_NOTIFICATION_ENDPOINT || 'https://seenit.ai.studio/api/releases/notify').trim();
const repository = (process.env.RELEASE_REPOSITORY || '').trim();
const runId = Number(process.env.RELEASE_RUN_ID || '');
const headSha = (process.env.RELEASE_HEAD_SHA || '').trim();
const maxAttempts = 3;
const runPollLimit = 30;
const runPollDelayMs = 2_000;

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
    if (!response.ok) {
      throw new Error(`Vérification du run source refusée (${response.status})`);
    }
    if (validateSourceRun(await response.json(), {
      repository: repositoryName,
      headSha: sourceHeadSha
    })) return;
    if (attempt + 1 < pollLimit) await sleepImpl(pollDelayMs);
  }

  throw new Error('Le run source n’est pas terminé dans la fenêtre bornée de 60 s');
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

async function main() {
  validateInputs();

  if (process.env.RELEASE_WAIT_FOR_COMPLETION === 'true') {
    await waitForSuccessfulSourceRun();
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await postAttempt();
      if (response.status === 204) {
        console.log('Aucune release APK officielle ne correspond à ce run ; aucune alerte envoyée.');
        return;
      }

      let body = {};
      try {
        body = await response.json();
      } catch {
        body = {};
      }

      if (response.ok) {
        console.log(
          `Alerte APK v${String(body.version || '?')}: ` +
          `${Number(body.sent || 0)} envoyée(s), ` +
          `${Number(body.alreadySent || 0)} déjà traitée(s), ` +
          `${Number(body.invalid || 0)} token(s) invalide(s).`
        );
        return;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`Backend de notification refusé (${response.status}, ${String(body.error || 'unknown')})`);
      }
    } catch (error) {
      if (attempt === maxAttempts) throw error;
    }

    await sleep(attempt * 5_000);
  }
}

module.exports = {
  maxAttempts,
  runPollDelayMs,
  runPollLimit,
  validateSourceRun,
  waitForSuccessfulSourceRun
};

if (require.main === module) {
  main().catch(error => {
    console.error('Échec de la notification Android post-release:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
