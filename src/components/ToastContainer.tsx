import React, { useEffect, useRef } from 'react';
import { Archive, Trash2, Ban, Info, Clock, AlertCircle, RotateCcw, Bell, BellOff, Heart, HeartOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToastStore, ToastMessageObj } from '../store/toastStore';
import { useShowActions } from '../hooks/useShows';
import { cn, scrollAllCarouselsToStart } from '../lib/utils';
import { SeenItGlyph } from './SeenItLogo';
import { isDownloadToastPresentation } from '../features/toasts/toastPresentation';
import { useLogStore } from '../store/logStore';
import {
  dispatchToastMediaNavigation,
  resolveToastMediaNavigationTarget,
} from '../features/toasts/toastNavigation';

const PlexLogo = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M4 2h7.5l7.5 10-7.5 10H4l7.5-10L4 2z" />
  </svg>
);

export function ToastContainer() {
  const { currentToast, queue, message, type, show, visible, onUndo, hideToast, clearQueuedScope } = useToastStore();
  const { updateShow } = useShowActions();
  const touchStartY = useRef<number | null>(null);
  const didDragRef = useRef(false);

  useEffect(() => {
    if (visible) {
      const duration = currentToast?.duration || 5000;
      const timer = setTimeout(() => {
        hideToast();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, currentToast?.id, hideToast]);

  const handleUndo = async () => {
    if (onUndo) {
      try {
        await onUndo();
        scrollAllCarouselsToStart();
      } catch (err) {
        useLogStore.getState().addLog(
          'system',
          "Impossible d'annuler l'action du toast",
          err,
          'error',
        );
      }
      hideToast();
    } else if (type === 'archive' && show?.id) {
      await updateShow(show.id, {
        isArchived: false,
        updatedAt: Date.now(),
        lastWatchedAt: Date.now()
      });
      scrollAllCarouselsToStart();
      hideToast();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    didDragRef.current = false;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current !== null) {
      const diff = e.changedTouches[0].clientY - touchStartY.current;
      if (Math.abs(diff) > 5) {
        didDragRef.current = true;
      }
      // If swiped downwards by 25px or more, dismiss the toast
      if (diff > 25) {
        hideToast();
      }
      touchStartY.current = null;
    }
  };

  const hasUndoAction = Boolean(onUndo || (type === 'archive' && show));
  const queuedPlexCount = currentToast?.scope === 'plex'
    ? queue.filter((item) => item.scope === 'plex').length
    : 0;
  const canSkipPlexQueue = queuedPlexCount > 0;
  const navigationTarget = resolveToastMediaNavigationTarget(currentToast);

  const handleSkipFollowingPlexToasts = () => {
    clearQueuedScope('plex');
  };

  const handleToastNavigation = () => {
    if (!navigationTarget) return;
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }

    dispatchToastMediaNavigation(navigationTarget);
    hideToast();
  };

  const handleToastNavigationKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!navigationTarget || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToastNavigation();
    }
  };

  // Parse the message into structured data
  const getParsedMessage = (): ToastMessageObj => {
    if (typeof message === 'object') {
      return message;
    }

    let title = show?.title;
    let action = message;
    let subtitle = undefined;

    // Try to extract title between guillemets if present
    const match = message.match(/«\s*(.+?)\s*»\s*(.*)/);
    if (match) {
      title = match[1]?.trim();
      action = match[2]?.trim();
    } else if (show && message.includes(show.title)) {
      title = show.title;
      action = message.replace(show.title, '').trim();
    }

    // Try to extract SXXEXX pattern for subtitle
    const seasonEpisodeMatch = action.match(/S(\d+)\s*[·|]?\s*E(\d+)/i);
    if (seasonEpisodeMatch) {
      subtitle = `S${seasonEpisodeMatch[1]} | E${seasonEpisodeMatch[2]}`;
      action = action.replace(/S\d+\s*[·|]?\s*E\d+/i, '').trim();

      // Strip the episode title before "marqué comme..."
      const verbMatch = action.match(/(marqué[e]?\s+comme\s+.*)$/i);
      if (verbMatch) {
        action = verbMatch[1].trim();
      }
    }

    // Clean up leading punctuation or leftover characters and emojis
    action = action.replace(/^[🔔🔕🎉❤️•\-\–\—:]\s*/, '').trim();

    // Clean up dangling prepositions left over after stripping title / episode (e.g. "Rappel activé pour")
    if (/rappel\s+activ[eé]/i.test(action)) {
      action = 'Rappel activé';
    } else if (/rappel\s+(retir[eé]|d[eé]sactiv[eé])/i.test(action)) {
      action = 'Rappel désactivé';
    } else if (/favori/i.test(action)) {
      if (/retir[eé]/i.test(action)) {
        action = 'Retirée des favoris';
      } else {
        action = 'Ajoutée aux favoris (Toutes les notifs activées)';
      }
    } else {
      action = action.replace(/\s+(pour|de|du|sur)\s*$/i, '').trim();
    }

    // Capitalize first letter of action if it's lowercased
    if (action && action.length > 0) {
      action = action.charAt(0).toUpperCase() + action.slice(1);
    }

    return {
      title,
      subtitle,
      action,
      posterPath: show?.posterPath
    };
  };

  const parsed = getParsedMessage();

  const rawMsgStr = typeof message === 'string' ? message : (parsed.action || '');
  const isPlexToast = Boolean(
    currentToast?.scope === 'plex' ||
    rawMsgStr.toLowerCase().includes('plex') ||
    parsed.action?.toLowerCase().includes('plex') ||
    parsed.title?.toLowerCase().includes('plex')
  );

  const isReminderToast = Boolean(
    type === 'reminder' ||
    rawMsgStr.toLowerCase().includes('rappel') ||
    parsed.action?.toLowerCase().includes('rappel')
  );

  const isFavoriteToast = Boolean(
    type === 'favorite' ||
    rawMsgStr.toLowerCase().includes('favori') ||
    parsed.action?.toLowerCase().includes('favori')
  );

  const isDownloadToast = isDownloadToastPresentation(
    type,
    rawMsgStr,
    parsed.action,
    parsed.title,
  );

  const getAccentColor = () => {
    if (isDownloadToast) return 'text-sky-400';
    if (isPlexToast) return 'text-[#E5A93D]';
    if (isReminderToast) return 'text-amber-400';
    if (isFavoriteToast) return 'text-rose-500';
    switch (type) {
      case 'download': return 'text-sky-400';
      case 'success': return 'text-[#E5A93D]';
      case 'unfollow': return 'text-rose-400';
      case 'dropped': return 'text-amber-400';
      case 'follow': return 'text-sky-400';
      case 'archive': return 'text-zinc-300';
      case 'error': return 'text-rose-500';
      case 'reminder': return 'text-amber-400';
      case 'favorite': return 'text-rose-500';
      default: return 'text-[#E5A93D]';
    }
  };

  const getProgressColor = () => {
    if (isDownloadToast) return 'bg-sky-500';
    if (isPlexToast) return 'bg-[#E5A93D]';
    if (isReminderToast) return 'bg-amber-500';
    if (isFavoriteToast) return 'bg-rose-500';
    switch (type) {
      case 'download': return 'bg-sky-500';
      case 'archive': return 'bg-zinc-500';
      case 'dropped': return 'bg-amber-500';
      case 'follow': return 'bg-sky-500';
      case 'unfollow': return 'bg-rose-500';
      case 'success': return 'bg-[#E5A93D]';
      case 'error': return 'bg-rose-500';
      case 'reminder': return 'bg-amber-500';
      case 'favorite': return 'bg-rose-500';
      default: return 'bg-[#E5A93D]';
    }
  };

  const renderIcon = (size = 14) => {
    const glyph = size + 3;
    if (parsed.iconSymbol) {
      return (
        <SeenItGlyph
          size={glyph}
          symbol={parsed.iconSymbol}
          color="gold"
          glow={false}
          idPrefix={`toast-tab-${parsed.iconSymbol}`}
          className="shrink-0"
        />
      );
    }
    if (isDownloadToast) {
      return <SeenItGlyph size={glyph} symbol="download" color="blue" glow={false} idPrefix="toast-dl" className="shrink-0" />;
    }
    if (isPlexToast) {
      return <PlexLogo className={cn('shrink-0 text-[#E5A93D]', size > 14 ? 'w-6 h-6' : 'w-4 h-4')} />;
    }
    if (isReminderToast) {
      const isOff = parsed.action?.toLowerCase().includes('désactivé') || parsed.action?.toLowerCase().includes('retiré');
      return isOff ? (
        <BellOff size={size} className="shrink-0 text-amber-400" />
      ) : (
        <Bell size={size} className="shrink-0 text-amber-400 fill-amber-400" />
      );
    }
    if (isFavoriteToast) {
      const isOff = parsed.action?.toLowerCase().includes('retiré');
      return isOff ? (
        <HeartOff size={size} className="shrink-0 text-rose-500" />
      ) : (
        <Heart size={size} className="shrink-0 text-rose-500 fill-rose-500" />
      );
    }
    const iconClass = cn("shrink-0", getAccentColor());
    switch (type) {
      case 'download': return <SeenItGlyph size={glyph} symbol="download" color="blue" glow={false} idPrefix="toast-dl-type" className="shrink-0" />;
      case 'archive': return <Archive size={size} className={iconClass} />;
      case 'unfollow': return <Trash2 size={size} className={iconClass} />;
      case 'dropped': return <Ban size={size} className={iconClass} />;
      case 'follow': return <Clock size={size} className={iconClass} />;
      case 'success': return <SeenItGlyph size={size + 1} symbol="check" glow={false} idPrefix="toast-seenit" className="shrink-0" />;
      case 'error': return <AlertCircle size={size} className={iconClass} />;
      default: return <Info size={size} className={iconClass} />;
    }
  };

  // #878 : bande gauche teintée selon l'action quand le toast ne vise pas un média.
  const getBandClass = () => {
    if (parsed.iconSymbol || isPlexToast || isReminderToast || type === 'success') return 'bg-[#3A2C10]';
    if (isDownloadToast || type === 'download' || type === 'follow') return 'bg-[#0E2A3A]';
    if (type === 'error' || isFavoriteToast || type === 'unfollow') return 'bg-[#3F1820]';
    return 'bg-[#26262B]';
  };

  const hasPoster = Boolean(parsed.posterPath);
  const posterUrl = parsed.posterPath
    ? (parsed.posterPath.startsWith('http')
        ? parsed.posterPath
        : `https://image.tmdb.org/t/p/w185${parsed.posterPath.startsWith('/') ? '' : '/'}${parsed.posterPath}`)
    : null;
  // Le titre d'un média reste en or (SEENIT-UX-020) ; un titre système reste blanc.
  const isMediaTitle = Boolean(hasPoster || show || navigationTarget);
  const displayTitle = parsed.title && isPlexToast ? parsed.title.replace(/^PLEX\s*•\s*/i, '') : parsed.title;
  const detail = (parsed.action || (typeof message === 'string' ? message : '')).replace(/\s*\n+\s*/g, ' · ');
  const episodeBand = parsed.subtitle?.replace(/S(\d+)\s*\|\s*E(\d+)/i, (_m, season: string, episode: string) => `S${season.padStart(2, '0')}E${episode.padStart(2, '0')}`);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          id="toast-notification-wrapper"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.92, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', damping: 26, stiffness: 380 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.05, bottom: 0.8 }}
          onPointerDown={() => {
            didDragRef.current = false;
          }}
          onDragStart={() => {
            didDragRef.current = true;
          }}
          onDragEnd={(_e, info) => {
            if (info.offset.y > 20 || info.velocity.y > 200) {
              hideToast();
            }
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClick={handleToastNavigation}
          onKeyDown={handleToastNavigationKeyDown}
          role={navigationTarget ? 'button' : undefined}
          tabIndex={navigationTarget ? 0 : undefined}
          aria-label={navigationTarget ? `Ouvrir la fiche ${parsed.title || show?.title || ''}`.trim() : undefined}
          className={cn(
            "fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 z-[99999] w-full max-w-md px-3 pointer-events-auto touch-pan-x select-none active:cursor-grabbing flex justify-center",
            navigationTarget ? "cursor-pointer" : "cursor-grab",
          )}
        >
          {/* #878 : une seule forme, taille fixe (76 px), quel que soit le message. */}
          <div data-toast-card className="seenit-toast w-full relative overflow-hidden h-[76px] min-h-[64px] bg-zinc-900/95 backdrop-blur-xl rounded-[18px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_16px_40px_rgba(0,0,0,0.8)] flex items-stretch">

            {/* Bande gauche de 56 px : affiche du média, sinon couleur et icône de l'action. */}
            {hasPoster ? (
              <div className="w-14 shrink-0 relative bg-zinc-800 self-stretch">
                <img src={posterUrl!} alt="" className="w-full h-full object-cover object-center" />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent from-40% to-zinc-900" />
                {episodeBand && episodeBand.length < 12 && (
                  <span className="absolute inset-x-0 bottom-0 h-[18px] grid place-items-center bg-black/80 text-[10px] font-extrabold tracking-wide text-amber-300">{episodeBand}</span>
                )}
              </div>
            ) : (
              <div className={cn('w-14 shrink-0 grid place-items-center self-stretch', getBandClass())} aria-hidden="true">
                {renderIcon(22)}
              </div>
            )}

            {/* Texte : titre sur deux lignes au plus, détail sur une ligne. */}
            <div className="flex-1 py-2.5 pl-3 pr-2.5 flex flex-col justify-center min-w-0 gap-0.5">
              {displayTitle ? (
                <>
                  <span className={cn('text-[15px] leading-tight font-extrabold line-clamp-2 break-words', isMediaTitle ? 'text-[#F2C36B]' : 'text-zinc-100')}>
                    {displayTitle}
                  </span>
                  {detail && (
                    <span className="flex items-center gap-1.5 min-w-0 text-[13.5px] font-semibold text-zinc-200">
                      {hasPoster && renderIcon()}
                      <span className="truncate">{detail}</span>
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[15px] leading-tight font-extrabold text-zinc-100 line-clamp-2 break-words">{detail}</span>
              )}
            </div>

            {/* Un seul bouton de 104 px : Annuler, sinon Ignorer les suivants (file Plex). */}
            {(hasUndoAction || canSkipPlexQueue) && (
              <div className="flex items-center gap-1.5 shrink-0 ml-auto pr-3">
                {hasUndoAction ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUndo();
                    }}
                    onTouchStart={(e) => e.stopPropagation()}
                    className="w-[104px] h-11 flex items-center justify-center gap-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 text-sm font-extrabold shadow-[inset_0_0_0_1px_rgba(245,158,11,0.3)] transition-all cursor-pointer touch-manipulation select-none"
                    title="Annuler l'action"
                  >
                    <RotateCcw size={15} className="stroke-[2.5]" />
                    <span>Annuler</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSkipFollowingPlexToasts();
                    }}
                    onTouchStart={(e) => e.stopPropagation()}
                    className="w-[104px] h-11 px-2 rounded-xl bg-white/8 hover:bg-white/12 active:scale-95 text-zinc-100 text-[12.5px] leading-tight font-bold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] transition-all cursor-pointer touch-manipulation select-none"
                    title={`Ignorer ${queuedPlexCount} notification(s) Plex suivante(s)`}
                  >
                    Ignorer les suivants
                  </button>
                )}
              </div>
            )}

            {/* Barre de temps : la couleur de l'action, jamais le titre. */}
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/5 overflow-hidden">
              <div
                key={currentToast?.id || (typeof message === 'string' ? message : parsed.action)}
                className={cn(
                  "h-full w-full origin-left animate-toast-progress",
                  getProgressColor()
                )}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
