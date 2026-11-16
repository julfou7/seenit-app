import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { type LiveDownloadItem } from '../services/sonarrRadarr';
import { assertManualReleaseSearchCurrent, grabManualArrRelease, searchManualArrReleases, type ManualReleaseCandidate, type ManualReleaseSearch } from '../services/arrManualReleases';
import { samePhysicalDownload } from '../features/downloads/downloadIdentity';
import { hasActiveDownloadInScope } from '../features/downloads/downloadSearchGuard';
import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { beginDownloadRequest, acceptDownloadRequest, failDownloadRequest, updateDownloadRequest } from '../features/downloads/downloadLifecycle';
import { describeReleases, matchesVersionFilter, type ReleaseLike, type VersionFilter } from '../features/downloads/releaseVersions';
import { ReleaseVersionCard, VersionFilterChips } from './ReleaseVersionCard';
import { commonRejections, frenchRejections, profileSwitchFor } from '../features/downloads/releaseRejections';
import { changeProgrammedQuality } from '../features/downloads/programmedCalendar';
import { notifyArrWrite } from '../store/arrSyncStore';

type AlternativeRelease = ReleaseLike & { candidate: ManualReleaseCandidate & { current: boolean }; reasons: string[] };

const code = (season: number, episode?: number) => `S${String(season).padStart(2, '0')}${episode != null ? `E${String(episode).padStart(2, '0')}` : ''}`;

/**
 * « Chercher une autre release » (À régler, Autre version). Retour terrain du 16/11 (« cet écran est un peu pourri ;
 * l'interface pourrait être la même que la recherche manuelle et une modif dans l'une s'appliquer à l'autre ») :
 * pleine page, mêmes pastilles de filtre et mêmes cartes que « Version précise » (`ReleaseVersionCard`,
 * `VersionFilterChips`) ; les versions viennent toujours de Sonarr/Radarr (recherche interactive), avec leurs
 * raisons de refus traduites, une raison commune dite une seule fois, et « Passer en 4K / 1080p » quand le profil
 * refuse la qualité.
 */
