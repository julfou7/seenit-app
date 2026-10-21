import React from 'react';
import type { Show } from '../../types';
import { getTodayStr, checkIsUpToDate } from '../../lib/utils';
import { getFormattedProviderLogo } from '../../utils/providerLogos';
import { usePassiveWatchProvider } from '../../hooks/usePassiveWatchProvider';
import { hasAiredEpisodeEvidence } from '../../features/watchlist/watchAvailability';
import { getExtraAvailableEpisodes } from '../../features/watchlist/watchEpisodeProgress';
import type { SeriesCardEpisode } from '../../features/watchlist/seriesCardPresentation';
import { SeriesEpisodeCard, type SeriesCardAction } from './SeriesEpisodeCard';

interface Props {
  key?: React.Key;
  show: Show;
  onShowClick?: (id: string, mediaType?: 'tv' | 'movie') => void;
  onEpisodeClick?: (show: Show, seasonNumber: number, episodeNumber: number) => void;
  onMarkAsSeen: (show: Show) => void | Promise<void>;
  layout?: 'rail' | 'list';
  actions?: SeriesCardAction[];
}

export const ContinueWatchingCard = React.memo(function ContinueWatchingCard(props: Props) {
  const todayStr = getTodayStr();
  if (!hasAiredEpisodeEvidence(props.show, todayStr)) return null;
  return <ContinueWatchingCardContent {...props} />;
});

function ContinueWatchingCardContent({ show, onShowClick, onEpisodeClick, onMarkAsSeen, layout = 'rail', actions }: Props) {
  const { cardRef, providerLogo, providerName } = usePassiveWatchProvider({
    tmdbId: show.tmdbId, mediaType: 'tv', title: show.title, originalTitle: show.originalTitle,
    year: show.firstAirDate?.slice(0, 4), retainInLibraryCache: true,
  });
  const nextEpNum = (show.nextEpisodeToWatch || show.nextEpisodeToAir || { season_number: 1, episode_number: 1 }) as SeriesCardEpisode;
  const todayStr = getTodayStr();
  const extraAvailableEpisodes = getExtraAvailableEpisodes(show, nextEpNum, todayStr);
  const isUpToDate = checkIsUpToDate(show) || Boolean(nextEpNum.air_date && nextEpNum.air_date > todayStr);
  const cachedSeason = show.seasonsCache?.find(season => season.season_number === nextEpNum.season_number);
  const cachedEpisode = cachedSeason?.episodes?.find((episode: SeriesCardEpisode) => episode.episode_number === nextEpNum.episode_number) as (SeriesCardEpisode & { still_path?: string }) | undefined;
  const episodeStill = (show.nextEpisodeToWatch?.still_path as string | undefined) || cachedEpisode?.still_path;
  const currentSeasonArtwork = cachedSeason?.poster_path || null;
  const showBackdrop = show.backdropPath;
  const showPoster = show.posterPath;
  const rawPath = episodeStill || currentSeasonArtwork || showBackdrop || showPoster;
  const openEpisode = onEpisodeClick ? () => onEpisodeClick(show, nextEpNum.season_number, nextEpNum.episode_number) : undefined;
  return <div ref={cardRef} className="series-8f-host">
    <SeriesEpisodeCard
      show={{ ...show, backdropPath: rawPath }}
      episode={{ ...nextEpNum, name: nextEpNum.name || cachedEpisode?.name }}
      context={{ kind: 'watch', upToDate: isUpToDate, onMarkSeen: show.nextEpisodeToWatch ? () => onMarkAsSeen(show) : undefined }}
      detail={isUpToDate ? 'À jour' : `${extraAvailableEpisodes + 1} restant${extraAvailableEpisodes ? 's' : ''}`}
      providerLogo={getFormattedProviderLogo(providerLogo, providerName)} providerName={providerName}
      onOpen={() => { if (onShowClick) onShowClick(show.id, 'tv'); else openEpisode?.(); }}
      onOpenEpisode={openEpisode} actions={actions} layout={layout}
    />
  </div>;
}
