import React, { useEffect, useMemo, useState } from 'react';
import { ShowDetailScreen as ShowDetailScreenCore } from './ShowDetailScreenCore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { tmdb } from '../features/shows/tmdb';
import { useShowsStore } from '../store/showsStore';
import { MediaDetailColdShell } from './MediaDetailColdShell';

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
[data-seenit-detail-shell="stable"] [data-seenit-relation-loading] > h3 {
  font-size: 0;
  min-height: 0.75rem;
}
[data-seenit-detail-shell="stable"] [data-seenit-relation-loading] > h3::after {
  content: '';
  display: block;
  width: 8rem;
  height: 0.75rem;
  border-radius: 0.25rem;
  background: rgb(39 39 42 / 0.8);
  animation: pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@media (prefers-reduced-motion: reduce) {
  [data-seenit-detail-shell="stable"] [data-seenit-relation-loading] > h3::after { animation: none; }
}
[data-seenit-detail-warmup="cold"] {
  min-height: 100%;
  contain: layout paint;
}
`;

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
    return tmdb.peekRenderableMediaDetails(resolvedMedia.tmdbId, resolvedMedia.mediaType) ? null : detailIdentity;
  });

  useEffect(() => {
    const tmdbId = resolvedMedia.tmdbId;
    const mediaType = resolvedMedia.mediaType;
    const identity = detailIdentity;
    if (!tmdbId || !identity) { setColdWarmupIdentity(null); return; }
    if (tmdb.peekRenderableMediaDetails(tmdbId, mediaType)) { setColdWarmupIdentity(null); return; }

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
        <MediaDetailColdShell onBack={props.onBack} mediaType={resolvedMedia.mediaType} knownTitle={resolvedMedia.knownTitle} />
      ) : (
        <ShowDetailScreenCore key={downloadsEnabled ? 'downloads-visible' : 'downloads-hidden'} {...props} />
      )}
    </div>
  );
}