export function AlternativeReleaseModal({ item, onClose }: { item: LiveDownloadItem; onClose: () => void }) {
  const config = useDownloadConfigStore();
  const showToast = useToastStore(state => state.showToast);
  const [season, setSeason] = useState(item.seasonNumber ?? 1);
  const [filter, setFilter] = useState<VersionFilter>('Toutes');
  const [open, setOpen] = useState<number | null>(null);
  const [session, setSession] = useState<ManualReleaseSearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [switching, setSwitching] = useState(false);
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
    setLoading(true); setError(''); setSession(null); setOpen(null); setSubmitted(false);
    void searchManualArrReleases({ mediaType: item.mediaType, tmdbId: Number(item.tmdbId),
      seasonNumber: item.mediaType === 'tv' ? season : undefined, episodeNumber: item.episodeNumber }, config)
      .then(result => { if (current) setSession(result); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Recherche impossible.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [item.mediaType, item.tmdbId, item.episodeNumber, season, refresh, config.radarrUrl,
    config.radarrApiKey, config.sonarrUrl, config.sonarrApiKey, config.scopeUid]);

  const preferred = /4k|2160/i.test(item.quality || '') ? '4k' : '1080p';
  const releases = useMemo<AlternativeRelease[]>(() => (session?.candidates || []).map((candidate, index) => ({
    id: index + 1, name: candidate.title, size: candidate.size, seeders: candidate.seeders, quality: candidate.quality,
    candidate: { ...candidate, current: samePhysicalDownload(item, { downloadId: candidate.infoHash }) },
    reasons: candidate.selectable ? [] : frenchRejections(candidate.rejections),
  })), [session, item]);
  const shared = useMemo(() => commonRejections(releases.map(release => release.reasons)), [releases]);
  const versions = useMemo(() => describeReleases(releases, preferred), [releases, preferred]);
  const visible = versions.filter(entry => matchesVersionFilter(entry, filter));
  // Retour terrain du 16/11 (« quand je déplie, ça se replie 1 s après ») : la carte suivie se rafraîchit chaque seconde
  // pendant un téléchargement ; la conseillée n'est ouverte d'office qu'une fois par recherche, jamais à chaque rafraîchissement.
  const openedFor = useRef<ManualReleaseSearch | null>(null);
  useEffect(() => {
    if (loading || !session || openedFor.current === session) return;
    openedFor.current = session;
    setOpen(versions.find(entry => entry.release.candidate.selectable)?.release.id ?? null);
  }, [loading, session, versions]);

  const submit = async (candidate: AlternativeRelease['candidate']) => {
    if (!session || !candidate.selectable || candidate.current || inFlight.current || submitted) return;
    // Revue Codex #1070 : seuls les transferts que la version choisie couvre sont remplacés — un épisode seul n'annule
    // jamais le pack de saison ni les autres épisodes en cours ; une couverture inconnue n'annule rien.
    const covers = (download: LiveDownloadItem) => item.mediaType === 'movie' || candidate.episodes === 'season'
      || (download.episodeNumber != null && Array.isArray(candidate.episodes) && candidate.episodes.includes(Number(download.episodeNumber)));
    const replaced = useLiveDownloadStore.getState().downloads.filter(download => hasActiveDownloadInScope([download], session.scope) && covers(download));
    try { assertManualReleaseSearchCurrent(session); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Relance la recherche.'); return; }
    inFlight.current = true; setSending(true); setSubmitted(true); setError('');
    // Retour terrain du 16/11 (« fichier beaucoup trop gros, je veux une version plus légère alors que le DL a commencé ») :
    // un téléchargement en cours est remplacé — la nouvelle version est envoyée d'abord, l'ancien transfert n'est
    // annulé qu'ensuite (un envoi en échec laisse l'ancien continuer).
    if (replaced.length) {
      try {
        await grabManualArrRelease(session, candidate.key, crypto.randomUUID());
      } catch (cause) {
        if (mounted.current) setError(`${cause instanceof Error ? cause.message : 'Envoi impossible.'} Le téléchargement en cours continue.`);
        inFlight.current = false; if (mounted.current) setSending(false);
        return;
      }
      // Revue Codex #1070 : chaque annulation est vérifiée ; un ancien transfert resté actif est signalé, jamais caché.
      let kept = 0;
      for (const download of replaced) if (!(await useLiveDownloadStore.getState().removeDownload(download))) kept++;
      // Revue Codex #1070 : le remplaçant est suivi comme tout envoi, mais seulement une fois l'ancien annulé — sinon la
      // demande rejoindrait l'ancienne carte (même titre) et lui prêterait le nouvel infohash.
      if (!kept) {
        const requestId = beginDownloadRequest({ title: item.movieTitle || item.seriesTitle || item.title,
          mediaType: item.mediaType, tmdbId: item.tmdbId, posterPath: item.posterPath, backdropPath: item.backdropPath,
          seasonNumber: session.scope.seasonNumber, episodeNumber: session.scope.episodeNumber,
          downloadClient: item.mediaType === 'movie' ? 'Radarr' : 'Sonarr', releaseTitle: candidate.title });
        updateDownloadRequest(requestId, { quality: candidate.quality, downloadId: candidate.infoHash });
        acceptDownloadRequest(requestId, 'Version choisie envoyée au client', 'queued');
      }
      showToast({ title: item.movieTitle || item.seriesTitle || item.title, action: kept
        ? 'Nouvelle version envoyée, mais l’ancien téléchargement n’a pas pu être annulé : annule-le dans « En cours ».'
        : 'Version remplacée : l’ancien téléchargement est annulé.', posterPath: item.posterPath }, kept ? 'error' : 'success');
      void useLiveDownloadStore.getState().fetchDownloads();
      inFlight.current = false;
      if (mounted.current) { setSending(false); onClose(); }
      return;
    }
    const requestId = beginDownloadRequest({ title: item.movieTitle || item.seriesTitle || item.title,
      mediaType: item.mediaType, tmdbId: item.tmdbId, posterPath: item.posterPath, backdropPath: item.backdropPath,
      seasonNumber: session.scope.seasonNumber, episodeNumber: session.scope.episodeNumber,
      downloadClient: item.mediaType === 'movie' ? 'Radarr' : 'Sonarr', releaseTitle: candidate.title });
    updateDownloadRequest(requestId, { quality: candidate.quality, downloadId: candidate.infoHash });
    try {
      await grabManualArrRelease(session, candidate.key, requestId);
      acceptDownloadRequest(requestId, 'Version choisie envoyée au client', 'queued');
      showToast('Version choisie envoyée au client', 'success');
      if (mounted.current) onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Résultat du lancement inconnu.';
      failDownloadRequest(requestId, message);
      if (mounted.current) setError(`${message} Vérifie le client avant de relancer : l’envoi a pu aboutir.`);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  };

  // Retour du 16/11 : changer la qualité depuis cet écran — le profil 4K ou 1080p de SeenIt est appliqué au film ou à
  // la série (comme « Changer la qualité » de Programmés), puis la recherche est relancée.
  const switchQuality = async (preference: '4k' | '1080p') => {
    if (!session?.target || switching) return;
    setSwitching(true); setError('');
    try {
      await changeProgrammedQuality(useDownloadConfigStore.getState(), session.target, preference);
      // Revue Codex #1068 : Programmés et la présence de la fiche relisent la nouvelle qualité (comme le menu ⋯).
      notifyArrWrite({ tmdbId: item.tmdbId, tvdbId: item.tvdbId, mediaType: item.mediaType });
      showToast({ title: item.movieTitle || item.seriesTitle || item.title, action: `Qualité : ${preference === '4k' ? '4K' : '1080p'}`, posterPath: item.posterPath }, 'success');
      if (mounted.current) setRefresh(value => value + 1);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Qualité inchangée.');
    } finally {
      if (mounted.current) setSwitching(false);
    }
  };

  const title = item.movieTitle || item.seriesTitle || item.title;
  const scopeLabel = item.mediaType === 'tv' ? code(season, item.episodeNumber ?? undefined) : 'Film';
  const busy = sending || switching;
  return <DialogLayer onDismiss={onClose} canDismiss={!sending} label="Autre version" role="dialog" data-alternative-release
    className="fixed inset-0 z-[180] max-w-md mx-auto bg-[#0B0B0D] text-white flex flex-col">
    <header className="shrink-0 flex items-center gap-1 px-2 pt-[calc(var(--seenit-safe-area-top,env(safe-area-inset-top,0px))+6px)] pb-2">
      <button type="button" onClick={onClose} disabled={sending} aria-label="Retour" className="w-11 h-11 grid place-items-center rounded-full text-zinc-100 active:bg-white/10"><ChevronLeft size={26} /></button>
      <div className="min-w-0 leading-tight">
        <h2 className="text-[19px] font-extrabold">Autre version</h2>
        <p className="truncate text-[13px] text-zinc-400"><span className="seenit-media-title font-bold">{title}</span> · {scopeLabel}</p>
      </div>
    </header>

    <div className="shrink-0 px-4 pb-3 flex flex-col gap-2">
      {/* Demande sur toute une série : la saison à comparer reste au choix. */}
      {item.mediaType === 'tv' && item.seasonNumber == null && <label className="flex items-center gap-2 text-[14px] font-bold text-zinc-300">Saison
        <input aria-label="Saison à rechercher" type="number" min={0} max={999} value={season} disabled={busy}
          onChange={event => setSeason(Math.max(0, Number(event.target.value)))} className="h-11 w-20 rounded-full bg-[#1F1F23] px-4 text-white" /></label>}
      <VersionFilterChips value={filter} onChange={label => { setFilter(label); setOpen(null); }} />
    </div>

    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] flex flex-col gap-2.5" aria-busy={loading}>
      {error && <p role="alert" className="rounded-2xl bg-rose-500/10 px-4 py-3 text-[14px] text-rose-200">{error}</p>}
      {activeInScope && !sending && <p data-active-request className="rounded-2xl bg-amber-500/10 px-4 py-3 text-[13.5px] text-amber-200">Un téléchargement est en cours pour ce titre : choisir une autre version le remplacera (l’ancien sera annulé).</p>}
      {!loading && shared.length > 0 && <p data-shared-rejections className="rounded-2xl bg-white/[0.04] px-4 py-3 text-[13.5px] text-zinc-300">Refusées par {item.mediaType === 'movie' ? 'Radarr' : 'Sonarr'} : {shared.join(' · ')}</p>}
      {loading && <p role="status" className="flex items-center gap-2 py-6 text-[14px] text-zinc-400"><Loader2 size={18} className="animate-spin" />Recherche des versions…</p>}
      {!loading && !error && !visible.length && <p className="py-6 text-[14px] text-zinc-400">{versions.length ? 'Aucune version pour ce filtre.' : 'Aucune version trouvée.'}</p>}
      {!loading && visible.map(entry => {
        const { release } = entry;
        const { candidate } = release;
        const isOpen = open === release.id;
        const own = release.reasons.filter(reason => !shared.includes(reason));
        const switchTo = session?.target && !candidate.selectable ? profileSwitchFor(candidate.rejections) : null;
        return <ReleaseVersionCard key={release.id} entry={entry} open={isOpen} onToggle={() => setOpen(isOpen ? null : release.id)}
          details={[candidate.indexer, `${candidate.seeders} source${candidate.seeders > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}>
          {candidate.current && <p className="text-[13px] text-zinc-300">Version actuelle</p>}
          {own.length > 0 && <p data-rejection className="text-[13px] text-amber-300">{own.join(' · ')}</p>}
          {switchTo && <button type="button" disabled={busy} onClick={() => void switchQuality(switchTo)} className="mt-1 h-12 rounded-[14px] bg-[#26262B] text-[15px] font-extrabold text-zinc-100 flex items-center justify-center gap-2 disabled:opacity-60">
            {switching && <Loader2 size={18} className="animate-spin" />}Passer en {switchTo === '4k' ? '4K' : '1080p'}
          </button>}
          <button type="button" disabled={!candidate.selectable || candidate.current || busy || submitted} onClick={() => void submit(candidate)} className="mt-1 h-12 rounded-[14px] bg-[#E5A93D] text-black text-[15px] font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40">
            {sending && <Loader2 size={18} className="animate-spin" />}{sending ? 'Envoi…' : activeInScope ? 'Remplacer par cette version' : 'Télécharger cette version'}
          </button>
        </ReleaseVersionCard>;
      })}
      {!loading && <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)} className="mt-1 h-12 rounded-[14px] text-[14.5px] font-bold text-zinc-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] active:bg-white/5">Relancer la recherche</button>}
    </div>
  </DialogLayer>;
}
