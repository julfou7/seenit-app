import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';

interface Props {
  onShowClick?: (id: any, mediaType?: 'tv' | 'movie') => void;
}

const DownloadsScreenCore = lazy(() => import('./DownloadsScreenCore').then(module => ({ default: module.DownloadsScreen })));

export function DownloadsScreen(props: Props) {
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);
  if (!downloadsEnabled) return null;

  return (
    <Suspense fallback={(
      <div className="flex-1 min-h-0 flex items-center justify-center bg-premium-ambient text-zinc-400">
        <Loader2 size={24} className="animate-spin" aria-label="Chargement des téléchargements" />
      </div>
    )}>
      <DownloadsScreenCore {...props} />
    </Suspense>
  );
}
