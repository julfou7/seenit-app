export const OFFICIAL_SEENIT_REPOSITORY = 'julfou7/seenit-app';
export const OFFICIAL_RELEASE_WORKFLOW_PATH = '.github/workflows/build-apk.yml';
export const APP_UPDATE_AVAILABLE_PUSH_TYPE = 'APP_UPDATE_AVAILABLE';
export const RELEASE_PUSH_MAX_ATTEMPTS = 3;
export const RELEASE_PUSH_LEASE_MS = 2 * 60 * 1000;

const RELEASE_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const HEAD_SHA_RE = /^[0-9a-f]{40}$/i;
const INSTALLATION_HASH_RE = /^[0-9a-f]{64}$/i;

export interface ReleaseNotificationRequest {
  repository: string;
  runId: number;
  headSha: string;
}

export interface VerifiedReleaseNotification {
  eligible: true;
  repository: typeof OFFICIAL_SEENIT_REPOSITORY;
  runId: number;
  headSha: string;
  version: string;
  tagName: string;
  apkName: string;
  apkSha256: string;
}

export interface IneligibleReleaseNotification {
  eligible: false;
  reason: 'no_release_for_run';
}

export type ReleaseNotificationVerification =
  | VerifiedReleaseNotification
  | IneligibleReleaseNotification;

export class ReleaseNotificationSourceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ReleaseNotificationSourceError';
  }
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

function parseRequest(input: unknown): ReleaseNotificationRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReleaseNotificationSourceError(400, 'invalid_request', 'Requête de notification de release invalide');
  }
  const candidate = input as Record<string, unknown>;
  const repository = typeof candidate.repository === 'string' ? candidate.repository.trim() : '';
  const runId = Number(candidate.runId);
  const headSha = typeof candidate.headSha === 'string' ? candidate.headSha.trim() : '';

  if (repository !== OFFICIAL_SEENIT_REPOSITORY) {
    throw new ReleaseNotificationSourceError(403, 'untrusted_repository', 'Dépôt de release non autorisé');
  }
  if (!Number.isSafeInteger(runId) || runId <= 0 || !HEAD_SHA_RE.test(headSha)) {
    throw new ReleaseNotificationSourceError(400, 'invalid_request', 'Identité du run de release invalide');
  }
  return { repository, runId, headSha };
}

function githubHeaders(githubToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'SeenIt-Release-Notifier',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (githubToken?.trim()) headers.Authorization = `Bearer ${githubToken.trim()}`;
  return headers;
}

async function fetchGithubJson(
  url: string,
  fetchImpl: FetchLike,
  githubToken?: string
): Promise<any> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: githubHeaders(githubToken) });
  } catch {
    throw new ReleaseNotificationSourceError(502, 'github_unavailable', 'GitHub est indisponible pour la vérification');
  }
  if (!response.ok) {
    throw new ReleaseNotificationSourceError(
      502,
      'github_verification_failed',
      `GitHub a refusé une preuve de release (${response.status})`
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ReleaseNotificationSourceError(502, 'github_invalid_response', 'Réponse GitHub invalide');
  }
}

function parseTimestamp(raw: unknown): number {
  if (typeof raw !== 'string') return NaN;
  return Date.parse(raw);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveTagCommitSha(
  tagName: string,
  fetchImpl: FetchLike,
  githubToken?: string
): Promise<string> {
  const ref = await fetchGithubJson(
    `https://api.github.com/repos/${OFFICIAL_SEENIT_REPOSITORY}/git/ref/tags/${encodeURIComponent(tagName)}`,
    fetchImpl,
    githubToken
  );
  let object = ref?.object;
  if (!object || typeof object.sha !== 'string' || typeof object.type !== 'string') {
    throw new ReleaseNotificationSourceError(502, 'invalid_tag_ref', 'Référence GitHub de release invalide');
  }
  if (object.type === 'tag') {
    const annotated = await fetchGithubJson(
      `https://api.github.com/repos/${OFFICIAL_SEENIT_REPOSITORY}/git/tags/${object.sha}`,
      fetchImpl,
      githubToken
    );
    object = annotated?.object;
  }
  if (object?.type !== 'commit' || typeof object.sha !== 'string' || !HEAD_SHA_RE.test(object.sha)) {
    throw new ReleaseNotificationSourceError(502, 'invalid_tag_target', 'Le tag de release ne cible pas un commit');
  }
  return object.sha;
}

function validateOfficialAssetUrl(rawUrl: unknown, tagName: string, fileName: string): string {
  const expected = `https://github.com/${OFFICIAL_SEENIT_REPOSITORY}/releases/download/${tagName}/${fileName}`;
  if (rawUrl !== expected) {
    throw new ReleaseNotificationSourceError(502, 'invalid_release_asset_url', 'URL d’asset de release non canonique');
  }
  return expected;
}

async function fetchOfficialSha256(
  url: string,
  apkName: string,
  fetchImpl: FetchLike
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'SeenIt-Release-Notifier'
      }
    });
  } catch {
    throw new ReleaseNotificationSourceError(502, 'sha256_unavailable', 'Empreinte SHA-256 indisponible');
  }
  if (!response.ok) {
    throw new ReleaseNotificationSourceError(502, 'sha256_unavailable', 'Empreinte SHA-256 indisponible');
  }
  const text = await response.text();
  if (text.length > 1024) {
    throw new ReleaseNotificationSourceError(502, 'invalid_sha256_asset', 'Fichier SHA-256 invalide');
  }
  const match = text
    .trim()
    .match(new RegExp(`^([0-9a-f]{64})\\s+\\*?${escapeRegExp(apkName)}$`, 'i'));
  if (!match) {
    throw new ReleaseNotificationSourceError(502, 'invalid_sha256_asset', 'Fichier SHA-256 invalide');
  }
  return match[1].toLowerCase();
}

