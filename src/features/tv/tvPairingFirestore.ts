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
export async function readTvLibrary(db: Firestore, uid: string) {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(uid)) throw new Error('Invalid TV owner');
  const snapshot = await db.collection(`users/${uid}/shows`).orderBy('updatedAt', 'desc').limit(60)
    .select('tmdbId', 'title', 'mediaType', 'status', 'isArchived', 'posterPath', 'backdropPath', 'nextEpisodeToWatch', 'updatedAt').get();
  return snapshot.docs.map(doc => {
    const item = doc.data();
    const next = item.nextEpisodeToWatch;
    const image = (value: unknown) => typeof value === 'string' && /^\/[a-zA-Z0-9._/-]+$/.test(value) && !value.includes('..') ? value : null;
    return {
      tmdbId: Number(item.tmdbId), title: typeof item.title === 'string' ? item.title.slice(0, 180) : '',
      mediaType: item.mediaType === 'movie' ? 'movie' : 'tv', status: item.status,
      isArchived: item.isArchived === true, posterPath: image(item.posterPath), backdropPath: image(item.backdropPath),
      nextEpisode: next && typeof next === 'object' ? { season: Number(next.season_number) || 1, episode: Number(next.episode_number) || 1,
        name: typeof next.name === 'string' ? next.name.slice(0, 180) : '' } : null,
    };
  }).filter(item => item.tmdbId > 0 && item.title && !item.isArchived && ['watching', 'plan_to_watch'].includes(item.status)).slice(0, 18);
}
