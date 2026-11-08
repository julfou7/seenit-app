import { resolveSeenItApiUrl } from '../../lib/seenitApi.ts';

export const SEENIT_GITHUB_REPOSITORY = 'julfou7/seenit-app';
export const SEENIT_GITHUB_RELEASE_API = `https://api.github.com/repos/${SEENIT_GITHUB_REPOSITORY}/releases/latest`;
export const SEENIT_GITHUB_RELEASES_API = `https://api.github.com/repos/${SEENIT_GITHUB_REPOSITORY}/releases`;

export interface SeenItReleaseNotesEntry {
  version: string;
  releaseNotes: string;
  publishedAt: string;
  htmlUrl: string;
}

export interface SeenItReleaseInfo {
  version: string;
  tagName: string;
  name: string;
  releaseNotes: string;
  publishedAt: string;
  apkDownloadUrl: string;
  apkSha256: string | null;
  browserDownloadUrl: string;
  htmlUrl: string;
  releaseNotesHistory: SeenItReleaseNotesEntry[];
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

export function normalizeSemanticVersion(input: unknown): string | null {
  const value = String(input || '').trim().replace(/^v/i, '');
  return /^\d+\.\d+\.\d+$/.test(value) ? value : null;
}

export function compareSemanticVersions(left: string, right: string): number {
  const leftParts = normalizeSemanticVersion(left)?.split('.').map(Number);
  const rightParts = normalizeSemanticVersion(right)?.split('.').map(Number);
  if (!leftParts || !rightParts) return 0;

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function normalizeSha256Digest(input: unknown): string | null {
  const digest = String(input || '').trim().toLowerCase().replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
}

export function getExpectedApkName(version: string): string {
  return `SeenIt-v${version}.apk`;
}

export function isTrustedSeenItApkUrl(input: unknown, version: string): boolean {
  if (!normalizeSemanticVersion(version)) return false;
  try {
    const url = new URL(String(input || ''));
    const expectedPath = `/${SEENIT_GITHUB_REPOSITORY}/releases/download/v${version}/${getExpectedApkName(version)}`;
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname === expectedPath
      && url.username === ''
      && url.password === ''
      && url.search === '';
  } catch {
    return false;
  }
}

/**
 * Retour terrain du 08/11 (v1.4.273) : la route GitHub par tag (`/releases/download/vX.Y.Z/…`) répondait
 * 504 sept fois sur dix pendant que la route `/releases/latest/download/…` servait le même asset. Le
 * téléchargement retombe donc sur cette route, liée au nom exact `SeenIt-vX.Y.Z.apk` : si une release
 * plus récente est sortie entre-temps, le fichier n'existe plus sous ce nom et rien n'est installé.
 */
export function getLatestRouteApkUrl(version: string): string | null {
  if (!normalizeSemanticVersion(version)) return null;
  return `https://github.com/${SEENIT_GITHUB_REPOSITORY}/releases/latest/download/${getExpectedApkName(version)}`;
}

export function isTrustedSeenItApkFallbackUrl(input: unknown, version: string): boolean {
  const expected = getLatestRouteApkUrl(version);
  return Boolean(expected) && String(input || '') === expected;
}

/**
 * Liens à essayer, dans l'ordre : l'asset exact de la release, puis la route « latest » du même fichier.
 * La route de secours n'est proposée que si l'empreinte SHA-256 officielle est connue : le fichier reçu
 * est alors prouvé identique à l'asset publié avant toute installation (SEENIT-UPDATE-002).
 */
export function apkDownloadCandidates(release: Pick<SeenItReleaseInfo, 'version' | 'apkDownloadUrl' | 'apkSha256'>): string[] {
  const candidates: string[] = [];
  if (isTrustedSeenItApkUrl(release.apkDownloadUrl, release.version)) candidates.push(release.apkDownloadUrl);
  const fallback = getLatestRouteApkUrl(release.version);
  if (candidates.length && fallback && normalizeSha256Digest(release.apkSha256)) candidates.push(fallback);
  return candidates;
}

export function parseSeenItRelease(payload: unknown): SeenItReleaseInfo | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const release = payload as GitHubReleasePayload;
  const version = normalizeSemanticVersion(release.tag_name);
  if (!version || String(release.tag_name) !== `v${version}`) return null;

  const expectedName = getExpectedApkName(version);
  const assets = Array.isArray(release.assets) ? release.assets as GitHubReleaseAsset[] : [];
  const apkAsset = assets.find(asset => asset?.name === expectedName);
  const apkDownloadUrl = typeof apkAsset?.browser_download_url === 'string'
    ? apkAsset.browser_download_url
    : '';
  if (!isTrustedSeenItApkUrl(apkDownloadUrl, version)) return null;

  const htmlUrl = typeof release.html_url === 'string'
    && release.html_url === `https://github.com/${SEENIT_GITHUB_REPOSITORY}/releases/tag/v${version}`
    ? release.html_url
    : `https://github.com/${SEENIT_GITHUB_REPOSITORY}/releases/tag/v${version}`;

  const releaseNotes = typeof release.body === 'string' ? release.body : '';
  const publishedAt = typeof release.published_at === 'string' ? release.published_at : '';
  const releaseInfo: SeenItReleaseInfo = {
    version,
    tagName: `v${version}`,
    name: typeof release.name === 'string' && release.name.trim() ? release.name : `SeenIt v${version}`,
    releaseNotes,
    publishedAt,
    apkDownloadUrl,
    apkSha256: normalizeSha256Digest(apkAsset?.digest),
    browserDownloadUrl: apkDownloadUrl,
    htmlUrl,
    releaseNotesHistory: []
  };

  releaseInfo.releaseNotesHistory = [{ version, releaseNotes, publishedAt, htmlUrl }];
  return releaseInfo;
}

function toReleaseNotesEntry(release: SeenItReleaseInfo): SeenItReleaseNotesEntry {
  return {
    version: release.version,
    releaseNotes: release.releaseNotes,
    publishedAt: release.publishedAt,
    htmlUrl: release.htmlUrl
  };
}

export function selectSeenItReleaseHistory(
  payloads: unknown[],
  installedVersion: string,
  targetVersion: string
): SeenItReleaseNotesEntry[] {
  if (!normalizeSemanticVersion(installedVersion) || !normalizeSemanticVersion(targetVersion)) return [];

  const releasesByVersion = new Map<string, SeenItReleaseNotesEntry>();
  for (const payload of payloads) {
    const release = parseSeenItRelease(payload);
    if (!release) continue;
    if (compareSemanticVersions(release.version, installedVersion) <= 0) continue;
    if (compareSemanticVersions(release.version, targetVersion) > 0) continue;
    releasesByVersion.set(release.version, toReleaseNotesEntry(release));
  }

  return [...releasesByVersion.values()].sort((left, right) =>
    compareSemanticVersions(left.version, right.version)
  );
}

export function selectSeenItCompleteReleaseHistory(payloads: unknown[]): SeenItReleaseNotesEntry[] {
  const releasesByVersion = new Map<string, SeenItReleaseNotesEntry>();
  for (const payload of payloads) {
    const release = parseSeenItRelease(payload);
    if (!release) continue;
    releasesByVersion.set(release.version, toReleaseNotesEntry(release));
  }

  return [...releasesByVersion.values()].sort((left, right) =>
    compareSemanticVersions(right.version, left.version)
  );
}

export async function resolveSeenItReleaseHistory(
  installedVersion: string,
  targetRelease: SeenItReleaseInfo,
  fetchImpl: typeof fetch = fetch,
  maxPages = 10
): Promise<SeenItReleaseNotesEntry[]> {
  const fallback = [toReleaseNotesEntry(targetRelease)];
  const collected: unknown[] = [];
  let historyIsComplete = false;

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await fetchImpl(`${SEENIT_GITHUB_RELEASES_API}?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github.v3+json' }
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) return fallback;

      const payload = await response.json();
      if (!Array.isArray(payload)) return fallback;
      collected.push(...payload);

      const reachedInstalledBoundary = payload.some(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const version = normalizeSemanticVersion((item as GitHubReleasePayload).tag_name);
        return Boolean(version && compareSemanticVersions(version, installedVersion) <= 0);
      });
      if (reachedInstalledBoundary || payload.length < 100) {
        historyIsComplete = true;
        break;
      }
    }

    if (!historyIsComplete) return fallback;
    const history = selectSeenItReleaseHistory(collected, installedVersion, targetRelease.version);
    return history.some(entry => entry.version === targetRelease.version) ? history : fallback;
  } catch {
    return fallback;
  }
}

export async function resolveSeenItCompleteReleaseHistory(
  fetchImpl: typeof fetch = fetch,
  maxPages = 10
): Promise<SeenItReleaseNotesEntry[]> {
  const collected: unknown[] = [];

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await fetchImpl(`${SEENIT_GITHUB_RELEASES_API}?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github.v3+json' }
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) break;

      const payload = await response.json();
      if (!Array.isArray(payload)) break;
      collected.push(...payload);
      if (payload.length < 100) break;
    }
  } catch {
    // L'historique déjà validé reste consultable si une page tardive échoue.
  }

  return selectSeenItCompleteReleaseHistory(collected);
}

export interface UpdateMetadataEndpoint {
  url: string;
  kind: 'github' | 'seenit';
}

export function getUpdateMetadataEndpoints(native: boolean): UpdateMetadataEndpoint[] {
  return [
    { url: SEENIT_GITHUB_RELEASE_API, kind: 'github' },
    { url: resolveSeenItApiUrl('/api/update', native), kind: 'seenit' }
  ];
}
