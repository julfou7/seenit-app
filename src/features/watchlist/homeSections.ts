import type { Show } from '../../types';
import { resolveWatchCardResume } from './watchCardResume.ts';

const DAY_MS = 86_400_000;
/** Fenêtre de l'accueil (SEENIT §5.1) : une sortie ou un visionnage de 60 jours au plus. */
export const HOME_RECENT_WINDOW_MS = 60 * DAY_MS;

/** Date de diffusion TMDB (« AAAA-MM-JJ ») lue à minuit local, comme le reste de l'accueil. */
function airTime(date?: string | null): number {
  if (!date) return 0;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Retour terrain du 08/11 (« un nouvel épisode de MobLand ») : « Nouveautés » est réservé à une saison dont
 * tu en es à l'épisode 1 — nouvelle saison, ou série pas encore commencée — sortie depuis 60 jours au plus.
 * L'épisode est celui de la carte (`resolveWatchCardResume`), jamais la seule date de première diffusion de
 * la série : un épisode 5 qui sort n'est pas une nouveauté. (Une série sans aucune date de diffusion n'est
 * déjà pas candidate à l'accueil : `hasAiredEpisodeEvidence`.)
 */
export function isSeasonStartNouveaute(show: Show, today: string, now: number): boolean {
  const { episode } = resolveWatchCardResume(show, today);
  if (!episode || episode.episode_number !== 1) return false;
  const released = airTime(episode.air_date);
  return released > 0 && released <= now + DAY_MS && now - released <= HOME_RECENT_WINDOW_MS;
}

/**
 * Sortie du prochain épisode quand elle est postérieure à ton dernier visionnage (tu étais à jour, il
 * t'attend), 0 sinon. Même épisode que la carte. Une sortie postérieure à maintenant (horloge ou fuseau
 * décalés) n'est jamais une activité : elle ne doit pas figer la série en tête.
 */
export function newEpisodeArrival(show: Show, today: string, lastWatched: number, now: number): number {
  if (!(show.seenEpisodes?.length) || lastWatched <= 0) return 0;
  const { episode } = resolveWatchCardResume(show, today);
  const released = airTime(episode?.air_date);
  return released > lastWatched && released <= now ? released : 0;
}

export interface ContinueWatchingKey { activity: number }

/**
 * Dernière activité d'une série : son dernier visionnage, ou la sortie d'un nouvel épisode depuis ce
 * visionnage. Un épisode sorti aujourd'hui passe devant tout ce qui a été vu avant ; ce qu'on regarde
 * ensuite (ici ou ailleurs) repasse devant lui.
 */
export function continueWatchingKey(show: Show, lastWatched: number, today: string, now: number): ContinueWatchingKey {
  return { activity: Math.max(lastWatched, newEpisodeArrival(show, today, lastWatched, now)) };
}

/** Ordre de « Continuer à regarder » : activité la plus récente en tête. */
export function compareContinueWatching(a: ContinueWatchingKey, b: ContinueWatchingKey): number {
  return b.activity - a.activity;
}
