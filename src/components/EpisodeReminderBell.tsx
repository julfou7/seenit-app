import { Bell, BellRing } from 'lucide-react';
import type { Show } from '../types';
import { cn } from '../lib/utils';
import { reminderEpisodeString, useEpisodeReminder, type ReminderEpisode } from '../features/notifications/episodeReminder';
import { SeenItBellRing } from './SeenItLogo';

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
  // Décision du 09/11 (#910) : la cloche agit sur toute la série, son nom accessible le dit.
  const label = `${reminder ? 'Couper' : 'Activer'} les rappels de ${show?.title || 'la série'} (${code})`;
  const press = (event: React.MouseEvent) => { event.stopPropagation(); void toggle(); };
  // Retour terrain du 18/11 (« la cloche est trop grosse par rapport au Vu », « aussi épaisse que Vu et Télécharger ») :
  // dans la liste, la cloche seule, sans rond, au trait de l'anneau Vu (36 px, « un poil plus petit », dans une cible de 48 px), or si active ;
  // sur la fiche épisode, elle reste une pastille ronde à côté de la croix.
  const icon = variant === 'icon';
  return <button type="button" data-episode-reminder={code} aria-pressed={reminder} aria-busy={pending || undefined} disabled={pending} onClick={press} aria-label={label}
    className={cn('shrink-0 rounded-full grid place-items-center active:scale-95', icon ? 'w-12 h-12' : reminder ? 'w-11 h-11 bg-[#E5A93D] text-black' : 'w-11 h-11 bg-[rgba(9,9,11,0.88)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]')}>
    {icon ? <SeenItBellRing size={36} active={reminder} /> : reminder ? <BellRing size={18} aria-hidden="true" /> : <Bell size={18} aria-hidden="true" />}
  </button>;
}
