import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildRedditEpisodeSearchQuery,
  buildRedditSearchUrl,
} from '../src/components/community/redditEpisodeSearch.ts';

test('SEENIT-COMMUNITY-001 priorise le titre communautaire anglais sans casser les titres courts', () => {
  const fixtures = [
    {
      seriesTitle: "Berlin et La Dame à l'hermine",
      communitySeriesTitle: 'Berlin and the Lady with an Ermine',
      originalSeriesTitle: 'Berlín y la dama del armiño',
      seasonNumber: 1,
      episodeNumber: 1,
      expected: 'Berlin and the Lady with an Ermine S1 E1',
    },
    {
      seriesTitle: 'MobLand',
      communitySeriesTitle: 'MobLand',
      originalSeriesTitle: 'MobLand',
      seasonNumber: 2,
      episodeNumber: 1,
      expected: 'MobLand S2 E1',
    },
    {
      seriesTitle: 'Lioness',
      communitySeriesTitle: 'Lioness',
      originalSeriesTitle: 'Special Ops: Lioness',
      seasonNumber: 3,
      episodeNumber: 1,
      expected: 'Lioness S3 E1',
    },
    {
      seriesTitle: 'The Bear',
      communitySeriesTitle: 'The Bear',
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

  assert.equal(
    buildRedditEpisodeSearchQuery({
      seriesTitle: 'Lioness',
      originalSeriesTitle: 'Special Ops: Lioness',
      seasonNumber: 3,
      episodeNumber: 1,
    }),
    'Lioness S3 E1',
  );
});

test('SEENIT-COMMUNITY-001 n’injecte jamais de syntaxe avancée ni de consigne IA', () => {
  const query = buildRedditEpisodeSearchQuery({
    seriesTitle: 'Severance',
    communitySeriesTitle: 'Severance',
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

test('SEENIT-COMMUNITY-001 résout le titre anglais au clic sur le chemin de production Reddit', () => {
  const episodeModal = fs.readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8');
  const redditSection = fs.readFileSync('src/components/community/RedditSection.tsx', 'utf8');
  const tmdbClient = fs.readFileSync('src/features/shows/tmdbClient.ts', 'utf8');

  assert.match(
    episodeModal,
    /tmdb\.getEnglishMediaTitle\(Number\(effectiveTmdbId\), 'tv'\)[\s\S]*buildRedditQuery\(englishTitleResult\.ok \? englishTitleResult\.value : null\)/,
  );
  assert.match(
    episodeModal,
    /<RedditSection[\s\S]*query=\{redditEpisodeQuery\}[\s\S]*resolveQuery=\{resolveRedditQuery\}/,
  );
  assert.match(
    redditSection,
    /const resolvedQuery = await resolveQuery\(\);[\s\S]*openExternalUrl\(buildRedditSearchUrl\(effectiveQuery\)\)/,
  );
  assert.match(tmdbClient, /\/\$\{type\}\/\$\{normalizedId\}\?language=en-US/);

  const url = buildRedditSearchUrl('Berlin and the Lady with an Ermine S1 E1');
  assert.equal(new URL(url).origin, 'https://www.reddit.com');
  assert.equal(new URL(url).pathname, '/search/');
  assert.equal(new URL(url).searchParams.get('q'), 'Berlin and the Lady with an Ermine S1 E1');
  assert.equal(new URL(url).searchParams.get('sort'), null);
  assert.equal(new URL(url).searchParams.get('type'), null);
  assert.match(redditSection, /résumé IA automatique si Reddit le propose/);
  assert.doesNotMatch(redditSection, /Demander/);
});
