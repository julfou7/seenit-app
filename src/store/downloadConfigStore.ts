import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DownloadClientConfig {
  c411ApiKey: string;
  sonarrUrl: string;
  sonarrApiKey: string;
  radarrUrl: string;
  radarrApiKey: string;
  qbittorrentUrl: string;
  qbittorrentUsername: string;
  qbittorrentPassword: string;
  autoSendToDownloader: boolean;
}

interface DownloadConfigState extends DownloadClientConfig {
  setConfig: (config: Partial<DownloadClientConfig>) => void;
  resetConfig: () => void;
}

const DEFAULT_CONFIG: DownloadClientConfig = {
  c411ApiKey: '2d4baaf4fdd1dacd26f8dc96b1ab6aa06fc95140a7509456b25c8c0b9b5ac55a',
  sonarrUrl: '',
  sonarrApiKey: '',
  radarrUrl: '',
  radarrApiKey: '',
  qbittorrentUrl: '',
  qbittorrentUsername: '',
  qbittorrentPassword: '',
  autoSendToDownloader: true,
};

export const useDownloadConfigStore = create<DownloadConfigState>()(
  persist(
    (set) => ({
      ...DEFAULT_CONFIG,
      setConfig: (newConfig) => set((state) => ({ ...state, ...newConfig })),
      resetConfig: () => set(DEFAULT_CONFIG),
    }),
    {
      name: 'seenit_download_config',
    }
  )
);
