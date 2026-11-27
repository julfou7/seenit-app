import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Show } from '../src/types.ts';
import { classifyComingBack, comingBackCountdown, comingBackDays, selectComingBack, COMING_BACK_HORIZON_DAYS, COMING_BACK_RETURN_HORIZON_DAYS } from '../src/features/watchlist/comingBack.ts';

// Retour terrain du 27/11 (maquette validée) : « un aperçu de À venir sous Continuer à regarder […] une série qui
// commence et dont j'ai vu la saison précédente, ou alors c'est la 1re : c'est un truc que j'aime et je suis à jour ».
const today = '2026-11-26';
const inDays = (days: number) => {
  const date = new Date(Date.UTC(2026, 10, 26 + days));
  return date.toISOString().slice(0, 10);
};
const episodes = (season: number, count: number) => Array.from({ length: count }, (_, index) => `${season}x${index + 1}`);
const proof = (season: number, count: number | null, extra: Record<string, unknown> = {}) => ({
  [String(season)]: { season_number: season, episode_count: count, known_episodes_in_season: count ?? 0, last_season_number: season, season_total_unknown: count === null, last_known_episode_type: null, last_known_episode_air_date: null, total_evidence_version: 5, ...extra },
});
const series = (overrides: Partial<Show>): Show => ({
  id: 'show', userId: 'u1', tmdbId: 1, title: 'Série', mediaType: 'tv', status: 'watching', isArchived: false, seenEpisodes: [],
  episodeRecords: {}, posterPath: null, backdropPath: null, createdAt: 0, updatedAt: 0, ...overrides,
} as Show);
const next = (season: number, episode: number, days: number) => ({ season_number: season, episode_number: episode, air_date: inDays(days) });

test('SEENIT-UX-024 « Ça revient » : nouvelle saison d’une série dont la saison précédente est vue en entier', () => {
  const mobland = series({ id: 'mobland', title: 'MobLand', seenEpisodes: episodes(1, 10), seasonProgress: proof(1, 10) as Show['seasonProgress'], nextEpisodeToAir: next(2, 1, 3) });
  const item = classifyComingBack(mobland, today);
  assert.equal(item?.kind, 'return');
  assert.equal(item?.label, 'Retour · saison 2');
  assert.equal(item?.reason, 'Saison 1 vue en entier');
  assert.equal(item?.days, 3);

  const lioness = series({ id: 'lioness', title: 'Lioness', seenEpisodes: [...episodes(1, 8), ...episodes(2, 8)],
    seasonProgress: { ...proof(1, 8), ...proof(2, 8) } as Show['seasonProgress'], nextEpisodeToAir: next(3, 1, 25) });
  assert.equal(classifyComingBack(lioness, today)?.reason, 'À jour · 2 saisons vues');

  const unfinished = series({ seenEpisodes: episodes(1, 9), seasonProgress: proof(1, 10) as Show['seasonProgress'], nextEpisodeToAir: next(2, 1, 3) });
  assert.equal(classifyComingBack(unfinished, today)?.behind, 1, 'saison précédente pas finie : à rattraper (SEENIT-UX-025)');

  // Sans total prouvé, la saison est finie seulement s'il ne reste rien de sorti à voir.
  const upToDate = series({ seenEpisodes: episodes(1, 6), nextEpisodeToWatch: next(2, 1, 3), nextEpisodeToAir: next(2, 1, 3) });
  assert.equal(classifyComingBack(upToDate, today)?.kind, 'return');
  const behind = series({ seenEpisodes: episodes(1, 4), nextEpisodeToWatch: { season_number: 1, episode_number: 5, air_date: inDays(-60) }, nextEpisodeToAir: next(2, 1, 3) });
  assert.equal(classifyComingBack(behind, today), null, 'un épisode sorti reste à voir');
  const partial = series({ seenEpisodes: ['1x1'], totalAiredEpisodes: 3, nextEpisodeToWatch: null, nextEpisodeToAir: next(2, 1, 3) });
  assert.equal(classifyComingBack(partial, today), null, '1 épisode vu sur 3 diffusés, même sans prochain épisode connu');
});

