import React, { useEffect, useRef } from 'react';
import { Archive, Trash2, Ban, Info, Clock, AlertCircle, RotateCcw, Bell, BellOff, Heart, HeartOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useToastStore, ToastMessageObj } from '../store/toastStore';
import { useShows } from '../hooks/useShows';
import { cn, scrollAllCarouselsToStart } from '../lib/utils';
import { SeenItGlyph } from './SeenItLogo';

const PlexLogo = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M4 2h7.5l7.5 10-7.5 10H4l7.5-10L4 2z" />
  </svg>
);

export function ToastContainer() {
  const { currentToast, message, type, show, visible, onUndo, hideToast } = useToastStore();
  const { updateShow } = useShows();
  const touchStartY = useRef<number | null>(null);

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
        console.error('Error undoing toast action:', err);
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
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current !== null) {
      const diff = e.changedTouches[0].clientY - touchStartY.current;
      // If swiped downwards by 25px or more, dismiss the toast
      if (Math.abs(diff) > 25) {
        hideToast();
      }
      touchStartY.current = null;
    }
  };

  const hasUndoAction = Boolean(onUndo || (type === 'archive' && show));

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
    const seasonEpisodeMatch = action.match(/S(\d+)E(\d+)/i);
    if (seasonEpisodeMatch) {
      subtitle = `S${seasonEpisodeMatch[1]} | E${seasonEpisodeMatch[2]}`;
      action = action.replace(/S\d+E\d+/i, '').trim();

      // Strip any episode title before "marqué comme..."
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

  const isDownloadToast = Boolean(
    type === 'download' ||
    rawMsgStr.toLowerCase().includes('téléchargement') ||
    rawMsgStr.toLowerCase().includes('recherche') ||
    parsed.action?.toLowerCase().includes('téléchargement') ||
    parsed.action?.toLowerCase().includes('recherche')
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

  const renderIcon = () => {
    if (isDownloadToast) {
      return <SeenItGlyph size={17} symbol="download" color="blue" glow={false} idPrefix="toast-dl" className="shrink-0" />;
    }
    if (isPlexToast) {
      return <PlexLogo className="w-4 h-4 text-[#E5A93D] shrink-0" />;
    }
    if (isReminderToast) {
      const isOff = parsed.action?.toLowerCase().includes('désactivé') || parsed.action?.toLowerCase().includes('retiré');
      return isOff ? (
        <BellOff size={14} className="shrink-0 text-amber-400" />
      ) : (
        <Bell size={14} className="shrink-0 text-amber-400 fill-amber-400" />
      );
    }
    if (isFavoriteToast) {
      const isOff = parsed.action?.toLowerCase().includes('retiré');
      return isOff ? (
        <HeartOff size={14} className="shrink-0 text-rose-500" />
      ) : (
        <Heart size={14} className="shrink-0 text-rose-500 fill-rose-500" />
      );
    }
    const iconClass = cn("shrink-0", getAccentColor());
    switch (type) {
      case 'download': return <SeenItGlyph size={17} symbol="download" color="blue" glow={false} idPrefix="toast-dl-type" className="shrink-0" />;
      case 'archive': return <Archive size={14} className={iconClass} />;
      case 'unfollow': return <Trash2 size={14} className={iconClass} />;
      case 'dropped': return <Ban size={14} className={iconClass} />;
      case 'follow': return <Clock size={14} className={iconClass} />;
      case 'success': return <SeenItGlyph size={15} symbol="check" glow={false} idPrefix="toast-seenit" className="shrink-0" />;
      case 'error': return <AlertCircle size={14} className={iconClass} />;
      default: return <Info size={14} className={iconClass} />;
    }
  };

  const hasPoster = Boolean(parsed.posterPath);
  const posterUrl = parsed.posterPath
    ? (parsed.posterPath.startsWith('http')
        ? parsed.posterPath
        : `https://image.tmdb.org/t/p/w185${parsed.posterPath.startsWith('/') ? '' : '/'}${parsed.posterPath}`)
    : null;

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
          onDragEnd={(_e, info) => {
            if (info.offset.y > 20 || info.velocity.y > 200) {
              hideToast();
            }
          }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 z-[99999] w-full max-w-md px-3 pointer-events-auto touch-pan-y select-none cursor-grab active:cursor-grabbing flex justify-center"
        >
          {hasPoster ? (
            /* Rich Media Toast with Poster */
            <div className="w-full relative overflow-hidden bg-zinc-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] flex items-stretch">
              
              {/* Full Poster on the left with gradient fade into background */}
              <div className="w-16 sm:w-20 shrink-0 relative bg-zinc-800 self-stretch min-h-[64px]">
                <img 
                  src={posterUrl!} 
                  alt={parsed.title || "Affiche"} 
                  className="w-full h-full object-cover object-center"
                />
                {/* Smooth gradient blend into the toast card */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-zinc-900/40 to-zinc-900" />
              </div>

              {/* Content Area */}
              <div className="flex-1 py-2.5 px-3 flex flex-col justify-center min-w-0">
                {/* Title + Subtitle */}
                {(parsed.title || parsed.subtitle) && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-tight mb-1">
                    {parsed.title && (
                      <span className={cn("font-bold text-[13px] sm:text-sm line-clamp-2 break-words max-w-full", getAccentColor())}>
                        {parsed.title}
                      </span>
                    )}
                    {parsed.subtitle && parsed.subtitle !== parsed.action && parsed.subtitle.length < 35 && (
                      <span className="text-[10px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded-md shrink-0">
                        {parsed.subtitle}
                      </span>
                    )}
                  </div>
                )}
                
                {/* Action Text */}
                <div className="flex items-center gap-1.5 text-zinc-300 text-xs font-normal leading-snug">
                  {renderIcon()}
                  <span className="line-clamp-2 break-words text-zinc-300 font-medium">
                    {parsed.action}
                  </span>
                </div>
              </div>

              {/* Actions Button Area */}
              {hasUndoAction && (
                <div className="flex items-center shrink-0 pr-3 py-2.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUndo();
                    }}
                    onTouchStart={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 text-xs font-bold border border-amber-500/30 shadow-sm transition-all cursor-pointer touch-manipulation select-none"
                    title="Annuler l'action"
                  >
                    <RotateCcw size={12} className="stroke-[2.5]" />
                    <span>Annuler</span>
                  </button>
                </div>
              )}

              {/* Dynamic Progress Bar */}
              <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-white/5 overflow-hidden">
                <div
                  key={currentToast?.id || (typeof message === 'string' ? message : parsed.action)}
                  className={cn(
                    "h-full w-full origin-left animate-toast-progress",
                    getProgressColor()
                  )}
                />
              </div>
            </div>
          ) : (
            /* Floating Compact Pill for Simple & System Notifications */
            <div className="relative overflow-hidden bg-zinc-900/95 backdrop-blur-2xl border border-white/15 rounded-full shadow-[0_14px_40px_rgba(0,0,0,0.85)] px-3.5 py-2 sm:px-4 sm:py-2.5 flex items-center gap-2.5 w-auto max-w-full">
              
              {/* Icon badge - Solid 100% Opaque for Plex, Amber for Reminder, Rose for Favorite */}
              {isPlexToast ? (
                <div className="w-6 h-6 rounded-full bg-[#E5A93D] text-zinc-950 flex items-center justify-center shrink-0 font-black shadow-md shadow-amber-500/20">
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-zinc-950">
                    <path d="M4 2h7.5l7.5 10-7.5 10H4l7.5-10L4 2z" />
                  </svg>
                </div>
              ) : isReminderToast ? (
                <div className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400 shadow-md shadow-amber-500/20">
                  {renderIcon()}
                </div>
              ) : isFavoriteToast ? (
                <div className="w-6 h-6 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0 text-rose-500 shadow-md shadow-rose-500/20">
                  {renderIcon()}
                </div>
              ) : (
                <div className="w-6 h-6 rounded-full bg-white/10 border border-white/10 flex items-center justify-center shrink-0 text-zinc-300">
                  {renderIcon()}
                </div>
              )}

              {/* Message text with auto-fitting width */}
              <div className="flex flex-col justify-center min-w-0">
                {parsed.title && (
                  <span className={cn("font-bold text-[12px] leading-tight line-clamp-1 mb-0.5", getAccentColor())}>
                    {parsed.title}
                  </span>
                )}
                <span className="text-zinc-100 text-[12px] sm:text-xs font-semibold leading-snug whitespace-nowrap sm:whitespace-normal line-clamp-2">
                  {parsed.action || (typeof message === 'string' ? message : '')}
                </span>
              </div>

              {/* Undo action button if present */}
              {hasUndoAction && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUndo();
                  }}
                  onTouchStart={(e) => e.stopPropagation()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 text-xs font-bold border border-amber-500/30 shadow-sm transition-all cursor-pointer shrink-0 ml-1"
                  title="Annuler"
                >
                  <RotateCcw size={11} className="stroke-[2.5]" />
                  <span>Annuler</span>
                </button>
              )}

              {/* Dynamic Progress Bar along bottom */}
              <div className="absolute bottom-0 left-4 right-4 h-[2px] bg-white/5 overflow-hidden rounded-full">
                <div
                  key={currentToast?.id || (typeof message === 'string' ? message : parsed.action)}
                  className={cn(
                    "h-full w-full origin-left animate-toast-progress",
                    getProgressColor()
                  )}
                />
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

