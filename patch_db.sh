sed -i '/totalEpisodes?: number;/a \  networks?: { id: number, name: string, logo_path: string | null }[];' src/core/db.ts
