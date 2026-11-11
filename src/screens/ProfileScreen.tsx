import { DialogLayer } from '../components/ui/DialogLayer';
import React, { Activity, Suspense, lazy, startTransition, useCallback, useLayoutEffect, useMemo, useState, useEffect, useRef } from 'react';
import { ChevronLeft, Settings } from 'lucide-react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { SettingsScreen } from './SettingsScreen';
import { PersonProfile as PersonDetailModal } from '../components/PersonProfile';
import { cn } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { LibraryScreen, type LibraryTypeFilter } from './LibraryScreen';
import { MoiFateRow, MoiYearCard } from '../components/profile/MoiYearCard';
import { collectProfileViewings, partitionProfileViewings } from '../features/profile/profileYearStats';
import { buildSeriesFate, summarizeSeriesFate } from '../features/profile/profileSeriesFate';
import { getTodayStr } from '../lib/utils';
import { useToastStore } from '../store/toastStore';
import { useShowsStore } from '../store/showsStore';
import { useUpdateStore } from '../store/updateStore';
import { getProfileAvatarUrl, getProfileInitials } from '../features/profile/profileAvatar';
import './moi.css';

// SEENIT-PROFILE-001 : Moi est une page unique ; Mes chiffres, Mon année, les séries laissées en route et la grille
// complète d'une section s'ouvrent comme des pages avec retour. Chaque sous-page reste chargée à la demande.
type ProfilePage = { kind: 'home' } | { kind: 'stats' } | { kind: 'year' } | { kind: 'fate' } | { kind: 'section'; id: string; title: string; type: LibraryTypeFilter };
const PAGE_TITLES: Record<Exclude<ProfilePage['kind'], 'home' | 'section'>, string> = { stats: 'Mes chiffres', year: 'Mon année', fate: 'Séries laissées en route' };

const ProAnalyticsDashboard = lazy(() => import('../components/ProAnalyticsDashboard').then(module => ({ default: module.ProAnalyticsDashboard })));
const ProfileYearStory = lazy(() => import('../components/ProfileYearStory').then(module => ({ default: module.ProfileYearStory })));
const SeriesFateScreen = lazy(() => import('../components/profile/SeriesFateScreen').then(module => ({ default: module.SeriesFateScreen })));

function useSeriesFate() {
  const { shows, loading } = useShows();
  const entries = useMemo(() => buildSeriesFate(shows, Date.now(), getTodayStr()), [shows]);
  return { shows, loading, entries };
}

const ProfileStatsContent = React.memo(function ProfileStatsContent({ onPersonClick, onFate }: { onPersonClick: (personId: number) => void; onFate: () => void }) {
  const { shows, loading, entries } = useSeriesFate();
  return <ProAnalyticsDashboard shows={shows} fate={entries} libraryReady={!loading} onPersonClick={onPersonClick} onFate={onFate} />;
});

const ProfileYearContent = React.memo(function ProfileYearContent({ onFate }: { onFate: () => void }) {
  const { shows, loading, entries } = useSeriesFate();
  return <ProfileYearStory shows={shows} fate={entries} libraryReady={!loading} onFate={onFate} />;
});

const ProfileFateContent = React.memo(function ProfileFateContent({ onShowClick }: { onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void }) {
  const { entries } = useSeriesFate();
  return <SeriesFateScreen entries={entries} onOpen={show => onShowClick?.(show.id, 'tv')} />;
});

