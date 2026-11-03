import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFeatureSource } from './featureSource.ts';

const ratings = readFileSync(new URL('../src/components/EpisodeRatingsChart.tsx', import.meta.url), 'utf8');
const core = readFeatureSource('showDetail');
const episodeDetail = readFileSync(new URL('../src/screens/EpisodeDetailModalCore.tsx', import.meta.url), 'utf8');

test('issue #216 garde le refresh Plex compact et accessible à côté du titre', () => {
  assert.match(core, /<h3[^>]*>Où regarder<\/h3>\{onRefreshPlex && <button/);
  assert.match(core, /aria-label="Actualiser Plex"/);
  assert.match(core, /w-11 h-11/);
  assert.match(core, /RefreshCw size=\{16\}/);
  assert.match(core, /refreshing=\{isRefreshingPlex\}/);
  assert.match(core, /cn\(refreshing && 'animate-spin'\)/);
  assert.match(core, /refreshPlexServers: true/);
});

test('issue #216 simplifie saisons, thèmes et casting sans modifier leurs actions métier', () => {
  assert.doesNotMatch(core, /ChevronUp|ChevronDown/);
  assert.match(core, /aria-pressed=\{on\}/, 'SEENIT-UX-019 : les saisons sont des pastilles sélectionnables');
  assert.match(core, /if \(season !== expandedSeason\) void loadSeason\(season\)/, 'une pastille ne referme jamais sa saison');
  assert.match(core, /Tout marquer vu/);
  assert.match(core, /Tout marquer non vu/);
  assert.match(core, /object-\[50%_25%\]/);
  assert.match(core, /line-clamp-2/);
  assert.match(core, /expanded && keywords\.map/);
  assert.match(core, /`\+\$\{keywords\.length\} thèmes`/);
  assert.match(core, /aria-label=\{fullyWatched \? 'Marquer toute la saison comme non vue' : 'Marquer toute la saison comme vue'\}/);
});

test('issue #216 hiérarchise la classification US sans perdre sa provenance', () => {
  assert.match(core, /resolved\.shortLabel \|\| resolved\.label/);
  assert.match(core, /resolved\.original && resolved\.country/);
  assert.match(core, /classification \$\{ratingInfo\.provenance\}/);
  assert.match(core, /<small[^>]*>\{ratingInfo\.provenance\}<\/small>/);
});

test('SEENIT-RATING-001 affiche les notes de saison et d’épisode uniquement depuis TMDB', () => {
  const seriesSections = readFileSync(new URL('../src/screens/mediaDetail/seriesSections.tsx', import.meta.url), 'utf8');
  const episodeSections = readFileSync(new URL('../src/screens/mediaDetail/episodeSections.tsx', import.meta.url), 'utf8');
  const planning = readFileSync(new URL('../src/features/shows/detailPlanning.ts', import.meta.url), 'utf8');
  // Moyenne par saison : seasons[].vote_average TMDB ; barres de saison : episode.vote_average TMDB.
  assert.match(core, /seasonAverages\(tmdbDetails\?\.seasons\)/);
  assert.match(planning, /vote_average/);
  assert.match(seriesSections, /episode\.vote_average/);
  assert.match(core, /★ \{tmdbRating\} TMDB/);
  assert.match(episodeDetail, /currentEpisode\?\.vote_average/);
  for (const source of [core, seriesSections, episodeSections, episodeDetail, planning]) assert.doesNotMatch(source, /getSeasonImdbRatings|getEpisodeImdbVotes|omdbService|episodeImdbRating|episodeImdbVotes|imdbRating/);
  // Chaque épisode garde une cible de 44 px : ligne et coche dans la fiche série, case de la fiche épisode.
  assert.match(seriesSections, /min-h-\[62px\]/);
  assert.match(seriesSections, /w-11 h-11 shrink-0/);
  assert.match(episodeSections, /className="flex-1 min-w-0 h-11 flex items-center"/);
  assert.match(seriesSections, /overflow-x-auto/);
  assert.doesNotMatch(ratings, /createPortal|document\.getElementById|MutationObserver/);
});
