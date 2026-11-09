import { create } from 'zustand';
import type { LiveDownloadItem } from '../../src/services/sonarrRadarrLive';

export const telemetry = { removed: [] as string[], opened: [] as string[], requested: [] as number[], searched: 0, mutations: [] as Array<{ quality: string }>, c411Results: false, queries: [] as string[], qualities: [] as string[], presence: [] as string[], pushed: [] as string[], programmed: false, unmonitored: [] as string[], added: [] as string[], arrDeleted: [] as string[] };
// #879 — versions de la page « Version précise » (C411 simulé) : la conseillée n'est pas la première reçue.
const day = 86_400_000;
const FIXTURE_RELEASES = [
  { id: 11, infoHash: 'a', name: 'L.Arene.S01E03.MULTi.2160p.NF.WEB-DL.DV.HDR.DDP5.1.H265.mkv', size: 7.4e9, seeders: 410, leechers: 3, createdAt: new Date(Date.now() - day).toISOString(), magnetUri: 'magnet:?xt=urn:btih:a' },
  { id: 12, infoHash: 'b', name: 'L.Arene.S01E03.FRENCH.1080p.WEB.H264-NoTag.mkv', size: 2.1e9, seeders: 214, leechers: 3, createdAt: new Date(Date.now() - 2 * day).toISOString(), magnetUri: 'magnet:?xt=urn:btih:b' },
  { id: 13, infoHash: 'c', name: 'The.Arena.S01E03.VOSTFR.1080p.NF.WEB-DL.DDP5.1.x264.mkv', size: 1.8e9, seeders: 156, leechers: 1, magnetUri: 'magnet:?xt=urn:btih:c' },
  { id: 14, infoHash: 'd', name: 'L.Arene.S01E03.FRENCH.1080p.HDLight.x264.mkv', size: 1.1e9, seeders: 6, leechers: 0, magnetUri: 'magnet:?xt=urn:btih:d' }
];
const sample = (id: string, title: string, status: string, progress = 0): LiveDownloadItem => ({ id, title, movieTitle: title, mediaType: 'movie', tmdbId: Number(id), size: 1200000000, sizeleft: 600000000, status, progress, statusText: status === 'warning' ? 'Manual import required' : 'État confirmé par le client', quality: '1080p', downloadClient: 'Radarr', releaseTitle: `${title}.1080p`, posterPath: '/fixture.jpg', addedAt: Number(id) });
export const fixtureItems = [sample('1', 'Blade Runner', 'warning', 100), sample('2', 'The Punisher : un très long titre de film à conserver entièrement', 'downloading', 63), { ...sample('3', 'The Boys', 'waiting'), availability: { reason: 'unconfirmed', automatic: false } }, sample('4', 'Dune', 'completed', 100),
  // Retour terrain du 08/11 : pas encore de version, surveillance Radarr confirmée → « Programmés ».
  { ...sample('5', 'Le Chat Chapeauté', 'waiting'), availability: { reason: 'no_release', automatic: true } }];
