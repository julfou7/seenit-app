import { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import type { Show } from '../types';
import { SettingsSubscreen } from './settings/SettingsUi';
import { HomeNoticeSwipe } from './cards/HomeNoticeSwipe';
import { imageUrl } from '../features/watchlist/seriesCardPresentation';
import { tmdb } from '../features/shows/tmdb';

/** `episode` : épisode visé (rappel de sortie, notification reçue) ; son image remplace celle de la série. */
export interface Notice { id: string; title: string; detail: string; show?: Show; newsId?: string; update?: boolean; episode?: { season: number; episode: number } }

const stillKey = (tmdbId: number, season: number, episode: number) => `${tmdbId}:${season}x${episode}`;

/**
 * Retour terrain 07/11 : une notification d'épisode montre l'image de cet épisode (TMDB, cache public des
 * saisons), pas le visuel global de la série. Sans image d'épisode connue, le visuel de la série reste.
 */
function useEpisodeStills(notices: Notice[]): Record<string, string> {
  const [stills, setStills] = useState<Record<string, string>>({});
  const seasons = [...new Set(notices.flatMap(notice => notice.episode && notice.show?.mediaType === 'tv' && Number(notice.show.tmdbId) > 0 ? [`${Number(notice.show.tmdbId)}:${notice.episode.season}`] : []))].sort().join(',');
  useEffect(() => {
    if (!seasons) return;
    let cancelled = false;
    for (const entry of seasons.split(',')) {
      const [tmdbId, season] = entry.split(':').map(Number);
      void tmdb.getSeasonDetails(tmdbId, season).then(result => {
        if (cancelled || !result.ok) return;
        const found: Record<string, string> = {};
        for (const episode of (result.value?.episodes || []) as Array<{ episode_number: number; still_path?: string | null }>) if (episode.still_path) found[stillKey(tmdbId, season, episode.episode_number)] = episode.still_path;
        setStills(previous => ({ ...previous, ...found }));
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [seasons]);
  return stills;
}

interface Props {
  notices: Notice[];
  unreadCount: number;
  loading: boolean;
  isRead: (notice: Notice) => boolean;
  onClose: () => void;
  onMarkAll: () => void;
  onOpenNotice: (notice: Notice) => void;
  onDismiss: (notice: Notice) => void;
}

/**
 * #876 — Page Notifications, chargée à la première ouverture de la cloche (hors du chargement d'À voir).
 * Contrat des sous-pages Réglages ; aucune action visible par carte : toucher ouvre, glisser à droite retire.
 */
export function HomeNotificationsPage({ notices, unreadCount, loading, isRead, onClose, onMarkAll, onOpenNotice, onDismiss }: Props) {
  const stills = useEpisodeStills(notices);
  const noticeImage = (notice: Notice) => {
    const still = notice.episode && notice.show ? stills[stillKey(Number(notice.show.tmdbId), notice.episode.season, notice.episode.episode)] : undefined;
    return still || notice.show?.backdropPath || notice.show?.posterPath || null;
  };
  const unreadLabel = !notices.length ? '' : unreadCount ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Tout est lu';
  return <SettingsSubscreen title="Notifications" onClose={onClose}>
    <section className="home-notifications-page" aria-label="Notifications">
      <div className="home-notifications-page__summary"><span>{unreadLabel}</span>
        {unreadCount > 0 && <button type="button" className="home-notifications__read" onClick={onMarkAll}><CheckCheck size={16} />Tout marquer lu</button>}</div>
      {loading && <p role="status" className="home-notifications-page__state">Chargement des notifications…</p>}
      {!loading && !notices.length && <div className="home-notifications-page__empty"><strong>Tu es à jour</strong><p>Les sorties et imports de ta liste apparaîtront ici.</p></div>}
      <div className="home-notifications__list">{notices.map(notice => <HomeNoticeSwipe key={notice.id} onDismiss={() => onDismiss(notice)}><div data-notice-id={notice.id} className={`home-notice${isRead(notice) ? ' home-notice--read' : ''}`}>
        <button type="button" className="home-notice__open" onClick={() => onOpenNotice(notice)}><span className="home-notice__image" aria-hidden="true">{noticeImage(notice) ? <img data-notice-image src={imageUrl(noticeImage(notice), 'w300')!} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <Bell size={23} />}{!isRead(notice) && <i className="home-notice__dot" />}</span><span className="home-notice__text"><strong>{notice.title}</strong><small>{notice.detail}</small>{!isRead(notice) && <span className="sr-only">, non lue</span>}</span></button>
        <button type="button" data-notice-action className="home-notice__dismiss sr-only focus:not-sr-only" aria-label={`Retirer la notification ${notice.title}`} onClick={() => onDismiss(notice)}>Retirer</button>
      </div></HomeNoticeSwipe>)}</div>
      {notices.length > 0 && <p className="home-notifications-page__hint">Glisse une notification vers la droite pour la retirer.</p>}
    </section>
  </SettingsSubscreen>;
}
