import type { Firestore } from 'firebase-admin/firestore';
import type { TvLink, TvLinkStore } from './tvPairing.ts';

function readLink(value: unknown): TvLink | null {
  if (!value || typeof value !== 'object') return null;
  const link = value as Partial<TvLink>;
  if (link.version !== 1 || !['pending', 'active', 'revoked'].includes(String(link.state))
    || typeof link.secretHash !== 'string' || typeof link.codeHash !== 'string'
    || typeof link.profile !== 'string' || typeof link.deviceName !== 'string'
    || !Number.isFinite(link.createdAt) || !Number.isFinite(link.expiresAt)) return null;
  if (link.state === 'active' && (typeof link.ownerUid !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(link.ownerUid))) return null;
  return link as TvLink;
}
export function createFirestoreTvLinkStore(db: Firestore): TvLinkStore {
  return {
    async create(id, link) { await db.doc(`tvDeviceLinks/${id}`).create(link); },
    async read(id) { return readLink((await db.doc(`tvDeviceLinks/${id}`).get()).data()); },
    async mutate(id, change) {
      const ref = db.doc(`tvDeviceLinks/${id}`);
      return db.runTransaction(async transaction => {
        const result = change(readLink((await transaction.get(ref)).data()));
        transaction.set(ref, result.next);
        return result.result;
      });
    },
  };
}
export function normalizeTvImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024 || value.includes('..') || /%2e|[\\\x00-\x20]/i.test(value)) return null;
  let path = value;
  if (value.startsWith('https://')) {
    try {
      const url = new URL(value);
      if (url.origin !== 'https://image.tmdb.org' || url.username || url.password || url.search || url.hash) return null;
      const match = /^\/t\/p\/(?:w\d+|original)(\/[^?]+)$/.exec(url.pathname);
      if (!match) return null;
      path = match[1];
    } catch { return null; }
  }
  return /^\/[a-zA-Z0-9._/-]+$/.test(path) && !path.includes('..') && !path.startsWith('//') ? path : null;
}
export async function readTvLibrary(db: Firestore, uid: string) {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(uid)) throw new Error('Invalid TV owner');
  const snapshot = await db.collection(`users/${uid}/shows`).orderBy('updatedAt', 'desc').limit(60)
    .select('tmdbId', 'title', 'mediaType', 'status', 'isArchived', 'posterPath', 'backdropPath', 'nextEpisodeToWatch', 'updatedAt').get();
  return snapshot.docs.map(doc => {
    const item = doc.data();
    const next = item.nextEpisodeToWatch;
    return {
      tmdbId: Number(item.tmdbId), title: typeof item.title === 'string' ? item.title.slice(0, 180) : '',
      mediaType: item.mediaType === 'movie' ? 'movie' : 'tv', status: item.status,
      isArchived: item.isArchived === true, posterPath: normalizeTvImage(item.posterPath), backdropPath: normalizeTvImage(item.backdropPath),
      nextEpisode: next && typeof next === 'object' ? { season: Number(next.season_number) || 1, episode: Number(next.episode_number) || 1,
        name: typeof next.name === 'string' ? next.name.slice(0, 180) : '' } : null,
    };
  }).filter(item => item.tmdbId > 0 && item.title && !item.isArchived && ['watching', 'plan_to_watch'].includes(item.status)).slice(0, 18);
}
