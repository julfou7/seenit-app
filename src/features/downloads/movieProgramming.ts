import { cleanUrl, executeGet, fetchQualityProfiles, searchAndDownloadInRadarr } from '../../services/sonarrRadarr';
import { executePut } from '../../services/sonarrRadarrTransport';
import { resolveEffectiveQualityProfileId } from './qualityProfileSelection';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import { auth } from '../../lib/firebase';
import type { useDownloadConfigStore } from '../../store/downloadConfigStore';
import type { DownloadQualityChoice } from './downloadLaunch';

type DownloadConfig = ReturnType<typeof useDownloadConfigStore.getState>;
type RadarrMovie = Record<string, unknown> & { id?: number; tmdbId?: number; hasFile?: boolean; monitored?: boolean; qualityProfileId?: number };

/** Accès Radarr injectables (tests) ; par défaut, les services réels. */
export interface MovieProgrammingIo {
  get: (url: string, headers: Record<string, string>) => Promise<unknown>;
  put: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;
  profiles: (url: string, apiKey: string) => Promise<{ id: number; name: string }[]>;
  ensureMovie: typeof searchAndDownloadInRadarr;
}

const defaultIo: MovieProgrammingIo = {
  get: executeGet,
  put: executePut,
  profiles: (url, apiKey) => fetchQualityProfiles('radarr', url, apiKey),
  ensureMovie: searchAndDownloadInRadarr
};

export interface MovieProgrammingRequest {
  title: string;
  tmdbId: number | string;
  imdbId?: string;
  year?: number;
  qualityPreference: DownloadQualityChoice;
  /** Configuration courante, relue avant chaque écriture Radarr. */
  readConfig: () => DownloadConfig;
  /** Compte courant ; par défaut l'utilisateur Firebase connecté. */
  readOwner?: () => string | undefined;
  io?: MovieProgrammingIo;
}

export interface MovieProgrammingResult {
  /** Radarr surveille le film exact et le récupérera dès sa sortie. */
  programmed: boolean;
  /** Le film est déjà présent : rien n'est modifié. */
  present: boolean;
  failure?: string;
  /** Le compte, le gate ou le serveur a changé en cours de route : arrêt sans écriture supplémentaire. */
  interrupted: boolean;
}

const radarrTarget = (config: DownloadConfig) => `${cleanUrl(config.radarrUrl || '')}\n${config.radarrApiKey || ''}`;

/**
 * Maquette DlFilm — Programmer un film à venir : Radarr le surveille et le récupère dès sa sortie, dans la
 * qualité choisie. Le film est vérifié par son TMDB exact, ajouté au besoin sans aucune recherche, puis
 * surveillé dans le profil choisi. Rien n'est recherché maintenant ; un film présent n'est jamais touché.
 * L'appel reste attaché au compte, au gate et au serveur Radarr qui l'ont lancé (comme les épisodes).
 */
