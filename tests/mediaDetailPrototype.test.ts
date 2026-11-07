import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { averageRating, episodeRank, formatClock, planEpisodes, planMovieEnd, ratingBarHeight, seasonAverages, settleSeenToggle, upcomingEpisodeLabel } from '../src/features/shows/detailPlanning.ts';
import { buildVerifiedSimilar, directedMovies, movieIdsFromCredits, similarReasonFor } from '../src/features/shows/similarReasons.ts';

test('SEENIT-UX-019 calcule « Fin à » et la soirée sans inventer de durée', () => {
  assert.equal(formatClock(21 * 60 + 40 + 166), '00:26', 'un film de 2 h 46 lancé à 21:40 finit à 00:26');
  const late = planMovieEnd(21 * 60 + 40, 166)!;
  assert.equal(late.end, '00:26');
  assert.equal(late.afterMidnight, 26);
  assert.equal(late.beforeMidnight, 0);
  assert.ok(late.midnightPercent !== null && Math.abs(late.midnightPercent - 70) < 0.01, 'minuit est à 140 min sur une fenêtre de 200');
  const early = planMovieEnd(18 * 60, 100)!;
  assert.equal(early.afterMidnight, 0);
  assert.equal(early.beforeMidnight, 260);
  assert.equal(early.midnightPercent, null, 'minuit hors fenêtre : pas de repère');
  assert.equal(planMovieEnd(20 * 60, 0), null, 'durée inconnue : pas de carte');

  const episodes = [{ runtime: 47 }, { runtime: 47 }, { runtime: null }, { runtime: 47 }];
  const evening = planEpisodes(23 * 60, episodes, episode => episode.runtime);
  assert.deepEqual(evening.plan.map(entry => entry.end), ['23:47', '00:34'], 'la soirée s’arrête au premier épisode sans durée');
  assert.equal(evening.beforeMidnight, 1);
  assert.equal(planEpisodes(20 * 60, episodes.slice(0, 2).concat(episodes[3]), episode => episode.runtime, 2).plan.length, 2, 'au plus la limite demandée');
});

test('SEENIT-UX-019 moyennes de saison, rang et barres à partir des seules notes TMDB connues', () => {
  assert.deepEqual(seasonAverages([{ season_number: 0, vote_average: 9 }, { season_number: 2, vote_average: 8.2 }, { season_number: 1, vote_average: 7.9 }, { season_number: 3, vote_average: 0 }]), [{ season: 1, average: 7.9 }, { season: 2, average: 8.2 }], 'saison 0 et notes absentes exclues, ordre des saisons');
  assert.equal(averageRating([8, 9, 0, undefined, 'x']), 8.5);
  assert.equal(averageRating([0, null]), null);
  assert.deepEqual(episodeRank([8.4, 9.6, 9.1, 0], 9.6), { rank: 1, total: 3 }, 'meilleure note de la saison');
  assert.deepEqual(episodeRank([8.4, 9.6, 9.1], 8.4), { rank: 3, total: 3 });
  assert.equal(episodeRank([8.4], 0), null, 'épisode non noté : pas de rang');
  assert.equal(ratingBarHeight(9.6, [8, 9.6]), 40);
  assert.equal(ratingBarHeight(8, [8, 9.6]), 6);
  assert.equal(ratingBarHeight(undefined, [8, 9.6]), 6, 'note absente : barre minimale, jamais inventée');
});

const director = { name: 'Denis Villeneuve', movieIds: new Set([335984, 329865]) };
const lead = { name: 'Timothée Chalamet', movieIds: new Set([157336]) };
const evidence = { director, leadActors: [lead], mainGenre: { id: 878, name: 'Science-fiction' } };

