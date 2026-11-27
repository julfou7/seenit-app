import type { SeasonProgressEvidence, Show } from '../../types.ts';
import { resolveWatchCardResume } from './watchCardResume.ts';

/**
 * « Ça revient » (retour terrain du 27/11, maquette validée) : sous « Continuer à regarder », les séries que tu
 * aimes et que tu as suivies jusqu'au bout reviennent bientôt.
 * - retour : nouvelle saison datée d'une série dont tu as vu toute la saison précédente ;
 * - première : saison 1 d'une série de ta liste, pas encore commencée ;
 * - finale : dernier épisode de saison d'une série où tu es à jour.
 * Retour terrain du 27/11 sur les vraies données :
 * - un retour où tu es à jour s'annonce jusqu'à 120 jours (une nouvelle saison se date des mois avant) ;
 * - dans les 45 jours, un retour ou une finale d'une saison commencée mais pas finie s'affiche aussi, avec le
 *   nombre d'épisodes à rattraper avant la sortie.
 * Le jour de la sortie, la série quitte « Ça revient » pour Nouveautés ou Continuer à regarder (règles existantes).
 */
export type ComingBackKind = 'return' | 'premiere' | 'finale';

export interface ComingBackEpisode {
  season_number: number;
  episode_number: number;
  air_date: string;
  name?: string | null;
  still_path?: string | null;
}

export interface ComingBackItem {
  show: Show;
  kind: ComingBackKind;
  episode: ComingBackEpisode;
  days: number;
  /** Étiquette de la carte, en casse normale (affichée en capitales). */
  label: string;
  /** Pourquoi la série est là, avec les mots de l'interface. */
  reason: string;
  /** Épisodes sortis à rattraper avant la sortie (0 : tu es à jour). */
  behind: number;
}

export const COMING_BACK_HORIZON_DAYS = 45;
/** Un retour où tu es à jour s'annonce plus tôt : les nouvelles saisons sont datées des mois à l'avance. */
export const COMING_BACK_RETURN_HORIZON_DAYS = 120;
/** Huit cartes : avec les retours lointains et le rattrapage, cinq coupaient déjà une série à jour (27/11). */
export const COMING_BACK_LIMIT = 8;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_ORDER: Record<ComingBackKind, number> = { return: 0, finale: 1, premiere: 2 };

function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Jours calendaires entre aujourd'hui et la sortie, sans dépendre de l'heure ni du changement d'heure. */
export function comingBackDays(airDate: string, today: string): number {
  return Math.round((utcDay(airDate) - utcDay(today)) / 86_400_000);
}

function seenKeys(show: Show): Set<string> {
  return new Set((show.seenEpisodes || []).flatMap(key => {
    const match = /^(?:s\s*)?(\d+)\s*(?:x|e)\s*(\d+)$/i.exec(key.trim());
    return match ? [`${Number(match[1])}x${Number(match[2])}`] : [];
  }));
}

function seenInSeason(seen: Set<string>, season: number): number {
  let count = 0;
  for (const key of seen) if (key.startsWith(`${season}x`)) count += 1;
  return count;
}

/** Total d'épisodes d'une saison seulement s'il est prouvé (preuve de saison synchronisée), sinon null. */
function provenSeasonTotal(evidence: Partial<SeasonProgressEvidence> | null | undefined): number | null {
  if (!evidence) return null;
  if (typeof evidence.episode_count === 'number' && evidence.episode_count > 0) return evidence.episode_count;
  const known = Number(evidence.known_episodes_in_season);
  return evidence.season_total_unknown === false && known > 0 ? known : null;
}

function validPointer(show: Show): ComingBackEpisode | null {
  const pointer = show.nextEpisodeToAir;
  const season = Number(pointer?.season_number);
  const episode = Number(pointer?.episode_number);
  if (!pointer || !Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) return null;
  if (typeof pointer.air_date !== 'string' || !ISO_DATE.test(pointer.air_date)) return null;
  return { season_number: season, episode_number: episode, air_date: pointer.air_date, name: pointer.name, still_path: pointer.still_path };
}

/**
 * Saison précédente vue en entier : par son total prouvé ; sinon, il ne reste rien de sorti à voir (tous les
 * épisodes diffusés vus, ou aucun épisode sorti à reprendre).
 */
