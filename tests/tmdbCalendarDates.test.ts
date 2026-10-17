import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjustTMDBSeasonDataForEurope,
  adjustTMDBShowDataForEurope,
  getCalendarDaysDiff,
} from '../src/lib/utils.ts';

const paramountNetworks = [{ id: 4330, name: 'Paramount+' }];

test('#407 conserve la date calendaire Paramount+ de MobLand S02E05 au 16/10', () => {
  const showDetails = {
    networks: paramountNetworks,
    first_air_date: '2025-03-30',
    last_air_date: '2026-10-16',
    next_episode_to_air: { season_number: 2, episode_number: 5, air_date: '2026-10-16' },
    last_episode_to_air: { season_number: 2, episode_number: 5, air_date: '2026-10-16' },
    seasons: [{ season_number: 2, air_date: '2026-09-18' }],
  };
  const seasonDetails = {
    season_number: 2,
    air_date: '2026-09-18',
    episodes: [
      { season_number: 2, episode_number: 1, air_date: '2026-09-18' },
      { season_number: 2, episode_number: 5, air_date: '2026-10-16' },
    ],
  };
  const expectedShow = structuredClone(showDetails);
  const expectedSeason = structuredClone(seasonDetails);

  adjustTMDBShowDataForEurope(showDetails);
  adjustTMDBSeasonDataForEurope(seasonDetails, paramountNetworks);

  assert.deepEqual(showDetails, expectedShow);
  assert.deepEqual(seasonDetails, expectedSeason);
  assert.equal(showDetails.next_episode_to_air.air_date, '2026-10-16');
  assert.equal(seasonDetails.episodes[1].air_date, '2026-10-16');
  assert.equal(getCalendarDaysDiff('2026-10-16', '2026-10-17'), -1);
});

test('#407 ne décale plus non plus les autres anciens réseaux heuristiques', () => {
  const appleSeason = {
    season_number: 3,
    air_date: '2026-10-24',
    episodes: [{ season_number: 3, episode_number: 1, air_date: '2026-10-24' }],
  };
  const expected = structuredClone(appleSeason);

  adjustTMDBSeasonDataForEurope(appleSeason, [{ id: 2552, name: 'Apple TV+' }]);

  assert.deepEqual(appleSeason, expected);
  assert.equal(getCalendarDaysDiff('2026-10-24', '2026-10-17'), 7);
});
