import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import express, { type Request, type RequestHandler } from 'express';
import {
  PARENTAL_BATCH_MOVIE_DETAILS_SCHEMA,
  compactParentalDetails,
  registerParentalRatingBatchRoute,
} from '../src/features/providers/parentalRatingBatchBackend.ts';
import {
  CINEMA_SEARCH_EVIDENCE_SCHEMA,
  applyCinemaEvidenceToSearchResults,
} from '../src/features/discover/cinemaSearchEvidenceCore.ts';
import { hasFrenchTheatricalCinemaEvidence } from '../src/features/shows/cinemaPolicy.ts';

const NOW = new Date('2026-09-22T12:00:00+02:00');
type UnknownRecord = Record<string, unknown>;

function requireRecord(value: unknown): UnknownRecord {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as UnknownRecord;
}

function requireRecords(value: unknown): UnknownRecord[] {
  assert.ok(Array.isArray(value));
  return value.map(entry => requireRecord(entry));
}

function releaseEntries(details: UnknownRecord): UnknownRecord[] {
  const releaseDates = requireRecord(details.release_dates);
  return requireRecords(releaseDates.results);
}

function rawReleaseDates(frRelease: Record<string, unknown>) {
  return {
    id: 424242,
    results: [
      {
        iso_3166_1: 'US',
        release_dates: [{ certification: 'PG-13' }],
      },
      {
        iso_3166_1: 'FR',
        release_dates: [frRelease],
      },
    ],
  };
}

test('issue #91 Tombé du ciel : la recherche reçoit la même preuve cinéma détaillée que la fiche avant navigation', () => {
  assert.equal(PARENTAL_BATCH_MOVIE_DETAILS_SCHEMA, CINEMA_SEARCH_EVIDENCE_SCHEMA);
  const compact = compactParentalDetails(
    { mediaType: 'movie', id: 424242, key: 'movie:424242' },
    rawReleaseDates({
      certification: '',
      type: 3,
      release_date: '2026-09-10T00:00:00.000Z',
      note: '',
    }),
  );

  assert.equal(compact.seenitParentalDetailsSchema, CINEMA_SEARCH_EVIDENCE_SCHEMA);
  const entries = releaseEntries(compact);
  const us = entries.find(entry => entry.iso_3166_1 === 'US');
  const fr = entries.find(entry => entry.iso_3166_1 === 'FR');
  assert.ok(us);
  assert.ok(fr);
  assert.equal(requireRecord(requireRecords(us.release_dates)[0]).certification, 'PG-13');
  assert.deepEqual(
    requireRecord(requireRecords(fr.release_dates)[0]),
    {
      certification: '',
      type: 3,
      release_date: '2026-09-10T00:00:00.000Z',
      note: '',
    },
  );

  const [searchResult] = applyCinemaEvidenceToSearchResults(
    [{ id: 424242, media_type: 'movie', title: 'Tombé du ciel', release_date: '2026-09-10' }],
    new Map([['movie:424242', compact]]),
  );
  assert.equal(hasFrenchTheatricalCinemaEvidence(searchResult, NOW), true);
});

test('issue #91 la preuve enrichie reste autoritative pour digital et projection événementielle terminée', () => {
  const digital = compactParentalDetails(
    { mediaType: 'movie', id: 1, key: 'movie:1' },
    rawReleaseDates({ type: 4, release_date: '2026-09-10T00:00:00.000Z', note: '' }),
  );
  const event = compactParentalDetails(
    { mediaType: 'movie', id: 2, key: 'movie:2' },
    rawReleaseDates({
      type: 3,
      release_date: '2026-07-16T18:00:00.000Z',
      note: 'Projection événementielle — Institut Lumière',
    }),
  );
  const enriched = applyCinemaEvidenceToSearchResults(
    [
      { id: 1, media_type: 'movie', title: 'Digital' },
      { id: 2, media_type: 'movie', title: 'Dune' },
    ],
    new Map([['movie:1', digital], ['movie:2', event]]),
  );
  assert.equal(hasFrenchTheatricalCinemaEvidence(enriched[0], NOW), false);
  assert.equal(hasFrenchTheatricalCinemaEvidence(enriched[1], NOW), false);
});

