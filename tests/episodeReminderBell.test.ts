import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Retour terrain du 08/11 (v1.4.279) : « Absence de cloche pour s'abonner sur un épisode à venir » (fiche
// épisode et lignes de la fiche série), « le texte sous le titre de l'épisode s'affiche en vue liste » et
// « vue liste, je descends, je remets la vue horizontale : j'ai un grand espace dessous ».
const read = (path: string) => readFileSync(path, 'utf8');

type Calls = { writes: Array<[string, unknown]>; deletes: string[]; updates: Array<[string, unknown]>; local: Array<[string, string, unknown]>; failSet: boolean; uid: string | null; switchOnPermission: boolean };
const calls: Calls = (globalThis as unknown as { __reminder: Calls }).__reminder = { writes: [], deletes: [], updates: [], local: [], failSet: false, uid: 'u1', switchOnPermission: false };

async function loadModule() {
  const stubs: Record<string, string> = {
    'firebase/firestore': `const c=()=>globalThis.__reminder;export const doc=(_db,...path)=>path.join('/');export const setDoc=async(ref,data)=>{if(c().failSet)throw new Error('refusé');c().writes.push([ref,data]);};export const deleteDoc=async ref=>{c().deletes.push(ref);};`,
    'lib/firebase': `const c=()=>globalThis.__reminder;export const db={};export const auth={get currentUser(){return c().uid?{uid:c().uid}:null}};export const requestNotificationPermission=async()=>{if(c().switchOnPermission)c().uid='u2';return 'fcm';};`,
    'lib/userIsolation': `const c=()=>globalThis.__reminder;export const readUserScopedJson=(_uid,_field,fallback)=>fallback;export const writeUserScopedJson=(uid,field,value)=>c().local.push(['set',uid+':'+field,value]);export const removeUserScopedValue=(uid,field)=>c().local.push(['remove',uid+':'+field,null]);`,
    'hooks/useShows': 'export const useShowActions=()=>({updateShow:async()=>{}});',
    'store/toastStore': 'export const useToastStore={getState:()=>({showToast(){}})};',
    'store/logStore': 'export const appLogger={warn(){}};',
  };
  const bundle = await build({ entryPoints: ['src/features/notifications/episodeReminder.ts'], bundle: true, platform: 'node', format: 'esm', write: false, external: ['react'],
    plugins: [{ name: 'reminder-ports', setup(builder) {
      builder.onResolve({ filter: /firebase\/firestore$|lib\/firebase$|lib\/userIsolation$|hooks\/useShows$|store\/toastStore$|store\/logStore$/ }, args => ({ path: Object.keys(stubs).find(key => args.path.endsWith(key))!, namespace: 'ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: stubs[args.path] }));
    } }] });
  const file = new URL(`./.episode-reminder-${process.pid}.mjs`, import.meta.url);
  const { writeFileSync, rmSync } = await import('node:fs');
  writeFileSync(file, bundle.outputFiles[0].text);
  try { return await import(file.href) as typeof import('../src/features/notifications/episodeReminder.ts'); }
  finally { rmSync(file, { force: true }); }
}

test('SEENIT-NOTIFICATION-009 cloche d’épisode à venir : même écriture que la carte À venir, retour arrière, jamais sous un autre compte', async () => {
  const { writeEpisodeReminder, reminderEpisodeString } = await loadModule();
  const show = { id: 's1', title: 'Harry Potter', notificationsEnabled: false } as never;
  const episode = { season_number: 1, episode_number: 3, name: '', air_date: '2027-01-12' };
  const updateShow = async (id: string, updates: unknown) => { calls.updates.push([id, updates]); };
  assert.equal(reminderEpisodeString(episode), 'S01E03');

  assert.equal(await writeEpisodeReminder({ target: show, ownerUid: 'u1', nextState: true, episode, updateShow }), true);
  assert.deepEqual(calls.updates, [['s1', { notificationsEnabled: true }]], 'rappels de la série activés');
  assert.equal(calls.writes[0][0], 'users/u1/reminders/s1_S01E03');
  assert.deepEqual({ ...(calls.writes[0][1] as Record<string, unknown>), createdAt: 0 }, { showId: 's1', showTitle: 'Harry Potter', episodeString: 'S01E03', seasonNumber: 1, episodeNumber: 3, episodeTitle: '', air_date: '2027-01-12', fcmToken: 'fcm', createdAt: 0 });
  assert.deepEqual(calls.local, [['set', 'u1:reminder_s1_S1E3', true]]);

  calls.updates.length = 0; calls.local.length = 0;
  assert.equal(await writeEpisodeReminder({ target: { ...show as object, notificationsEnabled: true } as never, ownerUid: 'u1', nextState: false, episode, updateShow }), true);
  assert.deepEqual(calls.deletes, ['users/u1/reminders/s1_S01E03']);
  assert.deepEqual(calls.local, [['remove', 'u1:reminder_s1_S1E3', null]]);

  calls.updates.length = 0; calls.failSet = true;
  await assert.rejects(writeEpisodeReminder({ target: show, ownerUid: 'u1', nextState: true, episode, updateShow }), /refusé/);
  assert.deepEqual(calls.updates, [['s1', { notificationsEnabled: true }], ['s1', { notificationsEnabled: false }]], 'préférence restaurée si l’écriture échoue');
  calls.failSet = false;

  calls.updates.length = 0; calls.writes.length = 0; calls.switchOnPermission = true;
  assert.equal(await writeEpisodeReminder({ target: show, ownerUid: 'u1', nextState: true, episode, updateShow }), false);
  assert.deepEqual([calls.updates, calls.writes], [[], []], 'changement de compte pendant la demande d’autorisation : rien n’est écrit');
});

test('SEENIT-NOTIFICATION-009 cloche câblée sur les épisodes à venir de la fiche série et de la fiche épisode', () => {
  const sections = read('src/screens/mediaDetail/seriesSections.tsx');
  assert.match(sections, /\{!aired && !inMode && <EpisodeReminderBell show=\{show\} episode=\{\{ season_number: number, episode_number: episode\.episode_number, name: episode\.name, air_date: episode\.air_date \}\} \/>\}/, 'ligne à venir, hors mode téléchargement');
  const modal = read('src/screens/EpisodeDetailModalCore.tsx');
  assert.match(modal, /\{isFutureEpisode \? \(activeShow\?\.id \? <EpisodeReminderBell variant="wide" show=\{activeShow\}/, 'fiche épisode à venir d’une série suivie');
  assert.match(modal, /Bientôt disponible<\/div>\)/, 'série non suivie : mention conservée');
  const card = read('src/components/cards/UpcomingShowCard.tsx');
  assert.match(card, /if \(await writeEpisodeReminder\(\{ target, ownerUid, nextState, episode: ep, updateShow \}\)\) setIsReminderSet\(nextState\);/, 'une seule écriture partagée');
  assert.doesNotMatch(card, /setDoc|deleteDoc/);
  const bell = read('src/components/EpisodeReminderBell.tsx');
  assert.match(bell, /if \(!available\) return null;/);
  assert.match(bell, /const press = \(event: React\.MouseEvent\) => \{ event\.stopPropagation\(\); void toggle\(\); \};/, 'la cloche n’ouvre pas l’épisode');
  assert.match(bell, /aria-pressed=\{reminder\}/);
  assert.match(bell, /'w-11 h-11 shrink-0 rounded-full/, 'cible tactile de 44 px');
});

test('SEENIT-UX-014 carte en pause sans ligne sous le titre ; retour en vue horizontale sans marge ajoutée', () => {
  assert.match(read('src/components/cards/SeriesEpisodeCard.tsx'), /const staleDetail = pause \? null : visibleDetail && \/pas vu\|délaissé\/i\.test\(visibleDetail\) \? visibleDetail : null;/, 'le badge de l’affiche suffit, dans toutes les vues');
  assert.match(read('src/hooks/useCardLayoutAnchor.ts'), /const deficit = anchor\.list \? Math\.max\(0, desired \+ viewport - scroller\.scrollHeight\) : 0;/, 'marge seulement au passage en liste');
});
