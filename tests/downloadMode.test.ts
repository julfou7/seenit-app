import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import vm from 'node:vm';

const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
const rows = readFileSync('src/screens/mediaDetail/seriesSections.tsx', 'utf8');
const modal = readFileSync('src/components/DownloadModal.tsx', 'utf8');
const launch = readFileSync('src/features/downloads/downloadLaunch.ts', 'utf8');

async function loadMode() {
  const bundle = await build({ entryPoints: ['src/screens/mediaDetail/downloadMode.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'mode-ports', setup(builder) {
      builder.onResolve({ filter: /^(?:react(?:\/jsx-runtime)?|react-dom|lucide-react)$|\/lib\/utils$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="f";export const Download=()=>null;export const cn=(...a)=>a.filter(Boolean).join(" ");export const createPortal=(n)=>n;export default {};' }));
    } }] });
  const module = { exports: {} as Record<string, unknown> };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, exports: module.exports }));
  return module.exports as { isEpisodeSelectable: (state: string) => boolean; seasonModeStates: (...args: unknown[]) => { episode: number; state: string }[] };
}

test('SEENIT-DOWNLOAD-014 #879 seul un épisode sorti, sans fichier ni téléchargement actif, se coche (un échec se relance)', async () => {
  const { isEpisodeSelectable, seasonModeStates } = await loadMode();
  assert.deepEqual(['available', 'attention', 'present', 'active', 'future', 'seen'].map(isEpisodeSelectable), [true, true, false, false, false, false]);
  const states = seasonModeStates(
    [{ episode_number: 1, air_date: '2026-11-01' }, { episode_number: 2, air_date: '2026-11-02' }, { episode_number: 3, air_date: '2026-11-03' }, { episode_number: 4, air_date: '2026-12-01' }],
    (episode: number) => episode === 1,
    (episode: number, aired: boolean) => ({ kind: !aired ? 'future' : episode === 3 ? 'present' : 'available', label: '', disabled: false }),
    '2026-11-06'
  );
  assert.deepEqual(states.map(entry => entry.state), ['seen', 'available', 'present', 'future']);
});

