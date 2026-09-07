import { ShowDetailScreen as ShowDetailScreenCore } from './ShowDetailScreenCore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';

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

export function ShowDetailScreen(props: ShowDetailScreenProps) {
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);

  return (
    <div
      className="contents"
      data-seenit-download-surface={downloadsEnabled ? 'visible' : 'hidden'}
    >
      {!downloadsEnabled && <style>{HIDDEN_DOWNLOAD_SURFACE_CSS}</style>}
      <ShowDetailScreenCore key={downloadsEnabled ? 'downloads-visible' : 'downloads-hidden'} {...props} />
    </div>
  );
}