export const useLiveDownloadStore = create(() => ({ downloads: fixtureItems, fetchDownloads: async () => {}, removeDownload: async (item: LiveDownloadItem) => { telemetry.removed.push(item.id); useLiveDownloadStore.setState(state => ({ downloads: state.downloads.filter(value => value.id !== item.id) })); return true; }, clearAllDownloads: async () => {} }));
const config = { downloadsEnabled: true, isHydrated: true, sonarrUrl: 'https://fixture.example', sonarrApiKey: 'fixture', radarrUrl: 'https://fixture.example', radarrApiKey: 'fixture' };
export const useDownloadConfigStore = Object.assign(() => config, { getState: () => config });
export const toasts: Array<{ title?: string; action?: string; posterPath?: string | null; type?: string }> = [];
export const useToastStore = Object.assign(() => () => {}, { getState: () => ({ showToast: (toast: unknown, type?: string) => { if (toast && typeof toast === 'object') toasts.push({ ...(toast as Record<string, string>), type }); } }) });
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
// v1.4.281 : une annulation dans « Programmés » relit la présence de la fiche (épisode à nouveau sélectionnable).
export const useMediaPresenceStore = { getState: () => ({ checkPresence: async (params: { tmdbId?: number | string; forceRefresh?: boolean }) => { telemetry.presence.push(`${params.tmdbId}:${params.forceRefresh === true}`); return {}; } }) };
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
// Rangée « Téléchargés » : imports Sonarr/Radarr des 7 derniers jours (un grab et un doublon d'import en piège).
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const SONARR_IMPORTS = [
  { eventType: 'downloadFolderImported', date: ago(0.1), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 10 }, series: { title: 'Severance', tmdbId: 95396, year: 2022, ratings: { value: 8.4 } } },
  { eventType: 'downloadFolderImported', date: ago(0.2), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 9 }, series: { title: 'Severance', tmdbId: 95396 } },
  { eventType: 'downloadFolderImported', date: ago(0.3), seriesId: 7, episode: { seasonNumber: 2, episodeNumber: 10 }, series: { title: 'Severance', tmdbId: 95396 } },
  { eventType: 'grabbed', date: ago(0.4), seriesId: 8, episode: { seasonNumber: 1, episodeNumber: 4 }, series: { title: 'A Knight of the Seven Kingdoms', tmdbId: 224372 } },
  { eventType: 'downloadFolderImported', date: ago(1), seriesId: 8, episode: { seasonNumber: 1, episodeNumber: 3 }, series: { title: 'A Knight of the Seven Kingdoms', tmdbId: 224372 } }
];
// Dune (TMDB 4) est aussi un téléchargement terminé suivi : il n'est pas répété dans « Terminés ».
const RADARR_IMPORTS = [{ eventType: 3, date: ago(3), movieId: 40, movie: { title: 'Dune', tmdbId: 4, year: 2021, ratings: { tmdb: { value: 7.8 } } } }];
// v1.4.284 — « Retirer » : Severance (Sonarr 7) n'attend plus rien ; A Knight… (Sonarr 8) a encore un épisode programmé.
const SONARR_EPISODES: Record<string, Array<{ monitored: boolean; hasFile: boolean }>> = { 7: [{ monitored: true, hasFile: true }], 8: [{ monitored: true, hasFile: true }, { monitored: true, hasFile: false }] };
// Recherchés (wanted/missing) de la page « Programmés » : un épisode de L'Arène sorti sans fichier et un film disponible.
// Affiche Sonarr de L'Arène : la carte et le toast d'annulation la gardent (retour terrain du 09/11 sur la v1.4.285).
const ARENE_IMAGES = [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/arene.jpg' }];
// Quatre épisodes pour L'Arène au total : repliés par défaut en vue détaillée (retour terrain du 09/11, MobLand).
const SONARR_WANTED = [6, 7].map(episodeNumber => ({ id: 792 + episodeNumber, seriesId: 5, seasonNumber: 1, episodeNumber, title: `Épisode ${episodeNumber}`, airDateUtc: ago(20 - 2 * episodeNumber), monitored: true, hasFile: false, series: { title: 'The Arena (2026)', tmdbId: 77, monitored: true, qualityProfileId: 4, images: ARENE_IMAGES } }));
const RADARR_WANTED = [{ id: 902, title: 'Blade Runner 2049', tmdbId: 335984, monitored: true, hasFile: false, isAvailable: true, qualityProfileId: 4, inCinemas: '2017-10-04', digitalRelease: '2018-01-16' }];
// SEENIT-DOWNLOAD-022 (retour terrain du 09/11 sur la v1.4.287) : Sonarr dit « The Arena (2026) », la fiche TMDB
// fr-FR « L'Arène » ; un titre sans fiche (Severance, Dune) garde le libellé de Sonarr/Radarr.
const TMDB_LABELS: Record<string, { title: string; posterPath: string; rating?: number; year?: number }> = {
  'tv:77': { title: "L'Arène", posterPath: '/arene-fr.jpg' },
  'tv:224372': { title: 'Le Chevalier des Sept Royaumes', posterPath: '/chevalier.jpg', rating: 8.1, year: 2026 },
};
export const tmdbArrLabelSource = {
  media: async (tmdbId: number, mediaType: 'tv' | 'movie') => TMDB_LABELS[`${mediaType}:${tmdbId}`] || null,
  episodes: async (tmdbId: number, season: number) => tmdbId === 77 && season === 1 ? new Map([[8, 'La Cage']]) : null,
};
export const executeDelete = async (url: string) => { telemetry.arrDeleted.push(url); return {}; };
export const executeGet = async (url: string) => {
  if (url.includes('/api/v3/history/since')) return telemetry.programmed ? [] : url.includes('includeMovie=true') ? RADARR_IMPORTS : SONARR_IMPORTS;
  if (url.includes('/api/v3/wanted/missing')) return { page: 1, records: !telemetry.programmed ? [] : (url.includes('includeSeries=true') ? SONARR_WANTED : RADARR_WANTED).filter(entry => !telemetry.unmonitored.some(done => done.endsWith(`/${entry.id}`))) };
  if (url.includes('/api/v3/episode?seriesId=')) return SONARR_EPISODES[url.split('=').pop() || ''] || [];
  if (url.includes('/api/v3/qualityprofile')) return [{ id: 4, name: 'HD-1080p' }, { id: 5, name: 'Ultra-HD' }];
  if (!telemetry.programmed) return [];
  // Un épisode déprogrammé n'apparaît plus au calendrier, comme dans Sonarr (l'état est relu après l'écriture).
  if (url.includes('/api/v3/calendar') && url.includes('includeSeries=true')) return ([
    { id: 801, seriesId: 5, seasonNumber: 1, episodeNumber: 8, title: 'Épisode 8', airDateUtc: inDays(7), monitored: true, hasFile: false, series: { title: 'The Arena (2026)', tmdbId: 77, monitored: true, qualityProfileId: 4, images: ARENE_IMAGES } },
    { id: 802, seriesId: 5, seasonNumber: 1, episodeNumber: 9, title: 'Épisode 9', airDateUtc: inDays(14), monitored: true, hasFile: false, series: { title: 'The Arena (2026)', tmdbId: 77, monitored: true, qualityProfileId: 4, images: ARENE_IMAGES } },
    // Non surveillé, présent ou série désactivée : jamais « programmé ».
    { id: 803, seriesId: 5, seasonNumber: 1, episodeNumber: 10, title: 'Épisode 10', airDateUtc: inDays(21), monitored: false, series: { title: 'The Arena (2026)', tmdbId: 77, monitored: true } },
    { id: 804, seriesId: 6, seasonNumber: 2, episodeNumber: 1, title: 'Pilote', airDateUtc: inDays(3), monitored: true, hasFile: false, series: { title: 'Série en pause', tmdbId: 78, monitored: false } },
    // Retour terrain du 08/11 (Harry Potter) : épisodes provisoires « TBA », nombre et dates non annoncés.
    ...[1, 2, 3].map(episodeNumber => ({ id: 810 + episodeNumber, seriesId: 7, seasonNumber: 1, episodeNumber, title: 'TBA', airDateUtc: inDays(10 + 7 * episodeNumber), monitored: true, hasFile: false, series: { title: 'Harry Potter', tmdbId: 79, monitored: true, qualityProfileId: 4 } }))
  ]).filter(entry => !telemetry.unmonitored.some(url => url.endsWith(`/api/v3/episode/${entry.id}`)));
  if (url.includes('/api/v3/calendar')) return [{ id: 901, title: 'Avatar : De feu et de cendres', tmdbId: 83533, monitored: true, hasFile: false, qualityProfileId: 5, inCinemas: inDays(5), digitalRelease: inDays(40) }];
  if (/\/api\/v3\/(?:episode|movie)\/\d+$/.test(url)) return { id: Number(url.split('/').pop()), monitored: true };
  return [];
};
export const executePut = async (url: string, body: { monitored?: boolean; qualityProfileId?: number }) => { if (body.monitored === false) telemetry.unmonitored.push(url); if (body.qualityProfileId) telemetry.qualities.push(`${url}:${body.qualityProfileId}`); return body; };
