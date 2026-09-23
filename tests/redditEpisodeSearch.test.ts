import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildRedditEpisodeSearchQuery,
  buildRedditSearchUrl,
} from '../src/components/community/redditEpisodeSearch.ts';

test('SEENIT-COMMUNITY-001 conserve les numéros naturels sans padding sur le chemin de production Reddit', () => {
  const fixtures = [
    {
      seriesTitle: 'MobLand',
      originalSeriesTitle: 'MobLand',
      seasonNumber: 2,
      episodeNumber: 1,
      expected: 'MobLand S2 E1',
    },
    {
      seriesTitle: 'Lioness',
      originalSeriesTitle: 'Special Ops: Lioness',
      seasonNumber: 3,
      episodeNumber: 1,
      expected: 'Lioness S3 E1',
    },
    {
      seriesTitle: 'The Bear',
      originalSeriesTitle: 'The Bear',
      seasonNumber: 4,
      episodeNumber: 10,
      expected: 'The Bear S4 E10',
    },
  ];

  for (const fixture of fixtures) {
    const query = buildRedditEpisodeSearchQuery(fixture);
    const url = buildRedditSearchUrl(query);

    assert.equal(query, fixture.expected);
    assert.equal(new URL(url).searchParams.get('q'), fixture.expected);
    assert.doesNotMatch(query, /\bS0\d\b|\bE0\d\b/);
  }

  const episodeModal = fs.readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8');
  const redditSection = fs.readFileSync('src/components/community/RedditSection.tsx', 'utf8');

  assert.match(
    episodeModal,
    /<RedditSection[\s\S]*query=\{buildRedditEpisodeSearchQuery\(\{[\s\S]*seasonNumber: currentSeason,[\s\S]*episodeNumber: currentEpisode\.episode_number/,
  );
  assert.match(redditSection, /const searchUrl = buildRedditSearchUrl\(query\);/);
});

test('SEENIT-COMMUNITY-001 n’injecte jamais de syntaxe avancée ni de consigne IA', () => {
  const query = buildRedditEpisodeSearchQuery({
    seriesTitle: 'Severance',
    originalSeriesTitle: 'Severance',
    seasonNumber: 2,
    episodeNumber: 8,
    episodeTitle: 'Sweet Vitriol',
  });

  assert.equal(query, 'Severance S2 E8');
  assert.doesNotMatch(query, /\b(?:AND|OR)\b|title:|["()]/);
  assert.doesNotMatch(query, /Réponds|français|résume|consensus|théories|Sweet Vitriol/i);
});

test('SEENIT-COMMUNITY-001 garde Reddit verrouillé avant visionnage et sans API privée', () => {
  const episodeModal = fs.readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8');
  const redditSection = fs.readFileSync('src/components/community/RedditSection.tsx', 'utf8');
  const helper = fs.readFileSync('src/components/community/redditEpisodeSearch.ts', 'utf8');

  assert.match(
    episodeModal,
    /<RedditSection[\s\S]*isLocked=\{!isSeen\}[\s\S]*marquant comme vu/,
  );
  assert.doesNotMatch(redditSection + helper, /search\.json|oauth|client[_ -]?id|gemini/i);
});

test('SEENIT-COMMUNITY-001 ouvre la recherche Tout sans padding ni mode de résultats forcé', () => {
  const query = buildRedditEpisodeSearchQuery({
    seriesTitle: 'MobLand',
    seasonNumber: 2,
    episodeNumber: 1,
  });
  const url = buildRedditSearchUrl(query);
  const redditSection = fs.readFileSync('src/components/community/RedditSection.tsx', 'utf8');

  assert.equal(new URL(url).origin, 'https://www.reddit.com');
  assert.equal(new URL(url).pathname, '/search/');
  assert.equal(new URL(url).searchParams.get('q'), 'MobLand S2 E1');
  assert.equal(new URL(url).searchParams.get('sort'), null);
  assert.equal(new URL(url).searchParams.get('type'), null);
  assert.match(redditSection, /résumé IA automatique si Reddit le propose/);
  assert.doesNotMatch(redditSection, /Demander/);
});
