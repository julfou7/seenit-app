import { type Show } from '../types';
import { EpisodeDetailModal as EpisodeDetailModalCore } from './EpisodeDetailModalCore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';

interface EpisodeDetailModalProps {
  show?: Show;
  season: number;
  episode: any;
  tmdbShowTitle?: string;
  tmdbShowId?: number;
  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
  onClose: () => void;
  onLoadSeason?: (seasonNum: number) => Promise<any>;
}

const HIDDEN_DOWNLOAD_SURFACE_CSS = `
[data-seenit-episode-download-surface="hidden"] button:has(svg.lucide-download),
[data-seenit-episode-download-surface="hidden"] button[title*="télécharg" i],
[data-seenit-episode-download-surface="hidden"] [role="button"][title*="télécharg" i] {
  display: none !important;
}
`;

export function EpisodeDetailModal(props: EpisodeDetailModalProps) {
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);

  return (
    <div
      className="contents"
      data-seenit-episode-download-surface={downloadsEnabled ? 'visible' : 'hidden'}
    >
      {!downloadsEnabled && <style>{HIDDEN_DOWNLOAD_SURFACE_CSS}</style>}
      <EpisodeDetailModalCore key={downloadsEnabled ? 'downloads-visible' : 'downloads-hidden'} {...props} />
    </div>
  );
}
