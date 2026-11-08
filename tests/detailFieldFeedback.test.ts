import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { pickHeroProvider } from '../src/features/providers/heroProvider.ts';
import { downloadGroup, isPreTransferRequest, isWatchedWaitingRequest } from '../src/features/downloads/downloadGroups.ts';
import { availabilityHint, noReleaseToastAction } from '../src/features/downloads/downloadAvailability.ts';

// Retours terrain du 08/11 (v1.4.273) sur la fiche série (The Killing), la fiche film (Le Chat Chapeauté)
// et l'onglet Télécharger.
const read = (path: string) => readFileSync(path, 'utf8');
const NETFLIX = { provider_id: 8, provider_name: 'Netflix' };
const DISNEY = { provider_id: 337, provider_name: 'Disney Plus' };
const PLEX = { provider_id: -1, provider_name: 'Plex', isPlex: true };

test('SEENIT-PROVIDER-003 un seul diffuseur près du bouton principal : celui des réglages, sinon Plex, jamais un public non choisi', () => {
  assert.equal(pickHeroProvider([DISNEY, PLEX], [337]), DISNEY, 'Disney+ choisi dans les réglages passe avant Plex');
  assert.equal(pickHeroProvider([PLEX, DISNEY, NETFLIX], [8]), NETFLIX, 'l’ordre de la liste ne fait pas gagner Plex');
  assert.equal(pickHeroProvider([DISNEY, PLEX], []), PLEX, 'aucune plateforme choisie disponible : Plex');
  assert.equal(pickHeroProvider([DISNEY, NETFLIX], [2]), undefined, 'ni plateforme choisie ni Plex : aucune tuile');
  const view = read('src/screens/ShowDetailView.tsx');
  assert.equal((view.match(/\{heroProvider && providerTile\(heroProvider\)\}/g) || []).length, 2, 'série et film');
  assert.doesNotMatch(view, /mainProvider|plexProvider/, 'plus de seconde tuile');
});

test('SEENIT-DOWNLOAD-015 une demande apparaît tout de suite dans « En attente », puis passe dans « Programmés » si aucune version n’est sortie', () => {
  assert.equal(isPreTransferRequest({ status: 'searching', progress: 0 }), true);
  assert.equal(isPreTransferRequest({ status: 'submitting', progress: 0 }), true);
  assert.equal(isPreTransferRequest({ status: 'searching', progress: 12 }), false, 'un transfert commencé est « En cours »');
  assert.equal(isPreTransferRequest({ status: 'downloading', progress: 0 }), false);
  // Retour terrain du 08/11 : sans version et surveillé = programmé ; surveillance non confirmée = à régler.
  assert.equal(isWatchedWaitingRequest({ status: 'waiting', progress: 0, availability: { reason: 'no_release', automatic: true } }), true);
  assert.equal(isWatchedWaitingRequest({ status: 'waiting', progress: 0, availability: { reason: 'no_release', automatic: false } }), false);
  assert.equal(isWatchedWaitingRequest({ status: 'waiting', progress: 0, availability: { reason: 'unconfirmed', automatic: false } }), false);
  assert.equal(isWatchedWaitingRequest({ status: 'warning', progress: 0, errorMessage: 'x', availability: { reason: 'no_release', automatic: true } }), false, 'une erreur reste une erreur');
  assert.equal(downloadGroup({ status: 'waiting', progress: 0 }), 'waiting');
  const screen = read('src/screens/DownloadsScreenCore.tsx');
  assert.match(screen, /downloadGroup\(item\) === 'active' && !isPreTransferRequest\(item\)/);
  assert.match(screen, /downloadGroup\(item\) === 'attention' \|\| \(downloadGroup\(item\) === 'waiting' && !isWatchedWaitingRequest\(item\)\)/);
  assert.match(screen, /const waitingDownloads = useMemo\(\(\) => sortDownloadsByAddedAt\(downloads\.filter\(item => downloadGroup\(item\) === 'active' && isPreTransferRequest\(item\)\), 'asc'\), \[downloads\]\);/);
  assert.match(screen, /<ProgrammedSection refreshKey=\{programmedRefresh\} onShowClick=\{onShowClick\} watching=\{watchedRequests\} onRemoveWatching=\{handleRemove\} \/>/);
  // Revue de #907 : annuler une attente surveillée recharge Programmés (l'entrée du calendrier masquée ne revient pas).
  assert.match(screen, /const transitions = `\$\{activeDownloads\.length\}:\$\{completedDownloads\.length\}:\$\{errorDownloads\.length\}:\$\{watchedRequests\.map\(item => item\.id\)\.join\(','\)\}`;/);
  assert.match(screen, /if \(lastTransitions\.current === transitions\) return;[\s\S]{0,80}setProgrammedRefresh\(key => key \+ 1\);/);
  const programmed = read('src/components/ProgrammedSection.tsx');
  assert.match(programmed, /data-programmed-request=\{entry\.id\}/);
  // Refonte du 08/11 puis v1.4.281 : une pastille de date (sortie numérique, cinéma…) au lieu de la phrase bleue.
  assert.match(programmed, /const pill = item \? releasePill\(item\.date, item\.kind === 'movie' \? item\.dateKind : 'air'\) : isTv \? 'Pas encore de version' : watchedMoviePill\(/);
  assert.match(programmed, /Number\(item\.tmdbId\) === Number\(request\.tmdbId\)/, 'doublon calendrier reconnu par TMDB exact, jamais le titre');
  const card = read('src/components/DownloadItemCard.tsx');
  assert.match(card, /waiting \? \(item\.availability\?\.reason === 'no_release' \? 'Pas encore disponible · surveillance non confirmée' : 'Recherche à vérifier'\)/);
  assert.match(card, /\$\{toFix \? ' download-card--attention' : ''\}/);
  for (const availability of [{ reason: 'no_release', automatic: true }, { reason: 'no_release', automatic: false }, undefined] as const) {
    assert.ok(noReleaseToastAction(availability).length <= 36, noReleaseToastAction(availability));
  }
  assert.equal(availabilityHint({ reason: 'no_release', automatic: true }), 'Surveillé : il partira seul dès qu’une version compatible sortira.');
});

// Vrai lancement partagé (popup, fiche film, épisodes, « Ajouter E6 ») : seuls ses services sont simulés.
async function loadLaunch(outcome: () => Promise<Record<string, unknown>>) {
  const key = `__launchToast${Math.random().toString(36).slice(2)}`;
  (globalThis as Record<string, unknown>)[key] = { outcome, failed: [] as unknown[] };
  const launchBundle = await build({ entryPoints: ['src/features/downloads/downloadLaunch.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'launch-ports', setup(builder) {
      builder.onResolve({ filter: /\/(?:shows\/tmdb|services\/sonarrRadarr|downloadLifecycle|qualityProfileSelection|episodeSeasonPackFallback|lib\/firebase)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `const s=globalThis.${key};export const tmdb={};export const fetchQualityProfiles=async()=>[];export const resolveEffectiveQualityProfileId=()=>1;
        export const searchAndDownloadInRadarr=()=>s.outcome();export const searchAndDownloadInSonarr=()=>s.outcome();export const downloadEpisodeWithSeasonPackFallback=()=>s.outcome();
        export const beginDownloadRequest=()=>'request';export const acceptDownloadRequest=()=>{};export const updateDownloadRequest=()=>{};export const failDownloadRequest=(...args)=>{s.failed.push(args)};export const auth={currentUser:{uid:'owner'}};` }));
    } }] });
  const module = await import(`data:text/javascript;base64,${Buffer.from(launchBundle.outputFiles[0].text).toString('base64')}`) as { launchArrDownload: (input: Record<string, unknown>) => Promise<unknown> };
  return { launch: module.launchArrDownload, state: (globalThis as Record<string, unknown>)[key] as { failed: unknown[][] } };
}

