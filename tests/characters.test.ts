import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type Request, type RequestHandler } from 'express';
import { buildCharacters, characterId, characterProgress, type CharacterMedia } from '../src/features/discover/characters.ts';
import { registerCharacterRoutes, CHARACTER_CACHE_TTL, CHARACTER_UPSTREAM_CONCURRENCY } from '../src/features/providers/characterBackend.ts';
import type { Show } from '../src/types.ts';

test('SEENIT-DISCOVER-004 identité par univers, alias explicites et interprètes prouvés', () => {
 const work: CharacterMedia = { key:'tv:1396',id:1396,type:'tv',title:'Breaking Bad',poster:null,universeId:'breaking-bad-universe',universe:'Breaking Bad',seasons:[],
  cast:[{id:1,name:'Bob',photo:null,roles:[{name:'Saul Goodman',count:43}]}] };
 const records=buildCharacters([work,{...work,key:'tv:60059',id:60059,title:'Better Call Saul',cast:[{id:1,name:'Bob',photo:null,roles:[{name:'Jimmy McGill / Gene Takavic',count:63}]}]}, {...work,key:'tv:99',id:99,universeId:'other',universe:'Autre série'}]);
 assert.equal(records.length,2);
 const saul=records.find(record=>record.id===characterId('breaking-bad-universe','Saul Goodman'))!;
 assert.equal(saul.works.length,2);
 assert.deepEqual(saul.actors.map(actor=>actor.name),['Bob']);
 assert.ok(saul.aliases.includes('Jimmy McGill'));
 assert.notEqual(saul.id, records.find(record=>record.universeId==='other')!.id);
 const twoActors=buildCharacters([work,{...work,key:'movie:8',id:8,type:'movie',cast:[{id:2,name:'Autre interprète',photo:'/actor.png',roles:[{name:'Saul Goodman',count:1}]}]}]);
 assert.equal(twoActors[0].actors.length,2);
 assert.equal(characterProgress(saul,[]).complete,false,'un count aggregate ne devient pas une preuve de visionnage');
});

