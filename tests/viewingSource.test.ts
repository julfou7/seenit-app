import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { viewingSourceOf } from '../src/features/history/viewingSource.ts';
import { collectProfileViewings } from '../src/features/profile/profileYearStats.ts';
import type { Show } from '../src/types.ts';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('SEENIT-PROFILE-007 trois origines de visionnage : TV Time, SeenIt, Plex, anciennes étiquettes comprises', () => {
  assert.equal(viewingSourceOf({ source: 'tvtime' }), 'tvtime');
  assert.equal(viewingSourceOf({ source: 'seenit' }), 'seenit');
  assert.equal(viewingSourceOf({ source: 'plex' }), 'plex');
  assert.equal(viewingSourceOf({ plexImported: true }), 'plex', 'ancienne étiquette Plex');
  assert.equal(viewingSourceOf({ importedFrom: 'tvtime' }), 'tvtime', 'étiquette de la v1.4.295');
  assert.equal(viewingSourceOf({ watchedAt: 1 }), null, 'ancien Vu sans étiquette : origine inconnue');
  assert.equal(viewingSourceOf(null), null);
  const show = { id: 's', title: 'S', mediaType: 'tv', seenEpisodes: ['1x1', '1x2', '1x3'], episodeRecords: {
    '1x1': { watchedAt: 1_700_000_000_000, source: 'plex' }, '1x2': { watchedAt: 1_700_000_100_000, source: 'tvtime' }, '1x3': { watchedAt: 1_700_000_200_000, source: 'seenit' },
  } } as unknown as Show;
  const viewings = collectProfileViewings([show]);
  assert.deepEqual(viewings.map(viewing => [viewing.plexTime, viewing.imported === true]), [[true, false], [false, true], [false, false]]);
});

test('SEENIT-PROFILE-007 chaque écriture de Vu pose son origine', () => {
  const seenit = (path: string, count: number) => assert.equal((read(path).match(/source: VIEWING_SOURCE_SEENIT/g) || []).length, count, path);
  seenit('src/features/shows/markEpisodeWatched.ts', 2);
  seenit('src/features/watchlist/watchProgressActions.ts', 1);
  seenit('src/screens/ShowDetailScreenCore.tsx', 4);
  seenit('src/screens/EpisodeDetailModalCore.tsx', 2);
  assert.equal((read('src/features/plex/plexSyncEngine.ts').match(/source: VIEWING_SOURCE_PLEX/g) || []).length, 4);
  assert.equal((read('src/components/CsvImporter.tsx').match(/source: VIEWING_SOURCE_TVTIME/g) || []).length, 3);
});
