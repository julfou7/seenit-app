import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ratings = readFileSync(new URL('../src/components/EpisodeRatingsChart.tsx', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src/screens/ShowDetailScreenCore.tsx', import.meta.url), 'utf8');
const episodeDetail = readFileSync(new URL('../src/screens/EpisodeDetailModalCore.tsx', import.meta.url), 'utf8');

test('issue #216 garde le refresh Plex compact et accessible à côté du titre', () => {
  assert.match(core, /<h3[^>]*>Où regarder<\/h3><button/);
  assert.match(core, /aria-label="Actualiser Plex"/);
  assert.match(core, /w-11 h-11/);
  assert.match(core, /RefreshCw size=\{16\}/);
  assert.match(core, /isRefreshingPlex && "animate-spin"/);
  assert.match(core, /refreshPlexServers: true/);
});

test('issue #216 simplifie saisons, thèmes et casting sans modifier leurs actions métier', () => {
  assert.doesNotMatch(core, /ChevronUp|ChevronDown/);
  assert.match(core, /aria-expanded=\{expandedSeason === seasonNum\}/);
  assert.match(core, /Tout marquer vu/);
  assert.match(core, /Tout marquer non vu/);
  assert.match(core, /object-\[50%_25%\]/);
  assert.match(core, /line-clamp-2 min-h-\[2\.2em\]/);
  assert.match(core, /areThemesExpanded && keywords\.map/);
  assert.match(core, /`\+\$\{keywords\.length\} thèmes`/);
  assert.match(core, /title=\{isFullyWatched \? "Marquer toute la saison comme non vue" : "Marquer toute la saison comme vue"\}/);
});

test('issue #216 hiérarchise la classification US sans perdre sa provenance', () => {
  assert.match(core, /resolved\.shortLabel \|\| resolved\.label/);
  assert.match(core, /resolved\.original && resolved\.country/);
  assert.match(core, /classification \$\{ratingInfo\.provenance\}/);
  assert.match(core, /<small[^>]*>\{ratingInfo\.provenance\}<\/small>/);
});

test('SEENIT-RATING-001 affiche le graphe uniquement dans Épisodes et uniquement depuis TMDB', () => {
  assert.doesNotMatch(ratings, /createPortal|document\.getElementById|MutationObserver/);
  const episodesSection = core.slice(core.indexOf('id="section-episodes"'), core.indexOf('id="section-casting"'));
  assert.match(episodesSection, /<EpisodeRatingsChart/);
  assert.doesNotMatch(core.slice(core.indexOf('id="section-about"'), core.indexOf('id="section-episodes"')), /<EpisodeRatingsChart/);
  assert.match(ratings, /Source TMDB/);
  assert.match(ratings, /episode\?\.vote_average/);
  assert.doesNotMatch(ratings, /getSeasonImdbRatings|getEpisodeImdbVotes|omdbService|activeEpisodeVotes|hasFullImdbRatings/);
  assert.doesNotMatch(episodeDetail, /getSeasonImdbRatings|getEpisodeImdbVotes|omdbService|episodeImdbRating|episodeImdbVotes/);
  assert.match(episodeDetail, /currentEpisode\?\.vote_average/);
  assert.match(episodeDetail, />TMDB</);
  assert.match(ratings, /w-11 min-w-11/);
  assert.match(ratings, /overflow-x-auto/);
});
