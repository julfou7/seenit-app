import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hasAiredEpisodeEvidence } from '../src/features/watchlist/watchAvailability.ts';

const TODAY = '2026-09-12';
const baseTv = {
  mediaType: 'tv' as const,
  seenEpisodes: [] as string[],
  totalAiredEpisodes: 0,
  firstAirDate: undefined,
  nextEpisodeToWatch: undefined,
};

test('watchlist disponibilité exclut une série en production sans épisode diffusé de À Regarder', () => {
  const prisonBreakBlackCreekLike = {
    ...baseTv,
    nextEpisodeToWatch: {
      season_number: 1,
      episode_number: 1,
      air_date: null,
    },
  };

  assert.equal(hasAiredEpisodeEvidence(prisonBreakBlackCreekLike, TODAY), false);
});

test('watchlist disponibilité refuse une date future comme preuve de disponibilité', () => {
  assert.equal(hasAiredEpisodeEvidence({
    ...baseTv,
    firstAirDate: '2027-01-15',
    nextEpisodeToWatch: {
      season_number: 1,
      episode_number: 1,
      air_date: '2027-01-15',
    },
  }, TODAY), false);
});

test('watchlist disponibilité accepte uniquement une preuve positive de diffusion', () => {
  assert.equal(hasAiredEpisodeEvidence({ ...baseTv, totalAiredEpisodes: 1 }, TODAY), true);
  assert.equal(hasAiredEpisodeEvidence({ ...baseTv, firstAirDate: '2026-09-11' }, TODAY), true);
  assert.equal(hasAiredEpisodeEvidence({
    ...baseTv,
    nextEpisodeToWatch: { season_number: 1, episode_number: 1, air_date: '2026-09-12' },
  }, TODAY), true);
  assert.equal(hasAiredEpisodeEvidence({ ...baseTv, seenEpisodes: ['1x1'] }, TODAY), true,
    'une progression déjà enregistrée reste une preuve legacy sûre');
  assert.equal(hasAiredEpisodeEvidence({ ...baseTv }, TODAY), false);
});

test('watchlist disponibilité branche le garde de disponibilité sur le classement et la carte', () => {
  const screenSource = fs.readFileSync('src/screens/WatchListScreen.tsx', 'utf8');
  const cardSource = fs.readFileSync('src/components/cards/ContinueWatchingCard.tsx', 'utf8');

  assert.match(screenSource, /hasAiredEpisodeEvidence\(s, todayIso\)/,
    'À Regarder doit filtrer les séries sans preuve de diffusion avant le classement');
  assert.match(cardSource, /hasAiredEpisodeEvidence\(props\.show, todayStr\)/,
    'la carte doit refuser de fabriquer un épisode disponible sans preuve de diffusion');
  assert.doesNotMatch(cardSource, /!ep\.air_date\s*\|\|\s*ep\.air_date\s*<=\s*todayStr/,
    'une date absente ne prouve jamais qu’un épisode est diffusé');

  const totalAiredBlock = cardSource.match(/const totalAiredCount = [\s\S]*?;\n/)?.[0] ?? '';
  assert.ok(totalAiredBlock, 'le calcul du total diffusé doit rester identifiable');
  assert.doesNotMatch(totalAiredBlock, /show\.totalEpisodes/,
    'le nombre total planifié ne doit jamais être transformé en nombre diffusé');
});
