import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waitingRetryLaunch } from '../src/features/downloads/waitingRetry.ts';

const base = { id: 'w1', size: 0, sizeleft: 0, progress: 0, statusText: 'En attente de disponibilité' };

// #664 — retour du 15/11 : « un bouton retry pour forcer la nouvelle tentative si possible ».
test('#664 Relancer la recherche d’une attente : même identité TMDB, même périmètre, même qualité', () => {
  assert.deepEqual(waitingRetryLaunch({ ...base, status: 'waiting', mediaType: 'tv', title: 'Dexter : Résurrection (S02E01)', seriesTitle: 'Dexter : Résurrection', tmdbId: 259909, tvdbId: 4, seasonNumber: 2, episodeNumber: 1, quality: '4K', posterPath: '/p.jpg' }),
    { mediaType: 'tv', title: 'Dexter : Résurrection', tmdbId: 259909, tvdbId: 4, imdbId: undefined, posterPath: '/p.jpg', season: 2, episode: 1, qualityPreference: '4k' });
  const movie = waitingRetryLaunch({ ...base, status: 'waiting', mediaType: 'movie', title: 'La Guerre des mondes', movieTitle: 'La Guerre des mondes', tmdbId: 755898, quality: '1080p' });
  assert.deepEqual([movie?.title, movie?.season, movie?.episode, movie?.qualityPreference], ['La Guerre des mondes', undefined, undefined, '1080p']);
  // Sans identité TMDB ou hors attente : rien n'est relancé, jamais de recherche par titre.
  assert.equal(waitingRetryLaunch({ ...base, status: 'waiting', mediaType: 'movie', title: 'Sans identité' }), null);
  assert.equal(waitingRetryLaunch({ ...base, status: 'downloading', mediaType: 'movie', title: 'En cours', tmdbId: 1 }), null);

  // Câblage réel : menu ⋯ de la carte en attente → lancement de la fiche (qui remplace l'attente du même périmètre).
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /\{onRetry && <button type="button" disabled=\{busy !== null\} onClick=\{onRetry\}><RotateCw size=\{15\} aria-hidden="true" \/>Relancer la recherche<\/button>\}/);
  assert.match(section, /onRetryWatching \? \(\) => \{ setMenu\(null\); onRetryWatching\(entry\); \} : undefined/);
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(screen, /const launch = waitingRetryLaunch\(item\);[\s\S]*?await launchArrDownload\(\{ \.\.\.launch, config: useDownloadConfigStore\.getState\(\)/);
  assert.match(screen, /onRetryWatching=\{item => void handleRetryWaiting\(item\)\}/);
});
