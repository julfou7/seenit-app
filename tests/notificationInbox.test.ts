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
 const context=vm.createContext({module,console,crypto:webcrypto,TextEncoder,localStorage:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)},__notifications:[{id:'1',title:'Film',body:'S1E2 disponible',data:{ownerUid:'a',tmdbId:42,mediaType:'movie'}},{id:'2',title:'Autre compte',data:{ownerUid:'b',tmdbId:42,mediaType:'movie'}},{id:'3',title:'Autre film',data:{ownerUid:'a',tmdbId:43,mediaType:'movie'}},{id:'legacy',title:'Même film sans propriétaire',data:{showId:'autre-document',tmdbId:42,mediaType:'movie'}}]});
 vm.runInContext(bundle.outputFiles[0].text,context);
 const shows=[{id:'film',tmdbId:42,mediaType:'movie',userId:'a'}];
 await module.exports.collectDeliveredNotifications('a',()=> 'a',shows);
 await module.exports.collectDeliveredNotifications('a',()=> 'a',shows);
 const inbox=[...values.values()].map(value=>JSON.parse(value)).find(value=>Array.isArray(value)&&value[0]?.title==='Film');
 assert.equal(inbox.length,1);assert.equal(inbox[0].id,'1');
 assert.equal(inbox.some((item: {id:string})=>item.id==='legacy'),false,'le même TMDB dans B ne peut jamais attribuer une ancienne alerte sans propriétaire');
 assert.equal(module.exports.formatNotificationEpisodeCodes(inbox[0].body),'S01 | E02 disponible');
 const count=values.size;await module.exports.collectDeliveredNotifications('b',()=> 'c',shows);assert.equal(values.size,count);
 module.exports.rememberNotification(null,{id:'4',title:'Sans session'});assert.equal(values.size,count);
});


test('SEENIT-NOTIFICATION-003 le producteur natif marque le propriétaire et refuse un changement de session en attente', async () => {
 const bundle=await build({entryPoints:['src/features/notifications/mediaReminderNotification.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'native-reminder-owner',setup(b){
  b.onResolve({filter:/^@capacitor\/(?:core|local-notifications)$|\/(?:firebase|clientOperationalDiagnostics)(?:\.ts)?$/},a=>({path:a.path,namespace:'ports'}));
  b.onLoad({filter:/.*/,namespace:'ports'},()=>({contents:`
    export const auth=globalThis.__auth;
    export const Capacitor={isNativePlatform:()=>true};
    export const LocalNotifications={checkPermissions:async()=>{if(globalThis.__hold)await new Promise(resolve=>globalThis.__release=resolve);return{display:'granted'};},registerActionTypes:async()=>{},schedule:async(value)=>globalThis.__scheduled.push(value)};
    export const generateNotificationNumericId=()=>42;export const sendNativeNotification=async()=>{};export const recordClientOperationalSignal=()=>{};
  `}));
 }}]});
 const auth={currentUser:{uid:'a'}}, scheduled:Array<{notifications:Array<{extra:{ownerUid?:string}}>}> = [];
 const module={exports:{} as {sendMediaReminderNotification:(title:string,options:{summaryText:string;tmdbId:number})=>Promise<boolean>}};
 const context=vm.createContext({module,__auth:auth,__scheduled:scheduled,__hold:false,console});
 vm.runInContext(bundle.outputFiles[0].text,context);
 assert.equal(await module.exports.sendMediaReminderNotification('Titre',{summaryText:'Épisode',tmdbId:42}),true);
 assert.equal(scheduled[0].notifications[0].extra.ownerUid,'a');
 context.__hold=true;
 const pending=module.exports.sendMediaReminderNotification('Titre',{summaryText:'Épisode',tmdbId:42});
 auth.currentUser.uid='b';
 context.__release();
 assert.equal(await pending,false);assert.equal(scheduled.length,1,'aucune notification du compte A programmée après le passage à B');
});
