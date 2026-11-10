import { collectDeliveredNotifications, formatNotificationEpisodeCodes, NOTIFICATION_INBOX_FIELD, type InboxNotification } from '../features/notifications/notificationInbox';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
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
import { receivedEpisode, releaseReminderAlreadyReceived } from '../features/notifications/notificationDedup';
import { useToastStore } from '../store/toastStore';
import type { Notice } from './HomeNotificationsPage';
import { NOTICE_FIRST_SEEN_FIELD, isValidNoticeTime, reconcileFirstSeen } from '../features/notifications/notificationNoticeTime';

interface News { id: string; showId: string; message: string; description?: string }
// Chargée à la première ouverture : la page (cadre Réglages, cartes, glissement) reste hors du chargement d'À voir.
const HomeNotificationsPage = lazy(() => import('./HomeNotificationsPage').then(module => ({ default: module.HomeNotificationsPage })));
/** #876 — Page Notifications : aucune action par carte ; toucher ouvre, glisser à droite retire, la page se ferme seule une fois vide. */
export function HomeNotifications({ shows, onOpen }: { shows: Show[]; onOpen: (id: string, type?: 'tv' | 'movie') => void }) {
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
  const [firstSeen, setFirstSeen] = useState<{ uid: string | null; times: Record<string, number> }>({ uid: null, times: {} });
  const plex = usePlexAvailabilityStore(state => state.cache);
  const downloadsEnabled = useDownloadConfigStore(state => state.downloadsEnabled);
  const release = useUpdateStore(state => state.latestRelease);
  const hasUpdate = useUpdateStore(state => state.hasUpdate);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    const reset = () => setOpen(false);
    // La navigation reste visible sous la page : changer d'onglet la ferme comme toute superposition.
    window.addEventListener('watchlist-reset-all', reset);
    window.addEventListener('app-close-modals', reset);
    return () => { clearInterval(timer); window.removeEventListener('watchlist-reset-all', reset); window.removeEventListener('app-close-modals', reset); };
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
  // Notifications réellement reçues, rattachées à leur série par identifiant (jamais par titre).
  const receivedFor = (show: Show) => received.filter(item => String(show.id) === String(item.data.showId) || Number(show.tmdbId) === Number(item.data.tmdbId) && show.mediaType === (item.data.mediaType || 'tv'));
  for (const show of userShows) {
    if (show.isArchived || show.status === 'dropped') continue;
    const available = plex[getPlexMediaKey(show.tmdbId, show.mediaType, uid)];
    if (canOfferPlexWatchedAction(show.mediaType, available?.available === true, show.seenEpisodes.includes('movie'))) notices.push({ id: `plex:${show.id}:movie`, title: show.title, detail: 'Disponible sur Plex', show });
    const upcoming = getUpcomingEpisodeInfo(show);
    // Le rappel calculé n'est qu'un repli : la notification déjà reçue pour cette sortie suffit (jamais deux cartes).
    const alreadyReceived = upcoming && releaseReminderAlreadyReceived(upcoming, receivedFor(show), today, time => getTodayStr(new Date(time)));
    if (upcoming && show.notificationsEnabled && upcoming.air_date === today && !alreadyReceived) notices.push({ id: `reminder:${show.id}:${today}`, title: show.title, detail: 'Rappel de sortie · aujourd’hui', show, episode: show.mediaType === 'tv' ? { season: upcoming.season_number, episode: upcoming.episode_number } : undefined });
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
    if (show) notices.push({ id: `received:${item.id}`, title: show.title, detail: formatNotificationEpisodeCodes(item.body), show, receivedAt: item.receivedAt, episode: show.mediaType === 'tv' ? receivedEpisode(item) : undefined });
  }
  if (hasUpdate && release) notices.unshift({ id: `update:${release.version}`, title: `SeenIt ${release.version}`, detail: 'Une mise à jour est disponible', update: true });
  // Le temps d'une carte calculée est sa première apparition dans la boîte pour cet UID,
  // jamais la date TMDB, le dernier polling Plex ou une réception native inventée.
  const firstSeenIds = notices.filter(notice => !isValidNoticeTime(notice.receivedAt)).map(notice => notice.id).join('\u001f');
  useEffect(() => {
    if (!uid) { setFirstSeen({ uid: null, times: {} }); return; }
    const stored = readUserScopedJson<Record<string, number>>(uid, NOTICE_FIRST_SEEN_FIELD, {});
    const { times, changed } = reconcileFirstSeen(stored, firstSeenIds ? firstSeenIds.split('\u001f') : [], Date.now());
    if (auth.currentUser?.uid !== uid) return;
    if (changed) writeUserScopedJson(uid, NOTICE_FIRST_SEEN_FIELD, times);
    setFirstSeen({ uid, times });
  }, [uid, firstSeenIds]);
  const isRead = (notice: Notice) => read.includes(notice.id) || Boolean(notice.newsId && readNews.includes(notice.newsId));
  const visibleNotices = notices.filter(notice => !dismissed.includes(notice.id))
    .map(notice => ({ ...notice, firstSeenAt: firstSeen.uid === uid ? firstSeen.times[notice.id] : undefined }));
  const unread = visibleNotices.filter(notice => !isRead(notice));
  const hadVisibleNotices = useRef(false);
  useEffect(() => {
    if (!open) { hadVisibleNotices.current = false; return; }
    if (visibleNotices.length) hadVisibleNotices.current = true;
    else if (!loading && hadVisibleNotices.current) setOpen(false);
  }, [open, loading, visibleNotices.length]);
  const dismiss = (notice: Notice) => {
    if (!uid || auth.currentUser?.uid !== uid) return;
    const next = [...new Set([...readUserScopedJson<string[]>(uid, 'home_dismissed_notifications', []), notice.id])].slice(-500);
    setDismissed(next); writeUserScopedJson(uid, 'home_dismissed_notifications', next);
    // #878 : le toast porte le média retiré (affiche + titre) ; le type info reste non navigable.
    useToastStore.getState().showToast('Notification retirée', 'info', notice.show, () => {
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
  const markAllRead = () => {
    if (!uid || auth.currentUser?.uid !== uid || !visibleNotices.length) return;
    const nextDismissed = [...new Set([
      ...readUserScopedJson<string[]>(uid, 'home_dismissed_notifications', []),
      ...visibleNotices.map(notice => notice.id),
    ])].slice(-500);
    setDismissed(nextDismissed);
    writeUserScopedJson(uid, 'home_dismissed_notifications', nextDismissed);
    void markRead(visibleNotices);
    setOpen(false);
  };
  const openNotice = (notice: Notice) => {
    void markRead([notice]); setOpen(false);
    if (notice.update) useUpdateStore.getState().requestUpdateModal(); else if (notice.show) onOpen(notice.show.id, notice.show.mediaType);
  };
  return <>
    <button type="button" className="home-notification-bell" aria-label={`Notifications${unread.length ? `, ${unread.length} non lues` : ''}`} aria-haspopup="dialog" onClick={() => setOpen(true)}><Bell size={22} />{unread.length > 0 && <span>{unread.length > 99 ? '99+' : unread.length}</span>}</button>
    {open && <Suspense fallback={null}><HomeNotificationsPage notices={visibleNotices} unreadCount={unread.length} loading={loading} isRead={isRead}
      onClose={() => setOpen(false)} onMarkAll={markAllRead} onOpenNotice={openNotice} onDismiss={dismiss} /></Suspense>}
  </>;
}
