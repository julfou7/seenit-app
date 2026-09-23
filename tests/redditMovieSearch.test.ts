import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildRedditMovieSearchQuery,
  buildRedditSearchUrl,
} from '../src/components/community/redditEpisodeSearch.ts';

test('SEENIT-COMMUNITY-002 cible Official Discussion au lieu de movie discussion', () => {
  const query = buildRedditMovieSearchQuery({
    movieTitle: 'Oppenheimer',
  });

  assert.equal(query, 'Oppenheimer official discussion');
  assert.doesNotMatch(query, /movie discussion/i);

  const url = buildRedditSearchUrl(query);
  assert.equal(new URL(url).origin, 'https://www.reddit.com');
  assert.equal(new URL(url).pathname, '/search/');
  assert.equal(new URL(url).searchParams.get('q'), 'Oppenheimer official discussion');
  assert.equal(new URL(url).searchParams.get('sort'), null);
  assert.equal(new URL(url).searchParams.get('type'), null);
});

test('SEENIT-COMMUNITY-002 priorise le titre anglais du film avec fallback conservateur', () => {
  assert.equal(
    buildRedditMovieSearchQuery({
      movieTitle: 'La Chambre d’à côté',
      communityMovieTitle: 'The Room Next Door',
      originalMovieTitle: 'La habitación de al lado',
    }),
    'The Room Next Door official discussion',
  );

  assert.equal(
    buildRedditMovieSearchQuery({
      movieTitle: 'Oppenheimer',
      communityMovieTitle: null,
      originalMovieTitle: 'Oppenheimer',
    }),
    'Oppenheimer official discussion',
  );

  assert.equal(
    buildRedditMovieSearchQuery({
      movieTitle: '',
      communityMovieTitle: null,
      originalMovieTitle: 'La habitación de al lado',
    }),
    'La habitación de al lado official discussion',
  );
});

test('SEENIT-COMMUNITY-002 résout le titre anglais par TMDB ID exact sur le chemin de production', () => {
  const showDetailView = fs.readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  const redditSection = fs.readFileSync('src/components/community/RedditSection.tsx', 'utf8');
  const tmdbClient = fs.readFileSync('src/features/shows/tmdbClient.ts', 'utf8');

  assert.match(
    showDetailView,
    /tmdb\.getEnglishMediaTitle\(Number\(effectiveTmdbId\), 'movie'\)[\s\S]*communityMovieTitle: englishTitleResult\.ok \? englishTitleResult\.value : null/,
  );
  assert.match(
    showDetailView,
    /<RedditSection[\s\S]*query=\{isSeries \? `\$\{redditVisibleTitle\} series discussion` : redditMovieQuery\}[\s\S]*resolveQuery=\{isSeries \? undefined : resolveRedditMovieQuery\}/,
  );
  assert.doesNotMatch(showDetailView, /'movie discussion'|"movie discussion"/);
  assert.match(showDetailView, /series discussion/);
  assert.match(
    redditSection,
    /const resolvedQuery = await resolveQuery\(\);[\s\S]*openExternalUrl\(buildRedditSearchUrl\(effectiveQuery\)\)/,
  );
  assert.match(tmdbClient, /\/\$\{type\}\/\$\{normalizedId\}\?language=en-US/);
});
