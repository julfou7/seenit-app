import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrMediaLabel, localizeArrLists, seasonEpisodeTitles, type ArrLabelSource } from '../src/features/downloads/arrMediaLabels.ts';
import type { ProgrammedItem } from '../src/features/downloads/programmedCalendar.ts';
import type { RecentImport } from '../src/features/downloads/recentImports.ts';

// Retour terrain du 09/11 sur la v1.4.287 (« titre pas traduit dans Téléchargements, écart avec le reste de l'app,
// voir L'Arène ») : Sonarr dit « The Arena (2026) », la fiche TMDB fr-FR « L'Arène ».
const episode = (id: number, number: number, extra: Partial<Extract<ProgrammedItem, { kind: 'episode' }>> = {}): ProgrammedItem => ({ kind: 'episode', id, seriesId: 5, tmdbId: 77, seriesTitle: 'The Arena (2026)', season: 1, episode: number, title: `Episode ${number}`, posterUrl: 'https://artworks.thetvdb.com/arena.jpg', ...extra });
const arenaImport: RecentImport = { kind: 'series', key: 's5', arrId: 5, tmdbId: 77, title: 'The Arena (2026)', posterUrl: 'https://artworks.thetvdb.com/arena.jpg', year: 2026, rating: 6.4, date: 1, episodes: [{ season: 1, episode: 1 }] };