const MoiHome = React.memo(function MoiHome({ onPage, onShowClick }: { onPage: (page: ProfilePage) => void; onShowClick: (id: string, mediaType?: 'tv' | 'movie') => void }) {
  const { shows, entries } = useSeriesFate();
  const viewings = useMemo(() => partitionProfileViewings(collectProfileViewings(shows)).viewings, [shows]);
  const fate = useMemo(() => summarizeSeriesFate(entries), [entries]);
  const libraryView = useMemo(() => ({ kind: 'shelves' as const, onOpenSection: (id: string, title: string, type: LibraryTypeFilter) => onPage({ kind: 'section', id, title, type }) }), [onPage]);
  return <>
    <div className="moi-home-top">
      <MoiYearCard viewings={viewings} onStats={() => onPage({ kind: 'stats' })} onYear={() => onPage({ kind: 'year' })} />
      <MoiFateRow left={fate.left.length} nearlyDone={fate.nearlyDone.length} onOpen={() => onPage({ kind: 'fate' })} />
    </div>
    <h2 className="moi-list-title">Ma liste<span>{shows.length.toLocaleString('fr-FR')}</span></h2>
    <LibraryScreen onShowClick={onShowClick} isEmbedded={true} view={libraryView} />
  </>;
});

export const ProfileScreen = React.memo(function ProfileScreen({
  initialShowSettings = false,
  onShowClick,
  onQuickSettings,
}: {
  initialShowSettings?: boolean;
  onShowClick?: (id: string | number, mediaType?: 'tv' | 'movie') => void;
  onQuickSettings?: () => void;
}) {
  const [showSettings, setShowSettings] = useState(initialShowSettings);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  // App ne monte le Profil qu'après résolution de Firebase Auth : reprendre la
  // valeur déjà disponible évite une frame « Utilisateur » au redémarrage.
  const [user, setUser] = useState<FirebaseUser | null>(() => auth.currentUser);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [page, setPage] = useState<ProfilePage>({ kind: 'home' });
  const homeScroll = useRef(0);
  // Le double appui sur Moi repart d'un état local neuf (filtre, étagères, sous-pages).
  const [homeGeneration, setHomeGeneration] = useState(0);
  const restoreHome = useRef(false);
  const [isProfileVisible, setIsProfileVisible] = useState(true);
  const showToast = useToastStore(state => state.showToast);
  const followedCount = useShowsStore(state => state.shows.length);
  const hasUpdate = useUpdateStore(state => state.hasUpdate);
  const avatarUrl = getProfileAvatarUrl(user);

  const [isExitingSettings, setIsExitingSettings] = useState(false);
  const [dragXSettings, setDragXSettings] = useState(0);
  const [isDraggingSettings, setIsDraggingSettings] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const startXRefSettings = useRef<number | null>(null);
  const startYRefSettings = useRef<number | null>(null);
  const isEdgeSwipeRefSettings = useRef<boolean>(false);
  const isHorizontalSwipeRefSettings = useRef<boolean | null>(null);

  const openPersonModal = useCallback((personId: number) => {
    setSelectedPersonId(personId);
    const currentState = window.history.state || {};
    window.history.pushState({ ...currentState, isModal: true, isPersonDetailModal: true, personId }, '');
  }, []);

  const openPage = useCallback((next: ProfilePage) => {
    if (rootRef.current && next.kind !== 'home') homeScroll.current = rootRef.current.scrollTop;
    startTransition(() => setPage(next));
    requestAnimationFrame(() => { if (rootRef.current) rootRef.current.scrollTop = 0; });
  }, []);
  const backHome = useCallback(() => { restoreHome.current = true; setPage({ kind: 'home' }); }, []);
  // Le retour depuis une sous-page rend la page Moi à la même position de défilement.
  useLayoutEffect(() => {
    if (page.kind !== 'home' || !restoreHome.current || !rootRef.current) return;
    restoreHome.current = false;
    rootRef.current.scrollTop = homeScroll.current;
  }, [page]);
  const openFate = useCallback(() => openPage({ kind: 'fate' }), [openPage]);

  const handleLibraryShowClick = useCallback((id: string, mediaType?: 'tv' | 'movie') => {
    onShowClick?.(id, mediaType);
  }, [onShowClick]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.isPersonDetailModal && event.state.personId) {
        setSelectedPersonId(event.state.personId);
      } else if (!event.state || !event.state.isPersonDetailModal) {
        setSelectedPersonId(null);
      }
    };
    const handleBackOneLevel = (event: Event) => {
      if (selectedPersonId !== null || showSettings || page.kind !== 'home') event.preventDefault();
      if (selectedPersonId !== null) {
        setSelectedPersonId(null);
        return;
      }
      if (showSettings) {
        setShowSettings(false);
        return;
      }
      if (page.kind !== 'home') backHome();
    };
    const handleResetAll = () => {
      setSelectedPersonId(null);
      setShowSettings(false);
      setIsExitingSettings(false);
      setDragXSettings(0);
      setPage({ kind: 'home' });
      setHomeGeneration(value => value + 1);
      requestAnimationFrame(() => {
        if (rootRef.current) rootRef.current.scrollTop = 0;
      });
      showToast('Moi réinitialisé : retour en haut de la page.', 'info');
    };
    // La barre reste visible dans les Réglages : changer d'onglet les ferme comme toute superposition.
    const handleCloseModals = () => setShowSettings(false);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('profile-back-one-level', handleBackOneLevel);
    window.addEventListener('profile-reset-all', handleResetAll);
    window.addEventListener('app-close-modals', handleCloseModals);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('profile-back-one-level', handleBackOneLevel);
      window.removeEventListener('profile-reset-all', handleResetAll);
      window.removeEventListener('app-close-modals', handleCloseModals);
    };
  }, [backHome, page.kind, selectedPersonId, showSettings, showToast]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsProfileVisible(entry.isIntersecting && entry.intersectionRatio > 0);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const handleAnimatedBackSettings = () => {
    if (isExitingSettings) return;
    setIsExitingSettings(true);
    setTimeout(() => {
      setShowSettings(false);
      setIsExitingSettings(false);
      setDragXSettings(0);
    }, 280);
  };

  const handleTouchStartSettings = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    startXRefSettings.current = touch.clientX;
    startYRefSettings.current = touch.clientY;
    isHorizontalSwipeRefSettings.current = null;

    if (touch.clientX <= 70) {
      isEdgeSwipeRefSettings.current = true;
    } else {
      isEdgeSwipeRefSettings.current = false;
    }
  };

  const handleTouchMoveSettings = (e: React.TouchEvent) => {
    if (startXRefSettings.current === null || startYRefSettings.current === null) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - startXRefSettings.current;
    const diffY = touch.clientY - startYRefSettings.current;

    if (isHorizontalSwipeRefSettings.current === null) {
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 8) {
        isHorizontalSwipeRefSettings.current = true;
      } else if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 8) {
        isHorizontalSwipeRefSettings.current = false;
      }
    }

    if (isEdgeSwipeRefSettings.current && isHorizontalSwipeRefSettings.current === true && diffX > 0) {
      setIsDraggingSettings(true);
      setDragXSettings(diffX);
    }
  };

  const handleTouchEndSettings = () => {
    if (isDraggingSettings) {
      setIsDraggingSettings(false);
      if (dragXSettings > 90) {
        handleAnimatedBackSettings();
      } else {
        setDragXSettings(0);
      }
    }
    startXRefSettings.current = null;
    startYRefSettings.current = null;
    isEdgeSwipeRefSettings.current = false;
    isHorizontalSwipeRefSettings.current = null;
  };

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [user?.uid, avatarUrl]);

  const creationYear = user?.metadata?.creationTime
    ? new Date(user.metadata.creationTime).getFullYear()
    : 2024;
  const profileContentVisible = isProfileVisible && !showSettings;
  const avatarInitials = getProfileInitials(user?.displayName, user?.email);

  const avatar = avatarUrl && !avatarLoadFailed ? (
    <img
      src={avatarUrl}
      alt="Avatar"
      onError={() => setAvatarLoadFailed(true)}
    />
  ) : (
    <span role="img" aria-label="Avatar">{avatarInitials}</span>
  );

  return (
    <div ref={rootRef} className="moi-root flex-1 overflow-y-auto pb-nav custom-scrollbar">

      {/* 1. EN-TÊTE : identité, puis la roue des Réglages */}
      <div className="moi-head">
        {onQuickSettings ? (
          <button type="button" className="moi-avatar" onClick={onQuickSettings} aria-label="Réglages rapides du compte">
            {avatar}
          </button>
        ) : (
          <span className="moi-avatar">{avatar}</span>
        )}
        <div className="moi-id">
          <h1 className="moi-name">{user?.displayName || (user?.email?.split('@')[0]) || 'Utilisateur'}</h1>
          <span className="moi-since">
            depuis {creationYear} · {followedCount.toLocaleString('fr-FR')} {followedCount > 1 ? 'titres suivis' : 'titre suivi'}
          </span>
        </div>
        <button
          type="button"
          className="moi-gear"
          onClick={() => setShowSettings(true)}
          aria-label="Réglages"
          title={hasUpdate ? 'Réglages · mise à jour disponible' : 'Réglages'}
        >
          <Settings size={21} strokeWidth={2} aria-hidden="true" />
          {hasUpdate && <span className="moi-gear-dot" aria-hidden="true" />}
        </button>
      </div>

      {/* 2. PAGE UNIQUE — l'accueil de Moi reste monté (état et défilement) pendant une sous-page */}
      <Activity mode={profileContentVisible && page.kind === 'home' ? 'visible' : 'hidden'}>
        <div className="moi-panel flex-1 flex flex-col">
          <MoiHome key={homeGeneration} onPage={openPage} onShowClick={handleLibraryShowClick} />
        </div>
      </Activity>
      {page.kind !== 'home' && (
        <div className="moi-panel moi-subpage pb-2">
          <div className="moi-subpage-bar">
            <button type="button" className="moi-back" onClick={backHome} aria-label="Retour à Moi"><ChevronLeft size={22} strokeWidth={2.4} aria-hidden="true" /></button>
            <h2>{page.kind === 'section' ? page.title : PAGE_TITLES[page.kind]}</h2>
          </div>
          <Suspense fallback={<div className="moi-empty"><strong>Chargement…</strong></div>}>
            {page.kind === 'stats' && <ProfileStatsContent onPersonClick={openPersonModal} onFate={openFate} />}
            {page.kind === 'year' && <ProfileYearContent onFate={openFate} />}
            {page.kind === 'fate' && <ProfileFateContent onShowClick={handleLibraryShowClick} />}
            {page.kind === 'section' && <LibraryScreen onShowClick={handleLibraryShowClick} isEmbedded={true} view={{ kind: 'section', id: page.id, type: page.type }} />}
          </Suspense>
        </div>
      )}

      {/* MODAL DÉTAILS PERSONNE (ACTEUR / RÉALISATEUR) */}
      {selectedPersonId && (
        <PersonDetailModal
          personId={selectedPersonId}
          onClose={() => {
            setSelectedPersonId(null);
            if (window.history.state?.isPersonDetailModal || window.history.state?.isModal) {
              window.history.back();
            }
          }}
          onShowClick={(id, mediaType) => {
            if (onShowClick) {
              onShowClick(id, mediaType);
            }
          }}
        />
      )}

      {/* SETTINGS OVERLAY MODAL */}
      {showSettings && isProfileVisible && (
        <DialogLayer onDismiss={handleAnimatedBackSettings} label="Réglages" historyMode="local" role="dialog" blocking={false} data-settings-layer=""
          className={cn(
            "reg-root fixed inset-0 max-w-md mx-auto z-50 flex flex-col transition-transform duration-300 ease-out",
            isExitingSettings ? "translate-x-full" : "translate-x-0"
          )}
          style={
            isDraggingSettings
              ? { transform: `translateX(${dragXSettings}px)`, transition: 'none' }
              : undefined
          }
          onTouchStart={handleTouchStartSettings}
          onTouchMove={handleTouchMoveSettings}
          onTouchEnd={handleTouchEndSettings}
        >
          <SettingsScreen onClose={handleAnimatedBackSettings} />
        </DialogLayer>
      )}
    </div>
  );
});
