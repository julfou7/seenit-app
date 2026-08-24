import { useSyncStore } from '../store/syncStore';
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

export function SyncStatusIndicator() {
  const syncStatus = useSyncStore(state => state.syncStatus);
  const plexSyncStatus = useSyncStore(state => state.plexSyncStatus);
  const isQuotaExceeded = useSyncStore(state => state.isQuotaExceeded);

  if (isQuotaExceeded) {
    return (
      <div 
        className="flex items-center gap-1.5 bg-red-500/10 text-red-400 px-2.5 py-1.5 rounded-xl border border-red-500/20 text-[10px] font-bold tracking-tight max-w-[150px] xs:max-w-[180px] sm:max-w-[280px] min-w-0 overflow-hidden"
        title="Quota Firestore atteint. Le synchronisateur est en pause."
      >
        <AlertTriangle size={12} className="shrink-0 text-red-400" />
        <span className="line-clamp-2 leading-tight break-words text-left min-w-0 flex-1">Quota Firestore atteint</span>
      </div>
    );
  }

  if (syncStatus) {
    return (
      <div 
        className="flex items-center gap-1.5 bg-[#E5A93D]/10 text-[#E5A93D] px-2.5 py-1.5 rounded-xl border border-[#E5A93D]/20 text-[10px] font-bold tracking-tight max-w-[180px] xs:max-w-[220px] sm:max-w-[320px] min-w-0 overflow-hidden animate-pulse"
        title={`Synchronisation en cours de "${syncStatus.current}" (${syncStatus.pending} restants)`}
      >
        <Loader2 size={12} className="animate-spin shrink-0" />
        <span className="line-clamp-2 leading-tight break-words text-left min-w-0 flex-1">Synchronisation ({syncStatus.pending})</span>
      </div>
    );
  }

  if (plexSyncStatus) {
    const isCompleted = plexSyncStatus.message.toLowerCase().includes('terminé') || 
                        plexSyncStatus.message.toLowerCase().includes('à jour');

    return (
      <div 
        className={`flex items-center gap-1.5 xs:gap-2 bg-zinc-900/95 text-zinc-200 px-2 py-1 xs:px-2.5 xs:py-1.5 rounded-xl border ${
          isCompleted ? 'border-emerald-500/40' : 'border-amber-500/40 animate-pulse'
        } text-[10px] xs:text-[11px] font-bold tracking-tight max-w-[220px] xs:max-w-[270px] sm:max-w-[380px] min-w-0 overflow-hidden shadow-md shadow-black/50 transition-colors duration-300`}
        title={plexSyncStatus.message}
      >
        {/* Solid Opaque Plex Badge */}
        <div className={`w-4 h-4 xs:w-5 xs:h-5 rounded-md ${isCompleted ? 'bg-emerald-500' : 'bg-[#E5A93D]'} text-zinc-950 flex items-center justify-center font-black shadow-sm shrink-0 transition-colors duration-300`}>
          <svg viewBox="0 0 24 24" className="w-3 h-3 xs:w-3.5 xs:h-3.5 fill-zinc-950">
            <path d="M4 2h7.5l7.5 10-7.5 10H4l7.5-10L4 2z" />
          </svg>
        </div>
        
        <div className="flex items-center gap-1 xs:gap-1.5 min-w-0 flex-1 overflow-hidden">
          {isCompleted ? (
            <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
          ) : (
            <Loader2 size={11} className="animate-spin text-amber-400 shrink-0" />
          )}
          <span className={`line-clamp-2 leading-tight break-words text-left font-semibold min-w-0 flex-1 ${
            isCompleted ? 'text-emerald-300' : 'text-zinc-200'
          }`}>
            {plexSyncStatus.message}
          </span>
        </div>
      </div>
    );
  }

  return null;
}