test('SEENIT-DISCOVER-004 route production : crédits exacts, co-crédits et cache public sans vus privés', async t => {
 const app=express();
 const calls:string[]=[]; let active=0,maxActive=0;
 let clock=Date.parse('2026-10-29T10:00:00Z'),failEpisode=false;
 const actor=(id:number,name:string,character:string)=>({id,name,character,profile_path:'/actor.jpg'});
 const cast=(character:string,count:number)=>[{id:1,name:'Bob',profile_path:'/bob.jpg',roles:[{character,episode_count:count}]},{id:8,name:'Kim',roles:[{character:'Kim Wexler',episode_count:2}]}];
 const authenticate:RequestHandler=(req,res,next)=>{
  if(!req.headers.authorization){res.status(401).end();return;}
  (req as Request & {user:{uid:string}}).user={uid:req.headers.authorization};next();
 };
 registerCharacterRoutes(app,{authenticate,now:()=>clock,secrets:()=>({TMDB_API_KEY:'secret-character-key'}),fetch:async input=>{
  const url=new URL(String(input)), path=url.pathname;
  calls.push(path);active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setTimeout(resolve,2));active--;
  let payload:Record<string,unknown>;
  if(path==='/3/tv/1396') payload={id:1396,name:'Breaking Bad',poster_path:'/bb.jpg',seasons:[{season_number:1,episode_count:2}],aggregate_credits:{cast:cast('Saul Goodman',1)}};
  else if(path==='/3/tv/60059')payload={id:60059,name:'Better Call Saul',seasons:[{season_number:1,episode_count:2}],aggregate_credits:{cast:cast('Jimmy McGill',2)}};
  else if(path==='/3/movie/559969')payload={id:559969,title:'El Camino',credits:{cast:[]}};
  else if(/\/season\/1$/.test(path))payload={episodes:[{episode_number:1,air_date:'2020-01-01'},{episode_number:2,air_date:'2020-01-08'}]};
  else if(/\/episode\/[12]$/.test(path)){
   if(failEpisode && path.includes('1396') && path.endsWith('/2')) return new Response('temporary failure',{status:503});
   const seenSaul=path.includes('60059')||path.endsWith('/2');
   payload={name:'Épisode',air_date:path.endsWith('/1')?'2020-01-01':'2020-01-08',credits:{cast:seenSaul?[actor(1,'Bob',path.includes('60059')?'Jimmy McGill':'Saul Goodman'),actor(2,'Bryan','Walter White')]:[actor(1,'Bob','Un autre rôle'),actor(2,'Bryan','Walter White')]},guest_stars:[actor(2,'Bryan','Walter White')]};
  }else throw Error('Unexpected provider path '+path);
  return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
 }});
 const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const base='http://127.0.0.1:'+address.port;
 const request=(path:string,user='user-a')=>fetch(base+path,{headers:{Authorization:user}});
 assert.equal((await fetch(base+'/api/media/characters?ids=tv:1396&q=saul')).status,401);
 assert.equal((await request('/api/media/characters?ids=http://evil&q=saul')).status,400);
 assert.equal((await request('/api/media/characters?ids='+Array.from({length:17},(_,i)=>'tv:'+(i+1)).join(',')+'&q=saul')).status,400);
 const index=await (await request('/api/media/characters?ids=tv:1396&q=saul')).json();
 assert.equal(index.results.length,1);
 assert.equal(index.results[0].works.length,2,'le manifeste apporte Better Call Saul sans rapprocher les noms approximativement');
 assert.equal(index.results[0].seed,'tv:1396');
 assert.ok(!JSON.stringify(index).includes('secret-character-key'));
 const before=calls.length;
 await request('/api/media/characters?ids=tv:1396&q=jimmy','user-b');
 assert.equal(calls.length,before,'le cache public de casting est partagé entre UID');
 const detail=await (await request('/api/media/characters/detail?seed=tv:1396&name=Saul%20Goodman')).json();
 const character=detail.character;
 assert.equal(character.complete,true);
 assert.deepEqual(character.works.find((work:{id:number})=>work.id===1396).episodes.map((episode:{key:string})=>episode.key),['1x2']);
 const shows=[{tmdbId:1396,mediaType:'tv',seenEpisodes:['1x1']},{tmdbId:60059,mediaType:'tv',seenEpisodes:['1x1']}] as Show[];
 assert.deepEqual(characterProgress(character,shows),{seen:1,total:3,complete:true,from:'2020',to:'2020'});
 assert.equal(character.neighbors[0].name,'Walter White');
 assert.equal(character.neighbors[0].count,3,'un guest/cast répété ne compte qu’une fois par épisode');
 assert.ok(!character.neighbors.some((neighbor:{name:string})=>neighbor.name==='Kim Wexler'),'la simple présence au casting de la série ne prouve aucun co-crédit');
 const after=calls.length;
 const detailB=await (await request('/api/media/characters/detail?seed=tv:1396&name=Saul%20Goodman','user-b')).json();
 assert.equal(calls.length,after,'les preuves détaillées sont réutilisées');
 assert.equal(characterProgress(detailB.character,[]).seen,0,'les vus ne sont jamais mis dans le cache public');
 assert.ok(maxActive<=CHARACTER_UPSTREAM_CONCURRENCY);
 clock+=CHARACTER_CACHE_TTL+1;failEpisode=true;
 const incomplete=await (await request('/api/media/characters/detail?seed=tv:1396&name=Saul%20Goodman')).json();
 assert.equal(incomplete.character.complete,false,'une preuve manquante ne devient jamais un total exact');
 assert.equal(characterProgress(incomplete.character,shows).complete,false);
 assert.ok(calls.length>after,'le cache expiré est réellement renouvelé');
});


test('SEENIT-DISCOVER-004 collection de films : unité, ordre et vus privés cohérents', () => {
 const film: CharacterMedia = {key:'movie:10',id:10,type:'movie',title:'Premier film',poster:null,universeId:'collection:42',universe:'Collection',releaseDate:'2020-01-01',seasons:[],cast:[{id:1,name:'Interprète',photo:null,roles:[{name:'Paul Atréides',count:1}]}]};
 const character=buildCharacters([{...film,key:'movie:20',id:20,title:'Second film',releaseDate:'2024-01-01'},film])[0];
 assert.deepEqual(character.works.map(work=>work.id),[10,20]);
 assert.ok(character.works.every(work=>work.type==='movie'));
 assert.deepEqual(characterProgress(character,[{tmdbId:10,mediaType:'movie',status:'completed',seenEpisodes:[]}] as unknown as Show[]),{seen:1,total:2,complete:true,from:'2020',to:'2024'});
 assert.equal(characterProgress(buildCharacters([{...film,coverageComplete:false}])[0],[]).complete,false,'un casting tronqué reste partiel');
});
