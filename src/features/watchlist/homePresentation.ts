export type WatchListTab = 'watch_next' | 'upcoming' | 'history';
export const HOME_TABS: ReadonlyArray<{ id: WatchListTab; label: string }> = [
  { id: 'watch_next', label: 'À regarder' }, { id: 'upcoming', label: 'À venir' }, { id: 'history', label: 'Historique' },
];
export const HOME_PAGE_SIZE = 3;
export const HISTORY_PAGE_SIZE = 10;
export function upcomingGroup(date: string, today: string): 'Aujourd’hui' | 'Cette semaine' | 'Plus tard' {
  const ordinal = (value: string) => { const [year, month, day] = value.split('-').map(Number); return Date.UTC(year, month - 1, day) / 86_400_000; };
  const days = ordinal(date) - ordinal(today);
  return days <= 0 ? 'Aujourd’hui' : days < 7 ? 'Cette semaine' : 'Plus tard';
}
export type StatusTone = 'today' | 'new' | 'remaining' | 'available' | 'final' | 'stale';
export function seriesStatus(detail?: string): { label: string; tone: StatusTone } | null {
  if (!detail?.trim()) return null;
  const clean = detail.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim();
  if (/aujourd|ce soir/i.test(clean)) return { label: 'Aujourd’hui', tone: 'today' };
  if (/hier|il y a \d+ jours|nouve|sorti/i.test(clean)) return { label: 'Nouveau', tone: 'new' };
  if (/final|fin de saison/i.test(clean)) return { label: clean, tone: 'final' };
  if (/pas vu|délaissé/i.test(clean)) return { label: 'Délaissé', tone: 'stale' };
  if (/plus que/i.test(clean)) return { label: clean, tone: 'remaining' };
  if (/dispo/i.test(clean)) return { label: 'Dispo', tone: 'available' };
  return null;
}
