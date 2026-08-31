import { resolveSeenItApiUrl } from '../../lib/seenitApi.ts';

export const SEENIT_GITHUB_REPOSITORY = 'julfou7/seenit-app';
export const SEENIT_GITHUB_RELEASE_API = `https://api.github.com/repos/${SEENIT_GITHUB_REPOSITORY}/releases/latest`;

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

  return {
    version,
    tagName: `v${version}`,
    name: typeof release.name === 'string' && release.name.trim() ? release.name : `SeenIt v${version}`,
    releaseNotes: typeof release.body === 'string' ? release.body : '',
    publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
    apkDownloadUrl,
    apkSha256: normalizeSha256Digest(apkAsset?.digest),
    browserDownloadUrl: apkDownloadUrl,
    htmlUrl
  };
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
