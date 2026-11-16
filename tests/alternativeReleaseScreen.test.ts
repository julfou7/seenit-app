import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { autoProfileSwitchFor, commonRejections, frenchRejection, frenchRejections, profileSwitchFor } from '../src/features/downloads/releaseRejections.ts';

// Retour terrain du 16/11 (« Chercher une autre release », Heart of the Beast) : « cet écran est un peu pourri ;
// permettre le changement de qualité, ne pas afficher 50 fois le même message, le mettre en français ; aucune liste
// déroulante ne fonctionne ; l'interface pourrait être la même que la recherche manuelle ».
test('refus de Sonarr/Radarr traduits, raison commune dite une fois', () => {
  assert.equal(frenchRejection('WEBDL-2160p is not wanted in profile'), 'Qualité WEBDL-2160p hors du profil choisi');
  assert.equal(frenchRejection('Quality for release in queue already meets cutoff: WEBRip-1080p v1'), 'Une version de qualité suffisante est déjà en cours de téléchargement');
  assert.equal(frenchRejection('1.6 GB is smaller than minimum allowed 1.7 GB (for 50min)'), 'Trop petite pour le profil : 1,6 Go, minimum 1,7 Go pour 50 min');
  assert.equal(frenchRejection('Not enough free space'), 'Disque plein : espace de stockage insuffisant');
  assert.doesNotMatch(frenchRejection('Something unexpected happened with the release'), /\bthe\b/, 'jamais de phrase anglaise');
  const cutoff = 'Quality for release in queue already meets cutoff: WEBRip-1080p v1';
  const lists = [frenchRejections(['WEBDL-2160p is not wanted in profile', cutoff]), frenchRejections([cutoff]), frenchRejections([cutoff, cutoff])];
  assert.deepEqual(lists[2], [frenchRejection(cutoff)], 'sans doublon sur une version');
  assert.deepEqual(commonRejections(lists), [frenchRejection(cutoff)], 'commune à toutes : une seule fois');
  assert.deepEqual(commonRejections([lists[0]]), [], 'une seule version : rien de « commun »');
  assert.equal(profileSwitchFor(['WEBDL-2160p is not wanted in profile']), '4k');
  assert.equal(profileSwitchFor(['WEBRip-1080p is not wanted in profile']), '1080p');
  assert.equal(profileSwitchFor([cutoff]), null);
  assert.equal(autoProfileSwitchFor(['WEBDL-2160p is not wanted in profile', cutoff]), '4k', 'qualité + file en cours : un appui suffit');
  assert.equal(autoProfileSwitchFor(['WEBDL-2160p is not wanted in profile', '1.6 GB is smaller than minimum allowed 1.7 GB']), null, 'un autre refus reste bloquant');
  assert.equal(autoProfileSwitchFor([cutoff]), null);
});

// Retour terrain du 16/11 (« le fichier actuel n'est pas assez mis en valeur »).
test('« Autre version » : la version actuelle est résumée en tête et marquée dans la liste', () => {
  const screen = readFileSync('src/components/AlternativeReleaseModal.tsx', 'utf8');
  assert.match(screen, /<section data-current-version aria-label="Version actuelle"/);
  assert.ok(screen.indexOf('data-current-version') < screen.indexOf('visible.map('), 'avant la liste');
  assert.match(screen, /\.sort\(\(a, b\) => Number\(b\.release\.candidate\.current\) - Number\(a\.release\.candidate\.current\)\)/);
  const card = readFileSync('src/components/ReleaseVersionCard.tsx', 'utf8');
  assert.match(card, /\{current && <span[^>]*>Actuelle<\/span>\}/);
});

