const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OFFICIAL_REPOSITORY = 'julfou7/seenit-app';

function parseSemver(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value || '').trim());
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function selectPreviousRelease(releases, currentVersion) {
  const current = parseSemver(currentVersion);
  if (!current) throw new Error(`Version courante invalide : ${currentVersion}`);

  const candidates = releases
    .filter((release) => !release.draft && !release.prerelease)
    .map((release) => ({ release, version: parseSemver(release.tag_name) }))
    .filter((entry) => entry.version && compareSemver(entry.version, current) < 0)
    .sort((left, right) => compareSemver(right.version, left.version));

  if (!candidates.length) {
    throw new Error(`Aucune release stable antérieure à v${currentVersion} n'est disponible.`);
  }

  const selected = candidates[0];
  const normalizedVersion = selected.version.join('.');
  const apkName = `SeenIt-v${normalizedVersion}.apk`;
  const checksumName = `${apkName}.sha256`;
  const apk = selected.release.assets?.find((asset) => asset.name === apkName);
  const checksum = selected.release.assets?.find((asset) => asset.name === checksumName);
  if (!apk || !checksum) {
    throw new Error(`La release v${normalizedVersion} ne contient pas la paire APK/SHA-256 officielle.`);
  }

  return { release: selected.release, version: normalizedVersion, apk, checksum };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyArtifactPair(apkBuffer, checksumBuffer, apkAsset) {
  const checksumText = checksumBuffer.toString('utf8').trim();
  const expected = /^([a-fA-F0-9]{64})\s+\*?SeenIt-v\d+\.\d+\.\d+\.apk$/.exec(checksumText)?.[1]?.toLowerCase();
  if (!expected) throw new Error('Le fichier SHA-256 de la baseline est invalide.');

  const actual = sha256(apkBuffer);
  if (actual !== expected) throw new Error(`Empreinte APK baseline invalide : ${actual} au lieu de ${expected}.`);

  const githubDigest = typeof apkAsset.digest === 'string'
    ? /^sha256:([a-fA-F0-9]{64})$/.exec(apkAsset.digest)?.[1]?.toLowerCase()
    : null;
  if (apkAsset.digest && !githubDigest) throw new Error('Le digest GitHub de la baseline est invalide.');
  if (githubDigest && githubDigest !== actual) {
    throw new Error(`Le digest GitHub de la baseline ne correspond pas à l'APK (${githubDigest}).`);
  }
  return actual;
}

async function githubRequest(url, token, accept = 'application/vnd.github+json') {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'SeenIt-Android-Upgrade-Smoke'
    },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} pour ${url}`);
  return response;
}

async function downloadPreviousRelease({ repository, currentVersion, token, outputDirectory }) {
  if (repository !== OFFICIAL_REPOSITORY) {
    throw new Error(`Dépôt baseline refusé : ${repository}. Attendu : ${OFFICIAL_REPOSITORY}.`);
  }
  if (!token) throw new Error('GITHUB_TOKEN est obligatoire pour récupérer la baseline APK.');

  const releasesResponse = await githubRequest(
    `https://api.github.com/repos/${repository}/releases?per_page=100&page=1`,
    token
  );
  const releases = await releasesResponse.json();
  if (!Array.isArray(releases)) throw new Error('Réponse GitHub releases invalide.');

  const selected = selectPreviousRelease(releases, currentVersion);
  const [apkResponse, checksumResponse] = await Promise.all([
    githubRequest(selected.apk.url, token, 'application/octet-stream'),
    githubRequest(selected.checksum.url, token, 'application/octet-stream')
  ]);
  const apkBuffer = Buffer.from(await apkResponse.arrayBuffer());
  const checksumBuffer = Buffer.from(await checksumResponse.arrayBuffer());
  const digest = verifyArtifactPair(apkBuffer, checksumBuffer, selected.apk);

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, selected.apk.name), apkBuffer);
  fs.writeFileSync(path.join(outputDirectory, selected.checksum.name), checksumBuffer);
  return { version: selected.version, digest, apkName: selected.apk.name };
}

async function main() {
  const outputDirectory = path.resolve(process.argv[2] || 'upgrade-baseline');
  const result = await downloadPreviousRelease({
    repository: process.env.GITHUB_REPOSITORY,
    currentVersion: process.env.CURRENT_VERSION,
    token: process.env.GITHUB_TOKEN,
    outputDirectory
  });
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `BASELINE_VERSION=${result.version}\n`);
  }
  console.log(`[APK Upgrade] Baseline v${result.version} vérifiée (${result.digest}).`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[APK Upgrade] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  compareSemver,
  downloadPreviousRelease,
  parseSemver,
  selectPreviousRelease,
  verifyArtifactPair
};
