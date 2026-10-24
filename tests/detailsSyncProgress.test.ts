import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import type { Show } from '../src/types.ts';
import { buildSeriesSeasonProgress } from '../src/features/watchlist/seriesCardPresentation.ts';

test('SEENIT-UX-014 les deux synchronisations conservent la finale avant de supprimer le cache saison', async () => {
  const bundle = await build({
    entryPoints: ['src/hooks/useDetailsSyncWorker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'details-sync-ports', setup(builder) {
      builder.onResolve({ filter: /^(?:react|firebase\/firestore)$|\/(?:firebase|tmdb|utils|syncStore|showsStore|syncPlex|plexStorage|logStore)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        const p=()=>globalThis.__ports;
        export const appLogger={warn:()=>{}}; export const useEffect=()=>{}; export const useRef=()=>({current:null});
        export const db={};export const auth={currentUser:{uid:'fixture'}};export const sendNativeNotification=()=>{};
        export const doc=(...args)=>args;export const collection=(...args)=>args;
        export const getDoc=async()=>({exists:()=>true,id:'series',data:()=>p().show});
        export const getDocs=async()=>({empty:false,docs:[{id:'series',data:()=>p().show}]});
        export const updateDoc=async(_ref,value)=>p().writes.push(value);export const addDoc=async()=>{};
        export const tmdb={getShowDetails:async()=>({ok:true,value:p().details}),getMediaDetails:async()=>({ok:true,value:p().details}),getSeasonDetails:async()=>({ok:true,value:p().season})};
        export const useSyncStore={getState:()=>({setSyncStatus:()=>{},setQuotaExceeded:()=>{},resetQuotaError:()=>{},isQuotaExceeded:false})};
        export const useShowsStore={getState:()=>({shows:[p().show],updateShowOptimistic:()=>{}})};
        export const performPlexSync=async()=>{}; export const getPlexLastSyncTimestamp=()=>0;export const getStoredPlexToken=()=>null;
        export const getTodayStr=()=>'2026-10-21';export const computeAutoArchiveStatus=()=>false;
        export const getNextEpisodeNumber=()=>({season:1,episode:1,episodeData:p().season.episodes[0]});
      ` }));
    } }],
  });
  const show: Show = { id: 'series', userId: 'fixture', tmdbId: 42, title: 'Finale réelle', mediaType: 'tv',
    posterPath: null, backdropPath: null, status: 'watching', isArchived: false, createdAt: 1, updatedAt: 1,
    seenEpisodes: [], episodeRecords: {}, firstAirDate: '2026-09-01' };
  const ports = { show, writes: [] as Array<Record<string, unknown>>,
    details: { status: 'Returning Series', seasons: [{ season_number: 1, episode_count: 4 }], number_of_episodes: 4 },
    season: { season_number: 1, episodes: Array.from({ length: 4 }, (_, index) => ({ episode_number: index + 1, air_date: '2026-09-01', episode_type: index === 3 ? 'finale' : 'standard' })) },
  };
  const module = { exports: {} as { syncSingleItem: (id: string, silent: boolean) => Promise<{ success: boolean }>; performDetailsSync: (force: boolean) => Promise<{ success: boolean }> } };
  const context = vm.createContext({ module, __ports: ports, console: { log() {}, warn() {}, error() {} }, setTimeout: (callback: () => void) => { callback(); return 1; }, clearTimeout() {} });
  vm.runInContext(bundle.outputFiles[0].text, context);
  for (const total of [4, 10, 0]) {
    ports.details.seasons[0].episode_count = total;
    ports.season.episodes[3].episode_type = total === 4 ? 'finale' : 'standard';
    for (const invoke of [() => module.exports.syncSingleItem('series', true), () => module.exports.performDetailsSync(true)]) {
      ports.writes.length = 0;
      assert.equal((await invoke()).success, true);
      const payload = ports.writes.find(value => value.seasonsCache === null);
      assert.ok(payload, 'la synchronisation de production a écrit les détails et supprimé le cache');
      const refreshed = { ...show, ...JSON.parse(JSON.stringify(payload)) } as Show;
      assert.equal(refreshed.seasonProgress?.['1']?.last_known_episode_type, total === 4 ? 'finale' : 'standard');
      assert.equal(refreshed.seasonProgress?.['1']?.episode_count, total || null);
      assert.equal(refreshed.nextEpisodeToWatch?.season_total_unknown, total === 0);
      const watch = buildSeriesSeasonProgress(refreshed, refreshed.nextEpisodeToWatch, 'watch', '2026-10-21');
      const history = buildSeriesSeasonProgress({ ...refreshed, nextEpisodeToWatch: null }, { season_number: 1, episode_number: 2 }, 'history', '2026-10-21');
      assert.equal(watch.unknownTail, total === 0);
      assert.equal(history.totalUnknown, total === 0);
      assert.equal(watch.label, `S1 · 0/${total || '?'}`);
      assert.equal(history.label, watch.label, 'le total survit au nettoyage du cache et à l’absence de reprise');
    }
  }
  // Le compte positif d'une liste partielle TMDB ne confirme pas sa taille finale.
  ports.details.seasons[0].episode_count = 4;
  ports.season.episodes[3].episode_type = 'standard';
  ports.season.episodes[3].air_date = '';
  for (const invoke of [() => module.exports.syncSingleItem('series', true), () => module.exports.performDetailsSync(true)]) {
    ports.writes.length = 0;
    await invoke();
    const partial = ports.writes.find(value => value.seasonProgress);
    assert.ok(partial);
    const refreshed = { ...show, ...JSON.parse(JSON.stringify(partial)) } as Show;
    assert.equal(refreshed.seasonProgress?.['1'].episode_count, 4);
    assert.equal(buildSeriesSeasonProgress(refreshed, { ...refreshed.nextEpisodeToWatch, episode_count: 4, season_total_unknown: false }, 'watch', '2026-10-23').unknownTail, false, 'la synchronisation garde un total TMDB explicite malgré une date manquante');
  }
  const originalEpisodes = ports.season.episodes;
  ports.details.seasons[0].episode_count = 1;
  ports.season.episodes = [{episode_number:1,air_date:'2026-12-26',episode_type:'standard'}];
  for (const invoke of [() => module.exports.syncSingleItem('series', true), () => module.exports.performDetailsSync(true)]) {
    ports.writes.length = 0; await invoke();
    const patch = ports.writes.find(value=>value.seasonProgress);
    const refreshed = {...show,...JSON.parse(JSON.stringify(patch))} as Show;
    assert.equal(refreshed.seasonProgress?.['1'].episode_count,null,'Harry Potter : la vraie synchronisation ne confirme pas un placeholder1');
    assert.equal(buildSeriesSeasonProgress(refreshed,{season_number:1,episode_number:1},'upcoming','2026-10-24').unknownTail,true);
  }
  ports.season.episodes = originalEpisodes;
  // Une installation existante doit être réparée sans pull-to-refresh, puis s'arrêter.
  for (const providerStatus of ['Returning Series', 'Ended', 'Canceled']) for (const oldFlag of [true, false]) {
  ports.details.status = providerStatus;
  ports.show = { ...show, status: oldFlag ? 'watching' : 'completed', isArchived: !oldFlag, seriesEnded: !oldFlag, isSynced: true, lastSyncedAt: Date.now(), seasonProgress: { '1': {
    season_number: 1, known_episodes_in_season: 10, season_total_unknown: oldFlag,
    last_season_number: 1, last_known_episode_type: 'standard', last_known_episode_air_date: null,
  } }, nextEpisodeToWatch: { season_number: 1, episode_number: 1, air_date: '2099-01-01' } };
  ports.details.seasons[0].episode_count = 10;
  ports.writes.length = 0;
  await module.exports.syncSingleItem('series', true);
  assert.equal(ports.writes.find(value => value.seasonProgress)?.status, undefined, 'la synchronisation manuelle conserve aussi le statut utilisateur');
  ports.writes.length = 0;
  await module.exports.performDetailsSync(false);
  const repaired = ports.writes.find(value => value.seasonProgress);
  assert.ok(repaired, 'l’ancienne preuve déclenche la réparation même avec une date future et un cache récent');
  assert.equal(repaired.status, undefined, 'le statut fournisseur ne remplace jamais le statut de suivi utilisateur');
  assert.equal(repaired.tmdbStatus, providerStatus);
  ports.show = { ...ports.show, ...JSON.parse(JSON.stringify(repaired)) };
  ports.writes.length = 0;
  await module.exports.performDetailsSync(false);
  assert.equal(ports.writes.length, 0, 'la réparation ne se répète pas');
  }
});
