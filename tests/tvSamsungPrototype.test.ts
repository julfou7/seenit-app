import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const config = readFileSync(new URL('../tv-samsung/config.xml', import.meta.url), 'utf8');
const html = readFileSync(new URL('../tv-samsung/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../tv-samsung/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../tv-samsung/app.js', import.meta.url), 'utf8');
const device = readFileSync(new URL('../tv-samsung/tv.js', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../docs/specifications/tv-samsung-prototype.md', import.meta.url), 'utf8');

function assertEs5(source, name) {
  const forbidden = [
    { pattern: /\bconst\b/, label: 'const' },
    { pattern: /\blet\b/, label: 'let' },
    { pattern: /=>/, label: 'arrow function' },
    { pattern: /\bclass\s+\w+/, label: 'class' },
    { pattern: /\basync\b/, label: 'async' },
    { pattern: /\bawait\b/, label: 'await' },
    { pattern: /\?\./, label: 'optional chaining' },
    { pattern: /\?\?/, label: 'nullish coalescing' },
    { pattern: /`/, label: 'template literal' },
  ];
  for (const item of forbidden) {
    assert.equal(item.pattern.test(source), false, `${name} must stay ES5: ${item.label}`);
  }
}

test('SEENIT-TV-POC-001 garde le widget compatible Tizen 3 et sans runtime lourd', () => {
  assert.match(config, /required_version="3\.0"/);
  const packageMatch = config.match(/<tizen:application[^>]*\bpackage="([A-Za-z0-9]{10})"/);
  assert.ok(packageMatch, 'Tizen package id must contain exactly 10 alphanumeric characters');
  assert.match(config, new RegExp(`id="${packageMatch[1]}\\.SeenItTV"`));
  assert.match(config, /application\.launch/);
  assert.match(config, /tv\.inputdevice/);
  assert.match(config, /tv\.window/);
  assertEs5(app, 'app.js');
  assertEs5(device, 'tv.js');
  assert.doesNotMatch(html, /react|babel|iframe/i);
  assert.doesNotMatch(css, /display\s*:\s*grid|backdrop-filter|filter\s*:\s*blur/i);
});

test('SEENIT-TV-POC-001 conserve TV tuner, apps directes et Sport provider-agnostic', () => {
  assert.match(html, /Antenne · TNT en direct/);
  assert.match(html, /MES APPS/);
  assert.match(html, /AS Monaco — Lille/);
  assert.match(app, /favoriteNames/);
  assert.match(device, /tizen\.application\.getAppsInfo/);
  assert.match(device, /tizen\.application\.launch/);
  assert.match(device, /org\.tizen\.tv-viewer/);
  assert.match(spec, /TV` signifie tuner\/antenne TNT/);
  assert.match(spec, /agnostique du diffuseur/);
  assert.doesNotMatch(app, /Ligue 1\s*=\s*['"](?:DAZN|CANAL)/i);
});

test('SEENIT-TV-POC-001 ne mute aucune donnée SeenIt avant appairage foyer', () => {
  assert.match(spec, /aucune mutation SeenIt/i);
  assert.doesNotMatch(app + device, /markEpisodeWatched|firebase|firestore|\/api\//i);
});
