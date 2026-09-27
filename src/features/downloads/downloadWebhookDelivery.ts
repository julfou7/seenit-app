export interface DownloadWebhookDeliveryPresentation {
  eventType: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
  plexAvailabilityData: Record<string, string> | null;
}

export interface DownloadPushOptions {
  platform?: 'android' | 'web';
  androidHighPriority?: boolean;
  plexAvailabilityBackground?: 'required' | 'legacy';
}

export interface DownloadPushResult {
  attempted: number;
  delivered: number;
  invalid: number;
}

export type DownloadPushSender = (
  uid: string,
  notification: { title: string; body: string } | null,
  data?: Record<string, string>,
  options?: DownloadPushOptions
) => Promise<DownloadPushResult>;

export async function deliverDownloadWebhookPresentation({
  uid,
  ownerUidHash,
  presentation,
  sendPush,
  traceId,
}: {
  uid: string;
  ownerUidHash: string;
  presentation: DownloadWebhookDeliveryPresentation;
  sendPush: DownloadPushSender;
  traceId?: string;
}): Promise<{
  delivered: number;
  invalidTokensRemoved: number;
  plexCheckAttempted: number;
  plexCheckDelivered: number;
  plexCheckFailed: number;
}> {
  if (presentation.eventType !== 'Download' || !presentation.plexAvailabilityData) {
    const result = await sendPush(uid, presentation.notification, presentation.data);
    return {
      delivered: result.delivered,
      invalidTokensRemoved: result.invalid,
      plexCheckAttempted: 0,
      plexCheckDelivered: 0,
      plexCheckFailed: 0,
    };
  }

  // Sur Android capable, un seul signal data-only haute priorité affiche immédiatement
  // le reçu d'import local puis met à jour cette même notification après preuve Plex.
  // Les APK legacy et la PWA conservent le reçu FCM visible classique.
  const [plexCheckDelivery, androidLegacyDelivery, webDelivery] = await Promise.all([
    sendPush(uid, null, {
      ...presentation.plexAvailabilityData,
      ownerUidHash,
      ...(traceId ? { traceId } : {}),
    }, {
      platform: 'android',
      androidHighPriority: true,
      plexAvailabilityBackground: 'required',
    }),
    sendPush(uid, presentation.notification, presentation.data, {
      platform: 'android',
      plexAvailabilityBackground: 'legacy',
    }),
    sendPush(uid, presentation.notification, presentation.data, {
      platform: 'web',
    }),
  ]);

  return {
    delivered: plexCheckDelivery.delivered + androidLegacyDelivery.delivered + webDelivery.delivered,
    invalidTokensRemoved: plexCheckDelivery.invalid + androidLegacyDelivery.invalid + webDelivery.invalid,
    plexCheckAttempted: plexCheckDelivery.attempted,
    plexCheckDelivered: plexCheckDelivery.delivered,
    plexCheckFailed: Math.max(0, plexCheckDelivery.attempted - plexCheckDelivery.delivered),
  };
}
