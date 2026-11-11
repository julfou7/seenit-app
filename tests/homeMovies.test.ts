import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Show } from '../src/types.ts';
import { featuredMoviePool, formatMovieRating, formatMovieRuntime, formatReleaseCountdown, homeMovieRelease, nextFeaturedSeed, pickFeaturedMovie, readHomeMovieFacts, sortHomeMovies, type HomeMovieFacts } from '../src/features/watchlist/homeMovies.ts';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const film = (id: string, extra: Partial<Show> = {}): Show => ({ id, userId: 'u', tmdbId: Number(id.replace(/\D/g, '')) || 1, mediaType: 'movie', title: id, posterPath: null, backdropPath: null, status: 'plan_to_watch', isArchived: false, seenEpisodes: [], episodeRecords: {}, createdAt: 1, updatedAt: 1, ...extra });
const now = new Date(2026, 10, 11, 20, 0).getTime();

test('SEENIT-UX-022 lit note, genre et date de sortie dans les détails sans en inventer', () => {
  const facts = readHomeMovieFacts(film('f1'), { vote_average: 7.234, vote_count: 120, genres: [{ id: 35, name: 'Comédie' }], release_date: '2026-04-29' });
  assert.deepEqual(facts, { rating: 7.2, genre: 'Comédie', releaseDate: '2026-04-29' });
  assert.deepEqual(readHomeMovieFacts(film('f2'), { vote_average: 0, vote_count: 0, genres: [] }), { rating: null, genre: null, releaseDate: null });
  assert.equal(readHomeMovieFacts(film('f3', { firstAirDate: '2026-12-09' }), null).releaseDate, '2026-12-09');
  assert.equal(formatMovieRating(7.2), '7,2');
  assert.equal(formatMovieRuntime(119), '1 h 59');
  assert.equal(formatMovieRuntime(120), '2 h');
  assert.equal(formatMovieRuntime(45), '45 min');
  assert.equal(formatMovieRuntime(null), null);
});

test('SEENIT-UX-022 un film non sorti a un compte à rebours ; une date inconnue vaut sortie', () => {
  const upcoming = homeMovieRelease('2026-12-10', false, now);
  assert.equal(upcoming.kind, 'upcoming');
  assert.equal(upcoming.kind === 'upcoming' && upcoming.days, 29);
  assert.deepEqual(upcoming.kind === 'upcoming' && formatReleaseCountdown(upcoming).value, '29 j');
  const tomorrow = homeMovieRelease('2026-11-12', false, now);
  assert.equal(tomorrow.kind === 'upcoming' && formatReleaseCountdown(tomorrow).value, 'demain');
  assert.equal(homeMovieRelease('2026-11-11', false, now).kind, 'released');
  assert.equal(homeMovieRelease(null, false, now).kind, 'released');
  assert.equal(homeMovieRelease('2026-11-01', true, now).kind, 'cinema');
});

test('SEENIT-UX-022 trie Récents, Mieux notés (sans note en dernier) et filtre Chez moi', () => {
  const movies = [film('a1'), film('b2'), film('c3'), film('d4')];
  const ratings: Record<string, number | null> = { a1: 6.1, b2: null, c3: 8.4, d4: 7 };
  const facts = (show: Show): HomeMovieFacts => ({ rating: ratings[show.id], genre: null, releaseDate: null });
  const home = (show: Show) => show.id === 'b2' || show.id === 'd4';
  assert.deepEqual(sortHomeMovies(movies, 'recent', facts, home).map(show => show.id), ['a1', 'b2', 'c3', 'd4']);
  assert.deepEqual(sortHomeMovies(movies, 'rated', facts, home).map(show => show.id), ['c3', 'd4', 'a1', 'b2']);
  assert.deepEqual(sortHomeMovies(movies, 'home', facts, home).map(show => show.id), ['b2', 'd4']);
});

