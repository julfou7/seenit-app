import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase';
import { useShowsStore } from '../../store/showsStore';
import { buildSeasonProgressEvidence } from './seasonProgressEvidence';
import type { Show } from '../../types';

interface SeasonPayload { season_number: number; episode_count?: number; episodes?: Array<{ episode_number: number; air_date?: string | null; episode_type?: string | null }> }
interface DetailsPayload { seasons?: SeasonPayload[]; status?: string }
const pending = new Set<string>();

/** Same supplier proof for the detail and every tracked card, without a render query. */
export function convergeTrackedSeasonProgress(tmdbId: number, details: DetailsPayload, season: SeasonPayload): void {
  const uid = auth.currentUser?.uid;
  if (!uid || !Number.isInteger(season.season_number) || season.season_number < 1) return;
  // Legacy documents omit userId; the library store itself is already UID scoped.
  const show = useShowsStore.getState().shows.find(item => (!item.userId || item.userId === uid) && item.mediaType === 'tv' && Number(item.tmdbId) === tmdbId);
  if (!show) return;
  const seasonSummary = details.seasons?.find(item => item.season_number === season.season_number);
  const seasons = (details.seasons || []).map(item => item.season_number === season.season_number ? { ...season, episode_count: seasonSummary?.episode_count } : item);
  if (!seasonSummary) return; // A list alone does not assert a season total.
  const next = buildSeasonProgressEvidence(seasons, details.status === 'Ended' || details.status === 'Canceled')[String(season.season_number)];
  const previous = show.seasonProgress?.[String(season.season_number)];
  const { total_checked_at: _oldTime, ...oldProof } = previous || {};
  const { total_checked_at: _newTime, ...newProof } = next;
  if (JSON.stringify(oldProof) === JSON.stringify(newProof)) return;
  const patch: Partial<Show> = { seasonProgress: { ...show.seasonProgress, [String(season.season_number)]: next } };
  for (const key of ['nextEpisodeToWatch', 'nextEpisodeToAir'] as const) {
    if (show[key]?.season_number === season.season_number) patch[key] = { ...show[key], ...next };
  }
  useShowsStore.getState().updateShowOptimistic(show.id, patch);
  const writeKey = `${uid}:${show.id}:${season.season_number}`;
  if (pending.has(writeKey)) return;
  pending.add(writeKey);
  // Field path preserves concurrent proofs for other seasons. Never rewrite watched state.
  void updateDoc(doc(db, 'users', uid, 'shows', show.id), { [`seasonProgress.${season.season_number}`]: next })
    .catch(() => { /* Local public evidence stays usable; the next sync retries persistence. */ })
    .finally(() => pending.delete(writeKey));
}
