import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildRedditEpisodeSearchQuery,
  buildRedditSearchUrl,
} from '../src/components/community/redditEpisodeSearch.ts';

test('SEENIT-COMMUNITY-001 prépare une recherche épisode multi-conventions pour Reddit', () => {
  const fixtures = [
    {
      seriesTitle: 'Severance',
      originalSeriesTitle: 'Severance',
      episodeTitle: 'Sweet Vitriol',
      seasonNumber: 2,
      episodeNumber: 8,
    },
    {
      seriesTitle: 'Le dernier d’entre nous',
      originalSeriesTitle: 'The Last of Us',
      episodeTitle: 'Through the Valley',
      seasonNumber: 2,
      episodeNumber: 2,
    },
    {
      seriesTitle: 'Bref.',
      originalSeriesTitle: null,
      episodeTitle: null,
      seasonNumber: 1,
      episodeNumber: 6,
    },
  ];

  for (const fixture of fixtures) {
    const query = buildRedditEpisodeSearchQuery(fixture);
    const season = String(fixture.seasonNumber).padStart(2, '0');
    const episode = String(fixture.episodeNumber).padStart(2, '0');

    assert.match(query, new RegExp(`title:"S${season}E${episode}"`));
    assert.match(query, new RegExp(`title:"Season ${fixture.seasonNumber} Episode ${fixture.episodeNumber}"`));
    assert.match(query, new RegExp(`title:"${fixture.seasonNumber}x${episode}"`));
    assert.match(query, new RegExp(`title:"Episode ${fixture.episodeNumber}"`));
    assert.match(query, /\bAND\b/);
    assert.match(query, /\bOR\b/);
  }

  const bilingual = buildRedditEpisodeSearchQuery(fixtures[1]);
  assert.match(bilingual, /"Le dernier d’entre nous" OR "The Last of Us"/);
  assert.match(bilingual, /"Through the Valley"/);
});

test('SEENIT-COMMUNITY-001 n’injecte jamais une consigne IA dans la recherche Reddit', () => {
  const searchQuery = buildRedditEpisodeSearchQuery({
    seriesTitle: 'Severance',
    originalSeriesTitle: 'Severance',
    seasonNumber: 2,
    episodeNumber: 8,
    episodeTitle: 'Sweet Vitriol',
  });

  assert.match(searchQuery, /"Severance"/);
  assert.match(searchQuery, /title:"S02E08"/);
  assert.match(searchQuery, /title:"Sweet Vitriol"/);
  assert.doesNotMatch(searchQuery, /Réponds|français|résume|consensus|théories/i);
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

test('SEENIT-COMMUNITY-001 conserve la recherche standard comme fallback du résumé IA Reddit', () => {
  const query = buildRedditEpisodeSearchQuery({
    seriesTitle: 'The Bear',
    seasonNumber: 4,
    episodeNumber: 3,
    episodeTitle: 'Scallop',
  });
  const url = buildRedditSearchUrl(query);
  const redditSection = fs.readFileSync('src/components/community/RedditSection.tsx', 'utf8');

  assert.equal(new URL(url).origin, 'https://www.reddit.com');
  assert.equal(new URL(url).pathname, '/search/');
  assert.equal(new URL(url).searchParams.get('sort'), 'relevance');
  assert.equal(new URL(url).searchParams.get('q'), query);
  assert.match(redditSection, /Demander/);
  assert.match(redditSection, /buildRedditSearchUrl\(query\)/);
  assert.doesNotMatch(redditSection, /buildRedditEpisodeAiQuestion|Réponds en français/);
});
