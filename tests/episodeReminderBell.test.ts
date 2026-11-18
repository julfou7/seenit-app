import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Retour terrain du 08/11 (v1.4.279) : « Absence de cloche pour s'abonner sur un épisode à venir » (fiche
// épisode et lignes de la fiche série), « le texte sous le titre de l'épisode s'affiche en vue liste » et
// « vue liste, je descends, je remets la vue horizontale : j'ai un grand espace dessous ».
const read = (path: string) => readFileSync(path, 'utf8');

type Calls = { writes: Array<[string, unknown]>; deletes: string[]; updates: Array<[string, unknown]>; local: Array<[string, string, unknown]>; failSet: boolean; failDelete?: boolean; uid: string | null; switchOnPermission: boolean; prefs?: Record<string, boolean>; flags?: Record<string, boolean>; stored?: string[] };
const calls: Calls = (globalThis as unknown as { __reminder: Calls }).__reminder = { writes: [], deletes: [], updates: [], local: [], failSet: false, uid: 'u1', switchOnPermission: false };

async function loadModule() {
  const stubs: Record<string, string> = {
    'firebase/firestore': `const c=()=>globalThis.__reminder;export const doc=(_db,...path)=>path.join('/');export const setDoc=async(ref,data)=>{if(c().failSet)throw new Error('refusé');c().writes.push([ref,data]);};export const deleteDoc=async ref=>{if(c().failDelete)throw new Error('refusé');c().deletes.push(ref);};export const collection=(_db,...path)=>path.join('/');export const where=(field,op,value)=>({field,op,value});export const query=(col,clause)=>({col,clause});export const getDocs=async q=>({docs:(c().stored||[]).filter(id=>id.startsWith(q.clause.value+'_')).map(id=>({id,ref:q.col+'/'+id}))});`,
    'lib/firebase': `const c=()=>globalThis.__reminder;export const db={};export const auth={get currentUser(){return c().uid?{uid:c().uid}:null}};export const requestNotificationPermission=async()=>{if(c().switchOnPermission)c().uid='u2';return 'fcm';};`,
    'lib/userIsolation': `const c=()=>globalThis.__reminder;export const readUserScopedJson=(_uid,field,fallback)=>field==='notifications'&&c().prefs?c().prefs:(c().flags&&field in c().flags?c().flags[field]:fallback);export const removeUserScopedPrefix=(uid,prefix)=>c().local.push(['prefix',uid+':'+prefix,null]);export const writeUserScopedJson=(uid,field,value)=>c().local.push(['set',uid+':'+field,value]);export const removeUserScopedValue=(uid,field)=>c().local.push(['remove',uid+':'+field,null]);`,
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
  Object.assign(calls, { uid: 'u1', switchOnPermission: false, failSet: false, failDelete: false, updates: [], writes: [], deletes: [], local: [] });
  assert.equal(reminderEpisodeString(episode), 'S01E03');
  // Retour terrain du 18/11 (« une cloche = cet épisode seul ») : la série n'est plus modifiée.
  assert.equal(await writeEpisodeReminder({ target: show, ownerUid: 'u1', nextState: true, episode }), true);
  assert.equal(calls.writes[0][0], 'users/u1/reminders/s1_S01E03');
  assert.deepEqual({ ...(calls.writes[0][1] as Record<string, unknown>), createdAt: 0 }, { showId: 's1', showTitle: 'Harry Potter', episodeString: 'S01E03', seasonNumber: 1, episodeNumber: 3, episodeTitle: '', air_date: '2027-01-12', fcmToken: 'fcm', createdAt: 0 });
  assert.deepEqual(calls.local, [['set', 'u1:reminder_s1_S1E3', true]]);
  calls.local.length = 0;
  assert.equal(await writeEpisodeReminder({ target: show, ownerUid: 'u1', nextState: false, episode }), true);
  assert.deepEqual(calls.deletes, ['users/u1/reminders/s1_S01E03'], 'couper ne supprime que le rappel de cet épisode');
  assert.deepEqual(calls.local, [['set', 'u1:reminder_s1_S1E3', false]], 'choix « coupé » gardé pour cet épisode');
  // Écriture refusée : aucun choix local n'est posé.
  calls.local.length = 0; calls.failSet = true;
  await assert.rejects(writeEpisodeReminder({ target: show, ownerUid: 'u1', nextState: true, episode }), /refusé/);
  assert.deepEqual(calls.local, [], 'rien de local si le serveur refuse');
  calls.failSet = false;
  calls.writes.length = 0; calls.switchOnPermission = true;
  assert.equal(await writeEpisodeReminder({ target: show, ownerUid: 'u1', nextState: true, episode }), false);
  assert.deepEqual([calls.updates, calls.writes], [[], []], 'changement de compte pendant la demande d’autorisation : rien n’est écrit');
  calls.switchOnPermission = false; calls.uid = 'u1';
});

