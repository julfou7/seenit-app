const DAY_MS = 24 * 60 * 60 * 1000;
const CANONICAL_REPOSITORY = 'julfou7/seenit-app';
const API_VERSION = '2022-11-28';

const ARTIFACT_RETENTION_POLICIES = Object.freeze([
  {
    id: 'apk-intermediate',
    days: 1,
    patterns: [/^seenit-(?:android-)?apk-/i]
  },
  {
    id: 'android-test-harness',
    days: 1,
    patterns: [/^seenit-(?:android-)?upgrade-test-/i, /^seenit-test-harness-/i]
  },
  {
    id: 'quality-evidence',
    days: 7,
    patterns: [
      /^seenit-quality-gates-/i,
      /^seenit-agent-quality-gates-/i,
      /^seenit-apk-upgrade-smoke-android-/i
    ]
  }
]);

function retentionPolicyForArtifact(name) {
  const artifactName = String(name || '');
  return ARTIFACT_RETENTION_POLICIES.find(policy =>
    policy.patterns.some(pattern => pattern.test(artifactName))
  ) || null;
}

function ageInDays(createdAt, nowMs) {
  const createdMs = Date.parse(String(createdAt || ''));
  if (!Number.isFinite(createdMs)) return null;
  return Math.max(0, (nowMs - createdMs) / DAY_MS);
}

function buildStoragePlan({ protectedRelease, releases = [], artifacts = [], nowMs = Date.now() }) {
  const protectedId = Number(protectedRelease?.id || 0);
  const releaseList = Array.isArray(releases) ? releases : [];
  const artifactList = Array.isArray(artifacts) ? artifacts : [];

  if (protectedId && releaseList.length > 0 && !releaseList.some(release => Number(release?.id) === protectedId)) {
    throw new Error('La release protégée est absente de la collection GitHub ; purge des releases refusée');
  }

  const releasesToDelete = protectedId
    ? releaseList.filter(release => Number(release?.id) > 0 && Number(release.id) !== protectedId)
    : [];

  const artifactsToDelete = artifactList.filter(artifact => {
    const policy = retentionPolicyForArtifact(artifact?.name);
    if (!policy || !Number(artifact?.id)) return false;
    if (artifact?.expired === true) return true;
    const age = ageInDays(artifact?.created_at, nowMs);
    return age !== null && age >= policy.days;
  });

  return {
    protectedReleaseId: protectedId || null,
    protectedReleaseTag: protectedRelease?.tag_name || null,
    releasesToDelete,
    artifactsToDelete,
    estimatedBytes: {
      releases: releasesToDelete.reduce((sum, release) => sum + (Array.isArray(release?.assets)
        ? release.assets.reduce((assetSum, asset) => assetSum + Number(asset?.size || 0), 0)
        : 0), 0),
      artifacts: artifactsToDelete.reduce((sum, artifact) => sum + Number(artifact?.size_in_bytes || 0), 0)
    }
  };
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let scaled = value;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

async function githubRequest(path, {
  method = 'GET',
  token = String(process.env.GITHUB_TOKEN || '').trim(),
  repository = String(process.env.GITHUB_REPOSITORY || '').trim(),
  fetchImpl = fetch,
  allow404 = false
} = {}) {
  if (repository !== CANONICAL_REPOSITORY) {
    throw new Error(`Dépôt de maintenance non canonique : ${repository || 'absent'}`);
  }
  if (!token) throw new Error('GITHUB_TOKEN absent pour la maintenance du stockage');

  const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'SeenIt-GitHub-Storage-Maintenance'
    }
  });

  if (allow404 && response.status === 404) return null;
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
    throw new Error(`GitHub API ${method} ${path} -> ${response.status}: ${detail}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function listPaginated(path, key, { request = githubRequest } = {}) {
  const all = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await request(`${path}${separator}per_page=100&page=${page}`);
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : [];
    all.push(...items);
    if (items.length < 100) return all;
  }
  throw new Error(`Pagination GitHub non bornée pour ${path}`);
}

async function resolveProtectedRelease({ releases, request = githubRequest } = {}) {
  const expectedHeadSha = String(process.env.SEENIT_STORAGE_KEEP_HEAD_SHA || '').trim();
  if (expectedHeadSha) {
    if (!/^[0-9a-f]{40}$/i.test(expectedHeadSha)) {
      throw new Error('SEENIT_STORAGE_KEEP_HEAD_SHA invalide');
    }
    const exact = releases.find(release =>
      !release?.draft && String(release?.target_commitish || '').toLowerCase() === expectedHeadSha.toLowerCase()
    );
    if (!exact) throw new Error(`Release publiée introuvable pour le SHA protégé ${expectedHeadSha}`);
    return exact;
  }
  return request('/releases/latest', { allow404: true });
}

async function runMaintenance({ request = githubRequest, nowMs = Date.now() } = {}) {
  const releases = await listPaginated('/releases', 'releases', { request });
  const protectedRelease = await resolveProtectedRelease({ releases, request });
  const artifactsPayload = await listPaginated('/actions/artifacts', 'artifacts', { request });
  const plan = buildStoragePlan({ protectedRelease, releases, artifacts: artifactsPayload, nowMs });
  const apply = String(process.env.SEENIT_STORAGE_APPLY || '').trim().toLowerCase() === 'true';

  console.log(`[Storage] release protégée : ${plan.protectedReleaseTag || 'aucune'} (${plan.protectedReleaseId || 'n/a'})`);
  console.log(`[Storage] releases à supprimer : ${plan.releasesToDelete.length} (${formatBytes(plan.estimatedBytes.releases)})`);
  console.log(`[Storage] artefacts à supprimer : ${plan.artifactsToDelete.length} (${formatBytes(plan.estimatedBytes.artifacts)})`);
  console.log(`[Storage] mode : ${apply ? 'APPLY' : 'DRY-RUN'}`);

  if (!apply) return plan;

  for (const release of plan.releasesToDelete) {
    await request(`/releases/${release.id}`, { method: 'DELETE' });
    console.log(`[Storage] release supprimée : ${release.tag_name || release.id}`);
  }
  for (const artifact of plan.artifactsToDelete) {
    await request(`/actions/artifacts/${artifact.id}`, { method: 'DELETE' });
    console.log(`[Storage] artefact supprimé : ${artifact.name || artifact.id}`);
  }
  return plan;
}

module.exports = {
  API_VERSION,
  ARTIFACT_RETENTION_POLICIES,
  CANONICAL_REPOSITORY,
  DAY_MS,
  ageInDays,
  buildStoragePlan,
  formatBytes,
  githubRequest,
  listPaginated,
  resolveProtectedRelease,
  retentionPolicyForArtifact,
  runMaintenance
};

if (require.main === module) {
  runMaintenance().catch(error => {
    console.error('[Storage] maintenance GitHub en échec:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
