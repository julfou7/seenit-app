import React from 'react';
import type { Show } from '../../types';
import { getCalendarDaysDiff, getTodayStr } from '../../lib/utils';
import { getFormattedProviderLogo } from '../../utils/providerLogos';
import { usePassiveWatchProvider } from '../../hooks/usePassiveWatchProvider';
import { hasAiredEpisodeEvidence } from '../../features/watchlist/watchAvailability';
import { seriesCardStaleDetail, type SeriesCardEpisode } from '../../features/watchlist/seriesCardPresentation';
import { resolveWatchCardResume } from '../../features/watchlist/watchCardResume';
import { SeriesEpisodeCard, type SeriesCardAction } from './SeriesEpisodeCard';

interface Props {
  key?: React.Key;
  show: Show;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (show: Show, seasonNumber: number, episodeNumber: number) => void;
  onMarkAsSeen: (show: Show) => void | boolean | Promise<void | boolean>;
  onMarkUnseen?: (show: Show, episode: SeriesCardEpisode) => Promise<void | boolean>;
  lastMarkedEpisode?: SeriesCardEpisode;
  animateSeen?: boolean;
  layout?: 'rail' | 'list';
  actions?: SeriesCardAction[];
  showStaleDetail?: boolean;
}

function episodeFreshnessBadge(episode: SeriesCardEpisode | null | undefined, todayStr: string): string | undefined {
  if (!episode?.air_date) return undefined;
  const days = getCalendarDaysDiff(episode.air_date, todayStr);
  if (days === 0) return '🔥 Sorti aujourd’hui';
  if (days === -1) return '🌟 Sorti hier';
  if (days <= -2 && days >= -7) return `🆕 Il y a ${Math.abs(days)} jours`;
  return undefined;
}

export const ContinueWatchingCard = React.memo(function ContinueWatchingCard(props: Props) {
  const todayStr = getTodayStr();
  if (!hasAiredEpisodeEvidence(props.show, todayStr)) return null;
  return <ContinueWatchingCardContent {...props} />;
});

function ContinueWatchingCardContent({ show, onShowClick, onEpisodeClick, onMarkAsSeen, onMarkUnseen, lastMarkedEpisode, animateSeen, layout = 'rail', actions, showStaleDetail = false }: Props) {
  const { cardRef, providerLogo, providerName } = usePassiveWatchProvider({
    tmdbId: show.tmdbId, mediaType: 'tv', title: show.title, originalTitle: show.originalTitle,
    year: show.firstAirDate?.slice(0, 4), retainInLibraryCache: true,
  });
  const todayStr = getTodayStr();
  const resume = resolveWatchCardResume(show, todayStr);
  const isUpToDate = resume.upToDate;
  const nextEpNum = resume.episode || (isUpToDate ? lastMarkedEpisode : null);
  const cachedSeason = nextEpNum ? show.seasonsCache?.find(season => season.season_number === nextEpNum.season_number) : undefined;
  const cachedEpisode = cachedSeason?.episodes?.find((episode: SeriesCardEpisode) => episode.episode_number === nextEpNum?.episode_number) as (SeriesCardEpisode & { still_path?: string }) | undefined;
  const episodeStill = nextEpNum?.still_path || cachedEpisode?.still_path;
  const currentSeasonArtwork = cachedSeason?.poster_path || null;
  const showBackdrop = show.backdropPath;
  const showPoster = show.posterPath;
  const rawPath = episodeStill || currentSeasonArtwork || showBackdrop || showPoster;
  const openEpisode = onEpisodeClick && nextEpNum ? () => onEpisodeClick(show, nextEpNum.season_number, nextEpNum.episode_number) : undefined;
  const freshnessBadge = isUpToDate ? undefined : episodeFreshnessBadge(nextEpNum, todayStr);
  const staleDetail = showStaleDetail ? seriesCardStaleDetail(show)?.replace(/^(?:⏳ )?Il y a /u, 'Pas vu depuis ') : undefined;
  return <div ref={cardRef} className="series-8f-host">
    <SeriesEpisodeCard
      show={{ ...show, backdropPath: rawPath }}
      episode={nextEpNum ? { ...nextEpNum, name: nextEpNum.name || cachedEpisode?.name } : null}
      context={{ kind: 'watch', upToDate: isUpToDate, animateSeen,
        onMarkSeen: resume.episode ? () => onMarkAsSeen(show) : undefined,
        onMarkUnseen: isUpToDate && lastMarkedEpisode && onMarkUnseen ? () => onMarkUnseen(show, lastMarkedEpisode) : undefined,
      }}
      hideStatus={showStaleDetail}
      detail={showStaleDetail ? staleDetail : freshnessBadge}
      providerLogo={getFormattedProviderLogo(providerLogo, providerName)} providerName={providerName}
      onOpen={() => { if (onShowClick) onShowClick(show.id, 'tv'); else openEpisode?.(); }}
      onOpenEpisode={openEpisode} actions={actions} layout={layout}
    />
  </div>;
}