test('« Autre version » : mêmes pastilles et cartes que « Version précise », plus de listes déroulantes', () => {
  const screen = readFileSync('src/components/AlternativeReleaseModal.tsx', 'utf8');
  const precise = readFileSync('src/screens/mediaDetail/PreciseVersionPage.tsx', 'utf8');
  for (const source of [screen, precise]) assert.match(source, /import \{ ReleaseVersionCard, VersionFilterChips \} from '[./]+components\/ReleaseVersionCard'|import \{ ReleaseVersionCard, VersionFilterChips \} from '\.\/ReleaseVersionCard'/);
  assert.doesNotMatch(screen, /<select/, 'les listes déroulantes ne s’ouvraient pas dans l’APK');
  assert.match(screen, /data-shared-rejections/, 'raison commune en tête');
  assert.match(screen, /const own = release\.reasons\.filter\(reason => !shared\.includes\(reason\)\);/, 'jamais répétée sur chaque carte');
  // Retour terrain du 16/11 (« Passer en 4K ok, mais transparent ») : un seul appui — profil basculé, même version
  // relue auprès de Sonarr/Radarr, puis envoyée ; plus de bouton séparé ni de rechargement de la page.
  assert.match(screen, /await changeProgrammedQuality\(useDownloadConfigStore\.getState\(\), session\.target, switchTo\);[\s\S]*?fresh = await searchManualArrReleases\(session\.scope, [\s\S]*?const again = fresh\.candidates\.find\(candidate => candidate\.key === picked\.key\);[\s\S]*?return send\(fresh, \{ \.\.\.again, current: picked\.current \}/, 'bascule puis envoi de la même version');
  assert.doesNotMatch(screen, /switchQuality|Passer en \{/, 'plus de bouton « Passer en 4K » séparé');
  assert.match(screen, /if \(!again\?\.selectable\) \{[\s\S]*?refuse encore cette version/, 'refus restant après bascule : dit, page conservée');
  assert.match(screen, /disabled=\{\(!candidate\.selectable && !switchTo\) \|\| candidate\.current/);
  assert.match(screen, /notifyArrWrite\(\{ tmdbId: item\.tmdbId, tvdbId: item\.tvdbId, mediaType: item\.mediaType \}\);/, 'revue Codex #1068 : Programmés relit la qualité');
  const service = readFileSync('src/services/arrManualReleases.ts', 'utf8');
  assert.match(service, /target: \{ kind: context\.movieId \? 'movie' as const : 'series' as const, id: targetId \}/);
});

// Retour terrain du 16/11 (« le DL a déjà commencé, je veux une version plus légère ») — revue Codex #1070.
test('remplacer une version : accessible pendant le transfert, annulation vérifiée', () => {
  const card = readFileSync('src/components/DownloadItemCard.tsx', 'utf8');
  assert.match(card, /item\.tmdbId && \(terminal \|\| group === 'active'\) && <button type="button" onClick=\{\(\) => setChoosingRelease\(true\)\}>/);
  const screen = readFileSync('src/components/AlternativeReleaseModal.tsx', 'utf8');
  assert.match(screen, /if \(!\(await useLiveDownloadStore\.getState\(\)\.removeDownload\(download\)\)\) kept\+\+;/);
  assert.match(screen, /kept \? 'error' : 'success'/, 'jamais « remplacée » si l’ancien continue');
  assert.match(screen, /removeDownload\(download\)\)\)\s*kept\+\+;[\s\S]*?if \(!kept\) \{\s+const requestId = beginDownloadRequest\(/, 'le remplaçant est suivi après l’annulation, jamais greffé sur l’ancienne carte');
  assert.match(screen, /candidate\.episodes === 'season'\s*\|\| \(download\.episodeNumber != null && Array\.isArray\(candidate\.episodes\) && candidate\.episodes\.includes\(Number\(download\.episodeNumber\)\)\)/, 'un épisode seul n’annule jamais le pack');
  assert.match(screen, /&& covers\(download\) && !\(candidate\.infoHash && samePhysicalDownload\(download, \{ downloadId: candidate\.infoHash \}\)\)\);/, 'la version choisie n’est jamais annulée');
  assert.match(screen, /if \(replaced\.some\(download => !\/\^\(sonarr\|radarr\|qbit\)_\/\.test\(download\.id\)\)\) \{[\s\S]*?return;/, 'demande pas encore chez le client : pas de remplacement');
  const service = readFileSync('src/services/arrManualReleases.ts', 'utf8');
  assert.match(service, /episodes: release\.fullSeason === true \? 'season' as const/);
  const store = readFileSync('src/store/liveDownloadStoreCore.ts', 'utf8');
  assert.match(store, /if \(cancelledHash && remoteHash && cancelledHash !== remoteHash\) return false;/, 'l’annulation de l’ancien ne masque pas un autre infohash');
});

// Retour terrain du 16/11 (v1.4.325, « Autre version » : une fine barre vide par version) : dans la liste en colonne
// qui défile, une carte de version ne rétrécit jamais — corrige aussi « Version précise » (carte partagée).
test('carte de version jamais écrasée dans une longue liste', () => {
  const card = readFileSync('src/components/ReleaseVersionCard.tsx', 'utf8');
  assert.match(card, /<article data-version-card=\{release\.id\} className=\{cn\('shrink-0 rounded-\[18px\] bg-\[#161619\] overflow-hidden'/);
});
