import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { actorReason, actorShortName, buildActorIndex, selectTicketActor } from '../src/features/people/movieActors.ts';
import { orderWatchMovies } from '../src/features/watchlist/watchNext18c.ts';
import type { Show } from '../src/types.ts';

const show = (id: number, type: 'movie' | 'tv', seen: string[], createdAt = 1) => ({ id: String(id), tmdbId: id, userId: 'alpha', title: `Titre ${id}`, mediaType: type, createdAt, seenEpisodes: seen, posterPath: null, backdropPath: null } as Show);
const cast = [
  { id: 1, name: 'Premier Rôle', order: 0 }, { id: 2, name: 'Sean Astin', order: 1 }, { id: 3, name: 'Acteur Favori', order: 2 },
];
const librarySource = readFileSync('src/screens/LibraryScreen.tsx', 'utf8');
const homeSource = readFileSync('src/screens/WatchNextSection.tsx', 'utf8');

test('SEENIT-UX-018 choisit le favori puis le plus connu parmi dix rôles ordonnés, sans réseau', () => {
  const movies = [show(10, 'movie', ['movie']), show(11, 'tv', ['1x1', '1x2']), show(12, 'movie', [])];
  const index = buildActorIndex(movies, id => ({ credits: { cast: id === 10 ? [cast[1], cast[2]] : [cast[1]] }, runtime: 100, episode_run_time: [40] }));
  assert.equal(index[2].seen.length, 2);
  assert.equal(index[2].seen[1].minutes, 80);
  assert.equal(index[3].seen.length, 1);
  assert.equal(selectTicketActor({ credits: { cast: [...cast].reverse() } }, [], index)?.id, 2);
  assert.equal(selectTicketActor({ credits: { cast } }, [{ id: 3 }], index)?.id, 3);
  assert.equal(selectTicketActor({ credits: { cast } }, [{ id: 2 }, { id: 3 }], index)?.id, 2);
  const eleven = [...cast, ...Array.from({ length: 8 }, (_, n) => ({ id: 20 + n, name: 'Rôle', order: 3 + n }))];
  assert.equal(selectTicketActor({ credits: { cast: eleven } }, [{ id: 27 }], {})?.id, 1);
  assert.equal(selectTicketActor(null, [{ id: 2 }], index), null);
});
test('SEENIT-UX-018 traite les égalités, les doublons et le retour Non vu sans conserver une fausse connaissance', () => {
  const watched = show(10, 'movie', ['movie']);
  const index = buildActorIndex([watched, watched], () => ({ credits: { cast } }));
  assert.equal(index[1].seen.length, 1);
  assert.equal(selectTicketActor({ credits: { cast } }, [], index)?.id, 1);
  assert.deepEqual(buildActorIndex([{ ...watched, seenEpisodes: [] }], () => ({ credits: { cast } })), {});
  assert.equal(actorShortName('Sean Astin'), 'S. Astin');
  const known = selectTicketActor({ credits: { cast } }, [], index)!;
  assert.equal(actorReason(known, true), 'vu dans Titre 10');
  assert.equal(actorReason({ ...known, favorite: true }, true), '❤ favori · 1 titre vu');
  assert.equal(actorReason({ ...known, seen: [] }, false), '');
});
test('SEENIT-UX-018 conserve le même ordre malgré les mises à jour de durée et de la source', () => {
  const movies = [show(3, 'movie', [], 4), show(1, 'movie', [], 5), show(2, 'movie', [], 4)];
  const before = orderWatchMovies(movies).map(movie => movie.id);
  assert.deepEqual(before, ['1', '2', '3']);
  const enriched = [...movies].reverse().map((movie, index) => ({ ...movie, updatedAt: Date.now(), runtime: 180 - index * 40 }));
  assert.deepEqual(orderWatchMovies(enriched).map(movie => movie.id), before);
});
test('Films à voir · Moi et accueil partagent l’ordre d’ajout et le chargement visuel', () => {
  assert.match(homeSource, /const sortedMovies = orderWatchMovies\(\[\.\.\.movieById\.values\(\)\]\)/);
  assert.match(librarySource, /const toWatchMovie = orderWatchMovies\(shows\.filter\(/);
  assert.match(librarySource, /import \{ HomeLoadMore \} from '\.\.\/components\/cards\/HomeLoadMore';/);
  assert.match(librarySource, /items=\{data\.slice\(visibleCount\)\.map\(item => item\.show\)\}/);
  assert.match(librarySource, /step=\{LIBRARY_GRID_BATCH_SIZE\}/);
  assert.doesNotMatch(librarySource, /className="moi-more"/);
});
