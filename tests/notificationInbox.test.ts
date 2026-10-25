import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
test('SEENIT-UX-018 reprend les notifications SeenIt livrées sans croiser les comptes et compte des IDs stables', async () => {
 const bundle=await build({entryPoints:['src/features/notifications/notificationInbox.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'inbox-native-ports',setup(b){
 b.onResolve({filter:/^@capacitor\/(?:core|push-notifications|local-notifications)$/},a=>({path:a.path,namespace:'native'}));
 b.onLoad({filter:/.*/,namespace:'native'},()=>({contents:`export const Capacitor={isNativePlatform:()=>true};export const PushNotifications={getDeliveredNotifications:async()=>({notifications:globalThis.__notifications})};export const LocalNotifications={getDeliveredNotifications:async()=>({notifications:[]})};`}));
 }}]});
 const module={exports:{} as {rememberNotification:Function;collectDeliveredNotifications:Function;formatNotificationEpisodeCodes:(value:string)=>string}};
 const values=new Map<string,string>();
 const context=vm.createContext({module,console,crypto:webcrypto,TextEncoder,localStorage:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)},__notifications:[{id:'1',title:'Film',body:'S1E2 disponible',data:{tmdbId:42,mediaType:'movie'}},{id:'2',title:'Autre compte',data:{ownerUid:'b',tmdbId:42,mediaType:'movie'}},{id:'3',title:'Autre film',data:{tmdbId:43,mediaType:'movie'}}]});
 vm.runInContext(bundle.outputFiles[0].text,context);
 const shows=[{id:'film',tmdbId:42,mediaType:'movie',userId:'a'}];
 await module.exports.collectDeliveredNotifications('a',()=> 'a',shows);
 await module.exports.collectDeliveredNotifications('a',()=> 'a',shows);
 const inbox=[...values.values()].map(value=>JSON.parse(value)).find(value=>Array.isArray(value)&&value[0]?.title==='Film');
 assert.equal(inbox.length,1);assert.equal(inbox[0].id,'1');
 assert.equal(module.exports.formatNotificationEpisodeCodes(inbox[0].body),'S01 | E02 disponible');
 const count=values.size;await module.exports.collectDeliveredNotifications('b',()=> 'c',shows);assert.equal(values.size,count);
 module.exports.rememberNotification(null,{id:'4',title:'Sans session'});assert.equal(values.size,count);
});
