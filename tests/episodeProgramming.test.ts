import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { episodeDownloadPresentation } from '../src/features/downloads/episodeDownloadPresentation.ts';

// Vrai module de programmation : seuls les transports Sonarr, Firebase et le gate sont remplacés.
const bundle = await build({ entryPoints: ['src/features/downloads/episodeProgramming.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'programming-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:sonarrRadarr|sonarrRadarrTransport|firebase|qualityProfileSelection|downloadFeatureVisibility)$/ }, args => ({ path: args.path.split('/').at(-1) || '', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'sonarrRadarr'
      ? 'export const cleanUrl=u=>String(u).replace(/\\/+$/,"");export const executeGet=async()=>{throw new Error("réseau réel interdit")};export const fetchQualityProfiles=async()=>[];export const searchAndDownloadInSonarr=async()=>{throw new Error("réseau réel interdit")};'
      : args.path === 'sonarrRadarrTransport' ? 'export const executePut=async()=>{throw new Error("réseau réel interdit")};'
      : args.path === 'firebase' ? 'export const auth={currentUser:null};'
      : args.path === 'qualityProfileSelection' ? 'export const resolveEffectiveQualityProfileId=(profiles,q)=>profiles.find(p=>p.name===(q==="4k"?"Ultra-HD":"HD-1080p"))?.id;'
      : 'export const isDownloadFeatureEnabled=c=>c.downloadsEnabled===true;' }));
  } }] });
type Result = { programmed: number[]; unannounced: number[]; failed: number[]; failure?: string; interrupted: boolean };
const { programArrEpisodes, programmingSummary } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  programArrEpisodes: (request: Record<string, unknown>) => Promise<Result>;
  programmingSummary: (now: number, programmed: number, quality: string) => string;
};

const config = { downloadsEnabled: true, sonarrUrl: 'http://sonarr/', sonarrApiKey: 'k' };
function fakeSonarr(episodeLists: unknown[][], series: Record<string, unknown> = { id: 7, qualityProfileId: 3, monitored: true }) {
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const ensure: Record<string, unknown>[] = [];
  let listCall = 0;
  const io = {
    get: async (url: string) => {
      calls.push({ method: 'GET', url });
      if (url.endsWith('/api/v3/series/7')) return series;
      if (url.includes('/api/v3/episode?seriesId=7')) return episodeLists[Math.min(listCall++, episodeLists.length - 1)];
      throw new Error(`GET inattendu ${url}`);
    },
    put: async (url: string, body: Record<string, unknown>) => { calls.push({ method: 'PUT', url, body }); return body; },
    profiles: async () => [{ id: 3, name: 'HD-1080p' }, { id: 9, name: 'Ultra-HD' }],
    ensureSeries: async (params: Record<string, unknown>) => { ensure.push(params); return { success: true, message: 'ok', target: { seriesId: 7 } }; },
    wait: async () => {}
  };
  return { io, calls, ensure };
}

test('SEENIT-DOWNLOAD-014 #879 programmer surveille seulement les épisodes à venir demandés, sans rien rechercher', async () => {
  const sonarr = fakeSonarr([[
    { id: 51, seasonNumber: 2, episodeNumber: 5, monitored: false, hasFile: false },
    { id: 52, seasonNumber: 2, episodeNumber: 6, monitored: true, hasFile: false },
    { id: 53, seasonNumber: 2, episodeNumber: 7, monitored: false, hasFile: true },
    { id: 54, seasonNumber: 2, episodeNumber: 9, monitored: false, hasFile: false }
  ]]);
  const result = await programArrEpisodes({ title: 'Série', tmdbId: 42, season: 2, episodes: [5, 6, 7, 8], qualityPreference: '4k', readConfig: () => config, readOwner: () => 'u1', io: sonarr.io });
  assert.deepEqual({ ...result, programmed: [...result.programmed], unannounced: [...result.unannounced], failed: [...result.failed] }, { programmed: [5, 6], unannounced: [8], failed: [], interrupted: false });
  // Identité exacte vérifiée sans recherche ni surveillance globale.
  assert.equal(sonarr.ensure.length, 1);
  assert.equal(sonarr.ensure[0].ensureOnly, true);
  assert.equal(sonarr.ensure[0].qualityProfileId, 9);
  const puts = sonarr.calls.filter(call => call.method === 'PUT');
  // La qualité choisie s'applique à la série ; seul l'épisode 5 change (6 déjà surveillé, 7 présent, 9 non demandé).
  assert.deepEqual(puts.map(call => call.url), ['http://sonarr/api/v3/series', 'http://sonarr/api/v3/episode/51']);
  assert.equal(puts[0].body?.qualityProfileId, 9);
  assert.equal(puts[1].body?.monitored, true);
  assert.ok(sonarr.calls.every(call => !/command|release/.test(call.url)), 'aucune recherche ni téléchargement immédiat');
});

test('SEENIT-DOWNLOAD-014 #879 une série tout juste ajoutée attend ses épisodes avant de les programmer', async () => {
  const sonarr = fakeSonarr([[], [], [{ id: 61, seasonNumber: 1, episodeNumber: 3, monitored: false }]]);
  const result = await programArrEpisodes({ title: 'Série', tmdbId: 42, season: 1, episodes: [3], qualityPreference: '1080p', readConfig: () => config, readOwner: () => 'u1', io: sonarr.io });
  assert.deepEqual([...result.programmed], [3]);
  assert.equal(sonarr.calls.filter(call => call.url.includes('/api/v3/episode?seriesId=7')).length, 3);
});

