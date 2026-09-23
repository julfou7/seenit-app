import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildMediaShareUrl, SEENIT_PUBLIC_APP_ORIGIN } from '../src/features/navigation/mediaShareUrl.ts';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const navigationSource = readFileSync(new URL('../src/features/navigation/useNavigation.ts', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../src/screens/ShowDetailScreenCore.tsx', import.meta.url), 'utf8');
const profileSource = readFileSync(new URL('../src/screens/ProfileScreen.tsx', import.meta.url), 'utf8');

test('SEENIT-UX-007 construit un lien média public canonique sans identifiant privé', () => {
  const url = buildMediaShareUrl({ tmdbId: 66732, mediaType: 'tv' });
  assert.ok(url);

  const parsed = new URL(url);
  assert.equal(parsed.origin, SEENIT_PUBLIC_APP_ORIGIN);
  assert.equal(parsed.pathname, '/');
  assert.equal(parsed.searchParams.get('tmdbId'), '66732');
  assert.equal(parsed.searchParams.get('mediaType'), 'tv');
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ['mediaType', 'tmdbId']);
  assert.doesNotMatch(url, /uid|showId|firestore|localhost/i);

  assert.equal(buildMediaShareUrl({ tmdbId: 550, mediaType: 'movie' }), 'https://seenit.ai.studio/?tmdbId=550&mediaType=movie');
  assert.equal(buildMediaShareUrl({ tmdbId: 0, mediaType: 'movie' }), null);
});

test('SEENIT-UX-007 réouvre le lien média par tmdbId et mediaType sur PWA et APK', () => {
  assert.match(navigationSource, /urlParams\.get\('tmdbId'\)/);
  assert.match(navigationSource, /urlParams\.get\('mediaType'\)/);
  assert.match(navigationSource, /tmdbId: tmdbId \? Number\(tmdbId\) : undefined/);
  assert.match(appSource, /const tmdbId = urlParams\.get\('tmdbId'\)/);
  assert.match(detailSource, /buildMediaShareUrl\(\{ tmdbId: Number\(effectiveTmdbId\), mediaType: requestedMediaType \}\)/);
  assert.match(detailSource, /navigator\.clipboard\.writeText\(shareUrl\)/);
  assert.doesNotMatch(detailSource, /url: window\.location\.href/);
  assert.doesNotMatch(detailSource, /clipboard\.writeText\(window\.location\.href\)/);
});

test('SEENIT-UX-007 retire le partage Profil tant qu’aucun profil public n’existe', () => {
  assert.doesNotMatch(profileSource, /handleShare/);
  assert.doesNotMatch(profileSource, /Mon Profil Cinéphile/);
  assert.doesNotMatch(profileSource, />Partager</);
  assert.doesNotMatch(profileSource, /navigator\.share/);
});
