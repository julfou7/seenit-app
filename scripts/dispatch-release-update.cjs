const EVENT_TYPE = 'seenit_apk_release_published';
const OFFICIAL_REPOSITORY = 'julfou7/seenit-app';

function validateReleaseDispatchInput({ repository, runId, headSha, token }) {
  if (repository !== OFFICIAL_REPOSITORY) {
    throw new Error(`Dépôt de release non canonique : ${repository || '(absent)'}`);
  }
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    throw new Error('Identifiant du run de release invalide');
  }
  if (!/^[0-9a-f]{40}$/i.test(headSha || '')) {
    throw new Error('SHA du run de release invalide');
  }
  if (!token) {
    throw new Error('GITHUB_TOKEN absent');
  }
}

function buildRepositoryDispatchRequest({ runId, headSha }) {
  return {
    event_type: EVENT_TYPE,
    client_payload: {
      release_run_id: runId,
      release_head_sha: headSha
    }
  };
}

async function dispatchReleaseUpdate({ repository, runId, headSha, token, fetchImpl = fetch }) {
  validateReleaseDispatchInput({ repository, runId, headSha, token });
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'seenit-release-update-dispatch'
    },
    body: JSON.stringify(buildRepositoryDispatchRequest({ runId, headSha }))
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`GitHub repository_dispatch refusé (${response.status}): ${detail}`);
  }

  console.log(`Notification Android mise en file pour le run ${runId} (${headSha.slice(0, 8)}).`);
}

async function main() {
  const repository = String(process.env.RELEASE_REPOSITORY || '').trim();
  const runId = Number(process.env.RELEASE_RUN_ID || '');
  const headSha = String(process.env.RELEASE_HEAD_SHA || '').trim();
  const token = String(process.env.GITHUB_TOKEN || '').trim();
  await dispatchReleaseUpdate({ repository, runId, headSha, token });
}

module.exports = {
  EVENT_TYPE,
  OFFICIAL_REPOSITORY,
  buildRepositoryDispatchRequest,
  dispatchReleaseUpdate,
  validateReleaseDispatchInput
};

if (require.main === module) {
  main().catch(error => {
    console.error('[Release Update Dispatch]', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
