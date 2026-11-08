import { Bell, BellRing } from 'lucide-react';
import type { Show } from '../types';
import { cn } from '../lib/utils';
import { reminderEpisodeString, useEpisodeReminder, type ReminderEpisode } from '../features/notifications/episodeReminder';

/**
 * Cloche d'un épisode à venir (retour terrain du 08/11 : « absence de cloche pour s'abonner sur un épisode à
 * venir »). `icon` dans les lignes de la fiche série, `wide` dans la fiche épisode. Visible seulement pour une
 * série suivie : le rappel s'écrit sur sa fiche SeenIt.
 */
export function EpisodeReminderBell({ show, episode, variant = 'icon' }: { show: Show | null | undefined; episode: ReminderEpisode; variant?: 'icon' | 'wide' }) {
  const { reminder, pending, toggle, available } = useEpisodeReminder(show, episode);
  if (!available) return null;
  const code = reminderEpisodeString(episode);
  const label = `${reminder ? 'Désactiver' : 'Activer'} le rappel pour ${code}`;
  const press = (event: React.MouseEvent) => { event.stopPropagation(); void toggle(); };
  if (variant === 'wide') return <button type="button" data-episode-reminder={code} aria-pressed={reminder} aria-busy={pending || undefined} disabled={pending} onClick={press} aria-label={label}
    className={cn('min-h-[52px] rounded-2xl flex items-center justify-center gap-2 text-[14px] font-bold active:scale-[0.98]', reminder ? 'bg-[#1E1A12] text-[#F2C36B] shadow-[inset_0_0_0_1.5px_#E5A93D]' : 'bg-[#18181b] text-zinc-100 shadow-[inset_0_0_0_1px_#3f3f46]')}>
    {reminder ? <BellRing size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}{reminder ? 'Rappel activé · tu seras prévenu' : 'Me prévenir à la sortie'}
  </button>;
  return <button type="button" data-episode-reminder={code} aria-pressed={reminder} aria-busy={pending || undefined} disabled={pending} onClick={press} aria-label={label}
    className={cn('w-11 h-11 shrink-0 rounded-full grid place-items-center active:scale-95', reminder ? 'bg-[#E5A93D] text-black' : 'bg-[#18181b] text-zinc-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]')}>
    {reminder ? <BellRing size={19} aria-hidden="true" /> : <Bell size={19} aria-hidden="true" />}
  </button>;
}
