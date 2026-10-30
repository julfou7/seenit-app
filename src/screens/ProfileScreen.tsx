import { DialogLayer } from '../components/ui/DialogLayer';
import React, { Activity, startTransition, useCallback, useState, useEffect, useRef } from 'react';
import { Settings } from 'lucide-react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { SettingsScreen } from './SettingsScreen';
import { PersonDetailModal } from './PersonDetailModal';
import { cn } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { ProAnalyticsDashboard } from '../components/ProAnalyticsDashboard';
import { ProfileYearStory } from '../components/ProfileYearStory';
import { LibraryScreen } from './LibraryScreen';
import { useToastStore } from '../store/toastStore';
import { useShowsStore } from '../store/showsStore';
import { useUpdateStore } from '../store/updateStore';
import { getProfileAvatarUrl, getProfileInitials } from '../features/profile/profileAvatar';
import './moi.css';

type ProfileTab = 'library' | 'stats' | 'year';
const PROFILE_TABS: [ProfileTab, string][] = [['library', 'Ma liste'], ['stats', 'Chiffres'], ['year', 'Mon année']];

const ProfileStatsContent = React.memo(function ProfileStatsContent({
  onPersonClick,
}: {
  onPersonClick: (personId: number) => void;
}) {
  const { shows, loading } = useShows();
  return <ProAnalyticsDashboard shows={shows} libraryReady={!loading} onPersonClick={onPersonClick} />;
});

const ProfileYearContent = React.memo(function ProfileYearContent() {
  const { shows, loading } = useShows();
  return <ProfileYearStory shows={shows} libraryReady={!loading} />;
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
  const [activeTab, setActiveTab] = useState<ProfileTab>('library');
  const [mountedProfileTabs, setMountedProfileTabs] = useState(() => new Set<ProfileTab>(['library']));
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

  const handleProfileTabChange = useCallback((tab: ProfileTab) => {
    startTransition(() => {
      setMountedProfileTabs(previous => {
        if (previous.has(tab)) return previous;
        const next = new Set(previous);
        next.add(tab);
        return next;
      });
      setActiveTab(tab);
    });
  }, []);

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
      if (selectedPersonId !== null || showSettings || activeTab !== 'library') event.preventDefault();
      if (selectedPersonId !== null) {
        setSelectedPersonId(null);
        return;
      }
      if (showSettings) {
        setShowSettings(false);
        return;
      }
      if (activeTab !== 'library') setActiveTab('library');
    };
    const handleResetAll = () => {
      setSelectedPersonId(null);
      setShowSettings(false);
      setIsExitingSettings(false);
      setDragXSettings(0);
      setMountedProfileTabs(new Set<ProfileTab>(['library']));
      setActiveTab('library');
      requestAnimationFrame(() => {
        if (rootRef.current) rootRef.current.scrollTop = 0;
      });
      showToast('Moi réinitialisé : retour à Ma liste.', 'info');
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('profile-back-one-level', handleBackOneLevel);
    window.addEventListener('profile-reset-all', handleResetAll);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('profile-back-one-level', handleBackOneLevel);
      window.removeEventListener('profile-reset-all', handleResetAll);
    };
  }, [activeTab, selectedPersonId, showSettings, showToast]);

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

      {/* 2. SOUS-VUES */}
      <div className="moi-seg">
        {PROFILE_TABS.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            aria-pressed={activeTab === tab}
            onClick={() => handleProfileTabChange(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 3. CONTENU — état conservé, Effects suspendus lorsque la sous-vue est masquée */}
      {mountedProfileTabs.has('library') && (
        <Activity mode={profileContentVisible && activeTab === 'library' ? 'visible' : 'hidden'}>
          <div className="moi-panel flex-1 flex flex-col">
            <LibraryScreen onShowClick={handleLibraryShowClick} isEmbedded={true} />
          </div>
        </Activity>
      )}
      {mountedProfileTabs.has('stats') && (
        <Activity mode={profileContentVisible && activeTab === 'stats' ? 'visible' : 'hidden'}>
          <div className="moi-panel pb-2">
            <ProfileStatsContent onPersonClick={openPersonModal} />
          </div>
        </Activity>
      )}
      {mountedProfileTabs.has('year') && (
        <Activity mode={profileContentVisible && activeTab === 'year' ? 'visible' : 'hidden'}>
          <div className="moi-panel pb-2">
            <ProfileYearContent />
          </div>
        </Activity>
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
        <DialogLayer onDismiss={handleAnimatedBackSettings} label="Réglages" historyMode="local" role="dialog"
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