test('SEENIT-RELATION-001 ne propose un similaire qu’avec une raison prouvée par TMDB', () => {
  assert.deepEqual(similarReasonFor({ id: 335984, genre_ids: [878] }, evidence), { kind: 'director', reason: 'Même réalisateur · Denis Villeneuve' }, 'le réalisateur l’emporte sur le genre');
  assert.deepEqual(similarReasonFor({ id: 157336, genre_ids: [878] }, evidence), { kind: 'actor', reason: 'Avec Timothée Chalamet' });
  assert.deepEqual(similarReasonFor({ id: 1, genre_ids: [878] }, evidence), { kind: 'genre', reason: 'Même genre · Science-fiction' });
  assert.equal(similarReasonFor({ id: 2, genre_ids: [18] }, evidence), null, 'sans raison, pas de carte');

  const recommendations = [
    { id: 872585, title: 'Oppenheimer', poster_path: '/o.jpg', genre_ids: [18] },
    { id: 157336, title: 'Interstellar', poster_path: '/i.jpg', genre_ids: [878] },
    { id: 1, title: 'SF', poster_path: '/s.jpg', genre_ids: [878] },
    { id: 438631, title: 'Dune', poster_path: '/d.jpg', genre_ids: [878] },
    { id: 3, title: 'Sans affiche', poster_path: null, genre_ids: [878] },
    { id: 4, title: 'Adulte', poster_path: '/a.jpg', genre_ids: [878], adult: true },
    { id: 5, name: 'Une série', poster_path: '/t.jpg', genre_ids: [878], media_type: 'tv' },
  ];
  const directorFilms = [{ id: 335984, title: 'Blade Runner 2049', poster_path: '/b.jpg', genre_ids: [878] }, { id: 157336, title: 'Doublon', poster_path: '/i.jpg' }];
  const result = buildVerifiedSimilar(693134, recommendations, directorFilms, evidence, new Set([438631]));
  assert.deepEqual(result.map(entry => entry.candidate.id), [335984, 157336, 1], 'réalisateur > acteur > genre ; collection, sans affiche, adulte, série et sans raison écartés');
  assert.deepEqual(result.map(entry => entry.kind), ['director', 'actor', 'genre']);
  assert.equal(buildVerifiedSimilar(693134, [{ id: 693134, poster_path: '/x.jpg', genre_ids: [878] }], [], evidence).length, 0, 'jamais le film courant');
  assert.equal(buildVerifiedSimilar(693134, recommendations, [], evidence, new Set(), 1).length, 1, 'borné');
});

test('SEENIT-RELATION-001 rapproche par identifiant TMDB seulement, jamais par titre ou année', () => {
  const credits = { crew: [{ id: 10, job: 'Director', title: 'A', release_date: '2010-01-01', poster_path: '/a.jpg', popularity: 1 }, { id: 11, job: 'Writer', title: 'B', release_date: '2011-01-01', poster_path: '/b.jpg' }, { id: 12, job: 'Director', title: 'C', release_date: '2999-01-01', poster_path: '/c.jpg' }, { id: 13, job: 'Director', title: 'D', release_date: '2012-01-01', poster_path: '/d.jpg', popularity: 9, media_type: 'tv' }], cast: [{ id: 20 }, { id: 21, media_type: 'tv' }] };
  assert.deepEqual(directedMovies(credits, '2026-11-03').map(movie => movie.id), [10], 'réalisés, sortis, films seulement');
  assert.deepEqual([...movieIdsFromCredits(credits, 'cast')], [20]);
  assert.deepEqual([...movieIdsFromCredits(credits, 'director')], [10, 12]);
  const sameTitle = buildVerifiedSimilar(1, [{ id: 99, title: 'Dune', poster_path: '/x.jpg', genre_ids: [18] }], [], { director: { name: 'X', movieIds: new Set([7]) }, leadActors: [], mainGenre: { id: 878, name: 'SF' } });
  assert.equal(sameTitle.length, 0, 'un titre identique ne crée aucune raison');
  const source = readFileSync('src/features/shows/similarReasons.ts', 'utf8');
  const decision = source.slice(source.indexOf('export function similarReasonFor'), source.indexOf('type CreditEntry'));
  assert.ok(decision.length > 200);
  assert.doesNotMatch(decision, /\.title|release_date|toLowerCase|localeCompare/, 'la décision ne lit ni titre, ni année');
  assert.match(decision, /movieIds\.has\(id\)/, 'personnes rapprochées par ID TMDB de film');
  assert.match(decision, /genre_ids \|\| \[\]\)\.includes\(evidence\.mainGenre\.id\)/, 'genre rapproché par ID TMDB');
});

