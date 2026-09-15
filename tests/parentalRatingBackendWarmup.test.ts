import assert from 'node:assert/strict';
import test from 'node:test';
import { createParentalRatingPrefetchFetch } from '../src/features/providers/mediaProviderBackend.ts';

const json = (data: unknown) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('issue #326 préchauffe en une vague bornée les classifications de la page Explorer froide', async () => {
  const calls: URL[] = [];
  let activeParental = 0;
  let maxActiveParental = 0;

  const upstream: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);

    if (url.pathname === '/3/discover/movie') {
      return json({ results: Array.from({ length: 20 }, (_, index) => ({ id: index + 1 })) });
    }
    if (url.pathname === '/3/discover/tv') {
      return json({ results: Array.from({ length: 20 }, (_, index) => ({ id: index + 101 })) });
    }

    if (url.pathname.endsWith('/release_dates') || url.pathname.endsWith('/content_ratings')) {
      activeParental += 1;
      maxActiveParental = Math.max(maxActiveParental, activeParental);
      await sleep(15);
      activeParental -= 1;
      const id = Number(url.pathname.split('/').at(-2));
      return url.pathname.endsWith('/release_dates')
        ? json({ id, results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG' }] }] })
        : json({ id, results: [{ iso_3166_1: 'US', rating: 'TV-PG' }] });
    }

    throw new Error(`Appel TMDB inattendu: ${url.pathname}`);
  }) as typeof fetch;

  const acceleratedFetch = createParentalRatingPrefetchFetch(upstream);
  const credential = 'test-private-key';

  await acceleratedFetch(`https://api.themoviedb.org/3/discover/movie?page=1&api_key=${credential}`);
  await acceleratedFetch(`https://api.themoviedb.org/3/discover/tv?page=1&api_key=${credential}`);
  assert.equal(calls.length, 2, 'Explorer sans filtre âge ne doit déclencher aucun préchauffage supplémentaire');

  const [movieResponse, tvResponse] = await Promise.all([
    acceleratedFetch(`https://api.themoviedb.org/3/movie/1/release_dates?api_key=${credential}`),
    acceleratedFetch(`https://api.themoviedb.org/3/tv/101/content_ratings?api_key=${credential}`),
  ]);
  assert.equal(movieResponse.status, 200);
  assert.equal(tvResponse.status, 200);

  await sleep(50);
  const parentalCalls = calls.filter(url => (
    url.pathname.endsWith('/release_dates') || url.pathname.endsWith('/content_ratings')
  ));
  assert.equal(parentalCalls.length, 40, 'les deux pages TMDB sont préchauffées une seule fois');
  assert.equal(maxActiveParental > 8, true, 'le backend doit casser les cinq vagues séquentielles du client');
  assert.equal(maxActiveParental <= 24, true, 'le fan-out serveur reste explicitement borné');

  const upstreamCountBeforeCacheHits = calls.length;
  await Promise.all([
    ...Array.from({ length: 19 }, (_, index) => (
      acceleratedFetch(`https://api.themoviedb.org/3/movie/${index + 2}/release_dates?api_key=${credential}`)
    )),
    ...Array.from({ length: 19 }, (_, index) => (
      acceleratedFetch(`https://api.themoviedb.org/3/tv/${index + 102}/content_ratings?api_key=${credential}`)
    )),
  ]);
  assert.equal(calls.length, upstreamCountBeforeCacheHits,
    'les requêtes unitaires déjà planifiées par v1.4.152 doivent tomber dans le cache de préchauffage');
});

test('issue #326 ne préchauffe pas une classification sans page Explorer correspondante', async () => {
  const calls: URL[] = [];
  const upstream: typeof fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);
    return json({ id: 999, results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] });
  }) as typeof fetch;

  const acceleratedFetch = createParentalRatingPrefetchFetch(upstream);
  const response = await acceleratedFetch('https://api.themoviedb.org/3/movie/999/release_dates?api_key=test-private-key');
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1, 'hors Explorer, le proxy conserve strictement le comportement unitaire');
});