export async function verifyOfficialReleaseNotification(
  input: unknown,
  options: { fetchImpl?: FetchLike; githubToken?: string } = {}
): Promise<ReleaseNotificationVerification> {
  const request = parseRequest(input);
  const fetchImpl = options.fetchImpl || fetch;

  const run = await fetchGithubJson(
    `https://api.github.com/repos/${OFFICIAL_SEENIT_REPOSITORY}/actions/runs/${request.runId}`,
    fetchImpl,
    options.githubToken
  );

  if (
    run?.repository?.full_name !== OFFICIAL_SEENIT_REPOSITORY ||
    run?.path !== OFFICIAL_RELEASE_WORKFLOW_PATH ||
    run?.event !== 'workflow_dispatch' ||
    run?.head_branch !== 'main' ||
    run?.head_sha !== request.headSha ||
    run?.status !== 'completed' ||
    run?.conclusion !== 'success'
  ) {
    throw new ReleaseNotificationSourceError(403, 'untrusted_workflow_run', 'Le run GitHub ne prouve pas une release SeenIt réussie');
  }

  const release = await fetchGithubJson(
    `https://api.github.com/repos/${OFFICIAL_SEENIT_REPOSITORY}/releases/latest`,
    fetchImpl,
    options.githubToken
  );

  const tagName = typeof release?.tag_name === 'string' ? release.tag_name.trim() : '';
  const tagMatch = tagName.match(RELEASE_TAG_RE);
  if (!tagMatch || release?.draft === true || release?.prerelease === true) {
    return { eligible: false, reason: 'no_release_for_run' };
  }

  const runStart = parseTimestamp(run.run_started_at || run.created_at);
  const runEnd = parseTimestamp(run.updated_at);
  const publishedAt = parseTimestamp(release.published_at);
  if (
    !Number.isFinite(runStart) ||
    !Number.isFinite(runEnd) ||
    !Number.isFinite(publishedAt) ||
    publishedAt < runStart - 5_000 ||
    publishedAt > runEnd + 120_000
  ) {
    return { eligible: false, reason: 'no_release_for_run' };
  }

  const tagCommitSha = await resolveTagCommitSha(tagName, fetchImpl, options.githubToken);
  if (tagCommitSha !== request.headSha) {
    return { eligible: false, reason: 'no_release_for_run' };
  }

  const version = `${Number(tagMatch[1])}.${Number(tagMatch[2])}.${Number(tagMatch[3])}`;
  const apkName = `SeenIt-v${version}.apk`;
  const shaName = `${apkName}.sha256`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const apkAssets = assets.filter((asset: any) => asset?.name === apkName);
  const shaAssets = assets.filter((asset: any) => asset?.name === shaName);
  if (apkAssets.length !== 1 || shaAssets.length !== 1) {
    throw new ReleaseNotificationSourceError(502, 'release_assets_missing', 'Paire APK/SHA-256 officielle manquante ou ambiguë');
  }

  const apkAsset = apkAssets[0];
  const shaAsset = shaAssets[0];
  validateOfficialAssetUrl(apkAsset.browser_download_url, tagName, apkName);
  const shaUrl = validateOfficialAssetUrl(shaAsset.browser_download_url, tagName, shaName);
  const apkSha256 = await fetchOfficialSha256(shaUrl, apkName, fetchImpl);

  const githubDigest = typeof apkAsset.digest === 'string' ? apkAsset.digest.trim().toLowerCase() : '';
  if (githubDigest && githubDigest !== `sha256:${apkSha256}`) {
    throw new ReleaseNotificationSourceError(502, 'release_digest_mismatch', 'Empreinte GitHub de l’APK incohérente');
  }

  return {
    eligible: true,
    repository: OFFICIAL_SEENIT_REPOSITORY,
    runId: request.runId,
    headSha: request.headSha,
    version,
    tagName,
    apkName,
    apkSha256
  };
}