test('SEENIT-UX-019 le smoke monte les vraies fiches et vérifie leurs parcours', () => {
  const smoke = readFileSync('scripts/pwa-browser-smoke.cjs', 'utf8');
  assert.match(smoke, /\['mediaDetail', client => testMediaDetailHarness\(client\)\]/);
  assert.match(smoke, /await buildMediaDetailHarness\(root\)/);
  const harness = readFileSync('scripts/media-detail-browser-checks.cjs', 'utf8');
  for (const step of ['film : un seul bouton Suivre et les tuiles, comme la série (#859)', 'film suivi : le bouton devient Marquer vu (#859)', 'film vu : logo Vu de SeenIt, plus de « Vu · annuler », plus d’heure de fin', 'anneau Vu dessiné par le compositeur, sans atténuation (#859)', 'anneau Vu final net après l’animation (#859)', 'Fin à épuré : ni « il est », ni « Fini … avant minuit » (#857)', 'note et âge au-dessus de Marquer vu (#857)', 'série : note et âge au-dessus de la progression (#857)', 'bande-annonce en bouton entier, comme la série (#857)', 'bouton Vu des lignes = celui de l’Accueil, anneau animé (#857)', 'Vu de la fiche épisode = anneau de l’Accueil, sans « il est » (#857)', 'squelette épisode au gabarit actuel (#857)', 'Entrée sur Vu ne fait que basculer l’épisode', 'Entrée sur la ligne ouvre l’épisode sans le marquer', 'plus d’onglets', 'le bouton or ouvre le prochain épisode', 'genres TMDB traduits en français', 'rôle « Self » traduit et accordé', 'pastilles alignées', 'un seul Netflix', 'une pastille sélectionne sa saison', 'menu ⋮ : toutes les actions existantes', 'similaires : seulement avec une raison prouvée', 'soirée de trois épisodes', 'masque son résumé', '« Vu, puis E15 » marque et enchaîne', 'réaction enregistrée', 'garde 44 px']) assert.ok(harness.includes(step), step);
  const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  assert.doesNotMatch(view, /handleTabChange|id="section-about"|>À propos</, 'un seul défilement, sans onglets');
});

test('SEENIT-UX-019 parle français : genres TMDB, rôles génériques et plateformes dédoublonnées', async () => {
  const { frenchCharacterName, frenchGenreName, frenchGenres } = await import('../src/features/shows/frenchLabels.ts');
  const { dedupeProvidersByName, getCleanProviderName } = await import('../src/features/providers/providerNames.ts');
  assert.equal(frenchGenreName({ id: 10764, name: 'Reality' }), 'Téléréalité');
  assert.equal(frenchGenreName({ id: 10765, name: 'Sci-Fi & Fantasy' }), 'Science-fiction & fantastique');
  assert.equal(frenchGenreName({ id: 999999, name: 'Inconnu' }), 'Inconnu', 'genre inconnu : nom fourni conservé');
  assert.deepEqual(frenchGenres([{ id: 18, name: 'Drame' }, { id: 10764, name: 'Reality' }]).map(genre => genre.name), ['Drame', 'Téléréalité']);
  assert.equal(frenchCharacterName('Self', 2), 'Lui-même');
  assert.equal(frenchCharacterName('Self', 1), 'Elle-même');
  assert.equal(frenchCharacterName('Herself'), 'Elle-même');
  assert.equal(frenchCharacterName('Host', 1), 'Présentatrice');
  assert.equal(frenchCharacterName('Maui (voice)'), 'Maui · voix');
  assert.equal(frenchCharacterName('Self - Contestant', 2), 'Lui-même · Contestant');
  assert.equal(frenchCharacterName('Walter White'), 'Walter White', 'un vrai personnage reste tel quel');
  assert.equal(getCleanProviderName({ provider_name: 'Netflix Standard with Ads' }), 'Netflix');
  assert.deepEqual(dedupeProvidersByName([{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 1796, provider_name: 'Netflix Standard with Ads' }, { provider_id: 337, provider_name: 'Disney Plus' }]).map(provider => [provider.provider_id, provider.provider_name]), [[8, 'Netflix'], [337, 'Disney+']], 'le premier (abonnement) l’emporte');
});

