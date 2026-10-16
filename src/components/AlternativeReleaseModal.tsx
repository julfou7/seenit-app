import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { formatBytes, type LiveDownloadItem } from '../services/sonarrRadarr';
import { assertManualReleaseSearchCurrent, grabManualArrRelease, searchManualArrReleases, type ManualReleaseSearch } from '../services/arrManualReleases';
import { samePhysicalDownload } from '../features/downloads/downloadIdentity';
import { hasActiveDownloadInScope } from '../features/downloads/downloadSearchGuard';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { beginDownloadRequest, acceptDownloadRequest, failDownloadRequest, updateDownloadRequest } from '../features/downloads/downloadLifecycle';

export function AlternativeReleaseModal({ item, onClose }: { item: LiveDownloadItem; onClose: () => void }) {
  const config = useDownloadConfigStore();
  const showToast = useToastStore(state => state.showToast);
  const [season, setSeason] = useState(item.seasonNumber ?? 1);
  const [audioFilter, setAudioFilter] = useState<'all' | 'vff' | 'vfq'>('all');
  const [session, setSession] = useState<ManualReleaseSearch | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const activeInScope = useLiveDownloadStore(state => hasActiveDownloadInScope(state.downloads,
    { mediaType: item.mediaType, tmdbId: item.tmdbId, seasonNumber: item.mediaType === 'tv' ? season : undefined,
      episodeNumber: item.episodeNumber }));
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setSession(null); setSelectedKey(''); setSubmitted(false);
    void searchManualArrReleases({ mediaType: item.mediaType, tmdbId: Number(item.tmdbId),
      seasonNumber: item.mediaType === 'tv' ? season : undefined, episodeNumber: item.episodeNumber }, config)
      .then(result => { if (current) setSession(result); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Recherche impossible.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [item.mediaType, item.tmdbId, item.episodeNumber, season, refresh, config.radarrUrl,
    config.radarrApiKey, config.sonarrUrl, config.sonarrApiKey, config.scopeUid]);
  const candidates = (session?.candidates || []).filter(candidate => audioFilter === 'all' || candidate.audio[audioFilter])
    .map(candidate => ({ ...candidate, current: samePhysicalDownload(item, { downloadId: candidate.infoHash }) }));
  const selected = candidates.find(candidate => candidate.key === selectedKey);
  const submit = async () => {
    if (!session || !selected?.selectable || selected.current || inFlight.current || submitted) return;
    if (hasActiveDownloadInScope(useLiveDownloadStore.getState().downloads, session.scope)) {
      setError('Une demande est déjà en cours pour ce média. Attendez sa fin ou annulez-la avant de choisir une autre release.');
      return;
    }
    try { assertManualReleaseSearchCurrent(session); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Rouvrez la recherche.'); return; }
    inFlight.current = true; setSending(true); setSubmitted(true); setError('');
    const requestId = beginDownloadRequest({ title: item.movieTitle || item.seriesTitle || item.title,
      mediaType: item.mediaType, tmdbId: item.tmdbId, posterPath: item.posterPath, backdropPath: item.backdropPath,
      seasonNumber: session.scope.seasonNumber, episodeNumber: session.scope.episodeNumber,
      downloadClient: item.mediaType === 'movie' ? 'Radarr' : 'Sonarr', releaseTitle: selected.title });
    updateDownloadRequest(requestId, { quality: selected.quality, downloadId: selected.infoHash });
    try {
      await grabManualArrRelease(session, selected.key, requestId);
      acceptDownloadRequest(requestId, 'Release choisie envoyée au client', 'queued');
      showToast('Release choisie envoyée au client', 'success');
      if (mounted.current) onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Résultat du lancement inconnu.';
      failDownloadRequest(requestId, message);
      if (mounted.current) setError(`${message} Vérifiez le client avant de refaire une recherche : l’envoi a pu aboutir.`);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  };
  return (
    <DialogLayer label="Chercher une autre release" onDismiss={onClose} canDismiss={!sending}
      className="fixed inset-0 flex items-end justify-center bg-black/80 p-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))] sm:items-center"
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget && !sending) onClose(); }}>
      <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121216] text-white">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0"><h2 className="text-lg font-bold">Chercher une autre release</h2>
            <p className="mt-1 text-sm text-[#E5A93D]">{item.movieTitle || item.seriesTitle || item.title}</p>
            {item.mediaType === 'tv' && <p className="mt-1 text-xs text-zinc-300">Saison {season}{item.episodeNumber != null ? ` · Épisode ${item.episodeNumber}` : ''}</p>}
            <p className="mt-1 text-xs text-zinc-400">Comparer les versions, puis choisir celle à télécharger.</p></div>
          <button type="button" aria-label="Fermer" disabled={sending} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5"><X size={20} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          {item.mediaType === 'tv' && item.seasonNumber == null && <label className="flex items-center gap-2 text-sm">Saison
            <input aria-label="Saison à rechercher" type="number" min={0} max={999} value={season} disabled={sending}
              onChange={event => setSeason(Math.max(0, Number(event.target.value)))} className="h-11 w-16 rounded-lg bg-zinc-800 px-2" /></label>}
          <select aria-label="Filtrer les versions audio" value={audioFilter} disabled={sending}
            onChange={event => { setAudioFilter(event.target.value as typeof audioFilter); setSelectedKey(''); }}
            className="h-11 rounded-lg bg-zinc-800 px-3 text-sm"><option value="all">Toutes les versions</option><option value="vff">VFF</option><option value="vfq">VFQ</option></select>
          <button type="button" disabled={loading || sending} onClick={() => setRefresh(value => value + 1)}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-white/5 px-3 text-sm"><Search size={16} />Rechercher</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={loading}>
          {error && <p role="alert" className="mb-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          {loading ? <p role="status" className="flex items-center gap-2 p-4 text-sm text-zinc-300"><Loader2 size={18} className="animate-spin" />Recherche des releases…</p>
            : !error && candidates.length === 0 ? <p className="p-4 text-sm text-zinc-400">Aucune release pour ce filtre. Essayez toutes les versions ou relancez la recherche.</p>
              : candidates.map(candidate => <label key={candidate.key} className={`mb-2 block rounded-xl border p-3 ${selectedKey === candidate.key ? 'border-[#E5A93D] bg-[#E5A93D]/10' : 'border-white/10 bg-white/[0.03]'}`}>
                <div className="flex items-start gap-3"><input type="radio" name="alternative-release" aria-label={candidate.title}
                  checked={selectedKey === candidate.key} disabled={!candidate.selectable || candidate.current || sending || submitted} onChange={() => setSelectedKey(candidate.key)} className="mt-1 h-5 w-5 shrink-0 accent-[#E5A93D]" />
                  <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{candidate.title}</p>
                    <p className="mt-2 text-xs font-bold text-cyan-300">{candidate.audio.label || 'Audio non précisé'} · {candidate.quality || 'Qualité non précisée'}</p>
                    <p className="mt-1 text-xs text-zinc-400">{formatBytes(candidate.size)} · {candidate.seeders} seeders{candidate.indexer ? ` · ${candidate.indexer}` : ''}</p>
                    {candidate.current && <p className="mt-2 text-xs text-zinc-300">Version actuelle</p>}
                    {!candidate.selectable && <p className="mt-2 text-xs text-amber-300">{candidate.rejections.join(' · ') || 'Refusée par le client'}</p>}
                  </div></div></label>)}
        </div>
        <div className="border-t border-white/10 p-3">
          {activeInScope && !sending && <p className="mb-2 text-xs text-amber-300">Une demande est déjà en cours. Attendez sa fin ou annulez-la avant un autre envoi.</p>}
          {selected && <p className="mb-2 break-words text-xs text-zinc-400">Choix : {selected.title}</p>}
          <button type="button" disabled={!selected?.selectable || selected.current || activeInScope || loading || sending || submitted} onClick={() => void submit()}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E5A93D] px-3 text-sm font-bold text-black disabled:opacity-40">
            {sending && <Loader2 size={16} className="animate-spin" />}{sending ? 'Envoi…' : 'Télécharger cette release'}</button>
        </div>
      </div>
    </DialogLayer>
  );
}
