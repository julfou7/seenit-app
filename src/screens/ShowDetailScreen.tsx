import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { ShowDetailScreen as ShowDetailScreenCore } from './ShowDetailScreenCore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { tmdb } from '../features/shows/tmdb';
import { getSeriesImdbData } from '../features/shows/omdbService';
import { useShowsStore } from '../store/showsStore';
import { useMediaPresenceStore } from '../store/mediaPresenceStore';

interface ShowDetailScreenProps {
  key?: string;
  showId?: string;
  tmdbId?: number;
  mediaType?: 'tv' | 'movie';
  initialSeason?: number;
  initialEpisode?: number;
  onBack: () => void;
  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
}

const DETAIL_WARMUP_GRACE_MS = 300;
const PROVIDER_LOADING_LABEL = 'Recherche Plex & streaming…';

const HIDDEN_DOWNLOAD_SURFACE_CSS = `
[data-seenit-download-surface="hidden"] button:has(svg.lucide-download),
[data-seenit-download-surface="hidden"] button[title*="télécharg" i],
[data-seenit-download-surface="hidden"] [role="button"][title*="télécharg" i] {
  display: none !important;
}
`;

const STABLE_DETAIL_LOADING_CSS = `
[data-seenit-detail-shell="stable"] .animate-pulse {
  overflow-anchor: none;
}

/* Le titre relationnel exact n'est connu qu'après résolution TVDB. Le sélecteur
   reste volontairement limité aux headings relationnels mb-3 : « Où regarder »
   (mb-2) est un titre produit stable et ne doit jamais devenir un skeleton. */
[data-seenit-detail-shell="stable"] h3.mb-3:has(+ .flex > .animate-pulse) {
  font-size: 0;
  min-height: 0.75rem;
}

[data-seenit-detail-shell="stable"] h3.mb-3:has(+ .flex > .animate-pulse)::after {
  content: '';
  display: block;
  width: 8rem;
  height: 0.75rem;
  border-radius: 0.25rem;
  background: rgb(39 39 42 / 0.8);
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

[data-seenit-detail-warmup="cold"] {
  min-height: 100%;
  contain: layout paint;
}
`;

const wait = (delayMs: number) => new Promise<void>(resolve => {
  setTimeout(resolve, delayMs);
});

function StableColdDetailSkeleton({ onBack }: Pick<ShowDetailScreenProps, 'onBack'>) {
  return (
    <div
      data-seenit-detail-warmup="cold"
      className="flex-1 overflow-hidden bg-black text-white relative w-full h-full"
    >
      <div className="relative min-h-[420px]">
        <div className="absolute top-0 inset-x-0 h-96 bg-zinc-900/60 animate-pulse" />
        <div className="relative z-10 pt-10 px-4">
          <button
            type="button"
            onClick={onBack}
            className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white text-xl"
            aria-label="Retour"
          >
            ‹
          </button>

          <div className="flex gap-4 mt-8">
            <div className="w-[120px] shrink-0 aspect-[2/3] bg-zinc-800/80 rounded-xl border border-white/10 animate-pulse" />
            <div className="flex-1 min-w-0 flex flex-col justify-end gap-3 pb-1">
              <div className="flex gap-2">
                <div className="h-5 w-24 bg-zinc-800/80 rounded-md animate-pulse" />
                <div className="h-5 w-16 bg-zinc-800/80 rounded-md animate-pulse" />
              </div>
              <div className="h-9 w-4/5 max-w-56 bg-zinc-800/80 rounded-lg animate-pulse" />
              <div className="h-4 w-32 bg-zinc-800/80 rounded animate-pulse" />
              <div className="flex gap-2 min-h-[26px]">
                <div className="h-6 w-16 bg-zinc-800/80 rounded-lg animate-pulse" />
                <div className="h-6 w-16 bg-zinc-800/80 rounded-lg animate-pulse" />
              </div>
            </div>
          </div>

          <div className="h-12 w-full bg-zinc-800/80 rounded-2xl mt-5 animate-pulse" />
        </div>
      </div>

      <div className="px-4 mt-4">
        <div className="h-10 bg-zinc-900 rounded-full animate-pulse border border-white/5" />
      </div>

      <div className="p-4 space-y-6">
        <div className="space-y-2">
          <div className="h-3 w-20 bg-zinc-800 rounded animate-pulse" />
          <div className="h-3.5 bg-zinc-800/80 rounded w-full animate-pulse" />
          <div className="h-3.5 bg-zinc-800/80 rounded w-11/12 animate-pulse" />
          <div className="h-3.5 bg-zinc-800/80 rounded w-4/5 animate-pulse" />
        </div>
        <div className="h-20 bg-zinc-900/60 rounded-2xl border border-white/5 animate-pulse" />
      </div>
    </div>
  );
}