export async function programArrMovie({ title, tmdbId, imdbId, year, qualityPreference, readConfig, readOwner = () => auth.currentUser?.uid, io = defaultIo }: MovieProgrammingRequest): Promise<MovieProgrammingResult> {
  const result: MovieProgrammingResult = { programmed: false, present: false, interrupted: false };
  const owner = readOwner();
  const initial = readConfig();
  if (!owner || !isDownloadFeatureEnabled(initial) || !initial.radarrUrl || !initial.radarrApiKey || !(Number(tmdbId) > 0)) return { ...result, interrupted: true };
  const stillOwned = () => {
    const config = readConfig();
    return readOwner() === owner && isDownloadFeatureEnabled(config) && radarrTarget(config) === radarrTarget(initial);
  };
  const base = cleanUrl(initial.radarrUrl);
  const headers = { 'X-Api-Key': initial.radarrApiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  const qualityLabel = qualityPreference === '4k' ? '4K' : '1080p';
  try {
    let profileId = (qualityPreference === '4k' ? initial.radarr4kProfileId : initial.radarr1080pProfileId) ?? undefined;
    if (!profileId) profileId = resolveEffectiveQualityProfileId(await io.profiles(initial.radarrUrl, initial.radarrApiKey), qualityPreference);
    if (!profileId) return { ...result, failure: `Aucun profil ${qualityLabel} compatible n’est disponible dans Radarr.` };

    // `ensureOnly` peut ajouter le film (surveillé, sans recherche) : la portée est relue juste avant.
    if (!stillOwned()) return { ...result, interrupted: true };
    // La garde est aussi relue par le service juste avant l'ajout effectif (POST), après ses lectures.
    const ensured = await io.ensureMovie({ url: initial.radarrUrl, apiKey: initial.radarrApiKey, title, tmdbId, imdbId, year, qualityProfileId: profileId, qualityPreference, ensureOnly: true, canWrite: stillOwned });
    if (!stillOwned()) return { ...result, interrupted: true };
    const movieId = ensured.success ? ensured.target?.movieId : undefined;
    if (!movieId) return { ...result, failure: ensured.message || 'Radarr n’a pas confirmé le film exact.' };

    const movie = await io.get(`${base}/api/v3/movie/${movieId}`, headers) as RadarrMovie | null;
    if (!movie || Number(movie.tmdbId) !== Number(tmdbId)) return { ...result, failure: 'Radarr n’a pas confirmé le film exact.' };
    if (movie.hasFile === true) return { ...result, present: true };
    if (movie.monitored !== true || movie.qualityProfileId !== profileId) {
      if (!stillOwned()) return { ...result, interrupted: true };
      await io.put(`${base}/api/v3/movie/${movieId}`, { ...movie, monitored: true, qualityProfileId: profileId }, headers);
    }
    return { ...result, programmed: true };
  } catch (error: unknown) {
    return { ...result, failure: (error instanceof Error && error.message) || 'Impossible de joindre Radarr.' };
  }
}

/**
 * Annuler la programmation d'un film depuis sa fiche : Radarr ne le surveille plus. Le film est retrouvé
 * par son TMDB exact ; rien n'est supprimé, et un film déjà présent n'est jamais modifié.
 */
export async function unprogramArrMovie({ tmdbId, readConfig, readOwner = () => auth.currentUser?.uid, io = defaultIo }: { tmdbId: number | string; readConfig: () => DownloadConfig; readOwner?: () => string | undefined; io?: Pick<MovieProgrammingIo, 'get' | 'put'> }): Promise<{ done: boolean; failure?: string; interrupted?: boolean }> {
  const owner = readOwner();
  const config = readConfig();
  if (!owner || !isDownloadFeatureEnabled(config) || !config.radarrUrl || !config.radarrApiKey || !(Number(tmdbId) > 0)) return { done: false, failure: 'Radarr n’est pas configuré.' };
  // Comme la programmation : l'écriture reste attachée au compte, au gate et au serveur qui l'ont demandée.
  const stillOwned = () => {
    const current = readConfig();
    return readOwner() === owner && isDownloadFeatureEnabled(current) && radarrTarget(current) === radarrTarget(config);
  };
  const base = cleanUrl(config.radarrUrl);
  const headers = { 'X-Api-Key': config.radarrApiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  try {
    const list = await io.get(`${base}/api/v3/movie`, headers);
    if (!Array.isArray(list)) return { done: false, failure: 'Réponse Radarr invalide : rien n’a été modifié.' };
    const movie = (list as RadarrMovie[]).find(entry => Number(entry.tmdbId) === Number(tmdbId));
    if (!movie?.id) return { done: true };
    if (movie.hasFile === true) return { done: false, failure: 'Le film est déjà présent : rien n’a été modifié.' };
    if (movie.monitored === true) {
      if (!stillOwned()) return { done: false, interrupted: true };
      await io.put(`${base}/api/v3/movie/${movie.id}`, { ...movie, monitored: false }, headers);
    }
    return { done: true };
  } catch (error: unknown) {
    return { done: false, failure: (error instanceof Error && error.message) || 'Impossible de joindre Radarr.' };
  }
}
