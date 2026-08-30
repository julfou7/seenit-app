import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Search
} from 'lucide-react';
import { type LiveDownloadItem, formatBytes } from '../services/sonarrRadarr';

interface LiveDownloadBannerProps {
  items: LiveDownloadItem[];
  compact?: boolean;
}

function getPhase(item: LiveDownloadItem) {
  const status = String(item.status || '').toLowerCase();
  const isError = status === 'error' || Boolean(item.errorMessage);
  const isWarning = status === 'warning';
  const isCompleted = status === 'completed' || item.progress >= 100;
  const isSubmitting = status === 'submitting';
  const isSearching = status === 'searching';
  const isQueued = status === 'queued' || status === 'paused';
  const isTransfer = !isError && !isWarning && !isCompleted && !isSubmitting && !isSearching && item.progress > 0;

  if (isError) return { kind: 'error' as const, label: item.statusText || 'Erreur' };
  if (isWarning) return { kind: 'warning' as const, label: item.statusText || 'Vérification en cours' };
  if (isCompleted) return { kind: 'completed' as const, label: 'Téléchargement terminé 🍿' };
  if (isSubmitting) return { kind: 'submitting' as const, label: item.statusText || 'Demande prise en compte…' };
  if (isSearching) return { kind: 'searching' as const, label: item.statusText || 'Recherche de release en cours…' };
  if (isQueued) return { kind: 'queued' as const, label: item.statusText || 'En file d’attente' };
  if (isTransfer) return { kind: 'downloading' as const, label: item.statusText || 'Téléchargement en cours' };
  return { kind: 'queued' as const, label: item.statusText || 'Préparation du téléchargement…' };
}

function PhaseIcon({ kind }: { kind: ReturnType<typeof getPhase>['kind'] }) {
  if (kind === 'error') return <AlertCircle size={14} className="text-red-400" />;
  if (kind === 'warning') return <AlertTriangle size={14} className="text-amber-400" />;
  if (kind === 'completed') return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (kind === 'submitting') return <Loader2 size={14} className="text-blue-400 animate-spin" />;
  if (kind === 'searching') return <Search size={14} className="text-cyan-400" />;
  if (kind === 'queued') return <Clock size={14} className="text-zinc-300" />;
  return <Download size={14} className="text-cyan-400" />;
}

export const LiveDownloadBanner: React.FC<LiveDownloadBannerProps> = ({ items, compact = false }) => {
  if (!items?.length) return null;

  if (compact) {
    const item = items[0];
    const phase = getPhase(item);
    const showProgress = phase.kind === 'downloading' || phase.kind === 'completed';

    return (
      <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/90 px-2.5 py-1 text-[10px] font-bold text-zinc-200 shadow-sm">
        <PhaseIcon kind={phase.kind} />
        <span className="truncate">{phase.label}</span>
        {showProgress && (
          <span className="shrink-0 text-white">{Math.min(100, Math.max(0, Math.round(item.progress || 0)))}%</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {items.map(item => {
        const phase = getPhase(item);
        const progress = Math.min(100, Math.max(0, Number(item.progress || 0)));
        const showNumericProgress = phase.kind === 'downloading' || phase.kind === 'completed';
        const showIndeterminate = phase.kind === 'submitting' || phase.kind === 'searching' || phase.kind === 'queued';
        const downloadedBytes = item.size > 0 ? Math.max(0, item.size - item.sizeleft) : 0;

        const tone = phase.kind === 'error'
          ? 'border-red-500/30 bg-red-950/20'
          : phase.kind === 'warning'
            ? 'border-amber-500/30 bg-amber-950/20'
            : phase.kind === 'completed'
              ? 'border-emerald-500/25 bg-emerald-950/15'
              : 'border-white/10 bg-zinc-900/85';

        return (
          <div key={item.id} className={`rounded-2xl border p-3.5 shadow-sm ${tone}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold text-white break-words leading-snug">
                  {item.movieTitle || item.seriesTitle || item.title}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-zinc-400">
                  {item.quality && <span>{item.quality}</span>}
                  {item.speedFormatted && phase.kind === 'downloading' && <span className="text-cyan-300">{item.speedFormatted}</span>}
                  {item.timeleft && item.timeleft !== '--' && phase.kind === 'downloading' && <span>{item.timeleft} restantes</span>}
                  {item.size > 0 && showNumericProgress && (
                    <span>{formatBytes(downloadedBytes)} / {formatBytes(item.size)}</span>
                  )}
                </div>
              </div>

              {showNumericProgress && (
                <span className={`shrink-0 text-sm font-black ${
                  phase.kind === 'completed' ? 'text-emerald-400' : 'text-cyan-300'
                }`}>
                  {Math.round(progress)}%
                </span>
              )}
            </div>

            <div className="mt-2.5 flex items-start gap-2 text-[11px] font-semibold text-zinc-300">
              <span className="mt-0.5 shrink-0"><PhaseIcon kind={phase.kind} /></span>
              <span className={phase.kind === 'error' ? 'text-red-300' : phase.kind === 'warning' ? 'text-amber-300' : ''}>
                {phase.label}
              </span>
            </div>

            {item.errorMessage && (
              <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[10px] font-semibold text-red-300">
                {item.errorMessage}
              </div>
            )}

            {showIndeterminate ? (
              <div className="mt-3 flex h-2 items-center gap-1.5" aria-label="Activité en cours">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90 animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/65 animate-pulse [animation-delay:160ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/40 animate-pulse [animation-delay:320ms]" />
              </div>
            ) : (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${
                    phase.kind === 'error'
                      ? 'bg-red-500'
                      : phase.kind === 'warning'
                        ? 'bg-amber-500'
                        : phase.kind === 'completed'
                          ? 'bg-emerald-500'
                          : 'bg-cyan-500'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
