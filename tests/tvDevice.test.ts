import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../tv-samsung/tv.js', import.meta.url), 'utf8');
test('SEENIT-TV-001 HDMI transmet le descripteur natif et conserve son numéro exact', () => {
  const native = { type: 'HDMI', number: 3 };
  const seen: unknown[] = [], launches: string[] = [];
  const sandbox = { window: { tizen: {
    application: { launch: (id: string, ok: () => void) => { launches.push(id); ok(); } },
    systeminfo: { getPropertyValue: (_: string, ok: (value: unknown) => void) => ok({ connected: [native], disconnected: [] }) },
    tvwindow: { setSource: (input: unknown, ok: () => void) => { assert.equal(input, native); seen.push(input); ok(); } },
  } }, navigator: {}, setTimeout };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  const device = vm.runInContext('TVDevice', context);
  let success = false;
  device.openSource('HDMI', 3, (ok: boolean) => { success = ok; });
  assert.equal(success, true);
  assert.deepEqual(seen, [native]);
  assert.deepEqual(launches, ['org.tizen.tv-viewer']);
  device.openSource('HDMI', 7, (ok: boolean) => assert.equal(ok, false));
  assert.equal(seen.length, 1);
});

test('SEENIT-TV-001 ne lance pas le menu interne connu pour capturer la télécommande sans écran', () => {
  const context = vm.createContext({ window: { tizen: { application: {
    getAppInfo: () => ({ id: 'org.tizen.menu' }),
    launch: () => assert.fail('Le menu interne ne doit pas être un repli aveugle'),
  } } }, navigator: {}, setTimeout });
  vm.runInContext(source, context);
  context.TVDevice.openSamsungSettings((ok: boolean) => assert.equal(ok, false));
});
