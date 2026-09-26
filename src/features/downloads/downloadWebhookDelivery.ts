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
}: {
  uid: string;
  ownerUidHash: string;
  presentation: DownloadWebhookDeliveryPresentation;
  sendPush: DownloadPushSender;
}): Promise<{ delivered: number; invalidTokensRemoved: number }> {
  if (presentation.eventType !== 'Download' || !presentation.plexAvailabilityData) {
    const result = await sendPush(uid, presentation.notification, presentation.data);
    return { delivered: result.delivered, invalidTokensRemoved: result.invalid };
  }

  // Le webhook Arr prouve déjà l'import : ce reçu reste visible partout.
  // La vérification Plex silencieuse est additionnelle et ne le remplace jamais.
  const [importDelivery, plexCheckDelivery] = await Promise.all([
    sendPush(uid, presentation.notification, presentation.data),
    sendPush(uid, null, {
      ...presentation.plexAvailabilityData,
      ownerUidHash,
    }, {
      platform: 'android',
      androidHighPriority: true,
      plexAvailabilityBackground: 'required',
    }),
  ]);

  return {
    delivered: importDelivery.delivered + plexCheckDelivery.delivered,
    invalidTokensRemoved: importDelivery.invalid + plexCheckDelivery.invalid,
  };
}
