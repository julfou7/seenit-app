import { cleanUrl, executeGet, fetchQualityProfiles, searchAndDownloadInSonarr } from '../../services/sonarrRadarr';
import { executePut } from '../../services/sonarrRadarrTransport';
import { resolveEffectiveQualityProfileId } from './qualityProfileSelection';
import { isDownloadFeatureEnabled } from './downloadFeatureVisibility';
import { auth } from '../../lib/firebase';
import type { useDownloadConfigStore } from '../../store/downloadConfigStore';
import type { DownloadQualityChoice } from './downloadLaunch';

type DownloadConfig = ReturnType<typeof useDownloadConfigStore.getState>;
type SonarrRecord = Record<string, unknown>;
type SonarrEpisode = SonarrRecord & { id?: number; seasonNumber?: number; episodeNumber?: number; hasFile?: boolean; monitored?: boolean };
type SonarrSeries = SonarrRecord & { id?: number; qualityProfileId?: number; monitored?: boolean };

/** Accès Sonarr injectables (tests) ; par défaut, les services réels. */
export interface EpisodeProgrammingIo {
  get: (url: string, headers: Record<string, string>) => Promise<unknown>;
  put: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;
  profiles: (url: string, apiKey: string) => Promise<{ id: number; name: string }[]>;
  ensureSeries: typeof searchAndDownloadInSonarr;
  wait: (ms: number) => Promise<void>;
}

const defaultIo: EpisodeProgrammingIo = {
  get: executeGet,
  put: executePut,
  profiles: (url, apiKey) => fetchQualityProfiles('sonarr', url, apiKey),
  ensureSeries: searchAndDownloadInSonarr,
  wait: ms => new Promise(resolve => setTimeout(resolve, ms))
};

export interface EpisodeProgrammingRequest {
  title: string;
  tmdbId: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  season: number;
  episodes: readonly number[];
  qualityPreference: DownloadQualityChoice;
  /** Configuration courante, relue avant chaque écriture Sonarr. */
  readConfig: () => DownloadConfig;
  /** Compte courant ; par défaut l'utilisateur Firebase connecté. */
  readOwner?: () => string | undefined;
  io?: EpisodeProgrammingIo;
}

export interface EpisodeProgrammingResult {
  /** Épisodes désormais surveillés par Sonarr (programmés par cet appel ou déjà surveillés). */
  programmed: number[];
  /** Épisodes encore inconnus de Sonarr : impossibles à programmer pour l'instant. */
  unannounced: number[];
  /** Raison d'un échec global (aucun épisode programmé). */
  failure?: string;
  /** Le compte, le gate ou le serveur a changé en cours de route : arrêt sans écriture supplémentaire. */
  interrupted: boolean;
}

const sonarrTarget = (config: DownloadConfig) => `${cleanUrl(config.sonarrUrl || '')}\n${config.sonarrApiKey || ''}`;

/**
 * #879 — Programmer des épisodes à venir : Sonarr les surveille et les télécharge à leur sortie, dans la
 * qualité choisie. La série est d'abord vérifiée par son identité exacte (TMDB → TVDB), ajoutée au besoin
 * sans aucune recherche ni surveillance globale, puis seuls les épisodes demandés passent en surveillés.
 * Rien n'est recherché ni téléchargé maintenant ; un épisode présent n'est jamais touché. Comme le lot de
 * téléchargement, l'appel reste attaché au compte, au gate et au serveur Sonarr qui l'ont lancé.
 */
export async function programArrEpisodes({ title, tmdbId, tvdbId, imdbId, season, episodes, qualityPreference, readConfig, readOwner = () => auth.currentUser?.uid, io = defaultIo }: EpisodeProgrammingRequest): Promise<EpisodeProgrammingResult> {
  const result: EpisodeProgrammingResult = { programmed: [], unannounced: [], interrupted: false };
  const owner = readOwner();
  const initial = readConfig();
  if (!owner || !isDownloadFeatureEnabled(initial) || !initial.sonarrUrl || !initial.sonarrApiKey || !episodes.length) return { ...result, interrupted: true };
  const stillOwned = () => {
    const config = readConfig();
    return readOwner() === owner && isDownloadFeatureEnabled(config) && sonarrTarget(config) === sonarrTarget(initial);
  };
  const base = cleanUrl(initial.sonarrUrl);
  const headers = { 'X-Api-Key': initial.sonarrApiKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  const qualityLabel = qualityPreference === '4k' ? '4K' : '1080p';

  try {
    let profileId = (qualityPreference === '4k' ? initial.sonarr4kProfileId : initial.sonarr1080pProfileId) ?? undefined;
    if (!profileId) profileId = resolveEffectiveQualityProfileId(await io.profiles(initial.sonarrUrl, initial.sonarrApiKey), qualityPreference);
    if (!profileId) return { ...result, failure: `Aucun profil ${qualityLabel} compatible n’est disponible dans Sonarr.` };

    const ensured = await io.ensureSeries({ url: initial.sonarrUrl, apiKey: initial.sonarrApiKey, title, tmdbId, tvdbId, imdbId, season, episode: episodes[0], qualityProfileId: profileId, qualityPreference, ensureOnly: true });
    const seriesId = ensured.success ? ensured.target?.seriesId : undefined;
    if (!seriesId) return { ...result, failure: ensured.message || 'Sonarr n’a pas confirmé la série exacte.' };
    if (!stillOwned()) return { ...result, interrupted: true };

    // La qualité choisie s'applique à la série, comme pour un téléchargement immédiat.
    const series = await io.get(`${base}/api/v3/series/${seriesId}`, headers) as SonarrSeries | null;
    if (series && (series.qualityProfileId !== profileId || series.monitored !== true)) {
      if (!stillOwned()) return { ...result, interrupted: true };
      await io.put(`${base}/api/v3/series`, { ...series, qualityProfileId: profileId, monitored: true }, headers);
    }

    // Une série tout juste ajoutée n'a ses épisodes qu'après son premier rafraîchissement Sonarr.
    let known: SonarrEpisode[] = [];
    for (let attempt = 0; attempt < 4 && !known.length; attempt += 1) {
      if (attempt) await io.wait(450 * attempt);
      const list = await io.get(`${base}/api/v3/episode?seriesId=${seriesId}`, headers);
      known = Array.isArray(list) ? list as SonarrEpisode[] : [];
    }
    for (const episode of episodes) {
      const target = known.find(entry => Number(entry.seasonNumber) === Number(season) && Number(entry.episodeNumber) === Number(episode));
      if (!target?.id) { result.unannounced.push(episode); continue; }
      if (target.hasFile === true) continue;
      if (target.monitored !== true) {
        if (!stillOwned()) return { ...result, interrupted: true };
        await io.put(`${base}/api/v3/episode/${target.id}`, { ...target, monitored: true }, headers);
      }
      result.programmed.push(episode);
    }
  } catch (error: unknown) {
    return { ...result, failure: (error instanceof Error && error.message) || 'Impossible de joindre Sonarr.' };
  }
  return result;
}

/** Ligne de toast du bilan (maquette : « 2 ajoutés · 1 programmé · 1080p »). */
export function programmingSummary(now: number, programmed: number, quality: DownloadQualityChoice): string {
  const parts = [now ? `${now} ajouté${now > 1 ? 's' : ''}` : '', programmed ? `${programmed} programmé${programmed > 1 ? 's' : ''}` : ''].filter(Boolean);
  return `${parts.join(' · ')} · ${quality === '4k' ? '4K' : '1080p'}`;
}