test('SEENIT-UX-019 une seule fiche acteur, la barre visible sur la fiche et un squelette au même gabarit', () => {
  for (const path of ['src/screens/ShowDetailView.tsx', 'src/screens/WatchListView.tsx', 'src/screens/DiscoverViewCore.tsx', 'src/screens/ProfileScreen.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /import \{ PersonProfile as PersonDetailModal \} from '\.\.\/components\/PersonProfile'/, `${path} ouvre la fiche acteur unique`);
    assert.doesNotMatch(source, /from '\.\/PersonDetailModal'/);
  }
  assert.match(readFileSync('src/components/PersonProfile.tsx', 'utf8'), /<MovieActorProfile [^>]*historyMode="external"/);
  assert.match(readFileSync('src/App.tsx', 'utf8'), /label="Fiche média" onDismiss=\{closeShow\} historyMode="external" blocking=\{false\} data-media-layer=""/);
  assert.match(readFileSync('src/components/bottomNav.css', 'utf8'), /:not\(\[data-media-layer\]\)\) \.bottom-nav-shell\{display:none\}/);
  const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  assert.match(view, /label=\{`Voir \$\{code\}`\}[^\n]*onClick=\{handleWatchNextEpisode\}/, 'le bouton or ouvre l’épisode, il ne marque rien');
  assert.ok(view.indexOf('<ThemesCard') > view.indexOf('<DetailSynopsis') && view.indexOf('<ThemesCard') < view.indexOf('<SeasonAverageChart'), 'genres et thèmes juste sous le synopsis');
  assert.match(readFileSync('src/screens/MediaDetailColdShell.tsx', 'utf8'), /style=\{\{ height: isSeries \? 300 : 380 \}\}/);
});

test('SEENIT-UX-019 #857 un épisode à venir dit quand il sort, en relatif et daté au-delà d’une semaine', () => {
  assert.equal(upcomingEpisodeLabel('2026-11-04', '2026-11-04'), 'Aujourd’hui');
  assert.equal(upcomingEpisodeLabel('2026-11-05', '2026-11-04'), 'Demain');
  assert.equal(upcomingEpisodeLabel('2026-11-11', '2026-11-04'), 'Dans 7 jours');
  assert.equal(upcomingEpisodeLabel('2026-11-16', '2026-11-04'), 'Dans 12 jours · 16 nov.', 'au-delà de 7 jours : « dans X jours » et la date');
  assert.equal(upcomingEpisodeLabel('2027-01-02', '2026-12-30'), 'Dans 3 jours', 'passage d’année');
  assert.equal(upcomingEpisodeLabel('bientôt', '2026-11-04'), 'Bientôt');
  const rows = readFileSync('src/screens/mediaDetail/seriesSections.tsx', 'utf8');
  assert.doesNotMatch(rows, /!aired && 'opacity-60'/, 'plus de ligne à moitié grisée');
  assert.match(rows, /<SeenItCheckButton className="seenit-check--compositor" celebrationLayer=\{<CompositorCelebration \/>\} isWatched=\{watched\}/, 'bouton Vu des lignes = bouton de l’Accueil');
  const header = readFileSync('src/screens/mediaDetail/episodeSections.tsx', 'utf8');
  assert.match(header, /<SeenItCheckButton \{\.\.\.\(isFuture && !isSeen \? \{\} : \{ className: 'seenit-check--compositor', celebrationLayer: <CompositorCelebration \/> \}\)\} isWatched=\{isSeen\}/);
  assert.doesNotMatch(readFileSync('src/screens/mediaDetail/detailUi.tsx', 'utf8'), /SeenItCheckGlyph/, 'le pictogramme TV a disparu');
  assert.doesNotMatch(readFileSync('src/screens/mediaDetail/movieSections.tsx', 'utf8'), /il est \{formatClock|beforeMidnight\} min avant minuit/, 'ni « il est », ni « Fini X min avant minuit »');
});

