import { create } from 'zustand';
import type { LiveDownloadItem } from '../../src/services/sonarrRadarrLive';

export const telemetry = { removed: [] as string[], opened: [] as string[], requested: [] as number[], searched: 0, mutations: [] as Array<{ quality: string }>, c411Results: false, queries: [] as string[], pushed: [] as string[], programmed: false, unmonitored: [] as string[], added: [] as string[] };
// #879 — versions de la page « Version précise » (C411 simulé) : la conseillée n'est pas la première reçue.
const day = 86_400_000;
const FIXTURE_RELEASES = [
  { id: 11, infoHash: 'a', name: 'L.Arene.S01E03.MULTi.2160p.NF.WEB-DL.DV.HDR.DDP5.1.H265.mkv', size: 7.4e9, seeders: 410, leechers: 3, createdAt: new Date(Date.now() - day).toISOString(), magnetUri: 'magnet:?xt=urn:btih:a' },
  { id: 12, infoHash: 'b', name: 'L.Arene.S01E03.FRENCH.1080p.WEB.H264-NoTag.mkv', size: 2.1e9, seeders: 214, leechers: 3, createdAt: new Date(Date.now() - 2 * day).toISOString(), magnetUri: 'magnet:?xt=urn:btih:b' },
  { id: 13, infoHash: 'c', name: 'The.Arena.S01E03.VOSTFR.1080p.NF.WEB-DL.DDP5.1.x264.mkv', size: 1.8e9, seeders: 156, leechers: 1, magnetUri: 'magnet:?xt=urn:btih:c' },
  { id: 14, infoHash: 'd', name: 'L.Arene.S01E03.FRENCH.1080p.HDLight.x264.mkv', size: 1.1e9, seeders: 6, leechers: 0, magnetUri: 'magnet:?xt=urn:btih:d' }
];
const sample = (id: string, title: string, status: string, progress = 0): LiveDownloadItem => ({ id, title, movieTitle: title, mediaType: 'movie', tmdbId: Number(id), size: 1200000000, sizeleft: 600000000, status, progress, statusText: status === 'warning' ? 'Manual import required' : 'État confirmé par le client', quality: '1080p', downloadClient: 'Radarr', releaseTitle: `${title}.1080p`, posterPath: '/fixture.jpg', addedAt: Number(id) });
export const fixtureItems = [sample('1', 'Blade Runner', 'warning', 100), sample('2', 'The Punisher : un très long titre de film à conserver entièrement', 'downloading', 63), { ...sample('3', 'The Boys', 'waiting'), availability: { reason: 'unconfirmed', automatic: false } }, sample('4', 'Dune', 'completed', 100)];
export const useLiveDownloadStore = create(() => ({ downloads: fixtureItems, fetchDownloads: async () => {}, removeDownload: async (item: LiveDownloadItem) => { telemetry.removed.push(item.id); useLiveDownloadStore.setState(state => ({ downloads: state.downloads.filter(value => value.id !== item.id) })); return true; }, clearAllDownloads: async () => {} }));
const config = { downloadsEnabled: true, isHydrated: true, sonarrUrl: 'https://fixture.example', sonarrApiKey: 'fixture', radarrUrl: 'https://fixture.example', radarrApiKey: 'fixture' };
export const useDownloadConfigStore = Object.assign(() => config, { getState: () => config });
export const useToastStore = Object.assign(() => () => {}, { getState: () => ({ showToast: () => {} }) });
export const useShowsStore = <T,>(selector: (state: { shows: [] }) => T) => selector({ shows: [] });
export const formatBytes = (size: number) => `${(size / 1000000000).toFixed(1)} Go`;
export const formatCleanMediaInfo = (item: LiveDownloadItem) => ({ cleanTitle: item.title, subTitle: item.mediaType === 'tv' ? 'S02 | E05' : 'Film', isTv: item.mediaType === 'tv' });
export const pushReleaseDirectly = async (payload: { torrent: { name: string } }) => { if (!telemetry.c411Results) throw new Error('mutation inattendue'); telemetry.pushed.push(payload.torrent.name); return { success: true, message: 'ok' }; };
export const searchC411Torrents = async ({ query }: { query: string }) => { telemetry.searched++; telemetry.queries.push(query); if (!telemetry.c411Results) throw new Error('C411 indisponible (503).'); return FIXTURE_RELEASES; };
export const formatTorrentSize = formatBytes;
export const openC411Magnet = async () => false;
export const DownloadConfigSection = () => null;
export const AlternativeReleaseModal = () => null;
export const beginDownloadRequest = (request: { quality: string }) => { telemetry.mutations.push(request); return 'fixture-request'; };
export const acceptDownloadRequest = () => {};
export const failDownloadRequest = () => {};
export const updateDownloadRequest = () => {};
export const useMediaPresence = () => ({ loading: false, episodesHasFile: {}, seasonsHasFile: {}, radarrHasFile: false, plexInfo: null });
export const fetchQualityProfiles = async () => [{ id: 1, name: 'HD-1080p' }, { id: 2, name: 'UltraHD-4K' }];
export const searchAndDownloadInRadarr = async () => ({ success: true, message: 'Demande acceptée', status: 'searching' });
export const searchAndDownloadInSonarr = searchAndDownloadInRadarr;
export const downloadEpisodeWithSeasonPackFallback = async () => { throw new Error('Lancement épisode inattendu dans ce contrôle visuel'); };
export const useTabShortcut = () => {};
// #879 — « Ajouter E6 » : la série TMDB 77 a l'épisode 6 sorti, ni vu, ni présent.
export const useNextEpisodeToAdd = (target: { tmdbId: number } | null) => target?.tmdbId === 77 ? { episode: 6, name: 'Sans filet' } : null;
export const addEpisodeToSeason = async (target: { tmdbId: number; season: number }, episode: number, quality: string) => { telemetry.added.push(`${target.tmdbId}:S${target.season}E${episode}:${quality}`); };
// #879 — calendrier Sonarr/Radarr de la section « Programmés » (vide hors de la page dédiée).
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
export const cleanUrl = (url: string) => String(url || '').replace(/\/+$/, '');
export const executeGet = async (url: string) => {
  if (!telemetry.programmed) return [];
  if (url.includes('/api/v3/calendar') && url.includes('includeSeries=true')) return [
    { id: 801, seriesId: 5, seasonNumber: 1, episodeNumber: 8, title: 'Épisode 8', airDateUtc: inDays(7), monitored: true, hasFile: false, series: { title: "L'Arène", tmdbId: 77, monitored: true } },
    { id: 802, seriesId: 5, seasonNumber: 1, episodeNumber: 9, title: 'Épisode 9', airDateUtc: inDays(14), monitored: true, hasFile: false, series: { title: "L'Arène", tmdbId: 77, monitored: true } },
    // Non surveillé, présent ou série désactivée : jamais « programmé ».
    { id: 803, seriesId: 5, seasonNumber: 1, episodeNumber: 10, title: 'Épisode 10', airDateUtc: inDays(21), monitored: false, series: { title: "L'Arène", tmdbId: 77, monitored: true } },
    { id: 804, seriesId: 6, seasonNumber: 2, episodeNumber: 1, title: 'Pilote', airDateUtc: inDays(3), monitored: true, hasFile: false, series: { title: 'Série en pause', tmdbId: 78, monitored: false } }
  ];
  if (url.includes('/api/v3/calendar')) return [{ id: 901, title: 'Avatar : De feu et de cendres', tmdbId: 83533, monitored: true, hasFile: false, digitalRelease: inDays(40) }];
  if (/\/api\/v3\/(?:episode|movie)\/\d+$/.test(url)) return { id: Number(url.split('/').pop()), monitored: true };
  return [];
};
export const executePut = async (url: string, body: { monitored?: boolean }) => { if (body.monitored === false) telemetry.unmonitored.push(url); return body; };
