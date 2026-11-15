import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hideQueuedProgrammed, orderByRecentlyAdded } from '../src/features/downloads/programmedQueue.ts';
import type { ProgrammedItem } from '../src/features/downloads/programmedCalendar.ts';
import type { LiveDownloadItem } from '../src/services/sonarrRadarrLive.ts';

const movie = (tmdbId: number) => ({ kind: 'movie', id: tmdbId * 10, tmdbId }) as unknown as ProgrammedItem;
const episode = (tmdbId: number, season: number, ep: number) => ({ kind: 'episode', id: tmdbId * 100 + ep, tmdbId, season, episode: ep }) as unknown as ProgrammedItem;
const queued = (fields: Partial<LiveDownloadItem>) => fields as LiveDownloadItem;

// Retour terrain du 15/11 : « Angel and the Badman » en cours (6 %) restait aussi dans « Programmés ».
test('un élément déjà en file n’est pas répété dans Programmés, par périmètre exact', () => {
  const items = [movie(1001), movie(1002), episode(2001, 1, 3), episode(2001, 1, 4)];
  const visible = hideQueuedProgrammed(items, [
    queued({ tmdbId: 1001, mediaType: 'movie' }),
    queued({ tmdbId: 2001, mediaType: 'tv', seasonNumber: 1, episodeNumber: 3 }),
  ]);
  assert.deepEqual(visible.map(item => item.id), [10020, 200104], 'film et épisode en file masqués, les autres restent');
  // Jamais un rapprochement approximatif : autre type, autre épisode, ou identifiant absent.
  assert.equal(hideQueuedProgrammed([movie(1001)], [queued({ tmdbId: 1001, mediaType: 'tv' })]).length, 1);
  assert.equal(hideQueuedProgrammed([episode(2001, 1, 4)], [queued({ tmdbId: 2001, mediaType: 'tv', seasonNumber: 1 })]).length, 1, 'pack de saison sans épisode exact : rien masqué');
  assert.equal(hideQueuedProgrammed([movie(1001)], [queued({ mediaType: 'movie' })]).length, 1);
});

test('l’onglet Télécharger passe la file (en cours et en recherche) à Programmés', () => {
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(screen, /const queuedDownloads = useMemo\(\(\) => \[\.\.\.activeDownloads, \.\.\.waitingDownloads\]/);
  assert.match(screen, /<ProgrammedSection [^>]*queued=\{queuedDownloads\}/);
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /hideQueuedProgrammed\(hideSeenWanted\(/);
});

// Retour terrain du 15/11 : « La Guerre des mondes », ajouté en dernier, apparaissait au milieu de « Programmés ».
test('Programmés trié par date d’ajout, le plus récent en premier, dates inconnues en fin', () => {
  const ordered = orderByRecentlyAdded([
    { key: 'chat', addedAt: Date.parse('2026-11-01') },
    { key: 'inconnu-1' },
    { key: 'guerre', addedAt: Date.parse('2026-11-15T09:44:00Z') },
    { key: 'potter', addedAt: Date.parse('2026-10-20') },
    { key: 'inconnu-2' },
  ]);
  assert.deepEqual(ordered.map(card => card.key), ['guerre', 'chat', 'potter', 'inconnu-1', 'inconnu-2']);
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /\{orderByRecentlyAdded\(cards\)\.map\(card => compact/);
  assert.match(section, /addedAt: Number\(entry\.addedAt\) \|\| undefined/, 'demande SeenIt : date de la demande');
  const calendar = readFileSync('src/features/downloads/programmedCalendar.ts', 'utf8');
  assert.match(calendar, /\.\.\.addedAt\(entry\.series\?\.added\)/, 'série Sonarr');
  assert.match(calendar, /\.\.\.addedAt\(movie\.added\)/, 'film Radarr');
});