test('SEENIT-UX-019 #858 le bouton Vu attend la vraie mutation avant d’annoncer le succès', async () => {
  let finished = false;
  const pending = settleSeenToggle(new Promise<void>(resolve => setTimeout(() => { finished = true; resolve(); }, 20)));
  assert.equal(await pending, undefined);
  assert.equal(finished, true, 'le bouton reste en attente jusqu’à la fin de l’écriture');
  assert.equal(await settleSeenToggle(false), false, 'un échec explicite n’anime pas le succès');
  await assert.rejects(settleSeenToggle(Promise.reject(new Error('Firestore'))), /Firestore/, 'une erreur n’est jamais transformée en succès');
  assert.match(readFileSync('src/screens/mediaDetail/seriesSections.tsx', 'utf8'), /onClick=\{event => settleSeenToggle\(onToggleEpisode\(event, episode\.episode_number\)\)\}/);
  assert.match(readFileSync('src/screens/mediaDetail/episodeSections.tsx', 'utf8'), /settleSeenToggle\(onToggle\(\)\)/);
  assert.match(readFileSync('src/screens/EpisodeDetailModalCore.tsx', 'utf8'), /const handleMainButtonClick = \(\) => \{[\s\S]*?return toggleSeen\(\);/);
});

test('SEENIT-UX-019 #859 film à bouton unique et anneau Vu sur le compositeur', () => {
  const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  // Maquette DlFilm : le bouton ⬇ du film suit le bouton unique et les tuiles, sous le gate et film absent.
  assert.match(view, /<div className="flex gap-2">\{movieCta\}\{mainProvider && providerTile\(mainProvider\)\}\{plexProvider && providerTile\(plexProvider\)\}\{canUseFilmMode && !movieAvailable && <MovieDownloadButton /);
  assert.match(view, /if \(!movieFollowed\) return <GoldCta label="Suivre le film"/);
  // Retour terrain du 07/11 : un film vu affiche le logo Vu officiel (anneau or + coche), jamais « Vu · annuler ».
  assert.match(view, /if \(hasSeenMedia\) return <GoldCta tone="done" label=\{<span data-movie-seen className="inline-flex items-center gap-2"><SeenItRing size=\{30\} \/>Vu<\/span>\} ariaLabel="Vu, toucher pour annuler" onClick=\{toggleMovieSeen\} \/>;/);
  assert.doesNotMatch(view, /label="✓ Vu · annuler"/);
  const css = readFileSync('src/components/seenItCheckButton.css', 'utf8');
  const compositor = css.slice(css.indexOf('#859'));
  assert.doesNotMatch(compositor.replace(/@media[\s\S]*$/, ''), /stroke-dashoffset/, 'aucune propriété SVG animée en mode compositeur');
  assert.match(compositor, /@keyframes seenitSweep \{ from \{ transform:rotate\(0\); \} to \{ transform:rotate\(180deg\); \} \}/);
  assert.match(compositor, /\[aria-busy=true\]:disabled \{ opacity:1;/);
  assert.match(readFileSync('src/screens/mediaDetail/seriesSections.tsx', 'utf8'), /<SeenItCheckButton className="seenit-check--compositor" celebrationLayer=/);
});
