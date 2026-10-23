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
      builder.onResolve({ filter: /^(?:react|firebase\/firestore)$|\/(?:firebase|tmdb|utils|syncStore|showsStore|syncPlex|plexStorage)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        const p=()=>globalThis.__ports;
        export const useEffect=()=>{}; export const useRef=()=>({current:null});
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
});
