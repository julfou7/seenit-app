import { useEffect } from 'react';
import { useMediaPresenceStore, MediaPresenceData } from '../store/mediaPresenceStore';

export function useMediaPresence(params: {
  tmdbId?: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  title?: string;
  originalTitle?: string;
  year?: number | string;
  mediaType: 'movie' | 'tv';
  enabled?: boolean;
}): MediaPresenceData {
  const { tmdbId, tvdbId, imdbId, title, originalTitle, year, mediaType, enabled = true } = params;
  const store = useMediaPresenceStore();
  
  const presence = store.getPresence(tmdbId, mediaType, title);

  useEffect(() => {
    if (!enabled) return;
    if (!tmdbId && !title) return;

    store.checkPresence({
      tmdbId,
      tvdbId,
      imdbId,
      title,
      originalTitle,
      year,
      mediaType
    });
  }, [tmdbId, tvdbId, imdbId, title, mediaType, enabled]);

  return presence || {
    loading: true,
    hasFile: false,
    seasonsHasFile: {},
    episodesHasFile: {}
  };
}
