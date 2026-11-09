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

/** Même reçu avec le titre SeenIt (fiche TMDB fr-FR) dans la notification, ses données et le reçu natif. */
export function localizeDownloadPresentation(presentation: DownloadWebhookDeliveryPresentation, title?: string): DownloadWebhookDeliveryPresentation {
  const clean = title?.trim();
  if (!clean) return presentation;
  return {
    ...presentation,
    notification: { ...presentation.notification, title: clean },
    data: presentation.data.title !== undefined ? { ...presentation.data, title: clean } : presentation.data,
    plexAvailabilityData: presentation.plexAvailabilityData ? { ...presentation.plexAvailabilityData, title: clean } : null,
  };
}

export async function deliverDownloadWebhookPresentation({
  uid,
  ownerUidHash,
  presentation: input,
  sendPush,
  traceId,
  resolvePoster,
  resolveMedia,
}: {
  uid: string;
  ownerUidHash: string;
  presentation: DownloadWebhookDeliveryPresentation;
  sendPush: DownloadPushSender;
  traceId?: string;
  resolvePoster?: (tmdbId: number, mediaType: string) => Promise<string | undefined>;
  /** Affiche et titre de la fiche TMDB fr-FR (SEENIT-DOWNLOAD-022) ; prime sur `resolvePoster`. */
  resolveMedia?: (tmdbId: number, mediaType: string) => Promise<{ posterUrl?: string; title?: string } | undefined>;
}): Promise<{
  delivered: number;
  invalidTokensRemoved: number;
  plexCheckAttempted: number;
  plexCheckDelivered: number;
  plexCheckFailed: number;
}> {
  if (input.eventType !== 'Download' && input.eventType !== 'Grab') {
    return { delivered: 0, invalidTokensRemoved: 0, plexCheckAttempted: 0, plexCheckDelivered: 0, plexCheckFailed: 0 };
  }
  // SEENIT-DOWNLOAD-022 (retour terrain du 09/11 : « titre de la notif Plex en anglais également ») : le titre de
  // Sonarr/Radarr est remplacé par celui de la fiche TMDB fr-FR, rattachée par l'identifiant TMDB exact du webhook.
  // Fiche indisponible : le titre de Sonarr/Radarr reste ; la livraison n'attend jamais plus que la lecture bornée.
  const tmdbId = Number(input.data.tmdbId);
  const mediaType = input.data.mediaType;
  let media: { posterUrl?: string; title?: string } | undefined;
  if (tmdbId > 0 && (mediaType === 'movie' || mediaType === 'tv')) {
    try {
      media = resolveMedia ? await resolveMedia(tmdbId, mediaType)
        : input.eventType === 'Download' && input.plexAvailabilityData && resolvePoster ? { posterUrl: await resolvePoster(tmdbId, mediaType) } : undefined;
    } catch { /* L'image et le titre ne conditionnent jamais la livraison. */ }
  }
  const presentation = localizeDownloadPresentation(input, media?.title);
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
  const posterUrl = media?.posterUrl;
  const [plexCheckDelivery, androidLegacyDelivery, webDelivery] = await Promise.all([
    sendPush(uid, null, {
      ...presentation.plexAvailabilityData,
      ownerUidHash,
      ...(posterUrl ? { posterUrl } : {}),
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