function ProviderAvailabilityControls({
  detailIdentity,
  tmdbId,
  mediaType,
}: {
  detailIdentity: string | null;
  tmdbId?: number;
  mediaType: 'tv' | 'movie';
}) {
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('[data-seenit-detail-shell="stable"]');
    if (!shell) return;

    const ensureProviderUi = () => {
      const heading = Array.from(shell.querySelectorAll('h3'))
        .find(node => node.textContent?.trim() === 'Où regarder');
      if (!heading?.parentElement) {
        if (hostRef.current && !hostRef.current.isConnected) {
          hostRef.current = null;
          setPortalHost(null);
        }
        return;
      }

      // Les deux chemins historiques (« Vérification… » et libellé complet)
      // deviennent une seule formulation courte et non tronquée, y compris pour
      // les lecteurs d'écran puisque le vrai texte DOM est normalisé.
      for (const pulse of heading.parentElement.querySelectorAll<HTMLElement>('.animate-pulse')) {
        if (!pulse.querySelector('img[alt="Plex"]')) continue;
        const label = pulse.querySelector<HTMLElement>('span');
        if (label && label.textContent !== PROVIDER_LOADING_LABEL) label.textContent = PROVIDER_LOADING_LABEL;
        if (label) label.style.whiteSpace = 'nowrap';
      }

      let host = heading.parentElement.querySelector<HTMLElement>(':scope > [data-seenit-provider-refresh-host="true"]');
      if (!host) {
        host = document.createElement('div');
        host.dataset.seenitProviderRefreshHost = 'true';
        host.className = 'flex justify-end -mt-1 mb-2';
        heading.insertAdjacentElement('afterend', host);
      }
      if (hostRef.current !== host) {
        hostRef.current = host;
        setPortalHost(host);
      }
    };

    ensureProviderUi();
    const observer = new MutationObserver(ensureProviderUi);
    observer.observe(shell, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      hostRef.current?.remove();
      hostRef.current = null;
      setPortalHost(null);
    };
  }, [detailIdentity]);

  const refreshPlexServers = async () => {
    if (!tmdbId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const details = tmdb.peekMediaDetails(tmdbId, mediaType);
      await useMediaPresenceStore.getState().checkPresence({
        tmdbId,
        tvdbId: details?.external_ids?.tvdb_id,
        imdbId: details?.external_ids?.imdb_id || details?.imdb_id,
        mediaType,
        forceRefresh: true,
        refreshPlexServers: true,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!portalHost || !tmdbId) return null;
  return createPortal(
    <button
      type="button"
      onClick={() => void refreshPlexServers()}
      disabled={isRefreshing}
      aria-label="Actualiser les serveurs Plex"
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/80 px-3 text-xs font-semibold text-zinc-300 transition hover:text-white disabled:opacity-60"
    >
      <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
      <span>{isRefreshing ? 'Actualisation Plex…' : 'Actualiser Plex'}</span>
    </button>,
    portalHost,
  );
}

export function ShowDetailScreen(props: ShowDetailScreenProps) {
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);
  const shows = useShowsStore(state => state.shows);

  const resolvedMedia = useMemo(() => {
    const matchingShow = shows.find(show =>
      (props.showId && (String(show.id) === String(props.showId) || String(show.tmdbId) === String(props.showId)))
      || (props.tmdbId && String(show.tmdbId) === String(props.tmdbId))
    );

    const numericShowId = props.showId && /^\d+$/.test(props.showId)
      ? Number(props.showId)
      : undefined;
    const tmdbId = matchingShow?.tmdbId
      ? Number(matchingShow.tmdbId)
      : props.tmdbId
        ? Number(props.tmdbId)
        : numericShowId;
    const mediaType: 'tv' | 'movie' = matchingShow?.mediaType === 'movie' || props.mediaType === 'movie'
      ? 'movie'
      : 'tv';

    return {
      tmdbId: Number.isFinite(tmdbId) && Number(tmdbId) > 0 ? Number(tmdbId) : undefined,
      mediaType,
    };
  }, [shows, props.showId, props.tmdbId, props.mediaType]);

  const detailIdentity = resolvedMedia.tmdbId
    ? `${resolvedMedia.mediaType}:${resolvedMedia.tmdbId}`
    : null;
  const [coldWarmupIdentity, setColdWarmupIdentity] = useState<string | null>(() => {
    if (!resolvedMedia.tmdbId || !detailIdentity) return null;
    return tmdb.peekMediaDetails(resolvedMedia.tmdbId, resolvedMedia.mediaType)
      ? null
      : detailIdentity;
  });

  useEffect(() => {
    const tmdbId = resolvedMedia.tmdbId;
    const mediaType = resolvedMedia.mediaType;
    const identity = detailIdentity;
    if (!tmdbId || !identity) {
      setColdWarmupIdentity(null);
      return;
    }

    // SEENIT-PERF-001 : une fiche déjà en cache reste instantanée. Le gate ne
    // s'applique qu'au premier chargement réellement froid.
    if (tmdb.peekMediaDetails(tmdbId, mediaType)) {
      setColdWarmupIdentity(null);
      return;
    }

    let cancelled = false;
    setColdWarmupIdentity(identity);

    const warmColdDetail = async () => {
      // Les plateformes partent en parallèle du détail principal pour ne pas
      // rallonger le chemin critique. Leur cache sera réutilisé par la fiche.
      const providersPromise = tmdb.getWatchProviders(tmdbId, mediaType);
      const detailsResult = await tmdb.getMediaDetails(tmdbId, mediaType);

      if (!detailsResult.ok || !detailsResult.value) {
        if (!cancelled) setColdWarmupIdentity(null);
        return;
      }

      const imdbId = detailsResult.value?.external_ids?.imdb_id || detailsResult.value?.imdb_id || null;
      const imdbPromise = imdbId
        ? getSeriesImdbData(imdbId)
        : Promise.resolve(null);

      // Petite fenêtre bornée : elle permet aux données du hero (plateformes +
      // IMDb) de rejoindre le détail principal sans bloquer la page sur les
      // enrichissements plus lourds (TVDB, Reddit, saisons...).
      await Promise.race([
        Promise.allSettled([providersPromise, imdbPromise]),
        wait(DETAIL_WARMUP_GRACE_MS),
      ]);

      if (!cancelled) setColdWarmupIdentity(null);
    };

    void warmColdDetail();
    return () => {
      cancelled = true;
    };
  }, [detailIdentity, resolvedMedia.tmdbId, resolvedMedia.mediaType]);

  const isColdWarmup = Boolean(detailIdentity && coldWarmupIdentity === detailIdentity);

  return (
    <div
      className="contents"
      data-seenit-download-surface={downloadsEnabled ? 'visible' : 'hidden'}
      data-seenit-detail-shell="stable"
    >
      {!downloadsEnabled && <style>{HIDDEN_DOWNLOAD_SURFACE_CSS}</style>}
      <style>{STABLE_DETAIL_LOADING_CSS}</style>
      {isColdWarmup ? (
        <StableColdDetailSkeleton onBack={props.onBack} />
      ) : (
        <>
          <ShowDetailScreenCore key={downloadsEnabled ? 'downloads-visible' : 'downloads-hidden'} {...props} />
          <ProviderAvailabilityControls
            detailIdentity={detailIdentity}
            tmdbId={resolvedMedia.tmdbId}
            mediaType={resolvedMedia.mediaType}
          />
        </>
      )}
    </div>
  );
}
