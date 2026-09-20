export interface DownloadClientConfig {
  downloadsEnabled: boolean;
  c411ApiKey: string;
  sonarrUrl: string;
  sonarrApiKey: string;
  sonarr1080pProfileId: number | null;
  sonarr4kProfileId: number | null;
  radarrUrl: string;
  radarrApiKey: string;
  radarr1080pProfileId: number | null;
  radarr4kProfileId: number | null;
  qbittorrentUrl: string;
  qbittorrentUsername: string;
  qbittorrentPassword: string;
  autoSendToDownloader: boolean;
}

const STRING_KEYS = [
  'c411ApiKey',
  'sonarrUrl',
  'sonarrApiKey',
  'radarrUrl',
  'radarrApiKey',
  'qbittorrentUrl',
  'qbittorrentUsername',
  'qbittorrentPassword'
] as const satisfies ReadonlyArray<keyof DownloadClientConfig>;

const PROFILE_KEYS = [
  'sonarr1080pProfileId',
  'sonarr4kProfileId',
  'radarr1080pProfileId',
  'radarr4kProfileId'
] as const satisfies ReadonlyArray<keyof DownloadClientConfig>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeDownloadConfigPatch(
  input: Partial<DownloadClientConfig>
): Partial<DownloadClientConfig> {
  const output: Partial<DownloadClientConfig> = { ...input };
  for (const key of STRING_KEYS) {
    const value = input[key];
    if (typeof value === 'string') Object.assign(output, { [key]: value.trim() });
  }
  return output;
}

export function parseDownloadConfigDocument(value: unknown): Partial<DownloadClientConfig> {
  if (!isRecord(value)) return {};
  const output: Partial<DownloadClientConfig> = {};

  if (typeof value.downloadsEnabled === 'boolean') output.downloadsEnabled = value.downloadsEnabled;
  if (typeof value.autoSendToDownloader === 'boolean') output.autoSendToDownloader = value.autoSendToDownloader;

  for (const key of STRING_KEYS) {
    const raw = value[key];
    if (typeof raw === 'string') Object.assign(output, { [key]: raw.trim() });
  }

  for (const key of PROFILE_KEYS) {
    const raw = value[key];
    if (raw === null || (typeof raw === 'number' && Number.isFinite(raw))) {
      Object.assign(output, { [key]: raw });
    }
  }

  return output;
}
