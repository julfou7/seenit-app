import { createHash } from 'node:crypto';
import { adminDb } from '../../lib/firebase-admin';
import { deliverDownloadFailureReceipt } from './downloadFailureNotification';

function deliveryRef(uid: string, requestId: string) {
  const key = createHash('sha256').update(JSON.stringify([uid, requestId])).digest('hex');
  // Collection serveur : les règles par défaut interdisent tout accès client.
  return adminDb.doc(`downloadFailureNotificationDeliveries/${key}`);
}

export function processDownloadFailureNotification(uid: string, input: unknown, send: Parameters<typeof deliverDownloadFailureReceipt>[0]['send']) {
  return deliverDownloadFailureReceipt({
    uid, input, send,
    store: {
      reserve: (ownerUid, requestId) => adminDb.runTransaction(async transaction => {
        const ref = deliveryRef(ownerUid, requestId);
        if ((await transaction.get(ref)).exists) return false;
        transaction.create(ref, { status: 'reserved', createdAt: new Date() });
        return true;
      }),
      finish: async (ownerUid, requestId, outcome) => {
        await deliveryRef(ownerUid, requestId).update({ status: outcome, updatedAt: new Date() });
      }
    }
  });
}
