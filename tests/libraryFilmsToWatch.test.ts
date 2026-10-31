import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Show } from '../src/types.ts';
import { orderWatchMovies } from '../src/features/watchlist/watchNext18c.ts';

const librarySource = readFileSync('src/screens/LibraryScreen.tsx', 'utf8');
const homeSource = readFileSync('src/screens/WatchNextSection.tsx', 'utf8');

const movie = (id: string, tmdbId: number, createdAt: number): Show => ({
  id,
  userId: 'uid',
  tmdbId,
  title: id,
  mediaType: 'movie',
  posterPath: '/poster.jpg',
  backdropPath: null,
  status: 'plan_to_watch',
  isArchived: false,
  updatedAt: createdAt,
  createdAt,
  seenEpisodes: [],
  episodeRecords: {},
});

test('Films à voir · accueil et Moi partagent l’ordre par date d’ajout', () => {
  const ordered = orderWatchMovies([
    movie('ancien', 30, 100),
    movie('recent-b', 20, 300),
    movie('recent-a', 10, 300),
  ]);

  assert.deepEqual(ordered.map(show => show.id), ['recent-a', 'recent-b', 'ancien']);
  assert.match(homeSource, /const sortedMovies = orderWatchMovies\(\[\.\.\.movieById\.values\(\)\]\)/);
  assert.match(librarySource, /const toWatchMovie = orderWatchMovies\(shows\.filter\(/);
});

test('Moi · Charger plus reprend les mini-affiches de l’accueil par lots de 12', () => {
  assert.match(librarySource, /import \{ HomeLoadMore \} from '\.\.\/components\/cards\/HomeLoadMore';/);
  assert.match(librarySource, /import '\.\/watchListHome\.css';/);
  assert.match(librarySource, /className="col-span-full"/);
  assert.match(
    librarySource,
    /<HomeLoadMore[\s\S]*items=\{data\.slice\(visibleCount\)\.map\(item => item\.show\)\}[\s\S]*step=\{LIBRARY_GRID_BATCH_SIZE\}/,
  );
  assert.doesNotMatch(librarySource, /className="moi-more"/);
});
