import { Bell, BellRing } from 'lucide-react';
import type { Show } from '../types';
import { cn } from '../lib/utils';
import { reminderEpisodeString, useEpisodeReminder, type ReminderEpisode } from '../features/notifications/episodeReminder';

/**
 * Cloche d'un épisode à venir (retour terrain du 08/11 : « absence de cloche pour s'abonner sur un épisode à
 * venir »). Visible seulement pour une série suivie : le rappel s'écrit sur sa fiche SeenIt.
 * - `icon` : lignes de la fiche série ;
 * - `overlay` : en-tête de la fiche épisode, ronde à côté de la croix (retour terrain du 09/11).
 * Retour terrain du 09/11 : « la cloche reste jaune » — l'or est la couleur du rappel ; c'est le mode
 * téléchargement qui est bleu.
 */
export function EpisodeReminderBell({ show, episode, variant = 'icon' }: { show: Show | null | undefined; episode: ReminderEpisode; variant?: 'icon' | 'overlay' }) {
  const { reminder, pending, toggle, available } = useEpisodeReminder(show, episode);
  if (!available) return null;
  const code = reminderEpisodeString(episode);
  const label = `${reminder ? 'Désactiver' : 'Activer'} le rappel pour ${code}`;
  const press = (event: React.MouseEvent) => { event.stopPropagation(); void toggle(); };
  const idle = variant === 'overlay'
    ? 'bg-[rgba(9,9,11,0.88)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
    : 'bg-[#18181b] text-zinc-400 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]';
  return <button type="button" data-episode-reminder={code} aria-pressed={reminder} aria-busy={pending || undefined} disabled={pending} onClick={press} aria-label={label}
    className={cn('w-11 h-11 shrink-0 rounded-full grid place-items-center active:scale-95', reminder ? 'bg-[#E5A93D] text-black' : idle)}>
    {reminder ? <BellRing size={variant === 'overlay' ? 18 : 19} aria-hidden="true" /> : <Bell size={variant === 'overlay' ? 18 : 19} aria-hidden="true" />}
  </button>;
}