test('SEENIT-DOWNLOAD-014 #879 la programmation s’arrête net si le compte ou le serveur Sonarr change', async () => {
  let owner = 'u1';
  const sonarr = fakeSonarr([[{ id: 71, seasonNumber: 1, episodeNumber: 4, monitored: false }]], { id: 7, qualityProfileId: 3, monitored: true });
  sonarr.io.ensureSeries = async () => { owner = 'u2'; return { success: true, message: 'ok', target: { seriesId: 7 } }; };
  const result = await programArrEpisodes({ title: 'Série', tmdbId: 42, season: 1, episodes: [4], qualityPreference: '1080p', readConfig: () => config, readOwner: () => owner, io: sonarr.io });
  assert.equal(result.interrupted, true);
  assert.equal(sonarr.calls.filter(call => call.method === 'PUT').length, 0, 'aucune écriture au nom d’un autre compte');
  const signedOut = await programArrEpisodes({ title: 'Série', tmdbId: 42, season: 1, episodes: [4], qualityPreference: '1080p', readConfig: () => ({ ...config, downloadsEnabled: false }), readOwner: () => 'u1', io: sonarr.io });
  assert.equal(signedOut.interrupted, true);
});

test('SEENIT-DOWNLOAD-014 #879 programmation : portée relue avant l’ajout de la série, échec partiel rendu', async () => {
  let owner = 'u1';
  const sonarr = fakeSonarr([[{ id: 81, seasonNumber: 1, episodeNumber: 4, monitored: false }]]);
  sonarr.io.profiles = async () => { owner = 'u2'; return [{ id: 3, name: 'HD-1080p' }]; };
  const switched = await programArrEpisodes({ title: 'Série', tmdbId: 42, season: 1, episodes: [4], qualityPreference: '1080p', readConfig: () => config, readOwner: () => owner, io: sonarr.io });
  assert.equal(switched.interrupted, true);
  assert.equal(sonarr.ensure.length, 0, 'aucune série ajoutée après un changement de compte');
  // Échec au milieu du lot : l'épisode programmé reste compté, les suivants sont rendus avec la cause.
  const partial = fakeSonarr([[5, 6, 7].map(episodeNumber => ({ id: 90 + episodeNumber, seasonNumber: 2, episodeNumber, monitored: false }))]);
  const put = partial.io.put;
  partial.io.put = async (url: string, body: Record<string, unknown>) => { if (url.endsWith('/episode/96')) throw new Error('Sonarr a refusé la modification.'); return put(url, body); };
  const result = await programArrEpisodes({ title: 'Série', tmdbId: 42, season: 2, episodes: [5, 6, 7], qualityPreference: '1080p', readConfig: () => config, readOwner: () => 'u1', io: partial.io });
  assert.deepEqual([[...result.programmed], [...result.failed], result.failure], [[5], [6, 7], 'Sonarr a refusé la modification.']);
  const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  assert.match(view, /if \(outcome\.failure && outcome\.programmed\.length\) toast\(/, 'un échec partiel reste affiché');
  // Sélection mixte : la programmation est attendue avant le lot immédiat (pas d'ajout concurrent de la série).
  const launch = view.slice(view.indexOf('const launchPickedEpisodes'), view.indexOf('const programPickedEpisodes'));
  assert.ok(launch.indexOf('await programPickedEpisodes(') > 0 && launch.indexOf('await programPickedEpisodes(') < launch.indexOf('await launchArrEpisodeBatch('));
});

test('SEENIT-DOWNLOAD-014 #879 un épisode à venir surveillé est « programmé », les autres restent programmables', () => {
  assert.equal(episodeDownloadPresentation(8, false, false, null, true).kind, 'programmed');
  assert.equal(episodeDownloadPresentation(8, false, false, null, false).kind, 'future');
  // Un épisode sorti ou présent garde son état, surveillé ou non.
  assert.equal(episodeDownloadPresentation(8, true, false, null, true).kind, 'available');
  assert.equal(episodeDownloadPresentation(8, false, true, null, true).kind, 'present');
  assert.equal(programmingSummary(2, 1, '1080p'), '2 ajoutés · 1 programmé · 1080p');
  assert.equal(programmingSummary(0, 3, '4k'), '3 programmés · 4K');
});

test('SEENIT-DOWNLOAD-014 #879 en mode, les épisodes à venir se cochent en bleu et partent vers Sonarr à part', () => {
  const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  const rows = readFileSync('src/screens/mediaDetail/seriesSections.tsx', 'utf8');
  assert.match(rows, /\{!aired && inMode && <EpisodeProgramControl /);
  assert.match(rows, /const selectable = inMode && isEpisodePickable\(modeState\);/);
  assert.match(rows, /episodesMonitored\?\.\[key\]/);
  assert.match(view, /const selectableEpisodes = modeStates\.filter\(entry => isEpisodePickable\(entry\.state\)\)/);
  const launch = view.slice(view.indexOf('const launchPickedEpisodes'), view.indexOf('const programPickedEpisodes'));
  assert.match(launch, /const episodes = pickedNow;/, 'seuls les épisodes sortis sont téléchargés maintenant');
  assert.match(launch, /if \(toProgram\.length\) await programPickedEpisodes\(/);
  assert.match(view, /episodes, qualityPreference: quality, readConfig: \(\) => useDownloadConfigStore\.getState\(\)/);
  // « Version précise » ne concerne qu'un épisode sorti.
  assert.match(view, /onPrecise=\{pickedNow\.length === 1 && !pickedFuture\.length \? openPreciseVersion : undefined\}/);
});
