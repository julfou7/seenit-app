const tmdb = require('./src/features/shows/tmdb').tmdb;
(async () => {
  const res = await tmdb.searchMulti('The Odyssey');
  const movie = res.value.results.find(r => r.media_type === 'movie' && r.title === 'The Odyssey' && r.release_date && r.release_date.startsWith('2026'));
  console.log(movie ? movie.release_date : 'Not found');
})();
