import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const modelSource = readFileSync(new URL('../tv-samsung/model.js', import.meta.url), 'utf8');
const deviceSource = readFileSync(new URL('../tv-samsung/tv.js', import.meta.url), 'utf8');
function model() {
  const context = vm.createContext({});
  vm.runInContext(modelSource, context);
  return context.TVModel;
}
function device(application: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const context = vm.createContext({ window: { tizen: { application, ...extra } }, navigator: {}, setTimeout: (fn: () => void) => fn() });
  vm.runInContext(deviceSource, context);
  return context.TVDevice;
}

test('SEENIT-TV-001 le vrai adapter regroupe les variantes Tizen4 sans perdre leurs IDs ni confondre Kids', () => {
  const nativeApps = JSON.parse(readFileSync(new URL('./fixtures/tv-samsung-tizen4-apps.json', import.meta.url), 'utf8'));
  const m = model();
  for (const input of [nativeApps, [...nativeApps].reverse()]) {
    let inventory: any;
    const d = device({ getAppsInfo(done: (apps: unknown[]) => void) { done(input); }, getCurrentApplication() { return { appInfo: { id: 'SeenItTV01.SeenItTV' } }; } });
    d.listApps((value: any) => { inventory = value; });
    assert.equal(inventory.length, nativeApps.length);
    const home = m.favorites(inventory, [], 5);
    assert.equal(home.filter((a: any) => a.title === 'Netflix').length, 1);
    assert.equal(home.find((a: any) => a.title === 'Netflix').id, 'RN1MCdNq8t.Netflix');
    assert.equal(m.userApps(inventory).length, 7);
    assert.equal(m.advancedApps(inventory).length, 6);
    assert.equal(inventory.find((a: any) => a.id === 'SeenItTV01.SeenItTV').launchable, false);
    assert.equal(m.brand('YouTube Kids'), null);
    assert.equal(m.brand('plex preview service'), null);
    assert.equal(m.favorites(inventory, ['org.tizen.netflix-app', 'RN1MCdNq8t.Netflix'], 5)[0].id, 'org.tizen.netflix-app');
    assert.equal(m.favorites(inventory, ['org.tizen.netflix-app'], 5).filter((a: any) => a.title === 'Netflix').length, 1);
  }
});

