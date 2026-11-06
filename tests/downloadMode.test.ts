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
      builder.onResolve({ filter: /^(?:react(?:\/jsx-runtime)?|lucide-react)$|\/lib\/utils$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="f";export const Download=()=>null;export const cn=(...a)=>a.filter(Boolean).join(" ");export default {};' }));
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
});

test('SEENIT-DOWNLOAD-014 #879 le lancement garde les gardes de la popup et une seule voie Sonarr', () => {
  const body = view.slice(view.indexOf('const launchPickedEpisodes'), view.indexOf('const openPreciseVersion'));
  assert.match(body, /if \(!isDownloadFeatureEnabled\(config\)\) return;/);
  assert.match(body, /if \(model\.presence\.loading\) \{/);
  assert.match(body, /if \(!\(config\.sonarrUrl && config\.sonarrApiKey\)\)/);
  assert.match(body, /if \(model\.presence\.episodesHasFile\?\.\[`\$\{modeSeason\}x\$\{episode\}`\]\) continue;/, 'un fichier présent n’est jamais remplacé');
  assert.match(body, /if \(model\.hasActiveDownloadInScope\?\.\(\{ mediaType: 'tv', tmdbId: Number\(effectiveTmdbId\), seasonNumber: modeSeason, episodeNumber: episode \}\)\) continue;/, 'pas de double lancement');
  assert.match(readFileSync('src/screens/ShowDetailScreenCore.tsx', 'utf8'), /hasActiveDownloadInScope: scope => hasActiveDownloadInScope\(useLiveDownloadStore\.getState\(\)\.downloads, scope\)/, 'même garde que la popup, fournie par le cœur');
  assert.match(body, /await launchArrDownload\(\{/);
  assert.doesNotMatch(body, /replaceExisting: true/);
  // La popup et le mode partagent le même lancement (demande durable, profil, pack de saison).
  assert.match(modal, /await launchArrDownload\(\{/);
  assert.match(launch, /const requestId = beginDownloadRequest\(\{/);
  assert.match(launch, /await downloadEpisodeWithSeasonPackFallback\(\{/);
  assert.match(launch, /resolveEffectiveQualityProfileId\(profiles, qualityPreference\)/);
});
