import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('#778 le vrai sendNativeNotification ne transfère pas une actualité après changement de compte pendant le cache image', async () => {
  const bundle = await build({ entryPoints: ['src/lib/firebase.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'native-news-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.importer.replaceAll('\\', '/').endsWith('/src/lib/firebase.ts')
        ? { path: args.path, namespace: 'ports' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, () => ({ contents: `
        export default {};
        export const auth = globalThis.__auth;
        export const initializeApp=()=>({}), getAuth=()=>auth, initializeFirestore=()=>({});
        export const persistentLocalCache=()=>({}), persistentSingleTabManager=()=>({}), persistentMultipleTabManager=()=>({});
        export class GoogleAuthProvider { setCustomParameters(){} }
        export const isSupported=async()=>false, getMessaging=()=>({}), getToken=async()=>null, deleteToken=async()=>{};
        export const Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android'};
        export const LocalNotifications={}, PushNotifications={};
        export const appLogger={warn:()=>{},error:()=>{}},useLogStore={getState:()=>({addLog:()=>{}})};
        export const resolveSeenItApiUrl=()=>'',queueAppUpdateAvailablePush=()=>{},notificationCapabilitiesForPlatform=()=>({});
        export const PLEX_BACKGROUND_CAPABILITY_CHANGED_EVENT='plex',syncNativePlexBackgroundCredentials=async()=>{};
        export const ensureSeenItServiceWorkerRegistration=async()=>{}, ensureSeenItNotificationChannels=async()=>{}, rememberNotification=()=>{};
        export const resolveNotificationMediaVisual=async()=>{globalThis.__resolving=true;return globalThis.__media;};
        export const sendMediaReminderNotification=async(title,options)=>{globalThis.__sent.push({title,...options});return true;};
      ` }));
    } }] });
  let finish!: (value: unknown) => void;
  const media = new Promise(resolve => { finish = resolve; });
  const auth = { currentUser: { uid: 'alice' } };
  const sent: Array<{ title: string; showId: string }> = [];
  const module = { exports: {} as { sendNativeNotification(title: string, options: object): Promise<void> } };
  const context = vm.createContext({ module, __auth: auth, __media: media, __sent: sent, setTimeout: () => 0, console });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const pending = module.exports.sendNativeNotification('Série privée', { showId: 'alice-tv', tag: 'news' });
  for (let i = 0; i < 20 && !context.__resolving; i++) await Promise.resolve();
  assert.equal(context.__resolving, true);
  auth.currentUser.uid = 'bob';
  finish({ icon: 'seenit-data://notification-media/a.img' });
  await pending;
  assert.equal(sent.length, 0);
  await module.exports.sendNativeNotification('Série Bob', { showId: 'bob-tv', tag: 'news' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].showId, 'bob-tv');
});

test('#778 l’action plateforme réutilise le transport Android de la fiche au lieu du navigateur intégré', () => {
  const source = readFileSync('src/App.tsx', 'utf8');
  const action = source.slice(source.indexOf("data.type === 'QUICK_ACTION_OPEN_PROVIDER'"), source.indexOf("data.type === 'QUICK_ACTION_REMIND_TONIGHT'"));
  assert.match(action, /openExternalUrl\(target.url/);
  assert.doesNotMatch(action, /Browser\.open/);
});
