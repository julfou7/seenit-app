export interface EpisodeDetailData extends Record<string, unknown> {
  episode_number: number;
  season_number?: number;
  name?: string;
  air_date?: string | null;
  still_path?: string | null;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
}
