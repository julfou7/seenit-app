import { tmdb } from './src/features/shows/tmdb';

global.localStorage = { getItem: () => null } as any;

async function run() {
  const res = await tmdb.searchMulti('Daredevil');
  const items = res.value?.results || [];
  for (const item of items.slice(0, 5)) {
    console.log(item.name || item.title, "Pop:", item.popularity, "Votes:", item.vote_count);
  }
}
run();
