import { readFileSync } from 'node:fs';

const featureFiles = {
  discover: [
    'src/screens/DiscoverScreen.tsx',
    'src/screens/DiscoverView.tsx',
    'src/screens/DiscoverHero.tsx',
    'src/screens/discoverPresentation.tsx',
  ],
  watchList: [
    'src/screens/WatchListScreen.tsx',
    'src/screens/WatchListView.tsx',
    'src/screens/watchListPresentation.tsx',
  ],
  showDetail: [
    'src/screens/ShowDetailScreenCore.tsx',
    'src/screens/ShowDetailView.tsx',
    'src/screens/showDetailPresentation.ts',
  ],
  sonarrRadarr: [
    'src/services/sonarrRadarr.ts',
    'src/services/sonarrRadarrTransport.ts',
    'src/services/sonarrRadarrSearch.ts',
    'src/services/sonarrRadarrLive.ts',
  ],
  plexSync: [
    'src/features/plex/syncPlex.ts',
    'src/features/plex/plexResolution.ts',
    'src/features/plex/plexSyncEngine.ts',
    'src/features/plex/plexLinks.ts',
  ],
} as const;

export type FeatureSourceName = keyof typeof featureFiles;

export function readFeatureSource(feature: FeatureSourceName): string {
  return featureFiles[feature]
    .map((path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
    .join('\n');
}
