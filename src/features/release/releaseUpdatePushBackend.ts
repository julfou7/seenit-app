import { adminDb, adminMessaging } from '../../lib/firebase-admin';
import {
  RELEASE_PUSH_LEASE_MS,
  RELEASE_PUSH_MAX_ATTEMPTS,
  ReleaseNotificationSourceError,
  deliverReleaseUpdatePush,
  type ReleaseDeliveryClaim,
  type ReleaseNotificationDevice,
  type ReleaseNotificationSender,
  type ReleaseNotificationStore,
  type ReleasePushMessage,
  type VerifiedReleaseNotification,
  verifyOfficialReleaseNotification,
  type FetchLike
} from './releaseUpdatePushCore';

function deliveryDocumentId(version: string, installationHash: string): string {
  return `v${version}__${installationHash}`;
}

function readMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (value && typeof (value as any).toMillis === 'function') return (value as any).toMillis();
  return 0;
}

class FirestoreReleaseNotificationStore implements ReleaseNotificationStore {
  async listDevices(): Promise<ReleaseNotificationDevice[]> {
    const bindings = await adminDb.collection('notificationInstallations').get();
    const resolved = await Promise.all(bindings.docs.map(async binding => {
      const uid = String(binding.get('uid') || '').trim();
      const installationHash = binding.id;
      if (!uid || !/^[0-9a-f]{64}$/i.test(installationHash)) return null;
      const device = await adminDb.doc(`users/${uid}/devices/${installationHash}`).get();
      if (!device.exists) return null;
      return {
        uid,
        installationHash,
        token: String(device.get('fcmToken') || '').trim(),
        platform: device.get('platform') === 'android' ? 'android' as const : 'web' as const
      };
    }));
    return resolved.filter((device): device is ReleaseNotificationDevice => Boolean(device));
  }

  async claim(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    now: number
  ): Promise<ReleaseDeliveryClaim> {
    const ref = adminDb.doc(`releaseNotificationDeliveries/${deliveryDocumentId(release.version, device.installationHash)}`);
    return adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data() || {};
      if (data.status === 'sent' || data.status === 'invalid') return 'already_sent';
      if (data.status === 'sending' && readMillis(data.leaseUntil) > now) return 'busy';

      const attempts = Number(data.attempts || 0);
      if (attempts >= RELEASE_PUSH_MAX_ATTEMPTS) return 'exhausted';

      transaction.set(ref, {
        version: release.version,
        tagName: release.tagName,
        runId: release.runId,
        headSha: release.headSha,
        apkSha256: release.apkSha256,
        ownerUid: device.uid,
        installationHash: device.installationHash,
        status: 'sending',
        attempts: attempts + 1,
        leaseUntil: new Date(now + RELEASE_PUSH_LEASE_MS),
        updatedAt: new Date(now)
      }, { merge: true });
      return 'claimed';
    });
  }

  async markSent(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    now: number
  ): Promise<void> {
    await adminDb.doc(`releaseNotificationDeliveries/${deliveryDocumentId(release.version, device.installationHash)}`).set({
      status: 'sent',
      sentAt: new Date(now),
      leaseUntil: null,
      lastErrorCode: null,
      updatedAt: new Date(now)
    }, { merge: true });
  }

  async markFailed(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    errorCode: string,
    now: number
  ): Promise<void> {
    await adminDb.doc(`releaseNotificationDeliveries/${deliveryDocumentId(release.version, device.installationHash)}`).set({
      status: 'failed',
      leaseUntil: null,
      lastErrorCode: errorCode,
      updatedAt: new Date(now)
    }, { merge: true });
  }

  async markInvalid(
    release: VerifiedReleaseNotification,
    device: ReleaseNotificationDevice,
    errorCode: string,
    now: number
  ): Promise<void> {
    const deliveryRef = adminDb.doc(`releaseNotificationDeliveries/${deliveryDocumentId(release.version, device.installationHash)}`);
    const bindingRef = adminDb.doc(`notificationInstallations/${device.installationHash}`);
    const deviceRef = adminDb.doc(`users/${device.uid}/devices/${device.installationHash}`);
    await adminDb.runTransaction(async transaction => {
      const binding = await transaction.get(bindingRef);
      if (String(binding.get('uid') || '') === device.uid) transaction.delete(bindingRef);
      transaction.delete(deviceRef);
      transaction.set(deliveryRef, {
        status: 'invalid',
        invalidatedAt: new Date(now),
        leaseUntil: null,
        lastErrorCode: errorCode,
        updatedAt: new Date(now)
      }, { merge: true });
    });
  }
}

class FirebaseReleaseNotificationSender implements ReleaseNotificationSender {
  async send(device: ReleaseNotificationDevice, message: ReleasePushMessage): Promise<void> {
    await adminMessaging.send({
      token: device.token,
      notification: message.notification,
      data: message.data,
      android: message.android
    });
  }
}

export interface ReleaseUpdateNotificationHttpResult {
  status: number;
  body?: Record<string, unknown>;
}

export async function processReleaseUpdateNotificationRequest(
  body: unknown,
  options: { fetchImpl?: FetchLike; githubToken?: string } = {}
): Promise<ReleaseUpdateNotificationHttpResult> {
  try {
    const verification = await verifyOfficialReleaseNotification(body, {
      fetchImpl: options.fetchImpl,
      githubToken: options.githubToken
    });
    if (!verification.eligible) {
      return { status: 204 };
    }

    const summary = await deliverReleaseUpdatePush(
      verification,
      new FirestoreReleaseNotificationStore(),
      new FirebaseReleaseNotificationSender()
    );

    const hasRetryableFailure = summary.failed > 0 || summary.exhausted > 0;
    return {
      status: hasRetryableFailure ? 503 : (summary.busy > 0 && summary.sent === 0 ? 202 : 200),
      body: {
        success: !hasRetryableFailure,
        version: verification.version,
        targeted: summary.targeted,
        sent: summary.sent,
        alreadySent: summary.alreadySent,
        busy: summary.busy,
        invalid: summary.invalid,
        failed: summary.failed,
        exhausted: summary.exhausted
      }
    };
  } catch (error) {
    if (error instanceof ReleaseNotificationSourceError) {
      return {
        status: error.status,
        body: { success: false, error: error.code }
      };
    }
    return {
      status: 503,
      body: { success: false, error: 'release_notification_backend_unavailable' }
    };
  }
}
