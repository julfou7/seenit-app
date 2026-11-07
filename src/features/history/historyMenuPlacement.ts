import { historyLocalDayKey } from './historyPresentation.ts';

/** Jour local « il y a N jours », par le calendrier (pas −24 h) : juste aussi aux changements d'heure. */
export const localDayKey = (daysAgo: number, now = new Date()) => historyLocalDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12).getTime());
/** Place le menu sous la ligne, sinon au-dessus, sinon borné à l'écran (avec défilement) : jamais coupé. */
export function placeAnchoredMenu(row: { top: number; bottom: number }, menuHeight: number, viewportHeight: number, gap = 8): { top: number; maxHeight: number } {
  const room = viewportHeight - gap * 2;
  if (row.bottom + gap + menuHeight <= viewportHeight - gap) return { top: row.bottom + gap, maxHeight: room };
  if (row.top - gap - menuHeight >= gap) return { top: row.top - gap - menuHeight, maxHeight: room };
  const height = Math.min(menuHeight, room);
  return { top: Math.max(gap, Math.min(viewportHeight - gap - height, row.bottom + gap)), maxHeight: room };
}
export const shiftTime = (time: string, minutes: number) => {
  const [hours, mins] = (time || '20:00').split(':').map(Number);
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