test('SEENIT-UX-024 première d’une série pas commencée, finale d’une saison où tu es à jour', () => {
  const premiere = series({ status: 'plan_to_watch', nextEpisodeToAir: next(1, 1, 10) });
  assert.deepEqual([classifyComingBack(premiere, today)?.kind, classifyComingBack(premiere, today)?.label, classifyComingBack(premiere, today)?.reason], ['premiere', 'Première', 'Dans ta liste']);

  const finale = series({ seenEpisodes: [...episodes(1, 8), ...episodes(3, 7)], seasonProgress: proof(3, 8) as Show['seasonProgress'], nextEpisodeToAir: next(3, 8, 2) });
  const item = classifyComingBack(finale, today);
  assert.equal(item?.kind, 'finale');
  assert.equal(item?.label, 'Finale · saison 3');
  assert.equal(item?.reason, 'À jour · 7 épisodes vus');

  assert.equal(classifyComingBack(series({ ...finale, seenEpisodes: episodes(3, 6) }), today)?.reason, '1 épisode à rattraper', 'épisode 7 pas vu (SEENIT-UX-025)');
  assert.equal(classifyComingBack(series({ ...finale, nextEpisodeToAir: next(3, 5, 2) }), today), null, 'pas le dernier épisode de la saison');
  assert.equal(classifyComingBack(series({ ...finale, seasonProgress: proof(3, null) as Show['seasonProgress'] }), today), null, 'total de saison inconnu');
  // Un finale dont la date est connue suffit à prouver le total, même sans nombre d'épisodes annoncé.
  const datedFinale = series({ ...finale, seasonProgress: proof(3, null, { known_episodes_in_season: 8, season_total_unknown: false, last_known_episode_type: 'finale' }) as Show['seasonProgress'] });
  assert.equal(classifyComingBack(datedFinale, today)?.kind, 'finale');
  // Un épisode du milieu de saison 2 n'entre jamais : ce n'est ni un retour ni une finale.
  assert.equal(classifyComingBack(series({ seenEpisodes: episodes(2, 3), seasonProgress: proof(2, 8) as Show['seasonProgress'], nextEpisodeToAir: next(2, 4, 2) }), today), null);
});

test('SEENIT-UX-024 horizon de 45 jours, jamais le jour de la sortie ni film, archive ou abandon ; huit au plus, la plus proche d’abord', () => {
  const base = { status: 'plan_to_watch' as const };
  assert.equal(classifyComingBack(series({ ...base, nextEpisodeToAir: next(1, 1, 0) }), today), null, 'le jour même, la série passe dans Nouveautés');
  assert.equal(classifyComingBack(series({ ...base, nextEpisodeToAir: next(1, 1, COMING_BACK_HORIZON_DAYS + 1) }), today), null);
  assert.ok(classifyComingBack(series({ ...base, nextEpisodeToAir: next(1, 1, COMING_BACK_HORIZON_DAYS) }), today));
  assert.equal(classifyComingBack(series({ ...base, mediaType: 'movie', nextEpisodeToAir: next(1, 1, 5) }), today), null);
  assert.equal(classifyComingBack(series({ ...base, isArchived: true, nextEpisodeToAir: next(1, 1, 5) }), today), null);
  assert.equal(classifyComingBack(series({ status: 'dropped', nextEpisodeToAir: next(1, 1, 5) }), today), null);
  assert.equal(classifyComingBack(series({ ...base, nextEpisodeToAir: { season_number: 1, episode_number: 1, air_date: null } }), today), null, 'sans date, rien');

  const shows = [9, 2, 30, 5, 1, 12, 40, 7, 3, 20].map((days, index) => series({ ...base, id: `s${index}`, title: `Série ${index}`, nextEpisodeToAir: next(1, 1, days) }));
  assert.deepEqual(selectComingBack(shows, today).map(item => item.days), [1, 2, 3, 5, 7, 9, 12, 20]);
});

test('SEENIT-UX-024 compte à rebours : « J-N » et sa semaine sous sept jours, sinon la date', () => {
  assert.equal(comingBackDays('2026-11-29', today), 3);
  assert.equal(comingBackDays('2026-03-30', '2026-03-28'), 2, 'le passage à l’heure d’été ne décale pas le compte');
  const near = comingBackCountdown('2026-11-29', 3);
  assert.deepEqual([near.near, near.headline, near.detail, near.elapsed], [true, 'J-3', 'dim. 29 nov.', 4]);
  const later = comingBackCountdown('2026-12-21', 25);
  assert.deepEqual([later.near, later.headline, later.detail], [false, '21 déc.', 'lundi · J-25']);
});

test('SEENIT-UX-024 l’accueil place « Ça revient » entre Continuer à regarder et Nouveautés ; « Tout À venir » ouvre l’onglet', () => {
  const section = readFileSync(new URL('../src/screens/WatchNextSection.tsx', import.meta.url), 'utf8');
  const first = section.indexOf('{renderSeriesGroup(0)}');
  const rail = section.indexOf('<ComingBackRail shows={allShows}');
  const second = section.indexOf('{renderSeriesGroup(1)}');
  assert.ok(first > 0 && first < rail && rail < second, 'Continuer, puis Ça revient, puis Nouveautés');
  const view = readFileSync(new URL('../src/screens/WatchListView.tsx', import.meta.url), 'utf8');
  assert.match(view, /onUpcoming=\{\(\) => scrollToSection\(upcomingRef, 'upcoming'\)\}/);
  const card = readFileSync(new URL('../src/components/cards/ComingBackRail.tsx', import.meta.url), 'utf8');
  assert.match(card, /<EpisodeReminderBell show=\{show\} episode=\{episode\} subject=\{show\.title\} \/>/, 'la cloche de l’épisode, comme sur la fiche');
  assert.match(card, /if \(!items\.length\) return null;/, 'section masquée quand elle est vide');
});

