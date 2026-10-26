import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (name: string) => readFileSync(new URL('../tv-samsung/' + name, import.meta.url), 'utf8');
const html = read('index.html'), css = read('styles.css'), app = read('app.js'), model = read('model.js'), device = read('tv.js'), config = read('config.xml');
test('SEENIT-TV-001 garde ES5, identité Samsung et absence de runtime lourd', () => {
  for (const [name, source] of Object.entries({ app, model, device })) {
    assert.doesNotMatch(source, /\b(?:const|let|async|await)\b|=>|\?\.|\?\?|\bclass\s+\w+|\x60/, name);
    new vm.Script(source, { filename: name });
  }
  assert.match(config, /version="0\.2\.2"/);
  assert.match(config, /id="SeenItTV01.SeenItTV" package="SeenItTV01" required_version="3\.0"/);
  assert.doesNotMatch(html, /react|babel|iframe/i);
  assert.doesNotMatch(css, /display\s*:\s*grid|backdrop-filter|filter\s*:\s*blur|animation\s*:/i);
});
test('SEENIT-TV-001 suit les quatre cartes, cinq apps et les sources détectées', () => {
  assert.equal((html.match(/class="primary-card /g) || []).length, 4);
  assert.match(html, /id="primaryTv".*data-action="live-tv"/);
  assert.match(html, /Antenne · TNT en direct/);
  assert.match(html, /id="homeSources"/);
  assert.doesNotMatch(html, /heroCard|shortcut-matrix|data-source="HDMI/);
  assert.match(app, /favorites = profileApps\(5\)/);
  assert.match(app, /setFocus\(el\('primaryTv'\)\)/);
  assert.match(css, /scale\(1\.04\)/);
});
test('SEENIT-TV-001 borne la bibliothèque et ne simule pas des données personnelles', () => {
  assert.match(app, /var APPS_PER_PAGE = 18/);
  assert.match(app, /start = appsPage \* APPS_PER_PAGE/);
  assert.match(app, /Math.min\(list.length, start \+ APPS_PER_PAGE\)/);
  assert.match(html, /data-tab="system"/);
  assert.match(app, /preview \? demoEvents : \[\]/);
  assert.doesNotMatch(app + model + device, /markEpisodeWatched|firestore|firebase|fetch\(|XMLHttpRequest|\/api\//i);
});
test('SEENIT-TV-001 suspend horloge, télémétrie et images en arrière-plan', () => {
  assert.match(app, /setInterval\(refreshMemory, 15000\)/);
  assert.match(app, /setInterval\(refreshStorage, 60000\)/);
  assert.match(app, /clearInterval\(clockTimer\)/);
  assert.match(app, /removeAttribute\('src'\)/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /document.hidden === true/);
  assert.doesNotMatch(device, /\.kill\(|sdb|root\s+/);
});
test('SEENIT-TV-001 lie le harnais TV à la validation navigateur canonique', () => {
  const smoke = readFileSync(new URL('../scripts/pwa-browser-smoke.cjs', import.meta.url), 'utf8');
  assert.match(smoke, /buildTvHarness\(root\)/);
  assert.match(smoke, /testTvHarness\(client, root\)/);
  assert.match(read('build.py'), /'model.js'/);
  assert.match(read('build.py'), /os.walk\(os.path.join\(ROOT, 'assets'\)\)/);
});
