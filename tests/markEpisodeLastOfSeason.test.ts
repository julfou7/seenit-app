import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import type { Show } from '../src/types.ts';

// Retour terrain du 15/11 (Lupin S03E07, dernier épisode) : aucune célébration depuis l'accueil, et il a
// fallu taper quatre fois : rien ne bougeait pendant les lectures TMDB et chaque tap relançait un marquage.
test('dernier épisode coché depuis l’accueil : vu tout de suite, un seul marquage, saison célébrée', async () => {
  const bundle = await build({ entryPoints: ['src/features/shows/markEpisodeWatched.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'last-episode-ports', setup(builder) {
      builder.onResolve({ filter: /firebase\/firestore|\/(?:showsStore|tmdb|toastStore|logStore|utils|firebase)$/ }, args => ({ path: args.path, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        const p=()=>globalThis.__ports;
        export const useShowsStore={getState:()=>({shows:[p().show],updateShowOptimistic:(_id,update)=>{p().show={...p().show,...update};}})};
        export const tmdb={getSeasonDetails:async(_id,season)=>{p().seasonCalls++;await p().gate;return season===3?{ok:true,value:{episodes:Array.from({length:7},(_,i)=>({season_number:3,episode_number:i+1,air_date:'2023-10-05',name:'Épisode'}))}}:{ok:false};}};
        export const useToastStore={getState:()=>({showToast:()=>{},addToast:()=>{}})};
        export const useLogStore={getState:()=>({addLog:()=>{}})};
        export const scrollAllCarouselsToStart=()=>{};export const getTodayStr=()=>'2026-11-15';
        export const db={};export const auth={currentUser:{uid:'fixture'}};
        export const doc=(...x)=>x;export const updateDoc=async(_ref,data)=>p().writes.push(data);export const arrayUnion=x=>[x];
      ` }));
    } }],
  });
  let release = () => {};
  const ports = {
    show: { id: 'lupin', userId: 'fixture', tmdbId: 96677, title: 'Lupin', mediaType: 'tv', posterPath: null, backdropPath: null, status: 'watching',
      isArchived: false, createdAt: 1, updatedAt: 1, tmdbStatus: 'Returning Series', seenEpisodes: ['3x1', '3x2', '3x3', '3x4', '3x5', '3x6'], episodeRecords: {},
      nextEpisodeToWatch: { season_number: 3, episode_number: 7 } } as unknown as Show,
    writes: [] as unknown[], seasonCalls: 0, gate: new Promise<void>(resolve => { release = resolve; }),
  };
  const module = { exports: {} as { markEpisodeWatched: (show: Show, season: number, episode: number) => Promise<boolean | undefined> } };
  vm.runInContext(bundle.outputFiles[0].text, vm.createContext({ module, __ports: ports, console, setTimeout, clearTimeout, navigator: { onLine: true }, window: { dispatchEvent() {} }, CustomEvent: class {}, process: { env: {} } }));

  const first = module.exports.markEpisodeWatched(ports.show, 3, 7);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(ports.show.seenEpisodes.includes('3x7'), 'vu à l’écran dès le tap, avant les lectures TMDB');
  assert.equal(await module.exports.markEpisodeWatched(ports.show, 3, 7), false, 'un deuxième tap pendant le marquage est ignoré');
  release();
  assert.notEqual(await first, false);
  assert.equal(ports.writes.length, 1, 'un seul enregistrement');
});

test('le marquage d’accueil déclenche la célébration de fin de saison', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('src/features/shows/markEpisodeWatched.ts', 'utf8');
  assert.match(source, /useCelebrationStore\.getState\(\)\.celebrate\(detectCompletionCelebration\(\{/);
  assert.match(source, /season: sNum, wasSeen: prevSeenEpisodes\.includes\(epKey\), previousSeen: prevSeenEpisodes, nextSeen: newSeenSet,/);
  const { detectCompletionCelebration } = await import('../src/features/shows/completionCelebration.ts');
  const aired = Array.from({ length: 7 }, (_, i) => ({ episode_number: i + 1, air_date: '2023-10-05' }));
  const before = ['3x1', '3x2', '3x3', '3x4', '3x5', '3x6'];
  assert.deepEqual(detectCompletionCelebration({ season: 3, wasSeen: false, previousSeen: before, nextSeen: new Set([...before, '3x7']), seasonEpisodes: aired, today: '2026-11-15', nextEpisodeToWatch: null, seriesEnded: false }), { kind: 'season', season: 3 });
});
