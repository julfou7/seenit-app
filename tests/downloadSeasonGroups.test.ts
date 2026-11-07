import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupSeasonDownloads } from '../src/features/downloads/downloadSeriesGroups.ts';

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
  assert.match(screen, /groupSeasonDownloads\(items\)\.map\(entry => \{/);
  assert.match(screen, /<SeasonDownloadCard key=\{entry\.key\} seasonNumber=\{entry\.seasonNumber\} items=\{entry\.items\} onShowClick=\{onShowClick\} onRemove=\{handleRemove\} \/>/, 'même confirmation que les cartes');
  assert.doesNotMatch(card, /SwipeableCard|onSwipe/, 'aucun geste qui annulerait toute la saison');
  assert.match(card, /aria-label=\{kind === 'done' \|\| kind === 'attention' \? `Retirer \$\{code\} de la liste` : `Annuler le téléchargement de \$\{code\}`\}/);
});
