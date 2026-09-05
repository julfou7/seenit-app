import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliverReleaseUpdatePush,
  ReleaseNotificationSourceError,
  verifyOfficialReleaseNotification,
  type ReleaseDeliveryClaim,
  type ReleaseNotificationDevice,
  type ReleaseNotificationSender,
  type ReleaseNotificationStore,
  type ReleasePushMessage,
  type VerifiedReleaseNotification
} from '../src/features/release/releaseUpdatePushCore';

const HEAD_SHA = 'a'.repeat(40);
const RUN_ID = 123456;
const VERSION = '1.4.115';
const APK_NAME = `SeenIt-v${VERSION}.apk`;
const SHA_NAME = `${APK_NAME}.sha256`;
const APK_SHA = 'b'.repeat(64);
const TAG = `v${VERSION}`;
const RELEASE_BASE = `https://github.com/julfou7/seenit-app/releases/download/${TAG}`;

function makeGithubFetch(overrides: {
  run?: Record<string, unknown>;
  release?: Record<string, unknown>;
} = {}) {
  const run = {
    repository: { full_name: 'julfou7/seenit-app' },
    path: '.github/workflows/build-apk.yml',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: HEAD_SHA,
    status: 'completed',
    conclusion: 'success',
    run_started_at: '2026-09-05T10:00:00Z',
    updated_at: '2026-09-05T10:08:00Z',
    ...(overrides.run || {})
  };
  const release = {
    tag_name: TAG,
    draft: false,
    prerelease: false,
    published_at: '2026-09-05T10:07:30Z',
    assets: [
      {
        name: APK_NAME,
        browser_download_url: `${RELEASE_BASE}/${APK_NAME}`,
        digest: `sha256:${APK_SHA}`
      },
      {
        name: SHA_NAME,
        browser_download_url: `${RELEASE_BASE}/${SHA_NAME}`
      }
    ],
    ...(overrides.release || {})
  };

  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.endsWith(`/actions/runs/${RUN_ID}`)) {
      return Response.json(run);
    }
    if (url.endsWith('/releases/latest')) {
      return Response.json(release);
    }
    if (url.endsWith(`/git/ref/tags/${TAG}`)) {
      return Response.json({ object: { type: 'commit', sha: HEAD_SHA } });
    }
    if (url === `${RELEASE_BASE}/${SHA_NAME}`) {
      return new Response(`${APK_SHA}  ${APK_NAME}\n`, {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      });
    }
    return new Response('not found', { status: 404 });
  };
}

const verifiedRelease: VerifiedReleaseNotification = {
  eligible: true,
  repository: 'julfou7/seenit-app',
  runId: RUN_ID,
  headSha: HEAD_SHA,
  version: VERSION,
  tagName: TAG,
  apkName: APK_NAME,
  apkSha256: APK_SHA
};

interface DeliveryState {
  status: 'sending' | 'sent' | 'failed' | 'invalid';
  leaseUntil: number;
  attempts: number;
}

class MemoryStore implements ReleaseNotificationStore {
  states = new Map<string, DeliveryState>();
  removed = new Set<string>();

  constructor(public devices: ReleaseNotificationDevice[]) {}

  key(release: VerifiedReleaseNotification, device: ReleaseNotificationDevice): string {
    return `${release.version}:${device.installationHash}`;
  }

  async listDevices(): Promise<ReleaseNotificationDevice[]> {
    return this.devices.filter(device => !this.removed.has(device.installationHash));
  }

  async claim(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    now: number
  ): Promise<ReleaseDeliveryClaim> {
    const key = this.key(release, device);
    const state = this.states.get(key);
    if (state?.status === 'sent' || state?.status === 'invalid') return 'already_sent';
    if (state?.status === 'sending' && state.leaseUntil > now) return 'busy';
    if ((state?.attempts || 0) >= 3) return 'exhausted';
    this.states.set(key, {
      status: 'sending',
      leaseUntil: now + 120_000,
      attempts: (state?.attempts || 0) + 1
    });
    return 'claimed';
  }

  async markSent(release: VerifiedReleaseNotification, device: ReleaseNotificationDevice): Promise<void> {
    const key = this.key(release, device);
    const state = this.states.get(key)!;
    this.states.set(key, { ...state, status: 'sent', leaseUntil: 0 });
  }

  async markFailed(release: VerifiedReleaseNotification, device: ReleaseNotificationDevice): Promise<void> {
    const key = this.key(release, device);
    const state = this.states.get(key)!;
    this.states.set(key, { ...state, status: 'failed', leaseUntil: 0 });
  }

  async markInvalid(release: VerifiedReleaseNotification, device: ReleaseNotificationDevice): Promise<void> {
    const key = this.key(release, device);
    const state = this.states.get(key)!;
    this.states.set(key, { ...state, status: 'invalid', leaseUntil: 0 });
    this.removed.add(device.installationHash);
  }
}