test('issue #91 une ancienne preuve parentale sans schéma cinéma ne devient jamais un faux négatif autoritatif', () => {
  const original = { id: 7, media_type: 'movie', title: 'Film ancien cache' };
  const legacy = {
    id: 7,
    media_type: 'movie',
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] },
  };
  const [result] = applyCinemaEvidenceToSearchResults([original], new Map([['movie:7', legacy]]));
  assert.equal(result, original, 'un cache v1 incomplet doit être ignoré plutôt que devenir une preuve cinéma négative');
});

test('issue #91 le backend invalide une preuve film persistée v1 et recharge FR en un appel fournisseur', async t => {
  let providerCalls = 0;
  const app = express();
  const authenticate: RequestHandler = (req, _res, next) => {
    (req as Request & { user?: { uid?: string } }).user = { uid: 'cinema-search' };
    next();
  };
  registerParentalRatingBatchRoute(app, {
    authenticate,
    secrets: () => ({ TMDB_API_KEY: 'private-tmdb-key' }),
    readPersisted: async () => new Map([['movie:7', {
      id: 7,
      media_type: 'movie',
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] },
    }]]),
    fetch: async () => {
      providerCalls += 1;
      return new Response(JSON.stringify(rawReleaseDates({
        type: 3,
        release_date: '2026-09-10T00:00:00.000Z',
        note: '',
      })), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const response = await fetch(`http://127.0.0.1:${address.port}/api/media/parental-ratings?items=movie%3A7&cinema=1`);
  assert.equal(response.status, 200);
  const payload = requireRecord(await response.json());
  const results = requireRecords(payload.results);
  assert.equal(providerCalls, 1);
  assert.equal(results.length, 1);
  const details = requireRecord(results[0].details);
  assert.equal(details.seenitParentalDetailsSchema, CINEMA_SEARCH_EVIDENCE_SCHEMA);
  assert.ok(releaseEntries(details).some(entry => entry.iso_3166_1 === 'FR'));
});

test('issue #91 le facade Explorer attend bien l’enrichissement cinéma avant de rendre smartSearchMulti', () => {
  const facade = readFileSync(new URL('../src/features/shows/tmdb.ts', import.meta.url), 'utf8');
  const wrapper = readFileSync(new URL('../src/features/shows/tmdbSearchCinema.ts', import.meta.url), 'utf8');
  assert.match(facade, /export \{ tmdb \} from '\.\/tmdbSearchCinema';/);
  assert.match(wrapper, /await enrichCinemaEvidenceForSearchResults\(result\.value\.results\)/);
  assert.match(wrapper, /coreTmdb\.smartSearchMulti\s*=/);
});


test('issue #91 Matrix 1999 : un candidat Discover ne gagne jamais contre la preuve détaillée', () => {
  const matrixCandidate = {
    id: 603,
    media_type: 'movie',
    title: 'Matrix',
    release_date: '1999-06-23',
    seenitFrenchTheatrical: true,
    seenitFrenchTheatricalCheckedAt: Date.now(),
  };
  assert.equal(hasFrenchTheatricalCinemaEvidence(matrixCandidate, NOW), false);

  const matrixDetails = compactParentalDetails(
    { mediaType: 'movie', id: 603, key: 'movie:603' },
    rawReleaseDates({
      type: 3,
      release_date: '2026-09-01T18:00:00.000Z',
      note: 'Projection événementielle — séance spéciale',
    }),
  );
  const [enriched] = applyCinemaEvidenceToSearchResults(
    [matrixCandidate],
    new Map([['movie:603', matrixDetails]]),
  );
  assert.equal(
    hasFrenchTheatricalCinemaEvidence(enriched, NOW),
    false,
    'Explorer doit rester aligné sur la fiche quand le détail invalide le candidat Discover',
  );
});

test('issue #91 les listes Explorer ordinaires et Au cinéma passent par le même enrichissement batch', () => {
  const tmdbCore = readFileSync(new URL('../src/features/shows/tmdbCore.ts', import.meta.url), 'utf8');
  const discoverScreen = readFileSync(new URL('../src/screens/DiscoverScreen.tsx', import.meta.url), 'utf8');

  assert.match(tmdbCore, /results = await enrichCinemaEvidenceForMediaResults\(results\)/);
  assert.match(tmdbCore, /const enriched = await enrichCinemaEvidenceForMediaResults\(candidates\)/);
  assert.doesNotMatch(tmdbCore, /seenitFrenchTheatrical:\s*true/);
  assert.match(discoverScreen, /enrichCinemaEvidenceForExplorerLists\(nextPopular, nextTrending\)/);
  assert.match(discoverScreen, /activeCategory !== 'Au cinéma'/);
});