export interface ReleaseNotificationDevice {
  uid: string;
  installationHash: string;
  token: string;
  platform: 'web' | 'android';
}

export type ReleaseDeliveryClaim = 'claimed' | 'already_sent' | 'busy' | 'exhausted';

export interface ReleaseNotificationStore {
  listDevices(): Promise<ReleaseNotificationDevice[]>;
  claim(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    now: number
  ): Promise<ReleaseDeliveryClaim>;
  markSent(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    now: number
  ): Promise<void>;
  markFailed(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    errorCode: string,
    now: number
  ): Promise<void>;
  markInvalid(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    errorCode: string,
    now: number
  ): Promise<void>;
}

export interface ReleasePushMessage {
  notification: { title: string; body: string };
  data: { type: typeof APP_UPDATE_AVAILABLE_PUSH_TYPE; version: string };
  android: {
    priority: 'high';
    collapseKey: string;
    notification: {
      icon: 'ic_stat_seenit';
      color: '#E5A93D';
      tag: string;
    };
  };
}

export interface ReleaseNotificationSender {
  send(device: ReleaseNotificationDevice, message: ReleasePushMessage): Promise<void>;
}

export interface ReleaseDeliverySummary {
  targeted: number;
  sent: number;
  alreadySent: number;
  busy: number;
  invalid: number;
  failed: number;
  exhausted: number;
}

export function buildReleaseUpdatePushMessage(version: string): ReleasePushMessage {
  const stableKey = version.replace(/\./g, '_');
  return {
    notification: {
      title: `SeenIt ${version} est disponible ✨`,
      body: 'Une nouvelle version de SeenIt est prête à installer.'
    },
    data: {
      type: APP_UPDATE_AVAILABLE_PUSH_TYPE,
      version
    },
    android: {
      priority: 'high',
      collapseKey: `seenit-update-${version}`,
      notification: {
        icon: 'ic_stat_seenit',
        color: '#E5A93D',
        tag: `seenit_update_${stableKey}`
      }
    }
  };
}

function isEligibleAndroidDevice(device: ReleaseNotificationDevice): boolean {
  return (
    device.platform === 'android' &&
    typeof device.uid === 'string' &&
    device.uid.length > 0 &&
    INSTALLATION_HASH_RE.test(device.installationHash) &&
    typeof device.token === 'string' &&
    device.token.trim().length > 20 &&
    device.token.trim().length <= 4096
  );
}

export function sanitizeMessagingErrorCode(error: unknown): string {
  const raw =
    typeof (error as any)?.code === 'string'
      ? (error as any).code
      : typeof (error as any)?.errorInfo?.code === 'string'
        ? (error as any).errorInfo.code
        : 'messaging/unknown';
  const clean = raw.replace(/[^a-zA-Z0-9_./-]/g, '').slice(0, 120);
  return clean || 'messaging/unknown';
}

export function isInvalidReleasePushTokenError(code: string): boolean {
  return code === 'messaging/registration-token-not-registered'
    || code === 'messaging/invalid-registration-token'
    || code === 'messaging/invalid-argument';
}

export async function deliverReleaseUpdatePush(
  release: VerifiedReleaseNotification,
  store: ReleaseNotificationStore,
  sender: ReleaseNotificationSender,
  now: () => number = Date.now
): Promise<ReleaseDeliverySummary> {
  const allDevices = await store.listDevices();
  const seenInstallations = new Set<string>();
  const devices = allDevices.filter(device => {
    if (!isEligibleAndroidDevice(device) || seenInstallations.has(device.installationHash)) return false;
    seenInstallations.add(device.installationHash);
    return true;
  });

  const summary: ReleaseDeliverySummary = {
    targeted: devices.length,
    sent: 0,
    alreadySent: 0,
    busy: 0,
    invalid: 0,
    failed: 0,
    exhausted: 0
  };
  const message = buildReleaseUpdatePushMessage(release.version);

  for (const device of devices) {
    const claim = await store.claim(release, device, now());
    if (claim === 'already_sent') {
      summary.alreadySent += 1;
      continue;
    }
    if (claim === 'busy') {
      summary.busy += 1;
      continue;
    }
    if (claim === 'exhausted') {
      summary.exhausted += 1;
      continue;
    }

    try {
      await sender.send(device, message);
      await store.markSent(release, device, now());
      summary.sent += 1;
    } catch (error) {
      const code = sanitizeMessagingErrorCode(error);
      if (isInvalidReleasePushTokenError(code)) {
        await store.markInvalid(release, device, code, now());
        summary.invalid += 1;
      } else {
        await store.markFailed(release, device, code, now());
        summary.failed += 1;
      }
    }
  }

  return summary;
}
