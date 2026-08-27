import React, { useState, useEffect, useRef } from 'react';
import { Settings, Share2, Calendar, CheckCircle2, ArrowLeft } from 'lucide-react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { SettingsScreen } from './SettingsScreen';
import { PersonDetailModal } from './PersonDetailModal';
import { cn } from '../lib/utils';
import { useShows } from '../hooks/useShows';
import { ProAnalyticsDashboard } from '../components/ProAnalyticsDashboard';
import { SeenItLogo } from '../components/SeenItLogo';
import { LibraryScreen } from './LibraryScreen';

export function ProfileScreen({ 
  initialShowSettings = false,
  onShowClick
}: { 
  initialShowSettings?: boolean;
  onShowClick?: (id: any, mediaType?: 'tv' | 'movie') => void;
}) {
  const [showSettings, setShowSettings] = useState(initialShowSettings);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'stats' | 'library'>('stats');

  const [isExitingSettings, setIsExitingSettings] = useState(false);
  const [dragXSettings, setDragXSettings] = useState(0);
  const [isDraggingSettings, setIsDraggingSettings] = useState(false);

  const startXRefSettings = useRef<number | null>(null);
  const startYRefSettings = useRef<number | null>(null);
  const isEdgeSwipeRefSettings = useRef<boolean>(false);
  const isHorizontalSwipeRefSettings = useRef<boolean | null>(null);

  const openPersonModal = (personId: number) => {
    setSelectedPersonId(personId);
    const currentState = window.history.state || {};
    window.history.pushState({ ...currentState, isModal: true, isPersonDetailModal: true, personId }, '');
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.isPersonDetailModal && event.state.personId) {
        setSelectedPersonId(event.state.personId);
      } else if (!event.state || !event.state.isPersonDetailModal) {
        setSelectedPersonId(null);
      }
    };
    const handleResetAll = () => {
      setSelectedPersonId(null);
      setShowSettings(false);
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('profile-reset-all', handleResetAll);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('profile-reset-all', handleResetAll);
    };
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

  const { shows } = useShows();

  const handleShare = async () => {
    const text = `Découvre mon Profil Cinéphile sur l'application !`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Mon Profil Cinéphile',
          text,
          url: window.location.href,
        });
      } catch (err) {
        console.log(err);
      }
    } else {
      navigator.clipboard.writeText(text);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    }
  };

  const creationYear = user?.metadata?.creationTime 
    ? new Date(user.metadata.creationTime).getFullYear() 
    : 2024;

  return (
    <div className="flex-1 overflow-y-auto bg-transparent text-white pb-nav custom-scrollbar">
      
      {/* 1. HERO SECTION */}
      <div className="px-6 pt-12 pb-6 relative">
        <div className="absolute top-0 left-0 w-64 h-32 bg-[#E5A93D]/10 blur-[100px] -z-10 rounded-full mix-blend-screen pointer-events-none" />
        <div className="flex justify-between items-start mb-4">
          <div className="relative">
             <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-[#E5A93D] p-1 shadow-lg shadow-[#E5A93D]/10">
               <img 
                 src={user?.photoURL || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300"} 
                 alt="Avatar" 
                 className="w-full h-full rounded-full object-cover" 
               />
             </div>
             <button 
               onClick={() => setShowSettings(true)}
               className="absolute bottom-0 right-0 bg-[#E5A93D] hover:bg-[#d49931] p-1.5 sm:p-2 rounded-full border-2 border-[#121212] shadow-md transition-transform active:scale-95"
               title="Réglages"
             >
               <Settings size={13} className="text-black font-bold" />
             </button>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={handleShare}
              className="bg-zinc-800/80 hover:bg-zinc-800 active:scale-95 text-zinc-200 px-3 py-2 rounded-xl transition-all border border-zinc-700/50 flex items-center gap-1.5 text-xs font-semibold"
            >
              {shareCopied ? <CheckCircle2 size={15} className="text-emerald-400" /> : <Share2 size={15} />}
              <span>{shareCopied ? 'Copié !' : 'Partager'}</span>
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="bg-zinc-800/80 hover:bg-zinc-800 active:scale-95 text-zinc-200 px-3 py-2 rounded-xl transition-all border border-zinc-700/50 flex items-center gap-1.5 text-xs font-semibold"
            >
              <Settings size={15} className="text-[#E5A93D]" />
              <span>Réglages</span>
            </button>
          </div>
        </div>
        
        <h1 className="text-3xl font-black tracking-tight text-white flex items-center justify-between">
          <span>{user?.displayName || (user?.email?.split('@')[0]) || 'Utilisateur'}</span>
        </h1>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <p className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
            <Calendar size={13} className="text-[#E5A93D]" /> Membre depuis {creationYear}
          </p>
          <SeenItLogo variant="badge" />
        </div>
      </div>

      {/* 2. TAB SELECTOR */}
      <div className="px-4 pb-4">
        <div className="flex bg-zinc-900/80 rounded-xl p-1 border border-white/5">
           <button 
             onClick={() => setActiveTab('stats')}
             className={cn("flex-1 text-sm font-bold py-2 rounded-lg transition-colors cursor-pointer", activeTab === 'stats' ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500")}
           >
             Statistiques
           </button>
           <button 
             onClick={() => setActiveTab('library')}
             className={cn("flex-1 text-sm font-bold py-2 rounded-lg transition-colors cursor-pointer", activeTab === 'library' ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-500")}
           >
             Ma Liste
           </button>
        </div>
      </div>

      {/* 3. CONTENT */}
      {activeTab === 'stats' ? (
        <div className="px-4 pb-2">
          <ProAnalyticsDashboard shows={shows} onPersonClick={openPersonModal} />
        </div>
      ) : (
        <div className="flex-1 pb-2 flex flex-col">
          <LibraryScreen onShowClick={(id, mediaType) => onShowClick && onShowClick(id, mediaType)} isEmbedded={true} />
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
      {showSettings && (
        <div 
          className={cn(
            "fixed inset-0 bg-black z-50 flex flex-col transition-transform duration-300 ease-out",
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
          <div className="flex items-center justify-between pt-10 pb-3.5 px-4 border-b border-white/10 bg-zinc-950/90 backdrop-blur-md sticky top-0 z-10">
            <button 
              onClick={handleAnimatedBackSettings} 
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white font-medium text-sm transition-colors"
            >
              <ArrowLeft size={18} />
              <span>Retour</span>
            </button>
            <span className="text-sm font-bold text-white">Réglages</span>
            <div className="w-12" />
          </div>
          <SettingsScreen />
        </div>
      )}
    </div>
  );
}
