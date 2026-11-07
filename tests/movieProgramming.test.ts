import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { isAllowedServiceProxyPath } from '../src/features/downloads/downloadBackendSecurity.ts';

// Vrai module de programmation du film : seuls les transports Radarr, Firebase et le gate sont remplacés.
const bundle = await build({ entryPoints: ['src/features/downloads/movieProgramming.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'movie-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:sonarrRadarr|sonarrRadarrTransport|firebase|qualityProfileSelection|downloadFeatureVisibility)$/ }, args => ({ path: args.path.split('/').at(-1) || '', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'sonarrRadarr'
      ? 'export const cleanUrl=u=>String(u).replace(/\\/+$/,"");export const executeGet=async()=>{throw new Error("réseau réel interdit")};export const fetchQualityProfiles=async()=>[];export const searchAndDownloadInRadarr=async()=>{throw new Error("réseau réel interdit")};'
      : args.path === 'sonarrRadarrTransport' ? 'export const executePut=async()=>{throw new Error("réseau réel interdit")};'
      : args.path === 'firebase' ? 'export const auth={currentUser:{uid:"u1"}};'
      : args.path === 'qualityProfileSelection' ? 'export const resolveEffectiveQualityProfileId=(profiles,q)=>profiles.find(p=>q==="4k"?/4k|ultra/i.test(p.name):/1080/.test(p.name))?.id;'
      : 'export const isDownloadFeatureEnabled=c=>c.downloadsEnabled===true;' }));
  } }] });
