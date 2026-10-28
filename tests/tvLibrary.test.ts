import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { normalizeTvImage, readTvLibrary } from '../src/features/tv/tvPairingFirestore.ts';

test('SEENIT-TV-002 images mobile absolues et relatives conservent le même visuel TMDB', () => {
  for (const size of ['w185', 'w500', 'w1280', 'original']) assert.equal(normalizeTvImage('https://image.tmdb.org/t/p/' + size + '/poster.jpg'), '/poster.jpg');
  assert.equal(normalizeTvImage('/poster.jpg'), '/poster.jpg');
  for (const value of [null, '', '//evil.invalid/x.jpg', '/../../x.jpg', 'https://image.tmdb.org.evil.invalid/t/p/w500/x.jpg', 'https://u:p@image.tmdb.org/t/p/w500/x.jpg', 'https://image.tmdb.org/t/p/w500/x.jpg?token=secret', 'https://image.tmdb.org/t/p/w500/x.jpg#fragment', 'https://image.tmdb.org/t/p/w500/%2e%2e/w500/x.jpg', 'http://localhost/image.jpg', 'https://192.168.1.2/image.jpg']) assert.equal(normalizeTvImage(value), null, String(value));
});
test('SEENIT-TV-002 le bootstrap de production garde les images sans lecture autre compte ni nouveau fetch', async () => {
  const paths: string[] = [], limits: number[] = [], selected: string[][] = [];
  const db = { collection(path: string) {
    paths.push(path);
    return { orderBy(field: string, direction: string) {
      assert.equal(field, 'updatedAt'); assert.equal(direction, 'desc'); return this;
    }, limit(count: number) { limits.push(count); return this; }, select(...fields: string[]) { selected.push(fields); return this; },
    async get() { return { docs: [
      { data: () => ({ tmdbId: 1, title: 'Série réelle', mediaType: 'tv', status: 'watching', posterPath: 'https://image.tmdb.org/t/p/w500/poster.jpg', backdropPath: 'https://image.tmdb.org/t/p/w1280/backdrop.jpg', nextEpisodeToWatch: { season_number: 2, episode_number: 3, name: 'Reprise' } }) },
      { data: () => ({ tmdbId: 1, title: 'Film réel', mediaType: 'movie', status: 'plan_to_watch', posterPath: '/film.jpg' }) },
      { data: () => ({ tmdbId: 3, title: 'Archivé', status: 'watching', isArchived: true }) },
    ] }; } };
  } } as unknown as Firestore;
  const items = await readTvLibrary(db, 'owner-a');
  assert.deepEqual(paths, ['users/owner-a/shows']); assert.deepEqual(limits, [60]);
  assert.ok(selected[0].includes('posterPath') && selected[0].includes('backdropPath'));
  assert.equal(items.length, 2); assert.equal(items[0].posterPath, '/poster.jpg'); assert.equal(items[0].backdropPath, '/backdrop.jpg');
  assert.deepEqual(items[0].nextEpisode, { season: 2, episode: 3, name: 'Reprise' });
  await assert.rejects(() => readTvLibrary(db, '../other-owner')); assert.equal(paths.length, 1);
});
