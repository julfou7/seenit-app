import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Module sans effet de bord : charger tout le smoke dans le processus des tests perturbait d'autres tests.
const { chromeCandidates } = require('../scripts/find-chrome.cjs') as { chromeCandidates: (env: Record<string, string | undefined>, platform: string) => string[] };

// #1079 (audit du 16/11) : le smoke navigateur ne tournait qu'en CI (Chrome cherché en chemins Linux) ; trois cycles CI
// perdus le 16/11 pour des sélecteurs obsolètes qu'un passage local aurait montrés.
test('le smoke trouve Chrome ou Edge sous Windows et macOS, CHROME_BIN restant prioritaire', () => {
  const win = chromeCandidates({ PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'win32');
  assert.ok(win.some(path => /Program Files[\\/]Google[\\/]Chrome[\\/]Application[\\/]chrome\.exe$/.test(path)));
  assert.ok(win.some(path => /Microsoft[\\/]Edge[\\/]Application[\\/]msedge\.exe$/.test(path)), 'Edge (Chromium) en dernier recours');
  assert.ok(chromeCandidates({}, 'darwin').includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  assert.equal(chromeCandidates({ CHROME_BIN: '/opt/chrome' }, 'linux')[0], '/opt/chrome');
  assert.ok(!chromeCandidates({}, 'linux').some(path => path.endsWith('.exe')), 'CI Linux inchangée');
});

test('le smoke utilise cette recherche de Chrome', () => {
  assert.match(readFileSync('scripts/pwa-browser-smoke.cjs', 'utf8'), /const \{ chromeCandidates, findChrome \} = require\('\.\/find-chrome\.cjs'\);/);
});

test('la barre compacte reste stricte en CI et tolère la police système en local', () => {
  const checks = readFileSync('scripts/downloads-browser-checks.cjs', 'utf8');
  assert.match(checks, /const BAR_MAX_HEIGHT = process\.env\.CI \? 80 : 100;/);
  assert.match(checks, /getBoundingClientRect\(\)\.height<=\$\{BAR_MAX_HEIGHT\}/);
});