test('SEENIT-TV-001 le regroupement de tuiles est générique, stable et ne change pas la cible épinglée', () => {
  const m = model(), apps = [
    { id: 'built-in', title: ' Nouvelle   App ', classification: 'USER', launchable: true, iconPath: '/usr/apps/id/icon.png' },
    { id: 'installed', title: 'nouvelle app', classification: 'USER', launchable: true, iconPath: '/opt/usr/apps/id/icon.png' },
    { id: 'kids', title: 'Nouvelle App Kids', classification: 'USER', launchable: true },
  ];
  assert.deepEqual(Array.from(m.userApps(apps), (a: any) => a.id), ['installed', 'kids']);
  assert.deepEqual(Array.from(m.favorites(apps, ['built-in'], 5), (a: any) => a.id), ['built-in', 'kids']);
  assert.equal(m.favorites(apps, [], 5, ['installed']).some((a: any) => a.id === 'built-in'), false);
  assert.equal(m.favorites(apps, [], 5, ['built-in']).some((a: any) => a.id === 'installed'), false);
  assert.equal(m.favorites(apps, ['installed'], 5, ['built-in'])[0].id, 'installed');
});
test('SEENIT-TV-001 isole les favoris et réouvertures par profil sans persister Invité', () => {
  const m = model(), saved: Record<string, string> = {};
  const store = { getItem: (key: string) => saved[key], setItem: (key: string, value: string) => { saved[key] = value; } };
  const julian = m.preferences(store, 'Julian');
  julian.toggle('custom.app.id'); julian.opened('custom.app.id');
  assert.deepEqual(Array.from(m.preferences(store, 'Julian').pins()), ['custom.app.id']);
  assert.deepEqual(Array.from(m.preferences(store, 'Camille').recent()), []);
  const before = JSON.stringify(saved), guest = m.preferences(store, 'Invité');
  guest.toggle('another.app'); guest.opened('another.app');
  assert.equal(JSON.stringify(saved), before);
  assert.deepEqual(Array.from(m.preferences(store, 'Invité').pins()), []);
});
test('SEENIT-TV-001 borne les préférences, supporte storage refusé et filtre le stockage invalide', () => {
  const m = model(), p = m.preferences({ getItem() { return '{"pins":{},"recent":[null,1,"x","x"]}'; }, setItem() { throw Error('quota'); } }, 'Milo');
  assert.deepEqual(Array.from(p.recent()), ['x']);
  for (let i = 0; i < 50; i++) { p.toggle('id-' + i); p.opened('id-' + i); }
  assert.equal(p.pins().length, 32); assert.equal(p.recent().length, 8);
  assert.equal(p.toggle(''), false);
});
test('SEENIT-TV-001 toute nouvelle app est favorite par son ID sans table de lancement', () => {
  const m = model(), apps = Array.from({ length: 130 }, (_, i) => ({ id: 'id-' + i, title: 'App ' + i, classification: 'USER', launchable: true }));
  apps.push({ id: 'sys', title: 'Netflix', classification: 'SYSTEM', launchable: false });
  assert.equal(m.favorites(apps, ['id-129', 'sys', 'deleted'], 5)[0].id, 'id-129');
  assert.equal(m.favorites(apps, [], 5).length, 5);
  assert.equal(m.byIds(apps, ['sys']).length, 0);
  assert.equal(m.initials('Nouvelle Application'), 'NA');
});
test('SEENIT-TV-001 les logos refusent le réseau et gardent un secours générique', () => {
  const m = model();
  for (const path of ['https://remote/icon.png', '//remote/icon', 'javascript:x', 'data:image/svg+xml,x', 'file://remote/x']) assert.equal(m.localIcon(path), '');
  assert.equal(m.localIcon('/opt/usr/apps/app/shared/res/icon.png'), '/opt/usr/apps/app/shared/res/icon.png');
  assert.equal(m.localIcon('file:///opt/icon.png'), 'file:///opt/icon.png');
  assert.equal(m.brand('Netflix').file, 'netflix'); assert.equal(m.brand('Une nouvelle app'), null);
});
test('SEENIT-TV-001 inventorie 130 apps et conserve système et inconnu', () => {
  let result: any;
  const apps = Array.from({ length: 130 }, (_, i) => ({ id: 'id-' + i, name: 'Custom ' + i, show: true }));
  const d = device({ getAppsInfo(done: (apps: unknown[]) => void) { done([...apps, { id: 'hidden', name: 'Hidden', show: false }, { id: 'unknown' }]); } });
  d.listApps((value: any) => { result = value; });
  assert.equal(result.length, 132);
  assert.equal(result.find((a: any) => a.id === 'hidden').classification, 'SYSTEM');
  assert.equal(result.find((a: any) => a.id === 'unknown').classification, 'UNKNOWN');
});
test('SEENIT-TV-001 ne fabrique pas HDMI ou RAM quand une API Samsung manque', () => {
  const d = device({}); let sources: any = 'unset', memory: any = 'unset', storage: any = 'unset';
  d.getSources((v: any) => { sources = v; }); d.getMemoryInfo((v: any) => { memory = v; }); d.getStorageInfo((v: any) => { storage = v; });
  assert.equal(sources, null); assert.equal(memory, null); assert.equal(storage, null);
});
test('SEENIT-TV-001 TV ouvre le tuner détecté et ne reprend pas le dernier HDMI', () => {
  const calls: string[] = [];
  const d = device({ launch(id: string, done: () => void) { calls.push(id); done(); } }, {
    systeminfo: { getPropertyValue(_name: string, done: (v: unknown) => void) { done({ connected: [{ type: 'HDMI', number: 1 }, { type: 'TV', number: 0 }] }); } },
    tvwindow: { setSource(source: any, done: () => void) { calls.push(source.type); done(); } }
  });
  d.openLiveTv((ok: boolean) => assert.equal(ok, true));
  assert.deepEqual(calls, ['TV', 'org.tizen.tv-viewer']);
});
test('SEENIT-TV-001 les réglages utilisent un handler vérifié et refusent une cible absente', () => {
  let launched = '';
  const d = device({ findAppControl(_control: unknown, done: (v: any[]) => void) { done([{ id: 'verified.settings' }]); }, launchAppControl(_control: unknown, id: string, done: () => void) { launched = id; done(); } }, { ApplicationControl: function () {} });
  d.openSamsungSettings((ok: boolean) => assert.equal(ok, true)); assert.equal(launched, 'verified.settings');
  const absent = device({ getAppInfo() { throw Error('not installed'); }, launch() { assert.fail('No blind launch'); } });
  absent.openSamsungSettings((ok: boolean) => assert.equal(ok, false));
});
test('SEENIT-TV-001 quitter utilise uniquement exit et aucun kill des autres apps', () => {
  let exits = 0;
  const d = device({ getCurrentApplication() { return { exit() { exits++; } }; } });
  d.exitApp((ok: boolean) => assert.equal(ok, true)); assert.equal(exits, 1);
});
test('SEENIT-TV-001 conserve ordre, masquage et apparence localement sans réapparition automatique', () => {
  const m = model(), saved: Record<string, string> = {};
  const store = { getItem: (key: string) => saved[key], setItem: (key: string, value: string) => { saved[key] = value; } };
  const p = m.preferences(store, 'Julian');
  p.order(['n', 'p']); p.hideApp('n'); p.setTheme('mist'); p.toggleMotion();
  const reopened = m.preferences(store, 'Julian');
  assert.deepEqual(Array.from(reopened.pins()), ['p']); assert.equal(reopened.theme(), 'mist'); assert.equal(reopened.motion(), false);
  const apps = [{ id: 'n', title: 'Netflix', classification: 'USER', launchable: true }, { id: 'p', title: 'Plex', classification: 'USER', launchable: true }];
  assert.deepEqual(Array.from(m.favorites(apps, reopened.pins(), 5, reopened.hidden()), (a: any) => a.id), ['p']);
  reopened.toggle('n'); assert.deepEqual(Array.from(reopened.hidden()), []);
  assert.equal(m.preferences(store, 'Camille').theme(), 'dusk');
  const before = JSON.stringify(saved), guest = m.preferences(store, 'Invité'); guest.setTheme('auto'); guest.hideApp('n');
  assert.equal(JSON.stringify(saved), before);
});
