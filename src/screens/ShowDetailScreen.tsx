import React, { useEffect, useMemo, useState } from 'react';
import { ShowDetailScreen as ShowDetailScreenCore } from './ShowDetailScreenCore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { tmdb } from '../features/shows/tmdb';
import { useShowsStore } from '../store/showsStore';

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

const HIDDEN_DOWNLOAD_SURFACE_CSS = `
[data-seenit-download-surface="hidden"] button:has(svg.lucide-download),
[data-seenit-download-surface="hidden"] button[title*="télécharg" i],
[data-seenit-download-surface="hidden"] [role="button"][title*="télécharg" i] {
  display: none !important;
}
`;

const DETAIL_UX_CSS = `
[data-seenit-detail-shell="stable"] .animate-pulse { overflow-anchor: none; }
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

interface StableColdDetailSkeletonProps extends Pick<ShowDetailScreenProps, 'onBack'> {
  mediaType: 'tv' | 'movie';
  knownTitle?: string | null;
}

function StableColdDetailSkeleton({ onBack, mediaType, knownTitle }: StableColdDetailSkeletonProps) {
  const isSeries = mediaType === 'tv';
  return (
    <div data-seenit-detail-warmup="cold" className="flex-1 overflow-y-auto bg-black text-white relative w-full h-full pb-nav">
      <div className="relative min-h-[420px]">
        <div className="absolute top-0 inset-x-0 h-96 bg-zinc-900/60 animate-pulse" />
        <div className="relative z-10 pt-10 px-4">
          <button type="button" onClick={onBack} className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white text-xl" aria-label="Retour">‹</button>
          <div className="flex gap-4 mt-8">
            <div className="w-[120px] shrink-0 aspect-[2/3] bg-zinc-800/80 rounded-xl border border-white/10 animate-pulse" />
            <div className="flex-1 min-w-0 flex flex-col justify-end gap-3 pb-1">
              <div className="flex gap-2">
                <span className="inline-flex items-center px-2 py-1 bg-[#E5A93D]/20 text-[10px] font-bold tracking-widest text-[#E5A93D] uppercase rounded-md border border-[#E5A93D]/30">
                  {isSeries ? '📺 SÉRIE' : '🎬 FILM'}
                </span>
                <div className="h-5 w-16 bg-zinc-800/80 rounded-md animate-pulse" />
              </div>
              {knownTitle ? (
                <h1 className="text-xl sm:text-2xl font-extrabold leading-tight text-white line-clamp-2">{knownTitle}</h1>
              ) : (
                <div className="h-9 w-4/5 max-w-56 bg-zinc-800/80 rounded-lg animate-pulse" />
              )}
              <div className="h-4 w-32 bg-zinc-800/80 rounded animate-pulse" />
              <div className="flex gap-2 min-h-[26px]"><div className="h-6 w-16 bg-zinc-800/80 rounded-lg animate-pulse" /></div>
            </div>
          </div>
          <div className="h-12 w-full bg-zinc-800/80 rounded-2xl mt-5 animate-pulse" />
        </div>
      </div>

      <div className="px-4 mt-4">
        <div className="h-10 bg-zinc-900 rounded-full border border-white/5 p-1 flex items-center gap-1">
          <span className="flex-1 py-2 text-center text-xs font-bold tracking-wider uppercase rounded-full bg-zinc-800 text-[#E5A93D]">À propos</span>
          {isSeries && <span className="flex-1 py-2 text-center text-xs font-bold tracking-wider uppercase text-zinc-500">Épisodes</span>}
        </div>
      </div>

      <div className="p-4 space-y-6">
        <section>
          <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Synopsis</h3>
          <div className="space-y-2 animate-pulse">
            <div className="h-3.5 bg-zinc-800/80 rounded w-full" />
            <div className="h-3.5 bg-zinc-800/80 rounded w-11/12" />
            <div className="h-3.5 bg-zinc-800/80 rounded w-4/5" />
          </div>
        </section>

        <section className="bg-zinc-900/40 border border-white/5 p-4 rounded-2xl">
          <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Catégories & Thèmes</h3>
          <div className="flex flex-wrap gap-2 animate-pulse">
            <div className="h-7 w-20 bg-zinc-800/80 rounded-full" />
            <div className="h-7 w-24 bg-zinc-800/80 rounded-full" />
            <div className="h-7 w-16 bg-zinc-800/80 rounded-full" />
          </div>
        </section>

        <section>
          <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-3">Où regarder</h3>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-zinc-900/80 text-zinc-400 text-xs font-medium">
            <span className="w-4 h-4 rounded bg-zinc-700/80 animate-pulse" aria-hidden="true" />
            <span>Recherche Plex & streaming…</span>
          </div>
        </section>
      </div>
    </div>
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
    const numericShowId = props.showId && /^\d+$/.test(props.showId) ? Number(props.showId) : undefined;
    const tmdbId = matchingShow?.tmdbId ? Number(matchingShow.tmdbId) : props.tmdbId ? Number(props.tmdbId) : numericShowId;
    const mediaType: 'tv' | 'movie' = matchingShow?.mediaType === 'movie' || props.mediaType === 'movie' ? 'movie' : 'tv';
    return {
      tmdbId: Number.isFinite(tmdbId) && Number(tmdbId) > 0 ? Number(tmdbId) : undefined,
      mediaType,
      knownTitle: matchingShow?.title || null,
    };
  }, [shows, props.showId, props.tmdbId, props.mediaType]);

  const detailIdentity = resolvedMedia.tmdbId ? `${resolvedMedia.mediaType}:${resolvedMedia.tmdbId}` : null;
  const [coldWarmupIdentity, setColdWarmupIdentity] = useState<string | null>(() => {
    if (!resolvedMedia.tmdbId || !detailIdentity) return null;
    return tmdb.peekMediaDetails(resolvedMedia.tmdbId, resolvedMedia.mediaType) ? null : detailIdentity;
  });

  useEffect(() => {
    const tmdbId = resolvedMedia.tmdbId;
    const mediaType = resolvedMedia.mediaType;
    const identity = detailIdentity;
    if (!tmdbId || !identity) { setColdWarmupIdentity(null); return; }
    if (tmdb.peekMediaDetails(tmdbId, mediaType)) { setColdWarmupIdentity(null); return; }

    let cancelled = false;
    setColdWarmupIdentity(identity);
    const warmColdDetail = async () => {
      // Les disponibilités démarrent en parallèle, mais elles ne bloquent jamais
      // l'affichage du cœur de fiche une fois les détails TMDB connus.
      void tmdb.getWatchProviders(tmdbId, mediaType).catch(() => undefined);
      const detailsResult = await tmdb.getMediaDetails(tmdbId, mediaType);
      if (!cancelled) setColdWarmupIdentity(null);
      if (!detailsResult.ok || !detailsResult.value) return;
    };
    void warmColdDetail();
    return () => { cancelled = true; };
  }, [detailIdentity, resolvedMedia.tmdbId, resolvedMedia.mediaType]);

  const isColdWarmup = Boolean(detailIdentity && coldWarmupIdentity === detailIdentity);

  return (
    <div className="contents" data-seenit-download-surface={downloadsEnabled ? 'visible' : 'hidden'} data-seenit-detail-shell="stable">
      {!downloadsEnabled && <style>{HIDDEN_DOWNLOAD_SURFACE_CSS}</style>}
      <style>{DETAIL_UX_CSS}</style>
      {isColdWarmup ? (
        <StableColdDetailSkeleton onBack={props.onBack} mediaType={resolvedMedia.mediaType} knownTitle={resolvedMedia.knownTitle} />
      ) : (
        <ShowDetailScreenCore key={downloadsEnabled ? 'downloads-visible' : 'downloads-hidden'} {...props} />
      )}
    </div>
  );
}
