import { collectDeliveredNotifications, formatNotificationEpisodeCodes, NOTIFICATION_INBOX_FIELD, type InboxNotification } from '../features/notifications/notificationInbox';
import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { collection, query, orderBy, limit, getDocs, getDoc, doc, setDoc, arrayUnion } from 'firebase/firestore';
import type { Show } from '../types';
import { auth, db } from '../lib/firebase';
import { readUserScopedJson, writeUserScopedJson, subscribeUserScopedStorageField } from '../lib/userIsolation';
import { usePlexAvailabilityStore, getPlexMediaKey } from '../features/plex/plexAvailability';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useUpdateStore } from '../store/updateStore';
import type { LiveDownloadItem } from '../services/sonarrRadarr';
import { getUpcomingEpisodeInfo } from './cards/UpcomingShowCard';
import { canOfferPlexWatchedAction } from '../features/watchlist/homePresentation';
import { getTodayStr } from '../lib/utils';
import { DialogLayer } from './ui/DialogLayer';
import { SeenItCheckButton } from './SeenItCheckButton';
import { useToastStore } from '../store/toastStore';
import { HomeNoticeSwipe } from './cards/HomeNoticeSwipe';
import { imageUrl } from '../features/watchlist/seriesCardPresentation';

interface Notice { id: string; title: string; detail: string; show?: Show; newsId?: string; update?: boolean; mark?: boolean }
interface News { id: string; showId: string; message: string; description?: string }
export function HomeNotifications({ shows, onOpen, onSeen }: { shows: Show[]; onOpen: (id: string, type?: 'tv' | 'movie') => void; onSeen: (show: Show) => void | boolean | Promise<void | boolean> }) {
  const uid = auth.currentUser?.uid;
  const showsRef = useRef(shows); showsRef.current = shows;
  const collectingUid = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [received, setReceived] = useState<InboxNotification[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [read, setRead] = useState<string[]>([]);
  const [readNews, setReadNews] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [downloads, setDownloads] = useState<LiveDownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const plex = usePlexAvailabilityStore(state => state.cache);
  const downloadsEnabled = useDownloadConfigStore(state => state.downloadsEnabled);
  const release = useUpdateStore(state => state.latestRelease);
  const hasUpdate = useUpdateStore(state => state.hasUpdate);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    const reset = () => setOpen(false);
    window.addEventListener('watchlist-reset-all', reset);
    return () => { clearInterval(timer); window.removeEventListener('watchlist-reset-all', reset); };
  }, []);
  useEffect(() => {
    let current = true;
    setNews(readUserScopedJson<News[]>(uid, 'home_news', [])); setLoading(Boolean(uid));
    const refresh = () => { setRead(readUserScopedJson<string[]>(uid, 'home_read_notifications', [])); setReadNews(readUserScopedJson<string[]>(uid, 'read_news_ids', [])); setDismissed(readUserScopedJson<string[]>(uid, 'home_dismissed_notifications', [])); };
    refresh();
    const unsubscribe = subscribeUserScopedStorageField(uid, 'home_read_notifications', refresh);
    const unsubscribeNews = subscribeUserScopedStorageField(uid, 'read_news_ids', refresh);
    const unsubscribeDismissed = subscribeUserScopedStorageField(uid, 'home_dismissed_notifications', refresh);
    if (uid) void getDocs(query(collection(db, 'users', uid, 'news'), orderBy('createdAt', 'desc'), limit(50))).then(snapshot => {
      if (current) {
        const items = snapshot.docs.map(item => ({ ...item.data(), id: item.id }) as News);
        setNews(items); writeUserScopedJson(uid, 'home_news', items);
      }
    }).catch(() => { /* Les notifications locales restent disponibles hors ligne. */ }).finally(() => { if (current) setLoading(false); });
    if (uid) void getDoc(doc(db, 'users', uid, 'settings', 'news_preferences')).then(snapshot => {
      const remote: unknown = snapshot.exists() ? snapshot.data()?.readNewsIds : null;
      if (!current || !Array.isArray(remote)) return;
      const ids = [...new Set([...readUserScopedJson<string[]>(uid, 'read_news_ids', []), ...remote.filter((id): id is string => typeof id === 'string')])];
      setReadNews(ids); writeUserScopedJson(uid, 'read_news_ids', ids);
    }).catch(() => {});
    return () => { current = false; unsubscribe(); unsubscribeNews(); unsubscribeDismissed(); };
  }, [uid]);
  useEffect(() => {
    if (!downloadsEnabled) { setDownloads([]); return; }
    let current = true;
    let unsubscribe: (() => void) | undefined;
    void import('../store/liveDownloadStore').then(({ useLiveDownloadStore }) => {
      if (!current) return;
      setDownloads(useLiveDownloadStore.getState().downloads);
      unsubscribe = useLiveDownloadStore.subscribe(state => setDownloads(state.downloads));
    });
    return () => { current = false; unsubscribe?.(); };
  }, [downloadsEnabled, uid]);
  useEffect(() => {
    const refresh = () => setReceived(readUserScopedJson<InboxNotification[]>(uid, NOTIFICATION_INBOX_FIELD, []));
    const collect = () => { if (!uid || collectingUid.current === uid) return; collectingUid.current = uid; void collectDeliveredNotifications(uid, () => auth.currentUser?.uid, showsRef.current).catch(() => {}).finally(() => { if (collectingUid.current === uid) collectingUid.current = null; }); };
    const visible = () => { if (document.visibilityState === 'visible') collect(); };
    refresh(); collect();
    const unsubscribe = subscribeUserScopedStorageField(uid, NOTIFICATION_INBOX_FIELD, refresh);
    window.addEventListener('focus', collect); document.addEventListener('visibilitychange', visible);
    return () => { unsubscribe(); window.removeEventListener('focus', collect); document.removeEventListener('visibilitychange', visible); };
  }, [uid, open]);
  const today = getTodayStr(new Date(clock));
  const userShows = shows.filter(show => show.userId === uid);
  const notices: Notice[] = [];
  for (const show of userShows) {
    if (show.isArchived || show.status === 'dropped') continue;
    const available = plex[getPlexMediaKey(show.tmdbId, show.mediaType, uid)];
    if (canOfferPlexWatchedAction(show.mediaType, available?.available === true, show.seenEpisodes.includes('movie'))) notices.push({ id: `plex:${show.id}:movie`, title: show.title, detail: 'Disponible sur Plex', show, mark: true });
    const upcoming = getUpcomingEpisodeInfo(show);
    if (upcoming && show.notificationsEnabled && upcoming.air_date === today) notices.push({ id: `reminder:${show.id}:${today}`, title: show.title, detail: 'Rappel de sortie · aujourd’hui', show });
    if (show.mediaType === 'movie' && upcoming && show.firstAirDate && show.firstAirDate >= today) notices.push({ id: `date:${show.id}:${show.firstAirDate}`, title: show.title, detail: `Sortie confirmée · ${new Date(`${show.firstAirDate}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`, show });
  }
  for (const download of downloads) {
    if (download.status !== 'completed') continue;
    const show = userShows.find(item => item.tmdbId === download.tmdbId && item.mediaType === download.mediaType);
    if (show) notices.push({ id: `download:${download.requestId || download.id}`, title: show.title, detail: 'Téléchargement terminé', show });
  }
  for (const item of news) {
    const show = userShows.find(show => show.id === item.showId || String(show.tmdbId) === String(item.showId));
    if (show) notices.push({ id: `news:${item.id}`, newsId: item.id, title: show.title, detail: item.message, show });
  }
  for (const item of received) {
    const show = userShows.find(show => String(show.id) === String(item.data.showId) || Number(show.tmdbId) === Number(item.data.tmdbId) && show.mediaType === (item.data.mediaType || 'tv'));
    if (show) notices.push({ id: `received:${item.id}`, title: show.title, detail: formatNotificationEpisodeCodes(item.body), show });
  }
  if (hasUpdate && release) notices.unshift({ id: `update:${release.version}`, title: `SeenIt ${release.version}`, detail: 'Une mise à jour est disponible', update: true });
  const isRead = (notice: Notice) => read.includes(notice.id) || Boolean(notice.newsId && readNews.includes(notice.newsId));
  const visibleNotices = notices.filter(notice => !dismissed.includes(notice.id));
  const unread = visibleNotices.filter(notice => !isRead(notice));
  const dismiss = (notice: Notice) => {
    if (!uid || auth.currentUser?.uid !== uid) return;
    const next = [...new Set([...readUserScopedJson<string[]>(uid, 'home_dismissed_notifications', []), notice.id])].slice(-500);
    setDismissed(next); writeUserScopedJson(uid, 'home_dismissed_notifications', next);
    useToastStore.getState().showToast('Notification retirée', 'info', undefined, () => {
      if (auth.currentUser?.uid !== uid) return;
      const restored = readUserScopedJson<string[]>(uid, 'home_dismissed_notifications', []).filter(id => id !== notice.id);
      setDismissed(restored); writeUserScopedJson(uid, 'home_dismissed_notifications', restored);
    });
  };
  const markRead = async (items: Notice[]) => {
    const next = [...new Set([...read, ...items.map(item => item.id)])].slice(-500);
    setRead(next); writeUserScopedJson(uid, 'home_read_notifications', next);
    const ids = items.flatMap(item => item.newsId ? [item.newsId] : []);
    if (ids.length && uid) {
      const nextNews = [...new Set([...readNews, ...ids])];
      setReadNews(nextNews); writeUserScopedJson(uid, 'read_news_ids', nextNews);
      try { await setDoc(doc(db, 'users', uid, 'settings', 'news_preferences'), { readNewsIds: arrayUnion(...ids) }, { merge: true }); }
      catch { useToastStore.getState().showToast('Lecture enregistrée sur cet appareil. Synchronisation à réessayer.', 'info'); }
    }
  };
  return <>
    <button type="button" className="home-notification-bell" aria-label={`Notifications${unread.length ? `, ${unread.length} non lues` : ''}`} aria-haspopup="dialog" onClick={() => setOpen(true)}><Bell size={22} />{unread.length > 0 && <span>{unread.length > 99 ? '99+' : unread.length}</span>}</button>
    {open && <DialogLayer label="Notifications" onDismiss={() => setOpen(false)} className="fixed inset-0 bg-black/65 flex items-end sm:items-center justify-center p-3">
      <section className="home-notifications"><header><h2>Notifications</h2><button type="button" aria-label="Fermer les notifications" data-dialog-initial-focus onClick={() => setOpen(false)}><X size={20} /></button></header>
        {unread.length > 0 && <button type="button" className="home-notifications__read" onClick={() => { void markRead(notices); }}><CheckCheck size={16} />Tout marquer lu</button>}
        {loading && <p role="status">Chargement des notifications…</p>}
        {!loading && !visibleNotices.length && <p>Aucune notification pour le moment.</p>}
        <div className="home-notifications__list">{visibleNotices.map(notice => <HomeNoticeSwipe key={notice.id} onDismiss={() => dismiss(notice)}><div data-notice-id={notice.id} className={`home-notice${isRead(notice) ? ' home-notice--read' : ''}`}>
          <button type="button" onClick={() => { void markRead([notice]); setOpen(false); if (notice.update) useUpdateStore.getState().requestUpdateModal(); else if (notice.show) onOpen(notice.show.id, notice.show.mediaType); }}><span className="home-notice__image" aria-hidden="true">{notice.show?.posterPath ? <img src={imageUrl(notice.show.backdropPath || notice.show.posterPath, 'w300')!} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} /> : <Bell size={23} />}</span><span className="home-notice__text"><strong>{!isRead(notice) && <i className="home-notice__dot" />}{notice.title}</strong><small>{notice.detail}</small></span></button>
          {notice.mark && notice.show && <span data-notice-action><SeenItCheckButton size={28} title={`Marquer ${notice.title} comme vu`} onClick={async () => { if (await onSeen(notice.show!) !== false) await markRead([notice]); }} /></span>}
          <button type="button" data-notice-action className="home-notice__dismiss" aria-label={`Retirer la notification ${notice.title}`} onClick={() => dismiss(notice)}><X size={16} /></button>
        </div></HomeNoticeSwipe>)}</div>
      </section>
    </DialogLayer>}
  </>;
}
