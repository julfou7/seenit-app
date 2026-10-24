export type WatchListTab = 'watch_next' | 'upcoming' | 'history';
export const HOME_TABS: ReadonlyArray<{ id: WatchListTab; label: string }> = [
  { id: 'watch_next', label: 'À regarder' }, { id: 'upcoming', label: 'À venir' }, { id: 'history', label: 'Historique' },
];
export const HOME_PAGE_SIZE = 6;
export const HISTORY_PAGE_SIZE = 10;
export function canOfferPlexWatchedAction(mediaType: 'movie' | 'tv', available: boolean, watched: boolean): boolean {
  // Le cache global Plex prouve l'identité d'un film, jamais la présence d'un épisode de série.
  return mediaType === 'movie' && available && !watched;
}
export function upcomingGroup(date: string, today: string): 'Aujourd’hui' | 'Cette semaine' | 'Plus tard' {
  const ordinal = (value: string) => { const [year, month, day] = value.split('-').map(Number); return Date.UTC(year, month - 1, day) / 86_400_000; };
  const days = ordinal(date) - ordinal(today);
  return days <= 0 ? 'Aujourd’hui' : days <= 7 ? 'Cette semaine' : 'Plus tard';
}
export type StatusTone = 'today' | 'new' | 'remaining' | 'available' | 'final' | 'stale';
export function seriesStatus(detail?: string): { label: string; tone: StatusTone } | null {
  if (!detail?.trim()) return null;
  const clean = detail.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim();
  if (/aujourd|ce soir/i.test(clean)) return { label: "🔥 Sorti aujourd’hui", tone: 'today' };
  if (/final de série|^final$/i.test(clean)) return { label: '🏁 Final', tone: 'final' };
  if (/fin de saison|final/i.test(clean)) return { label: '🎬 Fin de saison', tone: 'final' };
  const remaining = /plus que (\d+)/i.exec(clean);
  if (remaining) return { label: `⚡ Plus que ${remaining[1]}`, tone: 'remaining' };
  const available = /^(\d+) dispo/i.exec(clean);
  if (available) return { label: `🍿 ${available[1]} dispo`, tone: 'available' };
  if (/hier/i.test(clean)) return { label: '🌟 Sorti hier', tone: 'new' };
  if (/^\s*⏳/u.test(detail)) { const days = /il y a (\d+) jours?/i.exec(clean); if (days) return { label: `⏳ ${Math.max(1, Math.floor(Number(days[1]) / 7))} sem.`, tone: 'stale' }; }
  const age = /il y a (\d+) jours/i.exec(clean);
  if (age) return { label: `🆕 Il y a ${age[1]} j`, tone: 'new' };
  const stale = /pas vu depuis (\d+) jours/i.exec(clean);
  if (stale) return { label: `⏳ ${Math.max(1, Math.floor(Number(stale[1]) / 7))} sem.`, tone: 'stale' };
  if (/nouveau/i.test(clean)) return { label: '🆕 Nouveau', tone: 'new' };
  return null;
}
