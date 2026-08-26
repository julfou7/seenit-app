import { tmdb } from './src/features/shows/tmdb';

async function run() {
  const res = await tmdb.searchMulti('Daredevil');
  console.log(res.value?.results.map((r: any) => r.name || r.title));
}
run();
