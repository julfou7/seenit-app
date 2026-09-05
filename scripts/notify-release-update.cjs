const endpoint = (process.env.RELEASE_NOTIFICATION_ENDPOINT || 'https://seenit.ai.studio/api/releases/notify').trim();
const repository = (process.env.RELEASE_REPOSITORY || '').trim();
const runId = Number(process.env.RELEASE_RUN_ID || '');
const headSha = (process.env.RELEASE_HEAD_SHA || '').trim();
const maxAttempts = 3;

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

main().catch(error => {
  console.error('Échec de la notification Android post-release:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
