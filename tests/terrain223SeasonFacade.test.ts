import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { buildSeriesSeasonProgress } from '../src/features/watchlist/seriesCardPresentation.ts';
import type { Show } from '../src/types.ts';
import { buildSeasonProgressEvidence, needsSeasonProgressRefresh } from '../src/features/shows/seasonProgressEvidence.ts';

test('SEENIT-UX-014 les barres se dégrisent à la date connue sans ouvrir la fiche ni changer le Show', () => {
 const show={seenEpisodes:['1x1'],seasonProgress:buildSeasonProgressEvidence([{season_number:1,episode_count:3,episodes:[{episode_number:1,air_date:'2026-10-24'},{episode_number:2,air_date:'2026-10-25'},{episode_number:3,air_date:'2026-11-01'}]}],false,'2026-10-24')};
 const pointer={season_number:1,episode_number:1,air_date:'2026-10-24'};
 const yesterday=buildSeriesSeasonProgress(show,pointer,'watch','2026-10-24');
 const today=buildSeriesSeasonProgress(show,pointer,'watch','2026-10-25');
 assert.deepEqual(yesterday.segments.map(s=>s.state),['seen','future','future']);
 assert.deepEqual(today.segments.map(s=>s.state),['seen','unseen','future']);
 assert.equal(today.availableUnseen,1);
});

test('SEENIT-UX-014 la vraie façade saison fait converger le détail et la carte malgré une preuve v4 figée', async () => {
 const bundle = await build({stdin:{contents:"export {tmdb} from './src/features/shows/tmdb.ts';export {writePublicMetadataCache} from './src/features/shows/publicMetadataCache.ts'",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'supplier-ports',setup(b){
  b.onResolve({filter:/^(?:firebase\/firestore)$|\/(?:apiAuth|seenitApi|utils|firebase|showsStore|trackedMediaTitle|parentalRatingStore|tvdb|cinemaSearchEvidence)$/},a=>({path:a.path,namespace:'ports'}));
  b.onLoad({filter:/.*/,namespace:'ports'},()=>({contents:`
   const p=()=>globalThis.__ports;
   export const authenticatedFetch=async url=>{p().urls.push(url);return {ok:!p().offline,status:p().offline?503:200,json:async()=>structuredClone(url.includes('/season/')?p().season:p().details)}};
   export const resolveSeenItApiUrl=path=>'https://fixture.invalid'+path;
   export const adjustTMDBShowDataForEurope=()=>{};export const adjustTMDBSeasonDataForEurope=()=>{};
   export const auth={currentUser:{uid:'owner'}};export const db={};export const doc=(...args)=>args;
   export const updateDoc=async(_ref,value)=>p().writes.push(value);
   export const useShowsStore={getState:()=>({shows:p().shows,updateShowOptimistic:(id,patch)=>{p().shows=p().shows.map(show=>show.id===id?{...show,...patch}:show)}})};
   export const convergeTrackedMediaTitleFromTmdb=()=>{};
   export const getParentalRatingOverride=()=>null;export const getParentalRatingOverridesSnapshot=()=>({});
   export const getTVDBFranchiseRelation=async()=>null;export const enrichCinemaEvidenceForMediaResults=async v=>v;export const enrichCinemaEvidenceForSearchResults=async v=>v;
  `}));
 }}]});
 for(const [title,total,aired] of [['Has Fallen',8,7],['A Knight of the Seven Kingdoms',6,6],['The Madison',6,6],['Série voisine',10,7],['Harry Potter',1,0]] as const){
  const old={total_evidence_version:4,total_checked_at:Date.now(),season_number:1,episode_count:title==='Has Fallen'?8:null,season_total_unknown:title!=='Has Fallen',known_episodes_in_season:1,last_season_number:1,last_known_episode_type:null,last_known_episode_air_date:null};
  const ports={now:Date.now(),offline:false,urls:[] as string[],writes:[] as unknown[],shows:[{id:'tracked',userId:title==='Has Fallen'?undefined:'owner',tmdbId:42,mediaType:'tv',title,seenEpisodes:[],seasonProgress:{'1':old},nextEpisodeToWatch:{season_number:1,episode_number:1,episode_count:old.episode_count,aired_episodes_in_season:2,air_date:'2020-01-01'}}],
    details:{id:42,name:title,status:'Returning Series',seasons:[{season_number:1,episode_count:total}]},season:{season_number:1,episodes:Array.from({length:total},(_,index)=>({episode_number:index+1,air_date:index<aired?'2020-01-01':null}))}};
  const module={exports:{} as {tmdb:{getShowDetails:Function;getSeasonDetails:Function};writePublicMetadataCache:Function}};
  class Clock extends Date { static now(){return ports.now;} }
  vm.runInContext(bundle.outputFiles[0].text,vm.createContext({module,__ports:ports,Date:Clock,URL,console,setTimeout,clearTimeout,structuredClone,TextEncoder,TextDecoder}));
  await module.exports.tmdb.getShowDetails(42,true);
  await module.exports.tmdb.getSeasonDetails(42,1,true);
  const show=ports.shows[0] as unknown as Show;
  const card=buildSeriesSeasonProgress(show,show.nextEpisodeToWatch,'watch','2026-10-25');
  assert.equal(card.knownEpisodes,total,title);
  assert.equal(card.unknownTail,total===1,title);
  assert.equal(card.segments.filter(segment=>segment.state==='unseen'||segment.state==='current').length,Math.max(1,aired),title);
  assert.equal(ports.writes.length,1,'une écriture compacte seulement après changement de preuve');
  await module.exports.tmdb.getSeasonDetails(42,1);
  assert.equal(ports.writes.length,1,'cache identique sans nouvelle écriture Firestore');
  assert.equal(ports.urls.length,2,'aucun appel supplémentaire à la réouverture chaude');
  assert.equal(needsSeasonProgressRefresh(show),true,'la façade ne peut pas acquitter une migration v4');
  const before=ports.writes.length;
  const proof=ports.shows[0].seasonProgress['1'];
  proof.episode_count=total;proof.total_checked_at=ports.now+1;
  module.exports.writePublicMetadataCache('details','tv_42',{...ports.details,seasons:[{season_number:1,episode_count:4}]});
  module.exports.writePublicMetadataCache('season','42:1',{season_number:1,episodes:[{episode_number:1,air_date:'2020-01-01'}]});
  ports.now+=3*3600_000;ports.offline=true;
  const fallback=await module.exports.tmdb.getSeasonDetails(42,1);
  assert.equal(fallback.ok,true,'la fiche garde son repli hors ligne');
  assert.equal(ports.writes.length,before,'aucune preuve fraîche créée à partir du cache saison périmé');
  assert.equal(ports.shows[0].seasonProgress['1'].episode_count,total,'pas de régression6→4 depuis un ancien résumé');
  assert.equal(ports.shows[0].seasonProgress['1'].total_evidence_version,4,'réparation automatique toujours due');
 }
});
