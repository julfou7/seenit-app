export interface DownloadFailureReceipt {
  ownerUid: string;
  requestId: string;
  failureCode: 'no_release';
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  season?: number;
  episode?: number;
}

export function normalizeDownloadFailureReceipt(input: unknown): DownloadFailureReceipt | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.failureCode !== 'no_release' || typeof value.ownerUid !== 'string' || !value.ownerUid || value.ownerUid.length > 128) return null;
  if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.requestId)) return null;
  if (value.mediaType !== 'movie' && value.mediaType !== 'tv') return null;
  if (typeof value.tmdbId !== 'number' || !Number.isSafeInteger(value.tmdbId) || value.tmdbId <= 0) return null;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 180) return null;
  for (const key of ['season', 'episode']) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || Number(value[key]) < (key === 'season' ? 0 : 1))) return null;
  }
  if (value.mediaType === 'movie' && (value.season !== undefined || value.episode !== undefined)) return null;
  if (value.episode !== undefined && value.season === undefined) return null;
  return {
    ownerUid: value.ownerUid, requestId: value.requestId, failureCode: 'no_release',
    mediaType: value.mediaType, tmdbId: value.tmdbId,
    title: value.title.trim().replace(/\s+/g, ' '),
    ...(value.season !== undefined ? { season: Number(value.season) } : {}),
    ...(value.episode !== undefined ? { episode: Number(value.episode) } : {})
  };
}

export function downloadFailurePresentation(receipt: DownloadFailureReceipt): {
  notification: { title: string; body: string };
  data: Record<string, string>;
} {
  const scope = receipt.mediaType === 'movie' ? '' : receipt.episode !== undefined
    ? ` · S${String(receipt.season).padStart(2, '0')} | E${String(receipt.episode).padStart(2, '0')}`
    : receipt.season !== undefined ? ` · Saison ${receipt.season}` : ' · Toute la série';
  const data: Record<string, string> = {
    type: 'NAVIGATE_SHOW', notificationKind: 'download_failure', mediaType: receipt.mediaType, tmdbId: String(receipt.tmdbId),
    subText: 'Téléchargement', requestId: receipt.requestId, tag: `no-release-${receipt.requestId}`,
    url: `/?tmdbId=${receipt.tmdbId}&mediaType=${receipt.mediaType}${receipt.season !== undefined ? `&season=${receipt.season}` : ''}${receipt.episode !== undefined ? `&episode=${receipt.episode}` : ''}`
  };
  if (receipt.season !== undefined) data.season = String(receipt.season);
  if (receipt.episode !== undefined) data.episode = String(receipt.episode);
  return { notification: { title: receipt.title, body: `${scope.replace(/^ · /, '')}${scope ? ' · ' : ''}Aucune release compatible trouvée.` }, data };
}

export interface DownloadFailureDeliveryStore {
  reserve(uid: string, requestId: string): Promise<boolean>;
  finish(uid: string, requestId: string, outcome: 'sent' | 'unknown'): Promise<void>;
}

export async function deliverDownloadFailureReceipt(options: {
  uid: string;
  input: unknown;
  store: DownloadFailureDeliveryStore;
  send: (uid: string, notification: { title: string; body: string }, data: Record<string, string>) => Promise<unknown>;
}): Promise<{ accepted: boolean; duplicate?: boolean }> {
  const receipt = normalizeDownloadFailureReceipt(options.input);
  if (!receipt || receipt.ownerUid !== options.uid) return { accepted: false };
  const reserved = await options.store.reserve(options.uid, receipt.requestId);
  if (!reserved) return { accepted: true, duplicate: true };
  let outcome: 'sent' | 'unknown' = 'unknown';
  try {
    const presentation = downloadFailurePresentation(receipt);
    await options.send(options.uid, presentation.notification, presentation.data);
    outcome = 'sent';
  } finally {
    // Même si FCM ou l'acquittement échoue, conserver la réservation empêche un doublon.
    await options.store.finish(options.uid, receipt.requestId, outcome);
  }
  return { accepted: true };
}

export function createDownloadFailureOutbox(ports: {
  read: () => unknown;
  write: (items: DownloadFailureReceipt[]) => void;
  currentUid: () => string | null;
  send: (item: DownloadFailureReceipt) => Promise<boolean>;
}) {
  let inFlight: Promise<void> | null = null;
  function read(): DownloadFailureReceipt[] {
    const items = ports.read();
    return Array.isArray(items) ? items.map(normalizeDownloadFailureReceipt).filter((item): item is DownloadFailureReceipt => item !== null).slice(-50) : [];
  }
  return {
    enqueue(item: DownloadFailureReceipt): void {
      const normalized = normalizeDownloadFailureReceipt(item);
      if (!normalized || ports.currentUid() !== normalized.ownerUid) return;
      const items = read().filter(entry => entry.ownerUid !== item.ownerUid || entry.requestId !== item.requestId);
      ports.write([...items, normalized].slice(-50));
    },
    flush(): Promise<void> {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        const uid = ports.currentUid();
        if (!uid) return;
        for (const item of read().filter(entry => entry.ownerUid === uid)) {
          if (ports.currentUid() !== uid) break;
          try {
            if (!await ports.send(item)) continue;
            ports.write(read().filter(entry => entry.ownerUid !== uid || entry.requestId !== item.requestId));
          } catch { /* Le reçu reste disponible pour la prochaine reprise réseau/session. */ }
        }
      })().finally(() => { inFlight = null; });
      return inFlight;
    }
  };
}
