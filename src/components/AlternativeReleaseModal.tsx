import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { ReleaseVersionCard, VersionFilterChips, VersionPageHeader } from './ReleaseVersionCard';
import { autoProfileSwitchFor, commonRejections, frenchRejections } from '../features/downloads/releaseRejections';
import { formatBytes } from '../services/sonarrRadarr';
import { downloadGroup } from '../features/downloads/downloadGroups';
import { truncateDownloadProgressPercent } from '../features/downloads/downloadPresentation';
import { getReleaseAudio } from '../features/downloads/releaseAudio';
import { releaseVariantLabel } from '../features/downloads/releaseQuality';
import { releaseBadges } from '../features/downloads/releaseBadges';
import { changeProgrammedQuality } from '../features/downloads/programmedCalendar';
import { notifyArrWrite } from '../store/arrSyncStore';

type AlternativeRelease = ReleaseLike & { candidate: ManualReleaseCandidate & { current: boolean }; reasons: string[] };

/** Dernières recherches par titre (2 minutes) : rouvrir « Autre version » n'interroge pas de nouveau tous les indexers. */
const recentSearches = new Map<string, { at: number; session: ManualReleaseSearch }>();
const RECENT_SEARCH_MS = 2 * 60_000;

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
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const activeInScope = useLiveDownloadStore(state => hasActiveDownloadInScope(state.downloads,
    { mediaType: item.mediaType, tmdbId: item.tmdbId, seasonNumber: item.mediaType === 'tv' ? season : undefined,
      episodeNumber: item.episodeNumber }));
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const lastRefresh = useRef(refresh);
  useEffect(() => {
    let current = true;
    const scope = { mediaType: item.mediaType, tmdbId: Number(item.tmdbId),
      seasonNumber: item.mediaType === 'tv' ? season : undefined, episodeNumber: item.episodeNumber };
    // Revue Codex #1073 : la mémoire appartient au serveur Arr (URL et clé) — jamais réutilisée après un changement de réglages.
    const key = JSON.stringify([config.scopeUid, config.radarrUrl, config.radarrApiKey, config.sonarrUrl, config.sonarrApiKey, scope]);
    // « Relancer la recherche » force toujours une nouvelle interrogation ; sinon un résultat de moins de 2 minutes sert.
    const forced = lastRefresh.current !== refresh; lastRefresh.current = refresh;
    const recent = recentSearches.get(key);
    setError(''); setOpen(null); setSubmitted(false);
    if (!forced && recent && Date.now() - recent.at < RECENT_SEARCH_MS) {
      try { assertManualReleaseSearchCurrent(recent.session); setSession(recent.session); setLoading(false); return; }
      catch { recentSearches.delete(key); }
    }
    setLoading(true); setSession(null);
    void searchManualArrReleases(scope, config)
      .then(result => { recentSearches.set(key, { at: Date.now(), session: result }); if (current) setSession(result); })
      .catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Recherche impossible.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [item.mediaType, item.tmdbId, item.episodeNumber, season, refresh, config.radarrUrl,
    config.radarrApiKey, config.sonarrUrl, config.sonarrApiKey, config.scopeUid]);

  const preferred = /4k|2160/i.test(item.quality || '') ? '4k' : '1080p';
  const releases = useMemo<AlternativeRelease[]>(() => (session?.candidates || []).map((candidate, index) => ({
    id: index + 1, name: candidate.title, size: candidate.size, seeders: candidate.seeders, quality: candidate.quality,
    candidate: { ...candidate, current: samePhysicalDownload(item, { downloadId: candidate.infoHash }) },
    // Un refus de qualité seul est levé par l'appui lui-même : ni bandeau ni avertissement pour lui.
    reasons: candidate.selectable || (session?.target && autoProfileSwitchFor(candidate.rejections)) ? [] : frenchRejections(candidate.rejections),
  })), [session, item]);
  const shared = useMemo(() => commonRejections(releases.map(release => release.reasons)), [releases]);
  const versions = useMemo(() => describeReleases(releases, preferred), [releases, preferred]);
  // La version actuelle, si la recherche la retrouve, passe en tête de liste.
  const visible = versions.filter(entry => matchesVersionFilter(entry, filter))
    .sort((a, b) => Number(b.release.candidate.current) - Number(a.release.candidate.current));
  // Retour terrain du 16/11 (« quand je déplie, ça se replie 1 s après ») : la carte suivie se rafraîchit chaque seconde
  // pendant un téléchargement ; la conseillée n'est ouverte d'office qu'une fois par recherche, jamais à chaque rafraîchissement.
  const openedFor = useRef<ManualReleaseSearch | null>(null);
  useEffect(() => {
    if (loading || !session || openedFor.current === session) return;
    openedFor.current = session;
    setOpen(versions.find(entry => entry.release.candidate.selectable)?.release.id ?? null);
  }, [loading, session, versions]);

  const autoSwitch = (candidate: ManualReleaseCandidate) => session?.target && !candidate.selectable ? autoProfileSwitchFor(candidate.rejections) : null;
  const arrName = item.mediaType === 'movie' ? 'Radarr' : 'Sonarr';

  // Retour terrain du 16/11 (« Passer en 4K ok, mais que ce soit transparent ; le clic m'oblige à revenir sur la page ») :
  // choisir une version refusée seulement pour sa qualité bascule d'abord le profil du titre, relit la même version
  // auprès de Sonarr/Radarr, puis l'envoie — un seul appui, sans quitter ni recharger l'écran.
  const submit = async (picked: AlternativeRelease['candidate']) => {
    if (!session || picked.current || inFlight.current || submitted) return;
    const switchTo = autoSwitch(picked);
    if (!picked.selectable && !switchTo) return;
    if (!switchTo || !session.target) return send(session, picked);
    inFlight.current = true; setSending(true); setError('');
    recentSearches.clear();
    let fresh: ManualReleaseSearch;
    try {
      await changeProgrammedQuality(useDownloadConfigStore.getState(), session.target, switchTo);
      // Revue Codex #1068 : Programmés et la présence de la fiche relisent la nouvelle qualité.
      notifyArrWrite({ tmdbId: item.tmdbId, tvdbId: item.tvdbId, mediaType: item.mediaType });
      fresh = await searchManualArrReleases(session.scope, useDownloadConfigStore.getState());
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Qualité inchangée.');
      inFlight.current = false; if (mounted.current) setSending(false);
      return;
    }
    inFlight.current = false;
    if (!mounted.current) return;
    setSending(false);
    const again = fresh.candidates.find(candidate => candidate.key === picked.key);
    if (!again?.selectable) {
      openedFor.current = fresh; setSession(fresh);
      setError(`Qualité passée en ${switchTo === '4k' ? '4K' : '1080p'}, mais ${arrName} refuse encore cette version${again ? ` : ${frenchRejections(again.rejections).join(' · ')}` : ' : elle n’apparaît plus dans la recherche'}.`);
      return;
    }
    return send(fresh, { ...again, current: picked.current }, `Qualité passée en ${switchTo === '4k' ? '4K' : '1080p'}`);
  };

  const send = async (session: ManualReleaseSearch, candidate: AlternativeRelease['candidate'], note = '') => {
    if (!candidate.selectable || candidate.current || inFlight.current) return;
    // Un envoi change l'état du titre : le résultat mémorisé n'est plus à jour.
    recentSearches.clear();
    const withNote = (text: string) => note ? `${note} · ${text}` : text;
    // Revue Codex #1070 : seuls les transferts que la version choisie couvre sont remplacés — un épisode seul n'annule
    // jamais le pack de saison ni les autres épisodes en cours ; une couverture inconnue n'annule rien.
    const covers = (download: LiveDownloadItem) => item.mediaType === 'movie' || candidate.episodes === 'season'
      || (download.episodeNumber != null && Array.isArray(candidate.episodes) && candidate.episodes.includes(Number(download.episodeNumber)));
    // Revue Codex #1070 : la version choisie, si elle est déjà en cours, n'est jamais annulée.
    const replaced = useLiveDownloadStore.getState().downloads.filter(download => hasActiveDownloadInScope([download], session.scope)
      && covers(download) && !(candidate.infoHash && samePhysicalDownload(download, { downloadId: candidate.infoHash })));
    // Revue Codex #1070 : une demande pas encore confiée au client ne peut pas être annulée à distance de façon prouvée.
    // (même règle que `deleteLiveDownloadItem` : seuls les transferts Sonarr, Radarr ou qBittorrent s'annulent à distance).
    if (replaced.some(download => !/^(sonarr|radarr|qbit)_/.test(download.id))) {
      setError('La demande en cours n’est pas encore chez le client : attends qu’elle apparaisse dans « En cours » pour la remplacer.');
      return;
    }
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
      showToast({ title: item.movieTitle || item.seriesTitle || item.title, action: withNote(kept
        ? 'Nouvelle version envoyée, mais l’ancien téléchargement n’a pas pu être annulé : annule-le dans « En cours ».'
        : 'Version remplacée : l’ancien téléchargement est annulé.'), posterPath: item.posterPath }, kept ? 'error' : 'success');
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
      showToast(withNote('Version choisie envoyée au client'), 'success');
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

  const title = item.movieTitle || item.seriesTitle || item.title;
  const scopeLabel = item.mediaType === 'tv' ? code(season, item.episodeNumber ?? undefined) : 'Film';
  const busy = sending;
  // Retour terrain du 16/11 (« le fichier actuel n'est pas assez mis en valeur ») : la version en cours ou téléchargée
  // est résumée en tête, avant toute autre, et sa carte dans la liste porte « Actuelle ».
  const currentGroup = downloadGroup(item);
  const currentProgress = truncateDownloadProgressPercent(Math.min(100, Math.max(0, Number(item.progress) || 0)));
  const currentFacts = [item.quality, getReleaseAudio(item.releaseTitle).label, releaseVariantLabel(item.releaseTitle),
    item.size > 0 ? formatBytes(item.size) : ''].filter(Boolean).join(' · ');
  const currentBadges = releaseBadges(item.releaseTitle || '').slice(0, 5);
  return <DialogLayer onDismiss={onClose} canDismiss={!sending} label="Autre version" role="dialog" data-alternative-release
    className="fixed inset-0 z-[180] max-w-md mx-auto bg-[#0B0B0D] text-white flex flex-col">
    <VersionPageHeader label="Autre version" title={title} scope={scopeLabel} onBack={onClose} disabled={sending} />

    <div className="shrink-0 px-4 pb-2.5 flex flex-col gap-2">
      {/* Demande sur toute une série : la saison à comparer reste au choix. */}
      {item.mediaType === 'tv' && item.seasonNumber == null && <label className="flex items-center gap-2 text-[14px] font-bold text-zinc-300">Saison
        <input aria-label="Saison à rechercher" type="number" min={0} max={999} value={season} disabled={busy}
          onChange={event => setSeason(Math.max(0, Number(event.target.value)))} className="h-11 w-20 rounded-full bg-[#1F1F23] px-4 text-white" /></label>}
      <VersionFilterChips value={filter} onChange={label => { setFilter(label); setOpen(null); }} />
    </div>

    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] flex flex-col gap-2.5" aria-busy={loading}>
      {/* Retour terrain du 16/11 (« un peu de place perdue en haut ») : un seul encadré compact — la version actuelle et,
          pendant un téléchargement, la règle de remplacement en une ligne (plus de second bandeau). */}
      {(item.releaseTitle || item.quality || activeInScope) && <section data-current-version aria-label="Version actuelle" className="shrink-0 rounded-[16px] bg-[#10221A] px-3.5 py-2.5 shadow-[inset_0_0_0_1.5px_rgba(134,239,172,0.5)]">
        <p className="text-[12px] font-extrabold uppercase tracking-wide text-[#86EFAC]">{currentGroup === 'active' ? `En cours · ${currentProgress} %` : currentGroup === 'completed' ? 'Version téléchargée' : 'Version actuelle'}{currentFacts && <span className="normal-case tracking-normal text-white"> · {currentFacts}</span>}</p>
        {currentBadges.length > 0 && <ul aria-label="Type de release" className="mt-1.5 flex flex-wrap gap-1.5">
          {currentBadges.map(badge => <li key={badge} className="h-6 px-2 rounded-md bg-white/10 text-[12px] font-extrabold text-zinc-100 grid place-items-center">{badge}</li>)}
        </ul>}
        {activeInScope && !sending && <p data-active-request className="mt-1 text-[12.5px] text-zinc-300">Choisir une autre version la remplace : l’ancienne est annulée.</p>}
      </section>}
      {error && <p role="alert" className="rounded-2xl bg-rose-500/10 px-4 py-3 text-[14px] text-rose-200">{error}</p>}
      {!loading && shared.length > 0 && <p data-shared-rejections className="rounded-2xl bg-white/[0.04] px-4 py-3 text-[13.5px] text-zinc-300">Refusées par {item.mediaType === 'movie' ? 'Radarr' : 'Sonarr'} : {shared.join(' · ')}</p>}
      {/* Retour terrain du 16/11 (« recherche étrangement longue, +5 s ») : Radarr/Sonarr interrogent chaque indexer en direct ;
          l'attente est dite, et une réouverture dans les 2 minutes réutilise le dernier résultat. */}
      {loading && <p role="status" className="flex items-center gap-2 py-6 text-[14px] text-zinc-400"><Loader2 size={18} className="animate-spin" />{item.mediaType === 'movie' ? 'Radarr' : 'Sonarr'} interroge chaque indexer…</p>}
      {!loading && !error && !visible.length && <p className="py-6 text-[14px] text-zinc-400">{versions.length ? 'Aucune version pour ce filtre.' : 'Aucune version trouvée.'}</p>}
      {!loading && visible.map(entry => {
        const { release } = entry;
        const { candidate } = release;
        const isOpen = open === release.id;
        const own = release.reasons.filter(reason => !shared.includes(reason));
        const switchTo = autoSwitch(candidate);
        const switchLabel = switchTo === '4k' ? '4K' : '1080p';
        return <ReleaseVersionCard key={release.id} entry={entry} open={isOpen} current={candidate.current} onToggle={() => setOpen(isOpen ? null : release.id)}
          details={candidate.indexer}>
          {own.length > 0 && <p data-rejection className="text-[13px] text-amber-300">{own.join(' · ')}</p>}
          {switchTo && !candidate.current && <p data-auto-switch className="text-[13px] text-zinc-300">Le titre passera en {switchLabel} pour l’accepter.</p>}
          <button type="button" disabled={(!candidate.selectable && !switchTo) || candidate.current || busy || submitted} onClick={() => void submit(candidate)} className="mt-1 h-12 rounded-[14px] bg-[#E5A93D] text-black text-[15px] font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40">
            {sending && <Loader2 size={18} className="animate-spin" />}{candidate.current ? 'Version actuelle' : sending ? 'Envoi…' : activeInScope ? 'Remplacer par cette version' : 'Télécharger cette version'}
          </button>
        </ReleaseVersionCard>;
      })}
      {!loading && <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)} className="mt-1 h-12 rounded-[14px] text-[14.5px] font-bold text-zinc-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] active:bg-white/5">Relancer la recherche</button>}
    </div>
  </DialogLayer>;
}
