import { Bell, CheckCheck } from 'lucide-react';
import type { Show } from '../types';
import { SettingsSubscreen } from './settings/SettingsUi';
import { HomeNoticeSwipe } from './cards/HomeNoticeSwipe';
import { imageUrl } from '../features/watchlist/seriesCardPresentation';

export interface Notice { id: string; title: string; detail: string; show?: Show; newsId?: string; update?: boolean }

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
  const unreadLabel = !notices.length ? '' : unreadCount ? `${unreadCount} non lue${unreadCount > 1 ? 's' : ''}` : 'Tout est lu';
  return <SettingsSubscreen title="Notifications" onClose={onClose}>
    <section className="home-notifications-page" aria-label="Notifications">
      <div className="home-notifications-page__summary"><span>{unreadLabel}</span>
        {unreadCount > 0 && <button type="button" className="home-notifications__read" onClick={onMarkAll}><CheckCheck size={16} />Tout marquer lu</button>}</div>
      {loading && <p role="status" className="home-notifications-page__state">Chargement des notifications…</p>}
      {!loading && !notices.length && <div className="home-notifications-page__empty"><strong>Tu es à jour</strong><p>Les sorties et imports de ta liste apparaîtront ici.</p></div>}
      <div className="home-notifications__list">{notices.map(notice => <HomeNoticeSwipe key={notice.id} onDismiss={() => onDismiss(notice)}><div data-notice-id={notice.id} className={`home-notice${isRead(notice) ? ' home-notice--read' : ''}`}>
        <button type="button" className="home-notice__open" onClick={() => onOpenNotice(notice)}><span className="home-notice__image" aria-hidden="true">{notice.show?.posterPath ? <img src={imageUrl(notice.show.backdropPath || notice.show.posterPath, 'w300')!} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <Bell size={23} />}{!isRead(notice) && <i className="home-notice__dot" />}</span><span className="home-notice__text"><strong>{notice.title}</strong><small>{notice.detail}</small>{!isRead(notice) && <span className="sr-only">, non lue</span>}</span></button>
        <button type="button" data-notice-action className="home-notice__dismiss sr-only focus:not-sr-only" aria-label={`Retirer la notification ${notice.title}`} onClick={() => onDismiss(notice)}>Retirer</button>
      </div></HomeNoticeSwipe>)}</div>
      {notices.length > 0 && <p className="home-notifications-page__hint">Glisse une notification vers la droite pour la retirer.</p>}
    </section>
  </SettingsSubscreen>;
}