test('SEENIT-DOWNLOAD-022 titres, affiches et épisodes de la fiche TMDB fr-FR par identité exacte ; repli Sonarr/Radarr', async () => {
  const asked: string[] = [];
  const source: ArrLabelSource = {
    media: async (tmdbId, mediaType) => {
      asked.push(`${mediaType}:${tmdbId}`);
      if (mediaType === 'tv' && tmdbId === 77) return arrMediaLabel({ name: "L'Arène", original_name: 'The Arena', poster_path: '/arene-fr.jpg', vote_average: 7.26, first_air_date: '2026-09-30' }, 'tv');
      if (mediaType === 'movie' && tmdbId === 1022789) return arrMediaLabel({ title: 'Super Mario Galaxy, le film', poster_path: '/mario-fr.jpg', vote_average: 8.2, release_date: '2026-04-01' }, 'movie');
      if (tmdbId === 404) throw new Error('TMDB indisponible');
      return null;
    },
    episodes: async (tmdbId, season) => tmdbId === 77 && season === 1 ? seasonEpisodeTitles({ episodes: [{ episode_number: 1, name: 'Une Odyssée martiale de malade' }, { episode_number: 2, name: '  ' }] }) : null,
  };
  const lists = await localizeArrLists({
    programmed: { items: [episode(801, 1), episode(802, 2), { kind: 'movie', id: 902, tmdbId: 77, title: 'Arena Movie', posterUrl: 'radarr.jpg' }, episode(803, 1, { tmdbId: undefined, seriesId: 9, seriesTitle: 'Sans TMDB' }), episode(804, 1, { tmdbId: 404, seriesTitle: 'Panne' })], failures: [] },
    imports: { items: [arenaImport, { kind: 'movie', key: 'm40', arrId: 40, tmdbId: 1022789, title: 'The Super Mario Galaxy Movie', posterUrl: 'https://image.tmdb.org/t/p/original/mario-en.jpg', year: 2026, rating: 7, date: 2 }], failures: ['Radarr'], pending: [] },
    undecided: [{ ...arenaImport, key: 's9', arrId: 9, monitored: false }],
  }, source);

  const [first, second, movie, untracked, failing] = lists.programmed.items;
  assert.equal(first.kind === 'episode' && first.seriesTitle, "L'Arène", 'titre de la fiche TMDB fr-FR, pas « The Arena (2026) »');
  assert.equal(first.posterUrl, 'https://image.tmdb.org/t/p/w185/arene-fr.jpg', 'affiche française de la fiche');
  assert.equal(first.kind === 'episode' && first.title, 'Une Odyssée martiale de malade', 'titre français de l’épisode');
  assert.equal(second.kind === 'episode' && second.title, 'Episode 2', 'titre d’épisode vide chez TMDB : celui de Sonarr reste');
  // Identité exacte : `movie:77` n'est pas la série `tv:77`.
  assert.deepEqual([movie.kind === 'movie' && movie.title, movie.posterUrl], ['Arena Movie', 'radarr.jpg'], 'jamais la fiche d’un autre type au même identifiant');
  assert.deepEqual([untracked.kind === 'episode' && untracked.seriesTitle, untracked.posterUrl], ['Sans TMDB', 'https://artworks.thetvdb.com/arena.jpg'], 'sans identifiant TMDB : libellé Sonarr');
  assert.equal(failing.kind === 'episode' && failing.seriesTitle, 'Panne', 'fiche en erreur : repli Sonarr, la synchronisation continue');

  assert.equal(lists.undecided?.[0].title, "L'Arène", 'À décider : même libellé (SEENIT-DOWNLOAD-023)');
  const [arena, mario] = lists.imports.items;
  assert.deepEqual([arena.title, arena.posterUrl, arena.rating, arena.year], ["L'Arène", 'https://image.tmdb.org/t/p/w342/arene-fr.jpg', 7.3, 2026], 'Téléchargés : titre, affiche, note et année de la fiche');
  assert.deepEqual([mario.title, mario.posterUrl], ['Super Mario Galaxy, le film', 'https://image.tmdb.org/t/p/w342/mario-fr.jpg']);
  assert.deepEqual([arena.key, arena.arrId], ['s5', 5], 'identifiants Sonarr inchangés (Retirer, masquage)');
  assert.deepEqual(lists.imports.failures, ['Radarr'], 'panne d’une source toujours signalée');
  assert.deepEqual(asked.sort(), ['movie:1022789', 'movie:77', 'tv:404', 'tv:77'], 'une seule lecture par fiche, aucune sans identifiant TMDB');

  // Fiche trop lente : la synchronisation n'attend pas au-delà du délai, le repli s'affiche.
  const slow: ArrLabelSource = { media: () => new Promise(() => {}), episodes: () => new Promise(() => {}) };
  const started = Date.now();
  const late = await localizeArrLists({ programmed: { items: [episode(801, 1)], failures: [] }, imports: { items: [arenaImport], failures: [], pending: [] } }, slow, 20);
  assert.ok(Date.now() - started < 1000);
  assert.equal(late.programmed.items[0].kind === 'episode' && late.programmed.items[0].seriesTitle, 'The Arena (2026)');
  assert.equal(late.imports.items[0].title, 'The Arena (2026)');

  assert.equal(arrMediaLabel(null, 'tv'), null);
  assert.deepEqual(arrMediaLabel({ name: '', original_name: 'Эпидемия', poster_path: 'relative.jpg', vote_average: 0 }, 'tv'), { title: 'Эпидемия', posterPath: undefined, rating: undefined, year: undefined }, 'même règle de titre que la fiche ; affiche invalide ignorée');

  // La copie synchronisée est la seule à appliquer ces libellés : écrans, menus et toasts en héritent.
  const store = readFileSync('src/store/arrSyncStore.ts', 'utf8');
  assert.match(store, /const labelled = await localizeArrLists\(\{ programmed: coverage\.programmed, imports, undecided: coverage\.undecided \}, tmdbArrLabelSource\);\n\s+if \(arrSyncKey\(\) !== key \|\| id !== sequence\) return;/, 'réponse dépassée pendant la lecture TMDB toujours ignorée');
  assert.doesNotMatch(readFileSync('src/features/downloads/arrMediaLabels.ts', 'utf8'), /\.title\s*===|toLowerCase\(\)/, 'jamais de rapprochement par le titre');
});
