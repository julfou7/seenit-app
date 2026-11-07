import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupSeasonDownloads, nextEpisodeToAdd } from '../src/features/downloads/downloadSeriesGroups.ts';

type Item = Parameters<typeof groupSeasonDownloads>[0][number];
const item = (id: string, extra: Partial<Item>): Item => ({ id, title: 'Série', mediaType: 'tv', size: 1, sizeleft: 0, progress: 0, status: 'downloading', statusText: '', ...extra });

test('SEENIT-DOWNLOAD-013 #879 onglet Télécharger : une carte par saison, regroupée par identité exacte', () => {
  const entries = groupSeasonDownloads([
    item('a', { tmdbId: 77, seasonNumber: 1, episodeNumber: 5 }),
    item('m', { mediaType: 'movie', tmdbId: 5 }),
    item('b', { tmdbId: 77, seasonNumber: 1, episodeNumber: 4 }),
    // Même titre, autre série : jamais fusionnée par le nom.
    item('c', { tmdbId: 99, seasonNumber: 1, episodeNumber: 4 }),
    // Autre saison de la même série : sa propre carte.
    item('d', { tmdbId: 77, seasonNumber: 2, episodeNumber: 1 }),
    // TVDB exact à défaut de TMDB.
    item('e', { tvdbId: 400, seasonNumber: 3, episodeNumber: 2 }),
    item('f', { tvdbId: 400, seasonNumber: 3, episodeNumber: 1 }),
    // Sans identité exacte ni épisode : jamais regroupé.
    item('g', { seasonNumber: 1, episodeNumber: 1 }),
    item('h', { seasonNumber: 1, episodeNumber: 2 }),
    item('i', { tmdbId: 77, seasonNumber: 1 })
  ]);
  assert.deepEqual(entries.map(entry => entry.kind === 'season' ? `${entry.key}=${entry.items.map(member => member.id).join('+')}` : entry.item.id),
    ['tmdb:77:s1=b+a', 'm', 'c', 'd', 'tvdb:400:s3=f+e', 'g', 'h', 'i']);
});

test('SEENIT-DOWNLOAD-013 #879 la carte de saison annule épisode par épisode, avec confirmation', () => {
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  const card = readFileSync('src/components/SeasonDownloadCard.tsx', 'utf8');
  // Seule « En cours » est groupée : À régler (échec + attente), Terminés et Annulés gardent leurs cartes complètes.
  assert.match(screen, /\(groupSeasons \? groupSeasonDownloads\(items\) : items\.map\(item => \(\{ kind: 'single' as const, item \}\)\)\)\.map\(entry => \{/);
  assert.match(screen, /renderSection\('En cours', activeDownloads, undefined, true\)/);
  assert.equal((screen.match(/renderSection\('[^']+', \w+(?:, '\w+')?\)/g) || []).length, 3, 'les trois autres sections restent en cartes complètes');
  assert.match(screen, /<SeasonDownloadCard key=\{entry\.key\} seasonNumber=\{entry\.seasonNumber\} items=\{entry\.items\} onShowClick=\{onShowClick\} onRemove=\{handleRemove\} \/>/, 'même confirmation que les cartes');
  assert.doesNotMatch(card, /SwipeableCard|onSwipe/, 'aucun geste qui annulerait toute la saison');
  assert.match(card, /aria-label=\{kind === 'done' \|\| kind === 'attention' \? `Retirer \$\{code\} de la liste` : `Annuler le téléchargement de \$\{code\}`\}/);
});

test('SEENIT-DOWNLOAD-013 #879 « Ajouter E6 » : premier épisode sorti, ni vu, ni présent, ni déjà suivi', () => {
  const season = [7, 3, 6, 5, 4, 8, 1, 2].map(episode_number => ({ episode_number, name: `É${episode_number}`, air_date: episode_number <= 7 ? `2026-11-0${episode_number}` : '2026-12-01' }));
  const options = { today: '2026-11-07', seen: (episode: number) => episode <= 2, hasFile: (episode: number) => episode === 3, tracked: new Set([4, 5]) };
  assert.deepEqual(nextEpisodeToAdd(season, options), { episode: 6, name: 'É6' });
  // Tout est vu, présent, suivi ou à venir : rien n'est proposé (un épisode à venir se programme depuis la fiche).
  assert.equal(nextEpisodeToAdd(season, { ...options, tracked: new Set([4, 5, 6, 7]) }), null);
  assert.equal(nextEpisodeToAdd([{ episode_number: 9 }], options), null, 'sans date de diffusion : jamais proposé');
  const card = readFileSync('src/components/SeasonDownloadCard.tsx', 'utf8');
  const add = readFileSync('src/features/downloads/addNextEpisode.ts', 'utf8');
  // Même voie que le mode : lot attaché au compte et au serveur, fichier présent ou demande active jamais relancés.
  assert.match(add, /await launchArrEpisodeBatch\(\{/);
  assert.match(add, /hasActiveDownloadInScope\(useLiveDownloadStore\.getState\(\)\.downloads,/);
  assert.match(card, /const target = Number\(first\.tmdbId\) > 0 \?/, 'TMDB exact requis');
  // Présence résolue requise, recalculée à chaque mise à jour (deux cartes d'une même série, cache froid).
  assert.match(add, /const presence = useMediaPresenceStore\(state => target \? state\.getPresence\(target\.tmdbId, 'tv'\) : undefined\);/);
  assert.match(add, /if \(!target \|\| !episodes \|\| !presence \|\| presence\.loading\) return null;/);
  // Progression lue sur la série : un film peut porter le même identifiant numérique TMDB.
  assert.match(add, /shows\.find\(entry => entry\.mediaType === 'tv' && Number\(entry\.tmdbId\) === target\.tmdbId\)/);
  assert.match(card, /<button type="button" onClick=\{\(\) => setPicking\(false\)\}>Plus tard<\/button>/);
});
