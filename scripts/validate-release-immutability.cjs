const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const gradleRelativePath = 'android/app/build.gradle';

function parseSemver(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function expectedVersionCode(versionName) {
  const parsed = parseSemver(versionName);
  if (!parsed) return null;
  const [major, minor, patch] = parsed;
  return major * 100000 + minor * 1000 + patch;
}

function parseAndroidVersion(source) {
  const versionName = String(source || '').match(/\bversionName\s+["'](\d+\.\d+\.\d+)["']/)?.[1];
  const versionCodeRaw = String(source || '').match(/\bversionCode\s+(\d+)/)?.[1];
  if (!versionName || !versionCodeRaw || !parseSemver(versionName)) {
    throw new Error('versionName ou versionCode Android introuvable/invalide.');
  }
  return { versionName, versionCode: Number(versionCodeRaw) };
}

function evaluateReleaseCandidate({ current, previous, tagExists = false, releaseExists = false }) {
  const errors = [];
  const currentSemver = parseSemver(current.versionName);
  const previousSemver = parseSemver(previous.versionName);

  if (!currentSemver || !previousSemver) {
    errors.push('Les versions Android doivent être des SemVer X.Y.Z strictes.');
  } else if (compareSemver(currentSemver, previousSemver) <= 0) {
    errors.push(`versionName ${current.versionName} doit être strictement supérieure à ${previous.versionName}.`);
  }

  if (!Number.isInteger(current.versionCode) || current.versionCode <= previous.versionCode) {
    errors.push(`versionCode ${current.versionCode} doit être strictement supérieur à ${previous.versionCode}.`);
  }

  const expectedCode = expectedVersionCode(current.versionName);
  if (expectedCode !== current.versionCode) {
    errors.push(`versionCode ${current.versionCode} ne correspond pas à ${current.versionName} (attendu : ${expectedCode}).`);
  }

  if (tagExists) errors.push(`Le tag v${current.versionName} existe déjà : republication interdite.`);
  if (releaseExists) errors.push(`La release v${current.versionName} existe déjà : mutation interdite.`);

  return { ok: errors.length === 0, errors };
}

function selectBaseRef(value) {
  const normalized = String(value || '').trim();
  if (/^[0-9a-f]{40}$/i.test(normalized) && !/^0{40}$/.test(normalized)) return normalized;
  return 'HEAD^';
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  }).trim();
}

function readPreviousAndroidVersion(baseRef) {
  try {
    return parseAndroidVersion(runGit(['show', `${baseRef}:${gradleRelativePath}`]));
  } catch (error) {
    const details = String(error?.stderr || error?.message || '').trim();
    throw new Error(`Impossible de lire la version Android précédente depuis ${baseRef}${details ? ` : ${details}` : '.'}`);
  }
}

function localTagExists(tagName) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tagName}`], {
      cwd: root,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

async function githubResourceExists(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'SeenIt-Release-Guard',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(`GitHub a répondu HTTP ${response.status} pendant le contrôle d'immuabilité.`);
}

async function readRemoteState({ repository, token, versionName }) {
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY est absent ou invalide.');
  }
  if (!token) throw new Error('GITHUB_TOKEN est requis pour vérifier les tags et releases.');

  const tagName = `v${versionName}`;
  const apiRoot = `https://api.github.com/repos/${repository}`;
  const [tagExists, releaseExists] = await Promise.all([
    githubResourceExists(`${apiRoot}/git/ref/tags/${encodeURIComponent(tagName)}`, token),
    githubResourceExists(`${apiRoot}/releases/tags/${encodeURIComponent(tagName)}`, token)
  ]);
  return { tagExists, releaseExists };
}

function writeVersionOutput(versionName) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `APP_VERSION=${versionName}\n`, 'utf8');
}

async function main() {
  try {
    const current = parseAndroidVersion(fs.readFileSync(path.join(root, gradleRelativePath), 'utf8'));
    const baseRef = selectBaseRef(process.env.RELEASE_BASE_SHA);
    const previous = readPreviousAndroidVersion(baseRef);
    const tagName = `v${current.versionName}`;
    const localExists = localTagExists(tagName);
    const remote = process.argv.includes('--skip-remote')
      ? { tagExists: false, releaseExists: false }
      : await readRemoteState({
          repository: process.env.GITHUB_REPOSITORY,
          token: process.env.GITHUB_TOKEN,
          versionName: current.versionName
        });
    const result = evaluateReleaseCandidate({
      current,
      previous,
      tagExists: localExists || remote.tagExists,
      releaseExists: remote.releaseExists
    });

    if (!result.ok) {
      for (const error of result.errors) console.error(`[Release Guard] ${error}`);
      process.exitCode = 1;
      return;
    }

    writeVersionOutput(current.versionName);
    console.log(
      `[Release Guard] ${tagName} est inédite et progresse depuis v${previous.versionName} ` +
        `(versionCode ${previous.versionCode} → ${current.versionCode}).`
    );
  } catch (error) {
    console.error(`[Release Guard] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  compareSemver,
  evaluateReleaseCandidate,
  expectedVersionCode,
  parseAndroidVersion,
  parseSemver,
  selectBaseRef
};

if (require.main === module) main();