// Retour terrain du 27/11 sur les vraies données : deux cartes seulement, alors que Daryl Dixon (à jour, 3 saisons) et
// Présumé innocent (saison 1 vue) reviennent en février, que Loups garous revient dans 7 jours avec 8 épisodes de
// saison 2 à voir et que la finale de Singapura sort dans 3 jours avec un épisode de retard.
test('SEENIT-UX-025 un retour où tu es à jour s’annonce jusqu’à 120 jours ; première et finale restent à 45 jours', () => {
  const daryl = series({ id: 'daryl', title: 'Daryl Dixon', seenEpisodes: [...episodes(1, 6), ...episodes(2, 6), ...episodes(3, 7)],
    seasonProgress: { ...proof(1, 6), ...proof(2, 6), ...proof(3, 7), ...proof(4, null) } as Show['seasonProgress'], nextEpisodeToAir: next(4, 1, 87) });
  const item = classifyComingBack(daryl, today);
  assert.deepEqual([item?.kind, item?.label, item?.reason, item?.behind], ['return', 'Retour · saison 4', 'À jour · 3 saisons vues', 0]);
  assert.ok(classifyComingBack(series({ ...daryl, nextEpisodeToAir: next(4, 1, COMING_BACK_RETURN_HORIZON_DAYS) }), today));
  assert.equal(classifyComingBack(series({ ...daryl, nextEpisodeToAir: next(4, 1, COMING_BACK_RETURN_HORIZON_DAYS + 1) }), today), null);
  assert.equal(classifyComingBack(series({ status: 'plan_to_watch', nextEpisodeToAir: next(1, 1, COMING_BACK_HORIZON_DAYS + 1) }), today), null, 'première au-delà de 45 jours');
  const finale = series({ seenEpisodes: episodes(3, 7), seasonProgress: proof(3, 8) as Show['seasonProgress'], nextEpisodeToAir: next(3, 8, COMING_BACK_HORIZON_DAYS + 1) });
  assert.equal(classifyComingBack(finale, today), null, 'finale au-delà de 45 jours');
  // Le rattrapage reste à 45 jours : un retour lointain d'une saison pas finie, c'est Continuer à regarder.
  const farBehind = series({ seenEpisodes: episodes(1, 3), seasonProgress: proof(1, 8) as Show['seasonProgress'], nextEpisodeToAir: next(2, 1, 60) });
  assert.equal(classifyComingBack(farBehind, today), null);
  // La plus proche d'abord : les retours lointains complètent le rail sans passer devant.
  const soon = series({ id: 'soon', title: 'Bientôt', status: 'plan_to_watch', nextEpisodeToAir: next(1, 1, 20) });
  assert.deepEqual(selectComingBack([daryl, soon], today).map(entry => entry.show.id), ['soon', 'daryl']);
});

test('SEENIT-UX-025 retour ou finale d’une saison commencée : le nombre d’épisodes à rattraper avant la sortie', () => {
  const wolves = series({ id: 'wolves', title: 'Loups garous', seenEpisodes: [...episodes(1, 8), ...episodes(2, 2)],
    seasonProgress: { ...proof(1, 8), ...proof(2, 10), ...proof(3, null) } as Show['seasonProgress'], nextEpisodeToAir: next(3, 1, 7) });
  const back = classifyComingBack(wolves, today);
  assert.deepEqual([back?.kind, back?.label, back?.reason, back?.behind], ['return', 'Retour · saison 3', '8 épisodes à rattraper', 8]);

  const singapura = series({ id: 'singapura', title: 'Singapura', seenEpisodes: episodes(1, 4), seasonProgress: proof(1, 6) as Show['seasonProgress'], nextEpisodeToAir: next(1, 6, 3) });
  const last = classifyComingBack(singapura, today);
  assert.deepEqual([last?.kind, last?.label, last?.reason, last?.behind], ['finale', 'Finale · saison 1', '1 épisode à rattraper', 1]);

  assert.equal(classifyComingBack(series({ ...wolves, seenEpisodes: episodes(1, 8) }), today), null, 'saison précédente jamais commencée');
  assert.equal(classifyComingBack(series({ ...singapura, seenEpisodes: [] }), today), null, 'saison jamais commencée');
  assert.equal(classifyComingBack(series({ ...wolves, seasonProgress: { ...proof(1, 8), ...proof(2, null) } as Show['seasonProgress'], totalAiredEpisodes: 18 }), today), null, 'sans total prouvé, pas de compte');
  assert.equal(classifyComingBack(series({ ...singapura, nextEpisodeToAir: next(1, 5, 3) }), today), null, 'un épisode du milieu de saison n’entre pas');

  const card = readFileSync(new URL('../src/components/cards/ComingBackRail.tsx', import.meta.url), 'utf8');
  assert.match(card, /kind !== 'premiere' && !behind && <SeenItRing/, 'pas d’anneau Vu quand il reste des épisodes à voir');
});
