import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findExactSonarrSeries,
  pushExactSonarrRelease,
  resolveCanonicalSeriesBridge,
  type ExactSonarrReleasePayload,
  type ExactSonarrSeriesIdentity
} from '../src/features/downloads/sonarrCanonicalIdentity.ts';

const darkMatterExact: ExactSonarrSeriesIdentity = {
  seriesId: 42,
  title: 'Dark Matter',
  year: 2024,
  tmdbId: 196322,
  tvdbId: 420045,
  imdbId: 'tt19231492'
};

test('le pont Sonarr est toujours recalculé depuis la réponse du TMDB exact', () => {
  assert.deepEqual(resolveCanonicalSeriesBridge(196322, {
    id: 196322,
    external_ids: { tvdb_id: 420045, imdb_id: 'tt19231492' }
  }), {
    tmdbId: 196322,
    tvdbId: 420045,
    imdbId: 'tt19231492'
  });
  assert.equal(resolveCanonicalSeriesBridge(196322, {
    id: 196322,
    external_ids: { imdb_id: 'tt19231492' }
  }), null);
  assert.equal(resolveCanonicalSeriesBridge(196322, {
    id: 999999,
    external_ids: { tvdb_id: 420045 }
  }), null);
});

test('une correspondance TVDB contradictoire avec le TMDB canonique est rejetée', () => {
  const result = findExactSonarrSeries([
    { id: 7, title: 'Dark Matter', tvdbId: 420045, tmdbId: 70523 },
    { id: 42, title: 'Dark Matter', tvdbId: 420045, tmdbId: 196322 }
  ], darkMatterExact);
  assert.equal(result?.id, 42);
});

test('SEENIT-DOWNLOAD-001 recadre une release homonyme sur la série Sonarr issue du TMDB exact', async () => {
  const posted: ExactSonarrReleasePayload[] = [];
  const parsedTitles: string[] = [];

  const result = await pushExactSonarrRelease({
    releaseTitle: 'Dark.Matter.S01E03.FRENCH.1080p.WEB.H264',
    magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    publishDate: '2026-09-20T12:00:00.000Z',
    exact: darkMatterExact
  }, {
    parseReleaseTitle: async title => {
      parsedTitles.push(title);
      return title.includes('.2024.')
        ? { series: { id: 42, tvdbId: 420045, tmdbId: 196322 } }
        : { series: { id: 7, tvdbId: 77666, tmdbId: 70523 } };
    },
    postRelease: async payload => {
      posted.push(payload);
      return [{ approved: true, mappedSeriesId: 42 }];
    }
  });

  assert.equal(result.success, true);
  assert.deepEqual(parsedTitles, [
    'Dark.Matter.S01E03.FRENCH.1080p.WEB.H264',
    'Dark.Matter.2024.S01E03.FRENCH.1080p.WEB.H264'
  ]);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].title, 'Dark.Matter.2024.S01E03.FRENCH.1080p.WEB.H264');
  assert.equal(posted[0].tvdbId, darkMatterExact.tvdbId);
  assert.equal(posted[0].imdbId, darkMatterExact.imdbId);
});

test('SEENIT-DOWNLOAD-001 refuse une release Sonarr tant que son parseur ne confirme pas le TMDB exact', async () => {
  let postCount = 0;
  const result = await pushExactSonarrRelease({
    releaseTitle: 'Dark.Matter.S01E03.FRENCH.1080p.WEB.H264',
    magnetUri: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    publishDate: '2026-09-20T12:00:00.000Z',
    exact: darkMatterExact
  }, {
    parseReleaseTitle: async () => ({ series: { id: 7, tvdbId: 77666, tmdbId: 70523 } }),
    postRelease: async () => {
      postCount += 1;
      return [{ approved: true }];
    }
  });

  assert.equal(result.success, false);
  assert.match(result.message, /bloqué avant téléchargement/);
  assert.equal(postCount, 0);
});