function device(char: string, platform: 'android' | 'web' = 'android'): ReleaseNotificationDevice {
  return {
    uid: `uid-${char}`,
    installationHash: char.repeat(64),
    token: `token-${char}-${'x'.repeat(30)}`,
    platform
  };
}

test('SEENIT-UPDATE-003 valide la release officielle avant toute diffusion Android', async () => {
  const verification = await verifyOfficialReleaseNotification(
    { repository: 'julfou7/seenit-app', runId: RUN_ID, headSha: HEAD_SHA },
    { fetchImpl: makeGithubFetch() }
  );
  assert.equal(verification.eligible, true);
  if (verification.eligible) {
    assert.equal(verification.version, VERSION);
    assert.equal(verification.apkSha256, APK_SHA);
  }

  await assert.rejects(
    verifyOfficialReleaseNotification(
      { repository: 'evil/fork', runId: RUN_ID, headSha: HEAD_SHA },
      { fetchImpl: makeGithubFetch() }
    ),
    (error: unknown) => error instanceof ReleaseNotificationSourceError && error.code === 'untrusted_repository'
  );

  await assert.rejects(
    verifyOfficialReleaseNotification(
      { repository: 'julfou7/seenit-app', runId: RUN_ID, headSha: 'c'.repeat(40) },
      { fetchImpl: makeGithubFetch() }
    ),
    (error: unknown) => error instanceof ReleaseNotificationSourceError && error.code === 'untrusted_workflow_run'
  );
});

test('SEENIT-UPDATE-003 rend la diffusion Android idempotente face aux replays et à la concurrence', async () => {
  const android = device('a');
  const web = device('b', 'web');
  const store = new MemoryStore([android, web]);
  let sends = 0;
  const sender: ReleaseNotificationSender = {
    async send(_device: ReleaseNotificationDevice, message: ReleasePushMessage) {
      sends += 1;
      assert.equal(message.data.type, 'APP_UPDATE_AVAILABLE');
      assert.equal(message.data.version, VERSION);
      assert.equal('url' in message.data, false);
    }
  };

  const first = await deliverReleaseUpdatePush(verifiedRelease, store, sender, () => 1000);
  assert.deepEqual(first, {
    targeted: 1,
    sent: 1,
    alreadySent: 0,
    busy: 0,
    invalid: 0,
    failed: 0,
    exhausted: 0
  });
  const replay = await deliverReleaseUpdatePush(verifiedRelease, store, sender, () => 2000);
  assert.equal(replay.sent, 0);
  assert.equal(replay.alreadySent, 1);
  assert.equal(sends, 1);

  const concurrentDevice = device('c');
  const concurrentStore = new MemoryStore([concurrentDevice]);
  let unblock: (() => void) | undefined;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  let started: (() => void) | undefined;
  const sendStarted = new Promise<void>(resolve => { started = resolve; });
  const blockedSender: ReleaseNotificationSender = {
    async send() {
      started?.();
      await blocked;
    }
  };
  const inFlight = deliverReleaseUpdatePush(verifiedRelease, concurrentStore, blockedSender, () => 3000);
  await sendStarted;
  const concurrent = await deliverReleaseUpdatePush(verifiedRelease, concurrentStore, blockedSender, () => 3001);
  assert.equal(concurrent.busy, 1);
  assert.equal(concurrent.sent, 0);
  unblock?.();
  const completed = await inFlight;
  assert.equal(completed.sent, 1);
});

test('SEENIT-UPDATE-003 reprend seulement les échecs FCM explicites et supprime les tokens invalides', async () => {
  const ok = device('d');
  const transient = device('e');
  const invalid = device('f');
  const store = new MemoryStore([ok, transient, invalid]);
  const sends = new Map<string, number>();
  const sender: ReleaseNotificationSender = {
    async send(candidate) {
      const count = (sends.get(candidate.installationHash) || 0) + 1;
      sends.set(candidate.installationHash, count);
      if (candidate.installationHash === transient.installationHash && count === 1) {
        throw Object.assign(new Error('temporary'), { code: 'messaging/server-unavailable' });
      }
      if (candidate.installationHash === invalid.installationHash) {
        throw Object.assign(new Error('invalid'), { code: 'messaging/registration-token-not-registered' });
      }
    }
  };

  const first = await deliverReleaseUpdatePush(verifiedRelease, store, sender, () => 4000);
  assert.equal(first.sent, 1);
  assert.equal(first.failed, 1);
  assert.equal(first.invalid, 1);
  assert.equal(store.removed.has(invalid.installationHash), true);

  const retry = await deliverReleaseUpdatePush(verifiedRelease, store, sender, () => 5000);
  assert.equal(retry.sent, 1);
  assert.equal(sends.get(ok.installationHash), 1);
  assert.equal(sends.get(transient.installationHash), 2);
  assert.equal(sends.get(invalid.installationHash), 1);
});