test('SEENIT-DOWNLOAD-015 un seul toast au lancement ; le résultat (trouvé, pas de version, panne) va dans l’onglet, sans toast', async () => {
  const outcomes: Array<[string, () => Promise<Record<string, unknown>>]> = [
    ['trouvé', async () => ({ success: true, message: 'ok', status: 'queued', fallbackUsed: true })],
    ['pas de version', async () => ({ success: false, message: 'Aucune release', failureCode: 'no_release', availability: { reason: 'no_release', automatic: true } })],
    ['refus', async () => ({ success: false, message: 'Radarr refuse' })],
    ['panne', async () => { throw new Error('Radarr injoignable'); }]
  ];
  for (const [label, outcome] of outcomes) {
    const { launch, state } = await loadLaunch(outcome);
    const toasts: string[] = [];
    await launch({ config: { radarr1080pProfileId: 1 }, mediaType: 'movie', title: 'Le Chat Chapeauté', tmdbId: 11, qualityPreference: '1080p', notify: (action: string) => toasts.push(action) });
    assert.deepEqual(toasts, ['Téléchargement lancé · 1080p'], label);
    assert.equal(state.failed.length, label === 'trouvé' ? 0 : 1, `${label} : l’issue est inscrite dans la demande, visible dans Télécharger`);
  }
  assert.doesNotMatch(read('src/store/liveDownloadStoreCore.ts'), /showToast|sendLocalNotification/, 'plus de toast à la fin d’un transfert');
  const view = read('src/screens/ShowDetailView.tsx');
  assert.doesNotMatch(view, /Vérification de la disponibilité…', posterPath/, 'l’attente de la présence est silencieuse');
  assert.match(view, /if \(!single && !toProgram\.size\) useToastStore/, 'lot mixte : le résumé de programmation est l’unique toast');
});

// Vrai store de présence : seules ses dépendances réseau et Firebase sont simulées.
const bundle = await build({ entryPoints: ['src/store/mediaPresenceStore.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'presence-ports', setup(builder) {
    builder.onResolve({ filter: /downloadConfigStore$|services\/sonarrRadarr$|plexAvailability$|downloadFeatureVisibility$|episodePresenceKey$|^firebase\/auth$|lib\/firebase$/ }, args => ({ path: args.path, namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path.endsWith('downloadConfigStore') ? 'export const useDownloadConfigStore={getState:()=>({}),subscribe:()=>()=>{}};'
      : args.path.endsWith('sonarrRadarr') ? 'export const executeGet=async()=>[];export const cleanUrl=u=>u;'
        : args.path.endsWith('plexAvailability') ? 'export const checkPlexAvailability=async()=>({available:false});'
          : args.path.endsWith('downloadFeatureVisibility') ? 'export const isDownloadFeatureEnabled=()=>false;'
            : args.path.endsWith('episodePresenceKey') ? 'export const episodePresenceKey=(s,e)=>s+"x"+e;'
              : args.path === 'firebase/auth' ? 'export const onAuthStateChanged=()=>()=>{};' : 'export const auth={currentUser:null};' }));
  } }] });
