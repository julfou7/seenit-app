import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import express from 'express';
import { createTvSportService, parseFrance, parseMonaco, parisKickoff, registerTvSportRoutes, SPORT_SOURCES } from '../src/features/tv/tvSport.ts';

const monaco = readFileSync(new URL('fixtures/tv-sport-monaco.html', import.meta.url), 'utf8');
const france = readFileSync(new URL('fixtures/tv-sport-france.html', import.meta.url), 'utf8');
const fixture = (url: string) => Promise.resolve(url === SPORT_SOURCES[0].url ? monaco : france);
const today = Date.parse('2026-10-28T09:00:00Z');
test('SEENIT-TV-003 lit les vraies lignes officielles, sans exiger URL de match ni résultat', () => {
  const events = parseMonaco(monaco);
  assert.equal(events.length, 3);
  assert.equal(events[0].home.name, 'Paris FC');
  assert.equal(events[0].away.name, 'AS MONACO');
  assert.equal(events[0].kickoff, '2026-11-01T16:15:00.000Z');
  assert.equal(events[0].venue, 'Stade Jean Bouin');
  assert.ok(events[0].home.logo.startsWith('https://www.asmonaco.com/media/'));
  assert.equal(events[1].away.name, 'FC Nordsjælland');
  assert.equal(events[2].confirmed, false);
  assert.ok(events[2].id && events[2].sourceUrl === SPORT_SOURCES[0].url);
  assert.equal(new Set(events.map(e => e.id)).size, 3);
  assert.ok(events.every(e => !('score' in e) && !('broadcast' in e)));
  assert.equal(parseMonaco('<html>source modifiée</html>').length, 0);
});
test('SEENIT-TV-003 France A et Europe/Paris ne confondent ni saison ni heure été/hiver', () => {
  const events = parseFrance(france);
  assert.equal(events.length, 4);
  assert.equal(events[2].id, 'https://www.fff.fr/selection/matchs/3774-italie-france.html');
  assert.equal(events[2].kickoff, '2026-11-12T19:45:00.000Z');
  assert.equal(events[0].kickoff, '2026-10-02T18:45:00.000Z');
  assert.equal(new Date(parisKickoff(2026, 2, 28, 20, 45)).toISOString(), '2026-03-28T19:45:00.000Z');
  assert.equal(new Date(parisKickoff(2026, 2, 29, 20, 45)).toISOString(), '2026-03-29T18:45:00.000Z');
  assert.ok(Number.isNaN(parisKickoff(2026, -1, 2, 20, 45)));
});
test('SEENIT-TV-003 regroupe les requêtes, cache six heures, retire le passé sans scores', async () => {
  let calls = 0, now = today;
  const service = createTvSportService(async url => { calls++; await new Promise(r => setTimeout(r, 10)); return fixture(url); }, () => now);
  const [a, b] = await Promise.all([service.schedule(), service.schedule()]);
  assert.equal(calls, 2);
  assert.equal(a.events.length, 5);
  assert.deepEqual(a, b);
  assert.equal(a.spoilerPolicy, 'hide');
  assert.ok(a.events.every(e => Date.parse(e.kickoff) > today && !e.score && !e.status));
  now += 5 * 3600000; await service.schedule(); assert.equal(calls, 2);
  now += 2 * 3600000; await service.schedule(); assert.equal(calls, 4);
  now = Date.parse('2026-11-12T20:00Z');
  assert.ok((await service.schedule()).events.every(e => Date.parse(e.kickoff) > now));
});
test('SEENIT-TV-003 panne partielle, backoff et expiration du cache restent explicites', async () => {
  let now = today, broken = false, calls = 0;
  const service = createTvSportService(async url => { calls++; if (broken) throw Error('offline'); return fixture(url); }, () => now);
  await service.schedule(); broken = true; now += 7 * 3600000;
  const stale = await service.schedule();
  assert.equal(stale.sources[0].state, 'stale'); assert.equal(stale.events.length, 5);
  await service.schedule(); assert.equal(calls, 4);
  now += 49 * 3600000;
  const expired = await service.schedule(); assert.equal(expired.events.length, 0); assert.equal(expired.sources[0].state, 'unavailable');
  const partial = createTvSportService(async url => { if (url.includes('fff.fr')) throw Error('not available'); return monaco; }, () => today);
  const result = await partial.schedule(); assert.equal(result.events.length, 3); assert.equal(result.sources[1].state, 'unavailable');
});
test('SEENIT-TV-003 route réelle : seules les sources fixes sont lues, sans clé ni Firestore', async () => {
  const calls: string[] = [], app = express();
  registerTvSportRoutes(app, () => (_req, _res, next) => next(), createTvSportService(url => { calls.push(url); return fixture(url); }, () => today));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/tv/sport?url=https://untrusted.invalid');
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') || '', /public/);
    const data = await response.json(); assert.equal(data.events.length, 5);
    assert.deepEqual(calls.sort(), SPORT_SOURCES.map(s => s.url).sort());
    assert.ok(JSON.stringify(data).length < 65536);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
