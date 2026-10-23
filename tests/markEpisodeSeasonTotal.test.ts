import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import type { Show } from '../src/types.ts';
import { buildSeasonProgressEvidence } from '../src/features/shows/seasonProgressEvidence.ts';
import { buildSeriesSeasonProgress } from '../src/features/watchlist/seriesCardPresentation.ts';

test('SEENIT-UX-014 Vu conserve le total fournisseur sans transformer la liste partielle en total', async () => {
  const bundle = await build({ entryPoints: ['src/features/shows/markEpisodeWatched.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'mark-total-ports', setup(builder) {
      builder.onResolve({ filter: /firebase\/firestore|\/(?:showsStore|tmdb|toastStore|logStore|utils|firebase)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        const p=()=>globalThis.__ports;
        export const useShowsStore={getState:()=>({shows:[p().show],updateShowOptimistic:(_id,update)=>{p().show={...p().show,...update};}})};
        export const tmdb={getSeasonDetails:async(_id,season)=>({ok:true,value:{episodes:Array.from({length:4},(_,i)=>({season_number:season,episode_number:i+1,air_date:'2026-01-01',name:'Épisode'}))}})};
        export const useToastStore={getState:()=>({showToast:()=>{},addToast:()=>{}})};
        export const useLogStore={getState:()=>({addLog:()=>{}})};
        export const scrollAllCarouselsToStart=()=>{};
        export const db={};export const auth={currentUser:{uid:'fixture'}};
        export const doc=(...x)=>x;export const updateDoc=async(_ref,data)=>p().writes.push(data);export const arrayUnion=x=>[x];
      ` }));
    } }],
  });
  const initial: Show = { id: 'series', userId: 'fixture', tmdbId: 42, title: 'Série', mediaType: 'tv', posterPath: null, backdropPath: null,
    status: 'watching', isArchived: false, createdAt: 1, updatedAt: 1, seenEpisodes: [], episodeRecords: {}, totalEpisodes: 20 };
  const ports = { show: initial, writes: [] as Array<Record<string, unknown>> };
  const module = { exports: {} as { markEpisodeWatched: (show: Show, season: number, episode: number) => Promise<boolean | undefined> } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, __ports: ports, console, setTimeout, clearTimeout, navigator: { onLine: true }, window: { dispatchEvent() {} }, CustomEvent: class {} }));
  for (const total of [10, 0]) for (const episode of [1, 4]) {
    ports.show = { ...initial, seasonProgress: buildSeasonProgressEvidence([1, 2].map(season_number => ({ season_number, episode_count: total, episodes: [{ episode_number: 4 }] })), false),
      nextEpisodeToWatch: { season_number: 1, episode_number: episode, episode_count: 4, season_total_unknown: true } };
    ports.writes.length = 0;
    assert.notEqual(await module.exports.markEpisodeWatched(ports.show, 1, episode), false);
    const next = ports.show.nextEpisodeToWatch;
    assert.equal(next.season_number, episode === 4 ? 2 : 1);
    assert.equal(next.episode_count, total || null);
    assert.ok(ports.writes.length > 0, 'le vrai chemin a persisté le marquage');
    const progress = buildSeriesSeasonProgress(ports.show, next, 'watch', '2026-10-23');
    assert.equal(progress.totalUnknown, total === 0);
    assert.equal(progress.knownEpisodes, total || 4);
  }
});