const presenceStore = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  useMediaPresenceStore: { setState: (state: Record<string, unknown>) => void };
  waitForSettledPresence: (tmdbId: number, mediaType: 'movie' | 'tv', timeoutMs?: number) => Promise<Record<string, unknown> | null>;
};
const entry = (loading: boolean, extra: Record<string, unknown> = {}) => ({ loading, hasFile: false, seasonsHasFile: {}, episodesHasFile: {}, lastChecked: 1, ...extra });

test('SEENIT-DOWNLOAD-015 un lancement pendant la vérification de présence l’attend au lieu d’être refusé', async () => {
  const { useMediaPresenceStore, waitForSettledPresence } = presenceStore;
  useMediaPresenceStore.setState({ presenceCache: { 'signed-out|downloads-hidden|movie:42': entry(true) } });
  const pending = waitForSettledPresence(42, 'movie', 2_000);
  useMediaPresenceStore.setState({ presenceCache: { 'signed-out|downloads-hidden|movie:42': entry(false, { radarrHasFile: true }) } });
  assert.equal((await pending)?.radarrHasFile, true, 'la présence vérifiée arrive au lancement : un film présent n’est pas relancé');
  assert.equal((await waitForSettledPresence(42, 'movie', 10))?.loading, false, 'présence déjà connue : aucune attente');
  useMediaPresenceStore.setState({ presenceCache: { 'signed-out|downloads-hidden|tv:7': entry(true) } });
  assert.equal(await waitForSettledPresence(7, 'tv', 20), null, 'personne ne répond : rien n’est lancé');

  const view = read('src/screens/ShowDetailView.tsx');
  assert.doesNotMatch(view, /réessaie dans un instant|if \(model\.presence\.loading\) \{ showToast/, 'plus de refus pendant la vérification');
  assert.match(view, /const presence = await settledPresence\('movie'\);\n\s+if \(!presence\) return;\n[^\n]*\n\s+if \(presence\.radarrHasFile \|\| presence\.plexInfo\?\.available\)/);
  assert.match(view, /exitDownloadMode\(\);\n\s+const presence = await settledPresence\('tv'\);\n\s+if \(!presence\) return;/, 'la barre se ferme avant l’attente : pas de double lancement');
  assert.match(view, /skip: episode => Boolean\(presence\.episodesHasFile\?\.\[episodePresenceKey\(season, episode\)\]\)/, 'un épisode présent n’est jamais relancé, d’après la présence vérifiée');
});

test('Fiche série (08/11) : pastilles de saison avec l’anneau Vu, lignes d’épisode numérotées sans note, icône Télécharger agrandie', () => {
  const rows = read('src/screens/mediaDetail/seriesSections.tsx');
  assert.doesNotMatch(rows, /✓ vue/, 'plus de « ✓ vue » en texte');
  assert.match(rows, /\{complete \? <SeenItRing size=\{17\}/);
  assert.match(rows, /on \? 'bg-\[#1E1A12\] shadow-\[inset_0_0_0_1\.5px_#E5A93D\]'/, 'saison choisie cerclée d’or, sans aplat');
  assert.doesNotMatch(rows, /SeenItWatchedStamp|rounded-tr-md bg-black\/80/, 'image d’épisode libre : ni tampon, ni « E2 »');
  assert.doesNotMatch(rows, /★ \{formatRating\(Number\(episode\.vote_average\)\)\}/, 'la note est déjà dans les barres de la saison');
  assert.match(rows, /const episodeCode = `E\$\{String\(episode\.episode_number\)\.padStart\(2, '0'\)\}`;/);
  assert.match(rows, /<b data-episode-code className=\{cn\('font-extrabold', watched \? 'text-zinc-500' : aired \? 'text-\[#F2C36B\]' : 'text-sky-300'\)\}>\{episodeCode\}<\/b>/);
  assert.match(read('src/screens/mediaDetail/downloadMode.tsx'), /<DownloadMark size=\{34\} strokeWidth=\{1\.9\} \/>/);
  assert.match(read('src/screens/mediaDetail/movieDownloadMode.tsx'), /: <DownloadMark size=\{34\} strokeWidth=\{1\.9\} \/>\}/);
});
