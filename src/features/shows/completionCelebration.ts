import { create } from 'zustand';

/**
 * #436 — Célébration d'une fin réelle de saison, ou du final absolu d'une série.
 *
 * Elle se déclenche uniquement quand un marquage **individuel** « vu » fait passer la saison de
 * « au moins un épisode non vu » à « tous ses épisodes vus », tous déjà diffusés. Jamais sur un
 * numéro de final, un titre ou une action de masse. Une saison dont la liste d'épisodes n'est
 * pas connue ne déclenche rien plutôt que de deviner.
 */
export type CompletionCelebration =
  | { kind: 'season'; season: number }
  | { kind: 'series' };

export interface CompletionEpisode { episode_number: number; air_date?: string | null }

export function detectCompletionCelebration(input: {
  season: number;
  wasSeen: boolean;
  previousSeen: readonly string[];
  nextSeen: ReadonlySet<string>;
  seasonEpisodes: readonly CompletionEpisode[] | null | undefined;
  today: string;
  nextEpisodeToWatch: unknown;
  seriesEnded: boolean;
}): CompletionCelebration | null {
  const { season, wasSeen, previousSeen, nextSeen, seasonEpisodes, today, nextEpisodeToWatch, seriesEnded } = input;
  if (wasSeen || season <= 0 || !seasonEpisodes?.length) return null;
  const isAired = (episode: CompletionEpisode) => typeof episode.air_date === 'string' && episode.air_date.length >= 10 && episode.air_date.slice(0, 10) <= today;
  // Retour terrain du 23/11 (Singapura) : une saison dont un épisode est encore annoncé (date future ou inconnue)
  // n'est pas terminée ; finir les épisodes déjà diffusés ne la célèbre pas.
  if (seasonEpisodes.some(episode => !isAired(episode))) return null;
  const aired = seasonEpisodes.map(episode => `${season}x${episode.episode_number}`);
  const before = new Set(previousSeen);
  const wasComplete = aired.every(key => before.has(key));
  const isComplete = aired.every(key => nextSeen.has(key));
  if (wasComplete || !isComplete) return null;
  return !nextEpisodeToWatch && seriesEnded ? { kind: 'series' } : { kind: 'season', season };
}

export interface CelebrationEntry { celebration: CompletionCelebration; title: string; id: number }

interface CelebrationState {
  current: CelebrationEntry | null;
  celebrate: (celebration: CompletionCelebration | null, title: string) => void;
  dismiss: () => void;
}

let sequence = 0;
export const useCelebrationStore = create<CelebrationState>(set => ({
  current: null,
  celebrate: (celebration, title) => { if (celebration) set({ current: { celebration, title, id: ++sequence } }); },
  dismiss: () => set({ current: null }),
}));

export function celebrationCopy(entry: CelebrationEntry): { heading: string; body: string } {
  return entry.celebration.kind === 'series'
    ? { heading: 'Série terminée !', body: `Tu as vu tout « ${entry.title} ». Bravo !` }
    : { heading: `Saison ${entry.celebration.season} terminée !`, body: `Encore une saison de « ${entry.title} » dans la poche.` };
}
