import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { PUBLIC_METADATA_CACHE_SCHEMA_VERSION } from '../src/features/shows/publicMetadataCache.ts';
import { upcomingEpisodeLabel } from '../src/features/shows/detailPlanning.ts';

// Vrai module utils : seuls Capacitor et le journal sont remplacés.
const bundle = await build({ entryPoints: ['src/lib/utils.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'utils-ports', setup(builder) {
    builder.onResolve({ filter: /^@capacitor\/|\/logStore$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const Browser={};export const AppLauncher={};export const Capacitor={isNativePlatform:()=>false,getPlatform:()=>"web"};export const appLogger={info(){},warn(){},error(){}};' }));
  } }] });
const { adjustTMDBSeasonDataForEurope, adjustTMDBShowDataForEurope } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  adjustTMDBShowDataForEurope: (show: unknown) => void;
  adjustTMDBSeasonDataForEurope: (season: unknown, networks?: unknown[]) => void;
};

// Fixture terrain du 07/11/2026 : MobLand S02E08 (Paramount+, réseau TMDB 4330) est sortie le vendredi 06/11
// en France ; SeenIt l'affichait « Ce soir » le samedi et envoyait le rappel de sortie ce jour-là.
const mobland = () => ({
  networks: [{ id: 4330, name: 'Paramount+' }],
  first_air_date: '2025-03-30',
  last_air_date: '2026-11-06',
  last_episode_to_air: { season_number: 2, episode_number: 8, air_date: '2026-11-06' },
  next_episode_to_air: { season_number: 2, episode_number: 9, air_date: '2026-11-13' },
  seasons: [{ season_number: 2, air_date: '2026-09-18' }]
});

test('#407 une date calendaire TMDB n’est jamais décalée à cause du réseau (Paramount+, HBO)', () => {
  const show = mobland();
  adjustTMDBShowDataForEurope(show);
  assert.deepEqual(show, mobland(), 'MobLand garde exactement ses dates TMDB');
  const season = { air_date: '2026-09-18', episodes: [{ episode_number: 8, air_date: '2026-11-06' }, { episode_number: 9, air_date: '2026-11-13' }] };
  adjustTMDBSeasonDataForEurope(season, [{ id: 4330 }]);
  assert.deepEqual(season.episodes.map(episode => episode.air_date), ['2026-11-06', '2026-11-13']);
  // Autre réseau de l'ancienne liste (HBO, 49) : même règle.
  const hbo = { air_date: '2026-11-08', episodes: [{ episode_number: 1, air_date: '2026-11-08' }] };
  adjustTMDBSeasonDataForEurope(hbo, [{ id: 49 }]);
  assert.equal(hbo.episodes[0].air_date, '2026-11-08');
  // Le 07/11, E08 est sorti (plus « Aujourd’hui ») et E09 reste un vrai épisode futur.
  assert.ok('2026-11-06' < '2026-11-07');
  assert.equal(upcomingEpisodeLabel('2026-11-13', '2026-11-07'), 'Dans 6 jours');
  const utils = readFileSync('src/lib/utils.ts', 'utf8');
  assert.doesNotMatch(utils, /OFFSET_NETWORKS|addOneDayToDateStr/, 'plus aucune liste de réseaux ni de J+1');
});

test('#407 les détails déjà mis en cache avec J+1 sont relus depuis TMDB', () => {
  assert.equal(PUBLIC_METADATA_CACHE_SCHEMA_VERSION, 2);
  const cache = readFileSync('src/features/shows/publicMetadataCache.ts', 'utf8');
  assert.match(cache, /result\.schemaVersion === PUBLIC_METADATA_CACHE_SCHEMA_VERSION \? result : null/, 'une entrée v1 est ignorée');
});

test('#407 une série copiée avec l’ancien J+1 est resynchronisée une fois, même si son épisode paraît futur', async () => {
  const { CALENDAR_DATES_REVISION, needsCalendarDatesRefresh } = await import('../src/features/shows/calendarDatesRevision.ts');
  assert.equal(CALENDAR_DATES_REVISION, 2);
  // Terrain 07/11 : MobLand garde nextEpisodeToAir = 14/11 (décalé) au lieu du 13/11 → « dans 7 jours ».
  assert.equal(needsCalendarDatesRefresh({}), true);
  assert.equal(needsCalendarDatesRefresh({ calendarDatesRevision: 1 }), true);
  assert.equal(needsCalendarDatesRefresh({ calendarDatesRevision: 2 }), false);
  const worker = readFileSync('src/hooks/useDetailsSyncWorker.ts', 'utf8');
  const filter = worker.slice(worker.indexOf('const tvShowsToSync = shows.filter'), worker.indexOf('if (tvShowsToSync.length === 0)'));
  // Avant la règle « prochain épisode futur → pas d'appel » : sinon la fausse date future bloquerait la correction.
  assert.ok(filter.indexOf('if (needsCalendarDatesRefresh(s)) return true;') > 0 && filter.indexOf('if (needsCalendarDatesRefresh(s)) return true;') < filter.indexOf('hasFutureReleaseOnly'));
  // Chaque écriture de synchronisation marque la révision, y compris le chemin « rien n'a changé ».
  assert.equal((worker.match(/calendarDatesRevision: CALENDAR_DATES_REVISION/g) || []).length, 3);
});