test('SEENIT-DOWNLOAD-014 #879 hors mode la fiche reste propre ; en mode le contrôle remplace le Vu', () => {
  assert.doesNotMatch(rows, /onDownloadEpisode|onDownloadSeason/, 'plus de commande de téléchargement par ligne ni de saison');
  assert.match(rows, /\{aired && inMode && <EpisodeModeControl /);
  assert.match(rows, /\{aired && !inMode && <SeenItCheckButton /);
  assert.match(rows, /\{downloadMode && !inMode && <EpisodePassiveChip /, 'pastille passive seulement hors mode');
  assert.match(rows, /const activate = \(\) => \{ if \(!inMode\) onOpenEpisode\(episode\); else if \(selectable\) downloadMode!\.onToggle\(episode\.episode_number\); \}/);
  // Un seul point d'entrée visible : le bouton ⬇ de la carte de progression, sous le gate personnel.
  assert.match(view, /\{canUseDownloadMode && show && <DownloadModeToggle active=\{downloadMode\} badge=\{activeDownloads\} onToggle=\{toggleDownloadMode\} \/>\}/);
  assert.match(view, /if \(canUseDownloadMode\) \{ enterDownloadMode\(\); return; \}/, 'le menu ⋮ ouvre le mode pour une série');
});

test('SEENIT-DOWNLOAD-014 #879 le prochain épisode est coché, la saison change vide la sélection, l’onglet ferme le mode', () => {
  assert.match(view, /nextEp && nextEp\.season_number === modeSeason && selectableEpisodes\.includes\(nextEp\.episode_number\) \? \[nextEp\.episode_number\] : \[\]/);
  assert.match(view, /useEffect\(\(\) => \{ setPickedEpisodes\(new Set\(\)\); \}, \[modeSeason\]\);/);
  assert.match(view, /window\.addEventListener\('app-close-modals', close\);/);
  assert.match(view, /\{downloadMode && canUseDownloadMode && <DownloadModeBar /);
  // La barre d'action recouvre réellement la navigation (z-160) : portail hors du contexte z-150 de la fiche.
  const mode = readFileSync('src/screens/mediaDetail/downloadMode.tsx', 'utf8');
  assert.match(mode, /return typeof document === 'undefined' \? bar : createPortal\(bar, document\.body\);/);
  assert.match(mode, /z-\[170\]/);
  // Les états du bandeau sont relus à chaque rendu (la file en direct change sans changer de fonction).
  assert.doesNotMatch(view, /const modeStates = useMemo/);
});

test('SEENIT-DOWNLOAD-014 #879 le lancement garde les gardes de la popup et une seule voie Sonarr', () => {
  const body = view.slice(view.indexOf('const launchPickedEpisodes'), view.indexOf('const openPreciseVersion'));
  assert.match(body, /if \(!isDownloadFeatureEnabled\(config\)\) return;/);
  assert.match(body, /if \(model\.presence\.loading\) \{/);
  assert.match(body, /if \(!\(config\.sonarrUrl && config\.sonarrApiKey\)\)/);
  assert.match(body, /skip: episode => Boolean\(model\.presence\.episodesHasFile\?\.\[`\$\{season\}x\$\{episode\}`\]\)/, 'un fichier présent n’est jamais remplacé');
  assert.match(body, /\|\| Boolean\(model\.hasActiveDownloadInScope\?\.\(\{ mediaType: 'tv', tmdbId: Number\(effectiveTmdbId\), seasonNumber: season, episodeNumber: episode \}\)\)/, 'pas de double lancement');
  assert.match(body, /readConfig: \(\) => useDownloadConfigStore\.getState\(\),/, 'configuration relue avant chaque épisode');
  assert.match(readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8'), /hasActiveDownloadInScope: scope => hasActiveDownloadInScope\(useLiveDownloadStore\.getState\(\)\.downloads, scope\)/, 'même garde que la popup, fournie par le cœur');
  assert.match(body, /await launchArrEpisodeBatch\(\{/);
  assert.doesNotMatch(body, /replaceExisting: true/);
  assert.match(launch, /await launch\(\{ \.\.\.media, config, mediaType: 'tv', season, episode,/);
  // La popup et le mode partagent le même lancement (demande durable, profil, pack de saison).
  assert.match(modal, /await launchArrDownload\(\{/);
  assert.match(launch, /const requestId = beginDownloadRequest\(\{/);
  assert.match(launch, /await downloadEpisodeWithSeasonPackFallback\(\{/);
  assert.match(launch, /resolveEffectiveQualityProfileId\(profiles, qualityPreference\)/);
});

async function loadBatch() {
  const bundle = await build({ entryPoints: ['src/features/downloads/downloadLaunch.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'launch-ports', setup(builder) {
      builder.onResolve({ filter: /\/(?:shows\/tmdb|services\/sonarrRadarr|downloadLifecycle|qualityProfileSelection|episodeSeasonPackFallback|downloadAvailability|lib\/firebase)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const tmdb={};export const fetchQualityProfiles=0,searchAndDownloadInRadarr=0,searchAndDownloadInSonarr=0,acceptDownloadRequest=0,beginDownloadRequest=0,failDownloadRequest=0,updateDownloadRequest=0,resolveEffectiveQualityProfileId=0,downloadEpisodeWithSeasonPackFallback=0,availabilityHint=0;export const auth={currentUser:null};' }));
    } }] });
  const module = { exports: {} as Record<string, unknown> };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, exports: module.exports }));
  return module.exports as { launchArrEpisodeBatch: (batch: Record<string, unknown>) => Promise<{ launched: number; interrupted: boolean }> };
}

test('SEENIT-DOWNLOAD-014 #879 un lot d’épisodes s’arrête dès que le compte, le gate ou le serveur Sonarr change', async () => {
  const { launchArrEpisodeBatch } = await loadBatch();
  const base = { downloadsEnabled: true, isHydrated: true, sonarrUrl: 'http://sonarr', sonarrApiKey: 'k' };
  const run = async (episodes: number[], change: (state: { owner?: string; config: Record<string, unknown> }) => void, skip: (episode: number) => boolean = () => false) => {
    const state: { owner?: string; config: Record<string, unknown> } = { owner: 'uid-a', config: { ...base } };
    const launched: Array<{ season: number; episode: number; mediaType: string; replaceExisting?: boolean; owner?: string }> = [];
    const notices: string[] = [];
    const result = await launchArrEpisodeBatch({ title: 'Série', tmdbId: 1, season: 2, episodes, qualityPreference: '1080p',
      readConfig: () => state.config, readOwner: () => state.owner, skip,
      notify: (episode: number, action: string) => notices.push(`${episode}:${action}`),
      launch: async (input: { season: number; episode: number; mediaType: string; replaceExisting?: boolean; notify: (action: string) => void }) => { launched.push({ season: input.season, episode: input.episode, mediaType: input.mediaType, replaceExisting: input.replaceExisting, owner: state.owner }); input.notify('lancé'); change(state); } });
    return { result: { ...result }, launched, notices };
  };
  // Lot nominal : les épisodes gardés par l'appelant sont sautés, rien n'est remplacé.
  const nominal = await run([1, 2, 3], () => {}, episode => episode === 2);
  assert.deepEqual(nominal.result, { launched: 2, interrupted: false });
  assert.deepEqual(nominal.launched, [{ season: 2, episode: 1, mediaType: 'tv', replaceExisting: undefined, owner: 'uid-a' }, { season: 2, episode: 3, mediaType: 'tv', replaceExisting: undefined, owner: 'uid-a' }]);
  assert.deepEqual(nominal.notices, ['1:lancé', '3:lancé']);
  // Changement de compte, déconnexion, gate coupé ou autre serveur pendant le premier épisode : arrêt net.
  for (const change of [(s: { owner?: string }) => { s.owner = 'uid-b'; }, (s: { owner?: string }) => { s.owner = undefined; }, (s: { config: Record<string, unknown> }) => { s.config = { ...base, downloadsEnabled: false }; }, (s: { config: Record<string, unknown> }) => { s.config = { ...base, sonarrUrl: 'http://autre' }; }]) {
    const stopped = await run([1, 2, 3], change as never);
    assert.deepEqual(stopped.result, { launched: 1, interrupted: true });
    assert.deepEqual(stopped.launched.map(entry => entry.owner), ['uid-a'], 'aucune demande au nom d’un autre compte');
  }
  // Sans compte au départ : rien n'est lancé.
  const anonymous = await launchArrEpisodeBatch({ title: 'Série', season: 1, episodes: [1], qualityPreference: '4k', readConfig: () => base, readOwner: () => undefined, skip: () => false, notify: () => {}, launch: async () => { throw new Error('ne doit pas lancer'); } });
  assert.deepEqual({ ...anonymous }, { launched: 0, interrupted: true });
});
