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
  // Revue Codex #1051 : attente créée depuis la fiche, qualité gardée seulement dans le titre de release.
  assert.equal(waitingRetryLaunch({ ...base, status: 'waiting', mediaType: 'movie', title: 'Film', movieTitle: 'Film', tmdbId: 7, releaseTitle: 'Film • 4K' })?.qualityPreference, '4k');
  assert.equal(waitingRetryLaunch({ ...base, status: 'waiting', mediaType: 'movie', title: 'Film', movieTitle: 'Film', tmdbId: 7 }), null, 'qualité inconnue : jamais devinée');
  // Retour terrain du 15/11 (v1.4.316, « je suis bloqué ») : une demande « À régler » sans transfert se relance ;
  // un vrai transfert en échec non (« Choisir une version »).
  const failed = { ...base, status: 'error', mediaType: 'movie' as const, title: 'La Guerre des mondes', movieTitle: 'La Guerre des mondes', tmdbId: 755898, errorMessage: 'Recherche impossible : timeout', releaseTitle: 'La Guerre des mondes • 1080p', importState: 'pending' as const };
  // Revue Codex #1057 : importState: 'pending' vient du lancement lui-même, pas d'un transfert.
  assert.equal(waitingRetryLaunch(failed)?.qualityPreference, '1080p');
  assert.equal(waitingRetryLaunch({ ...failed, downloadId: 'abc' }), null);
  const card = readFileSync('src/components/DownloadItemCard.tsx', 'utf8');
  assert.match(card, /\{toFix && onRetry && <button type="button" className="download-card__retry" onClick=\{onRetry\}><RotateCw size=\{15\} aria-hidden="true" \/>Relancer la recherche<\/button>\}/);
  assert.equal(waitingRetryLaunch({ ...failed, status: 'warning', progress: 100 }), null, 'import manuel requis : le fichier est arrivé, pas de relance');
  const core = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(core, /onRetry=\{waitingRetryLaunch\(item\) \? \(\) => void handleRetryFailed\(item\) : undefined\}/);
  assert.match(core, /if \(item\.status !== 'waiting' && !\(await removeDownload\(item\)\)\)/, 'la carte en échec est retirée avant la relance');
  // Sans identité TMDB ou hors attente : rien n'est relancé, jamais de recherche par titre.
  assert.equal(waitingRetryLaunch({ ...base, status: 'waiting', mediaType: 'movie', title: 'Sans identité', quality: '4K' }), null);
  assert.equal(waitingRetryLaunch({ ...base, status: 'downloading', mediaType: 'movie', title: 'En cours', tmdbId: 1, quality: '4K' }), null);

  // Câblage réel : menu ⋯ de la carte en attente → lancement de la fiche (qui remplace l'attente du même périmètre).
  const section = readFileSync('src/components/ProgrammedSection.tsx', 'utf8');
  assert.match(section, /\{onRetry && <button type="button" disabled=\{busy !== null\} onClick=\{onRetry\}><RotateCw size=\{15\} aria-hidden="true" \/>Relancer la recherche<\/button>\}/);
  assert.match(section, /const retryEntry = quality \? \{ \.\.\.entry, quality \} : entry;[\s\S]*?onRetryWatching && waitingRetryLaunch\(retryEntry\) \? \(\) => \{ setMenu\(null\); onRetryWatching\(retryEntry\); \} : undefined/);
  const screen = readFileSync('src/screens/DownloadsScreenCore.tsx', 'utf8');
  assert.match(screen, /const launch = waitingRetryLaunch\(item\);[\s\S]*?await launchArrDownload\(\{ \.\.\.launch, config: useDownloadConfigStore\.getState\(\)/);
  assert.match(screen, /onRetryWatching=\{item => void handleRetryWaiting\(item\)\}/);
});