function previousSeasonComplete(show: Show, seen: Set<string>, season: number, today: string): boolean {
  const watched = seenInSeason(seen, season);
  if (watched === 0) return false;
  const total = provenSeasonTotal(show.seasonProgress?.[String(season)]);
  if (total !== null) return watched >= total;
  const aired = show.totalAiredEpisodes;
  if (typeof aired === 'number' && aired > 0) return seen.size >= aired;
  return resolveWatchCardResume(show, today).episode === null;
}

/** Épisodes d'une saison commencée qui restent à voir, seulement si le total de la saison est prouvé. */
function provenBehind(show: Show, seen: Set<string>, season: number, total: number | null = provenSeasonTotal(show.seasonProgress?.[String(season)])): number {
  const watched = seenInSeason(seen, season);
  if (watched === 0 || total === null) return 0;
  return Math.max(0, total - watched);
}

function behindReason(behind: number): string {
  return `${behind} épisode${behind > 1 ? 's' : ''} à rattraper`;
}

function returnReason(seen: Set<string>, previous: number): string {
  const allSeasonsStarted = previous >= 2 && Array.from({ length: previous }, (_, index) => index + 1).every(season => seenInSeason(seen, season) > 0);
  return allSeasonsStarted ? `À jour · ${previous} saisons vues` : `Saison ${previous} vue en entier`;
}

/** Classe une série de la liste, ou null si elle n'a rien à faire dans « Ça revient ». */
export function classifyComingBack(show: Show, today: string): ComingBackItem | null {
  if (show.mediaType === 'movie' || show.isArchived || show.status === 'dropped') return null;
  const episode = validPointer(show);
  if (!episode) return null;
  const days = comingBackDays(episode.air_date, today);
  if (days < 1 || days > COMING_BACK_RETURN_HORIZON_DAYS) return null;
  const near = days <= COMING_BACK_HORIZON_DAYS;
  const seen = seenKeys(show);
  const { season_number: season, episode_number: number } = episode;

  if (season === 1 && number === 1 && seen.size === 0) {
    return near ? { show, kind: 'premiere', episode, days, label: 'Première', reason: 'Dans ta liste', behind: 0 } : null;
  }
  if (number === 1 && season >= 2) {
    const label = `Retour · saison ${season}`;
    if (previousSeasonComplete(show, seen, season - 1, today)) {
      return { show, kind: 'return', episode, days, label, reason: returnReason(seen, season - 1), behind: 0 };
    }
    const behind = near ? provenBehind(show, seen, season - 1) : 0;
    return behind > 0 ? { show, kind: 'return', episode, days, label, reason: behindReason(behind), behind } : null;
  }
  if (number >= 2 && near) {
    const total = provenSeasonTotal(show.seasonProgress?.[String(season)] ?? show.nextEpisodeToAir);
    if (total !== number) return null;
    const label = `Finale · saison ${season}`;
    const upToDate = Array.from({ length: number - 1 }, (_, index) => index + 1).every(previous => seen.has(`${season}x${previous}`));
    if (upToDate) {
      const watched = number - 1;
      return { show, kind: 'finale', episode, days, label, reason: `À jour · ${watched} épisode${watched > 1 ? 's' : ''} vu${watched > 1 ? 's' : ''}`, behind: 0 };
    }
    // Les épisodes avant la finale, pas la finale elle-même : c'est elle qu'on attend.
    const behind = provenBehind(show, seen, season, number - 1);
    return behind > 0 ? { show, kind: 'finale', episode, days, label, reason: behindReason(behind), behind } : null;
  }
  return null;
}

/** Les cartes « Ça revient » : la sortie la plus proche d'abord, huit au plus. */
export function selectComingBack(shows: readonly Show[], today: string, limit = COMING_BACK_LIMIT): ComingBackItem[] {
  return shows.flatMap(show => { const item = classifyComingBack(show, today); return item ? [item] : []; })
    .sort((a, b) => a.days - b.days || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.show.title.localeCompare(b.show.title, 'fr'))
    .slice(0, limit);
}

export interface ComingBackCountdown {
  /** Sous une semaine, le compte à rebours en grand ; au-delà, la date. */
  near: boolean;
  headline: string;
  detail: string;
  /** Jours déjà écoulés de la semaine qui mène à la sortie (barre de sept segments). */
  elapsed: number;
}

export function comingBackCountdown(airDate: string, days: number): ComingBackCountdown {
  const date = new Date(`${airDate}T12:00:00`);
  if (days <= 7) {
    return { near: true, headline: `J-${days}`, detail: new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date), elapsed: 7 - days };
  }
  const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(date);
  return { near: false, headline: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date), detail: `${weekday} · J-${days}`, elapsed: 0 };
}
