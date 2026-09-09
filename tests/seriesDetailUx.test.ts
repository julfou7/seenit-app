import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wrapper = readFileSync(new URL('../src/screens/ShowDetailScreen.tsx', import.meta.url), 'utf8');
const ratings = readFileSync(new URL('../src/components/EpisodeRatingsChart.tsx', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src/screens/ShowDetailScreenCore.tsx', import.meta.url), 'utf8');

test('issue #216 garde le refresh Plex compact et accessible à côté du titre', () => {
  assert.match(wrapper, /data-seenit-provider-heading-row/);
  assert.match(wrapper, /aria-label="Actualiser Plex"/);
  assert.match(wrapper, /w-11 h-11/);
  assert.match(wrapper, /RefreshCw size=\{16\}/);
  assert.match(wrapper, /isRefreshing \? 'animate-spin' : ''/);
});

test('issue #216 simplifie saisons, thèmes et casting sans modifier leurs actions métier', () => {
  assert.match(wrapper, /#section-episodes button:has\(svg\.lucide-chevron-up\)/);
  assert.match(wrapper, /Tout marquer vu/);
  assert.match(wrapper, /Tout marquer non vu/);
  assert.match(wrapper, /object-position: 50% 25%/);
  assert.match(wrapper, /-webkit-line-clamp: 2/);
  assert.match(wrapper, /data-seenit-theme-extra/);
  assert.match(wrapper, /`\+\$\{extras\.length\} thèmes`/);
  assert.match(core, /title=\{isFullyWatched \? "Marquer toute la saison comme non vue" : "Marquer toute la saison comme vue"\}/);
});

test('issue #216 hiérarchise la classification US sans perdre sa provenance', () => {
  assert.match(wrapper, /text\.includes\('· US ·'\)/);
  assert.match(wrapper, /classification \$\{provenance\}/);
  assert.match(wrapper, /readableAge/);
  assert.match(wrapper, /provenance/);
});

test('SEENIT-RATING-001 affiche le graphe uniquement dans Épisodes et uniquement depuis TMDB', () => {
  assert.match(ratings, /createPortal/);
  assert.match(ratings, /document\.getElementById\('section-episodes'\)/);
  assert.match(ratings, /data-seenit-ratings-host/);
  assert.match(ratings, /Source TMDB/);
  assert.match(ratings, /episode\?\.vote_average/);
  assert.doesNotMatch(ratings, /getSeasonImdbRatings|getEpisodeImdbVotes|omdbService|activeEpisodeVotes|hasFullImdbRatings/);
  assert.match(ratings, /w-11 min-w-11/);
  assert.match(ratings, /overflow-x-auto/);
});