type Call = { method: string; url: string; body?: Record<string, unknown> };
const movieModule = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`) as {
  programArrMovie: (request: Record<string, unknown>) => Promise<{ programmed: boolean; present: boolean; failure?: string; interrupted: boolean }>;
  unprogramArrMovie: (request: Record<string, unknown>) => Promise<{ done: boolean; failure?: string; interrupted?: boolean }>;
};

const config = { downloadsEnabled: true, radarrUrl: 'http://radarr/', radarrApiKey: 'k' };
function fakeRadarr(movie: Record<string, unknown>) {
  const calls: Call[] = [];
  const ensure: Record<string, unknown>[] = [];
  const io = {
    get: async (url: string) => { calls.push({ method: 'GET', url }); if (url.endsWith('/api/v3/movie/40')) return movie; if (url.endsWith('/api/v3/movie')) return [movie]; throw new Error(`GET inattendu ${url}`); },
    put: async (url: string, body: Record<string, unknown>) => { calls.push({ method: 'PUT', url, body }); return body; },
    profiles: async () => [{ id: 3, name: 'HD-1080p' }, { id: 9, name: 'Ultra-HD' }],
    ensureMovie: async (params: Record<string, unknown>) => { ensure.push(params); return { success: true, message: 'ok', target: { movieId: 40, tmdbId: 83533 } }; }
  };
  return { io, calls, ensure };
}

test('DlFilm programmer un film à venir : surveillé dans la qualité choisie, sans aucune recherche', async () => {
  const radarr = fakeRadarr({ id: 40, tmdbId: 83533, monitored: false, hasFile: false, qualityProfileId: 3, title: 'Avatar' });
  const result = await movieModule.programArrMovie({ title: 'Avatar : De feu et de cendres', tmdbId: 83533, qualityPreference: '4k', readConfig: () => config, readOwner: () => 'u1', io: radarr.io });
  assert.deepEqual(result, { programmed: true, present: false, interrupted: false });
  assert.equal(radarr.ensure.length, 1);
  assert.equal(radarr.ensure[0].ensureOnly, true, 'ajout éventuel sans recherche automatique');
  assert.equal(radarr.ensure[0].qualityProfileId, 9);
  // La garde de portée est transmise au service, qui la relit juste avant d'ajouter le film.
  assert.equal(typeof radarr.ensure[0].canWrite, 'function');
  assert.equal((radarr.ensure[0].canWrite as () => boolean)(), true);
  const puts = radarr.calls.filter(call => call.method === 'PUT');
  assert.deepEqual(puts.map(call => [call.url, call.body?.monitored, call.body?.qualityProfileId]), [['http://radarr/api/v3/movie/40', true, 9]]);
  // En PWA, chaque appel passe par le proxy serveur (SEENIT-SECURITY-001).
  assert.ok(radarr.calls.every(call => isAllowedServiceProxyPath(call.url, call.method)), radarr.calls.map(call => `${call.method} ${call.url}`).join(' '));
});

test('DlFilm programmer : un film présent ou d’une autre identité n’est jamais modifié', async () => {
  const present = fakeRadarr({ id: 40, tmdbId: 83533, monitored: false, hasFile: true });
  assert.deepEqual(await movieModule.programArrMovie({ title: 'Avatar', tmdbId: 83533, qualityPreference: '1080p', readConfig: () => config, readOwner: () => 'u1', io: present.io }), { programmed: false, present: true, interrupted: false });
  assert.equal(present.calls.filter(call => call.method === 'PUT').length, 0);
  const other = fakeRadarr({ id: 40, tmdbId: 1, monitored: false, hasFile: false });
  const mismatch = await movieModule.programArrMovie({ title: 'Avatar', tmdbId: 83533, qualityPreference: '1080p', readConfig: () => config, readOwner: () => 'u1', io: other.io });
  assert.equal(mismatch.programmed, false);
  assert.match(String(mismatch.failure), /film exact/);
  assert.equal(other.calls.filter(call => call.method === 'PUT').length, 0);
});

test('DlFilm programmer : un changement de compte ou de serveur arrête tout sans écrire', async () => {
  const radarr = fakeRadarr({ id: 40, tmdbId: 83533, monitored: false, hasFile: false, qualityProfileId: 3 });
  let reads = 0;
  // Le serveur change après l'ajout : la surveillance n'est jamais écrite sur l'autre serveur.
  const readConfig = () => (++reads > 2 ? { ...config, radarrUrl: 'http://autre' } : config);
  const result = await movieModule.programArrMovie({ title: 'Avatar', tmdbId: 83533, qualityPreference: '1080p', readConfig, readOwner: () => 'u1', io: radarr.io });
  assert.equal(result.interrupted, true);
  assert.equal((radarr.ensure[0].canWrite as () => boolean)(), false, 'la garde transmise voit le changement de serveur');
  assert.equal(radarr.calls.filter(call => call.method === 'PUT').length, 0);
  const disabled = await movieModule.programArrMovie({ title: 'Avatar', tmdbId: 83533, qualityPreference: '1080p', readConfig: () => ({ ...config, downloadsEnabled: false }), readOwner: () => 'u1', io: radarr.io });
  assert.equal(disabled.interrupted, true);
});

test('DlFilm annuler une programmation : le film exact n’est plus surveillé, rien n’est supprimé', async () => {
  const radarr = fakeRadarr({ id: 40, tmdbId: 83533, monitored: true, hasFile: false });
  assert.deepEqual(await movieModule.unprogramArrMovie({ tmdbId: 83533, readConfig: () => config, readOwner: () => 'u1', io: radarr.io }), { done: true });
  assert.deepEqual(radarr.calls.filter(call => call.method === 'PUT').map(call => [call.url, call.body?.monitored]), [['http://radarr/api/v3/movie/40', false]]);
  assert.ok(radarr.calls.every(call => isAllowedServiceProxyPath(call.url, call.method)));
  const present = fakeRadarr({ id: 40, tmdbId: 83533, monitored: true, hasFile: true });
  const kept = await movieModule.unprogramArrMovie({ tmdbId: 83533, readConfig: () => config, readOwner: () => 'u1', io: present.io });
  assert.equal(kept.done, false);
  assert.equal(present.calls.filter(call => call.method === 'PUT').length, 0);
});

test('DlFilm annuler une programmation : déconnexion, gate coupé ou autre serveur pendant la lecture, aucune écriture', async () => {
  for (const change of ['owner', 'gate', 'server'] as const) {
    const radarr = fakeRadarr({ id: 40, tmdbId: 83533, monitored: true, hasFile: false });
    let changed = false;
    const io = { get: async (url: string) => { const value = await radarr.io.get(url); changed = true; return value; }, put: radarr.io.put };
    const readConfig = () => changed && change === 'gate' ? { ...config, downloadsEnabled: false } : changed && change === 'server' ? { ...config, radarrUrl: 'http://autre' } : config;
    const readOwner = () => (changed && change === 'owner' ? undefined : 'u1');
    const result = await movieModule.unprogramArrMovie({ tmdbId: 83533, readConfig, readOwner, io });
    assert.deepEqual(result, { done: false, interrupted: true }, change);
    assert.equal(radarr.calls.filter(call => call.method === 'PUT').length, 0, change);
  }
});

test('DlFilm télécharger un film sorti passe par la voie de la popup (profil Radarr configuré, présence revérifiée)', async () => {
  const { readFileSync } = await import('node:fs');
  const view = readFileSync('src/screens/ShowDetailView.tsx', 'utf8');
  assert.match(view, /await launchArrDownload\(\{ config, mediaType: 'movie',/);
  assert.doesNotMatch(view, /launchMovieDownload/);
  // Présence confirmée pendant que la barre est ouverte (Plex sans Radarr) : barre fermée, aucun lancement.
  const launchFilm = view.slice(view.indexOf('const launchFilm = async'), view.indexOf('const cancelFilm = async'));
  assert.ok(launchFilm.indexOf('if (movieAvailable)') > 0 && launchFilm.indexOf('if (movieAvailable)') < launchFilm.indexOf('launchArrDownload') && launchFilm.indexOf('if (movieAvailable)') < launchFilm.indexOf('programArrMovie'), 'la présence est revérifiée avant tout lancement ou programmation');
  assert.match(view, /useEffect\(\(\) => \{ if \(movieAvailable\) setFilmMode\(false\); \}, \[movieAvailable\]\);/);
  assert.match(view, /\{filmMode && canUseFilmMode && !movieAvailable && <DownloadModeBar/);
  const launch = readFileSync('src/features/downloads/downloadLaunch.ts', 'utf8');
  assert.match(launch, /qualityPreference === '4k' \? config\.radarr4kProfileId : config\.radarr1080pProfileId/);
});