test('SEENIT-UX-022 À l’affiche tire parmi les dix mieux notés, sortis et non vus, jamais sous trois films', () => {
  const movies = Array.from({ length: 14 }, (_, index) => film(`m${index + 1}`));
  const facts = (show: Show): HomeMovieFacts => {
    const index = Number(show.id.slice(1));
    return { rating: index === 2 ? null : index, genre: null, releaseDate: index === 14 ? '2027-01-01' : null };
  };
  movies[12] = { ...movies[12], seenEpisodes: ['movie'] };
  const pool = featuredMoviePool(movies, facts, now);
  assert.equal(pool.length, 10);
  assert.ok(!pool.some(show => ['m2', 'm13', 'm14'].includes(show.id)), 'sans note, vu ou non sorti exclus');
  assert.equal(pool[0].id, 'm12');
  assert.deepEqual(featuredMoviePool(movies.slice(0, 3), facts, now), [], 'deux films notés ne suffisent pas');
  const first = pickFeaturedMovie(pool, 3, null)!;
  assert.equal(pickFeaturedMovie(pool, 7, first.id), first, 'le film affiché reste tant qu’il est éligible');
  for (const draw of [0, 0.4, 0.99]) assert.notEqual(pool[nextFeaturedSeed(pool, 3, first.id, () => draw)].id, first.id);
  assert.equal(pickFeaturedMovie([], 1), null);
});

test('SEENIT-UX-022 l’accueil branche tri, À l’affiche, billets sans coupe et pas de Vu avant la sortie', () => {
  const section = read('src/screens/WatchNextSection.tsx'), card = read('src/components/cards/MovieTicketCard.tsx'), css = read('src/screens/watchNext18c.css');
  assert.match(section, /aria-label="Trier les films à voir"/);
  assert.match(section, /\['recent', 'Récents'\], \['rated', 'Mieux notés'\], \['home', 'Chez moi'\]/);
  assert.match(section, /<FeaturedMovieCard/);
  assert.doesNotMatch(section, /home-movie-order|Ajouts les plus récents|ce soir/i);
  assert.match(card, /\{canMark && <SeenItCheckButton/);
  assert.equal((card.match(/\{canMark && <SeenItCheckButton/g) || []).length, 2, 'les deux présentations');
  assert.match(css, /SEENIT-UX-022[^]*\.movie-ticket h3,\.movie-ticket--poster > h3 \{ display:block; height:auto; min-height:0; overflow:visible; -webkit-line-clamp:unset/);
  assert.doesNotMatch(read('src/components/cards/FeaturedMovieCard.tsx'), /ce soir/i);
});

test('SEENIT-UX-022 revue Codex #943 : notes chargées pour toute la liste, Chez moi sans plateforme = Plex seul, diffuseurs périmés réactualisés', () => {
  const section = read('src/screens/WatchNextSection.tsx');
  assert.match(section, /const missingDetailsKey = orderedMovies\.filter\(show => show\.tmdbId && !movieFactsStore\.current\.has\(show\.tmdbId\) && !movieDetails\(show\)\)/);
  assert.match(section, /const result = await tmdb\.getMovieDetails\(show\.tmdbId\)/);
  assert.match(section, /if \(details && current\) rememberMovieFacts\(show, details\)/, 'les faits survivent à l’éviction des caches bornés');
  assert.match(section, /if \(!preferredPlatforms\.length\) return false;/);
  assert.match(section, /!readWatchProviderCache\(show\.tmdbId, 'movie'\)\)\.map\(show => show\.tmdbId\)/, 'un cache périmé est rechargé');
});

test('SEENIT-UX-022 revue Codex #943 : la preuve « en salle » survit au redémarrage, sinon le billet la recharge', async () => {
  const { createMediaDetailRenderSnapshot, MEDIA_DETAIL_RENDER_SCHEMA_VERSION } = await import('../src/features/shows/mediaDetailRenderSnapshot.ts');
  const snapshot = createMediaDetailRenderSnapshot({ id: 7, runtime: 115, release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2026-10-01' }] }, { iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2026-10-22T00:00:00.000Z', note: '', certification: '' }] }] } }, 'movie');
  assert.equal(MEDIA_DETAIL_RENDER_SCHEMA_VERSION, 4);
  assert.deepEqual(snapshot.release_dates, { results: [{ iso_3166_1: 'FR', release_dates: [{ type: 3, release_date: '2026-10-22T00:00:00.000Z' }] }] });
  assert.equal(createMediaDetailRenderSnapshot({ id: 8, name: 'Série' }, 'tv').release_dates, undefined);
  const card = read('src/components/cards/MovieTicketCard.tsx');
  assert.match(card, /onEnrich: runtime && !missingProof \? undefined : enrich/);
  assert.match(card, /\(movieRuntime\(show, known\) && !needsCinemaProof\(known\)\)\) return;/);
});
