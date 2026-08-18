sed -i '/poster_path: string | null;/a \  backdrop_path?: string | null;\n  vote_average?: number;\n  genre_ids?: number[];' src/features/shows/tmdb.ts