test('SEENIT-NOTIFICATION-009 la cloche suit la préférence de la série après le clic d’une autre cloche (revue Codex #917)', async () => {
  const { displayedEpisodeReminder } = await loadModule();
  const episodeA = { season_number: 1, episode_number: 4 };
  const before = { id: 's1', notificationsEnabled: true } as never;
  // A désactivé : le clic couvre l'attente de la relecture de la fiche…
  const storedA = { value: false, basis: before };
  assert.equal(displayedEpisodeReminder(storedA, before, episodeA), false);
  // … la fiche relue (préférence coupée) reprend la main…
  const afterA = { id: 's1', notificationsEnabled: false } as never;
  assert.equal(displayedEpisodeReminder(storedA, afterA, episodeA), false);
  // … puis B active la préférence de la série : A s'affiche activé, son prochain clic le désactive.
  const afterB = { id: 's1', notificationsEnabled: true } as never;
  assert.equal(displayedEpisodeReminder(storedA, afterB, episodeA), true);
  assert.equal(displayedEpisodeReminder(null, afterB, episodeA), true);
  assert.match(read('src/features/notifications/episodeReminder.ts'), /setStored\(\{ value: nextState, basis \}\)/);
});

test('SEENIT-NOTIFICATION-009 cloche câblée sur les épisodes à venir de la fiche série et de la fiche épisode', () => {
  const sections = read('src/screens/mediaDetail/seriesSections.tsx');
  assert.match(sections, /\{!aired && !inMode && <EpisodeReminderBell show=\{show\} episode=\{\{ season_number: number, episode_number: episode\.episode_number, name: episode\.name, air_date: episode\.air_date \}\} \/>\}/, 'ligne à venir, hors mode téléchargement');
  const modal = read('src/screens/EpisodeDetailModalCore.tsx');
  // Retour terrain du 09/11 : dans l'en-tête de la fiche épisode, ronde, à côté de la croix.
  assert.match(modal, /\{isFutureEpisode && activeShow\?\.id && <EpisodeReminderBell variant="overlay" show=\{activeShow\}/, 'fiche épisode à venir d’une série suivie');
  assert.ok(modal.indexOf('<EpisodeReminderBell variant="overlay"') < modal.indexOf('aria-label="Fermer"', modal.indexOf('<EpisodeReminderBell variant="overlay"')), 'juste avant la croix');
  assert.match(modal, /\{!activeShow\?\.id && <div className="min-h-11[^"]*"><Clock size=\{16\} className="text-zinc-500" \/>Bientôt disponible<\/div>\}/, 'série non suivie : mention conservée');
  const card = read('src/components/cards/UpcomingShowCard.tsx');
  assert.match(card, /if \(await writeEpisodeReminder\(\{ target, ownerUid, nextState, episode: ep, updateShow \}\)\) setIsReminderSet\(nextState\);/, 'une seule écriture partagée, sans toast tardif');
  assert.match(card, /useState<boolean>\(\(\) => readEpisodeReminder\(show, ep\)\)/, 'même état réel que les autres cloches');
  assert.doesNotMatch(card, /setDoc|deleteDoc/);
  const bell = read('src/components/EpisodeReminderBell.tsx');
  assert.match(bell, /if \(!available\) return null;/);
  assert.match(bell, /const press = \(event: React\.MouseEvent\) => \{ event\.stopPropagation\(\); void toggle\(\); \};/, 'la cloche n’ouvre pas l’épisode');
  assert.match(bell, /aria-pressed=\{reminder\}/);
  assert.match(bell, /icon \? 'w-12 h-12' : reminder \? 'w-11 h-11 /, 'cible tactile de 48 px dans la liste, 44 px sur la fiche épisode');
});

test('SEENIT-UX-014 carte en pause sans ligne sous le titre ; retour en vue horizontale sans marge ajoutée', () => {
  assert.match(read('src/components/cards/SeriesEpisodeCard.tsx'), /const staleDetail = pause \? null : visibleDetail && \/pas vu\|délaissé\/i\.test\(visibleDetail\) \? visibleDetail : null;/, 'le badge de l’affiche suffit, dans toutes les vues');
  assert.match(read('src/hooks/useCardLayoutAnchor.ts'), /const deficit = anchor\.list \? Math\.max\(0, desired \+ viewport - scroller\.scrollHeight\) : 0;/, 'marge seulement au passage en liste');
});

// Décision du 09/11 (#910) remplacée le 18/11 : « une cloche = cet épisode seul ». Sans choix posé sur l'épisode, la règle
// de la série s'applique (choix explicite, sinon « Sortie du jour » pour une série suivie).
test('SEENIT-NOTIFICATION-009 la cloche agit sur son seul épisode et montre les rappels réellement planifiés', async () => {
  const { seriesRemindersActive, readEpisodeReminder } = await loadModule();
  const episode = { season_number: 2, episode_number: 9 };
  Object.assign(calls, { uid: 'u1', switchOnPermission: false, failSet: false, prefs: undefined, flags: undefined });
  assert.equal(seriesRemindersActive({ id: 's1', mediaType: 'tv' } as never), true);
  assert.equal(readEpisodeReminder({ id: 's1', mediaType: 'tv' } as never, episode), true, 'série suivie prévenue par défaut');
  assert.equal(seriesRemindersActive({ id: 's1', mediaType: 'tv', notificationsEnabled: false } as never), false, 'série coupée');
  assert.equal(seriesRemindersActive({ id: 's1', mediaType: 'tv', isArchived: true } as never), false, 'série archivée');
  assert.equal(seriesRemindersActive({ id: 's1', mediaType: 'tv', status: 'dropped' } as never), false, 'série abandonnée');
  assert.equal(seriesRemindersActive({ id: '', mediaType: 'tv' } as never), false, 'série non suivie (fiche acteur)');
  calls.prefs = { release_today_tv: false };
  assert.equal(seriesRemindersActive({ id: 's1', mediaType: 'tv' } as never), false, '« Sortie du jour » coupée : pas de rappel par défaut');
  assert.equal(seriesRemindersActive({ id: 's1', mediaType: 'tv', notificationsEnabled: true } as never), true);
  calls.prefs = undefined;
  const notifier = read('src/hooks/useRemindersNotifier.ts');
  assert.match(notifier, /if \(userPrefs\.release_today_tv \|\| isSpecificReminder \|\| s\.notificationsEnabled === true\) \{/, 'un épisode allumé est prévenu même sans « Sortie du jour »');
  assert.match(read('src/components/EpisodeReminderBell.tsx'), /const label = `\$\{reminder \? 'Couper' : 'Activer'\} le rappel de \$\{code\}`;/, 'le nom accessible dit que la cloche agit sur cet épisode');
});

// Retour terrain du 18/11 (« si je coupe E05 ça me coupe tout » ; « je mets E08 en cloche et tous les autres, avant et
// après, passent avec la cloche ») : chaque cloche n'agit que sur son épisode, dans un sens comme dans l'autre.
test('SEENIT-NOTIFICATION-009 une cloche n’allume ni ne coupe les autres épisodes de la série', async () => {
  const { readEpisodeReminder, writeEpisodeReminder } = await loadModule();
  Object.assign(calls, { uid: 'u1', switchOnPermission: false, failSet: false, failDelete: false, prefs: { release_today_tv: false }, flags: { reminder_s1_S2E8: true }, writes: [], deletes: [], local: [] });
  const show = { id: 's1', title: 'Dexter', mediaType: 'tv' } as never;
  assert.equal(readEpisodeReminder(show, { season_number: 2, episode_number: 8 }), true, 'E08 allumée');
  assert.equal(readEpisodeReminder(show, { season_number: 2, episode_number: 7 }), false, 'E07 avant : reste éteinte');
  assert.equal(readEpisodeReminder(show, { season_number: 2, episode_number: 9 }), false, 'E09 après : reste éteinte');
  calls.prefs = undefined; calls.flags = { reminder_s1_S2E5: false };
  assert.equal(readEpisodeReminder(show, { season_number: 2, episode_number: 5 }), false, 'E05 coupée malgré « Sortie du jour »');
  assert.equal(readEpisodeReminder(show, { season_number: 2, episode_number: 6 }), true, 'E06 garde la règle de la série');
  await writeEpisodeReminder({ target: show, ownerUid: 'u1', nextState: false, episode: { season_number: 2, episode_number: 5 } });
  assert.deepEqual(calls.deletes, ['users/u1/reminders/s1_S02E05'], 'aucun autre rappel supprimé');
  assert.deepEqual(calls.updates, [], 'la série n’est pas modifiée');
  const notifier = read('src/hooks/useRemindersNotifier.ts');
  assert.match(notifier, /const episodeChoice = readUserScopedJson<boolean \| null>\(uid, `reminder_\$\{s\.id\}_S\$\{upcoming\.season_number\}E\$\{upcoming\.episode_number\}`, null\);/);
  assert.match(notifier, /if \(episodeChoice === false \|\| \(!isSpecificReminder && !isShowNotification && s\.notificationsEnabled === false\)\) \{/);
  Object.assign(calls, { prefs: undefined, flags: undefined });
});

// Un film n'a pas d'épisode : sa cloche (fiche acteur, carte À venir) reste le réglage du film, restauré en cas d'échec.
test('SEENIT-NOTIFICATION-009 la cloche d’un film reste le réglage du film', async () => {
  const { writeEpisodeReminder } = await loadModule();
  Object.assign(calls, { uid: 'u1', switchOnPermission: false, failSet: false, failDelete: false, updates: [], writes: [], deletes: [], local: [] });
  const updateShow = async (id: string, updates: unknown) => { calls.updates.push([id, updates]); };
  const film = { id: 'm1', title: 'Film', mediaType: 'movie' } as never;
  assert.equal(await writeEpisodeReminder({ target: film, ownerUid: 'u1', nextState: true, episode: { season_number: 0, episode_number: 0 }, updateShow }), true);
  assert.deepEqual(calls.updates, [['m1', { notificationsEnabled: true }]]);
  calls.updates.length = 0; calls.failSet = true;
  await assert.rejects(writeEpisodeReminder({ target: film, ownerUid: 'u1', nextState: true, episode: { season_number: 0, episode_number: 0 }, updateShow }));
  assert.deepEqual(calls.updates, [['m1', { notificationsEnabled: true }], ['m1', { notificationsEnabled: undefined }]], 'réglage du film restauré');
  calls.failSet = false;
  await writeEpisodeReminder({ target: { id: 's1', title: 'Série', mediaType: 'tv' } as never, ownerUid: 'u1', nextState: true, episode: { season_number: 1, episode_number: 2 }, updateShow });
  assert.equal(calls.updates.length, 2, 'une série n’est jamais modifiée par une cloche d’épisode');
});

// Revue Codex #1099 : couper une cloche relance la planification locale (alarme de l'appareil annulée).
test('SEENIT-NOTIFICATION-009 une bascule de cloche relance la planification des notifications', () => {
  const reminder = read('src/features/notifications/episodeReminder.ts');
  assert.match(reminder, /writeUserScopedJson\(ownerUid, reminderStorageField\(target\.id, episode\), nextState\);\n  if \(typeof window !== 'undefined'\) window\.dispatchEvent\(new Event\(EPISODE_REMINDER_CHANGED_EVENT\)\);/);
  const notifier = read('src/hooks/useRemindersNotifier.ts');
  assert.match(notifier, /window\.addEventListener\(EPISODE_REMINDER_CHANGED_EVENT, bump\);/);
  assert.match(notifier, /\}, \[shows, showToast, reminderRevision\]\);/);
  // Revue Codex #1099 : les cloches déjà affichées (liste, carte À venir) se relisent à chaque bascule faite ailleurs.
  assert.match(reminder, /const sync = \(\) => setStored\(null\);\n    window\.addEventListener\(EPISODE_REMINDER_CHANGED_EVENT, sync\);/);
  assert.match(read('src/components/cards/UpcomingShowCard.tsx'), /const sync = \(\) => setIsReminderSet\(readEpisodeReminder\(show, ep\)\);\n    window\.addEventListener\(EPISODE_REMINDER_CHANGED_EVENT, sync\);/);
});

// Revue Codex #1099 : la page Notifications lit aussi la cloche de l'épisode annoncé, et se rafraîchit à chaque bascule.
test('SEENIT-NOTIFICATION-009 la page Notifications suit la cloche de l’épisode', () => {
  const page = read('src/components/HomeNotifications.tsx');
  assert.match(page, /const reminderOn = upcoming && show\.mediaType === 'tv' \? readEpisodeChoice\(show, upcoming, uid\) \?\? show\.notificationsEnabled === true : show\.notificationsEnabled === true;/);
  assert.match(page, /if \(upcoming && reminderOn && upcoming\.air_date === today && !alreadyReceived\)/);
  assert.match(page, /window\.addEventListener\(EPISODE_REMINDER_CHANGED_EVENT, bump\);/);
});
