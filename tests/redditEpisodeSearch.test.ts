import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildRedditEpisodeSearchQuery,
  buildRedditSearchUrl,
} from '../src/components/community/redditEpisodeSearch.ts';

test('SEENIT-COMMUNITY-001 utilise une requête épisode courte qui laisse Reddit déclencher son IA native', () => {
  const query = buildRedditEpisodeSearchQuery({
    seriesTitle: 'Lioness',
    originalSeriesTitle: 'Special Ops: Lioness',
    seasonNumber: 3,
    episodeNumber: 1,
    episodeTitle: 'The Spider and the Fly',
  });

  assert.equal(query, 'Lioness S03 E01');
  assert.doesNotMatch(query, /\b(?:AND|OR)\b|title:|["()]/);
  assert.doesNotMatch(query, /Spider|Discussion|reactions/i);
});

test('SEENIT-COMMUNITY-001 n’injecte jamais de syntaxe avancée ni de consigne IA', () => {
  const query = buildRedditEpisodeSearchQuery({
    seriesTitle: 'Severance',
    originalSeriesTitle: 'Severance',
    seasonNumber: 2,
    episodeNumber: 8,
    episodeTitle: 'Sweet Vitriol',
  });

  assert.equal(query, 'Severance S02 E08');
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

test('SEENIT-COMMUNITY-001 ouvre la recherche Tout sans forcer un mode de résultats', () => {
  const query = buildRedditEpisodeSearchQuery({
    seriesTitle: 'Lioness',
    seasonNumber: 3,
    episodeNumber: 1,
  });
  const url = buildRedditSearchUrl(query);
  const redditSection = fs.readFileSync('src/components/community/RedditSection.tsx', 'utf8');

  assert.equal(new URL(url).origin, 'https://www.reddit.com');
  assert.equal(new URL(url).pathname, '/search/');
  assert.equal(new URL(url).searchParams.get('q'), 'Lioness S03 E01');
  assert.equal(new URL(url).searchParams.get('sort'), null);
  assert.equal(new URL(url).searchParams.get('type'), null);
  assert.match(redditSection, /résumé IA automatique si Reddit le propose/);
  assert.doesNotMatch(redditSection, /Demander/);
});
