import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { buildSeasonProgressEvidence, needsSeasonProgressRefresh } from '../src/features/shows/seasonProgressEvidence.ts';
import { formatHistoryClock, formatHistoryRowDate } from '../src/features/history/historyPresentation.ts';

test('SEENIT-UX-014 réévalue les totaux inconnus sans polling ni boucle de migration', () => {
  const old = { ...buildSeasonProgressEvidence([{ season_number:1, episodes:[{episode_number:6}] }], false)['1'] };
  delete old.total_checked_at;
  assert.equal(needsSeasonProgressRefresh({seasonProgress:{'1':old}}),true);
  assert.equal(needsSeasonProgressRefresh({seasonProgress:{'1':{...old,total_checked_at:Date.now()} as typeof old}}),false);
  assert.equal(needsSeasonProgressRefresh({seasonProgress:{'1':{...old,total_checked_at:Date.now()-8*86_400_000} as typeof old}}),true);
  assert.equal(needsSeasonProgressRefresh({seasonProgress:buildSeasonProgressEvidence([{season_number:1,episode_count:6}],false)}),false);
  assert.equal(needsSeasonProgressRefresh({seasonProgress:buildSeasonProgressEvidence([{season_number:1,episode_count:1}],false)}),false,'Harry Potter reste inconnu sans déclencher une boucle');
});

test('SEENIT-UX-015 affiche le jour et la vraie heure sans ce soir ni heure inventée', () => {
  const now=new Date(2026,9,24,18,40).getTime(), morning=new Date(2026,9,24,8,13).getTime();
  assert.equal(formatHistoryRowDate(morning,now),'Aujourd’hui');
  assert.equal(formatHistoryClock(morning,true),'08:13');
  assert.equal(formatHistoryClock(morning,false),null);
});

test('SEENIT-UX-014 la façade TMDB répare un total malgré ses caches chauds', async () => {
  const bundle=await build({entryPoints:['src/features/shows/tmdbClient.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'metadata-ports',setup(builder){
    builder.onResolve({filter:/\/(?:apiAuth|seenitApi|utils|publicMetadataCache|parentalRatingCache)$/},args=>({path:args.path,namespace:'ports'}));
    builder.onLoad({filter:/.*/,namespace:'ports'},()=>({contents:`
      const p=()=>globalThis.__ports;
      export const authenticatedFetch=async()=>{p().calls++;return {ok:!p().offline,status:p().offline?503:200,json:async()=>({id:42,name:'Série',seasons:[{season_number:1,episode_count:6}]})}};
      export const resolveSeenItApiUrl=path=>'https://fixture.invalid'+path;
      export const adjustTMDBShowDataForEurope=()=>{};export const adjustTMDBSeasonDataForEurope=()=>{};
      export const readParentalRatingCache=()=>null;export const writeParentalRatingCache=()=>{};
      export const normalizePublicMetadataRequestKey=value=>value;
      export const isPublicMetadataFallbackStatus=status=>status===503;
      export const readPublicMetadataCache=async(family,key)=>p().cache.get(family+key)||null;
      export const writePublicMetadataCache=(family,key,data)=>{p().cache.set(family+key,{data,fresh:true,storedAt:Date.now()});};
      export const runPublicMetadataSingleFlight=(_family,_key,load)=>load();
    `}));
  }}]});
  const ports={calls:0,offline:false,cache:new Map([['detailstv_42',{data:{id:42,name:'Série',seasons:[{season_number:1,episode_count:0}]},fresh:true,storedAt:Date.now()}]])};
  const module={exports:{} as {tmdb:{getShowDetails:(id:number,refresh?:boolean)=>Promise<{ok:boolean;value:any}>;getMediaDetails:(id:number,type:string,refresh?:boolean)=>Promise<{ok:boolean;value:any}>}}};
  vm.runInContext(bundle.outputFiles[0].text,vm.createContext({module,__ports:ports,URL,console,setTimeout,clearTimeout,structuredClone}));
  const client=module.exports.tmdb;
  assert.equal((await client.getShowDetails(42)).value.seasons[0].episode_count,0);
  assert.equal(ports.calls,0,'la lecture ordinaire réutilise son cache');
  assert.equal((await client.getShowDetails(42,true)).value.seasons[0].episode_count,6);
  assert.equal(ports.calls,1,'la réparation ciblée passe par la vraie façade et le transport');
  assert.equal((await client.getShowDetails(42)).value.seasons[0].episode_count,6);
  assert.equal(ports.calls,1,'la preuve réparée est réutilisée');
  ports.offline=true;
  assert.equal((await client.getMediaDetails(42,'tv',true)).ok,false,'une panne ne devient pas une nouvelle preuve fraîche');
  assert.equal((await client.getShowDetails(42)).value.seasons[0].episode_count,6,'le cache connu reste intact après l’échec de rafraîchissement');
});
