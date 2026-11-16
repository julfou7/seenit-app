#!/usr/bin/env node
/**
 * #1065 — Construit (sans navigateur) les harnais du smoke PWA. Un harnais remplace des modules de production par
 * des fixtures (`tests/fixtures/*Runtime.ts`) : quand un module gagne un import que la fixture n'exporte pas, le
 * bundle échoue. Cette erreur n'apparaissait qu'en CI (couloir 3), après un cycle complet ; `validate:change` la
 * rend locale et immédiate. Il faut le build Web (`dist/assets`) pour les feuilles de style des harnais.
 */
const path = require('node:path');
const { buildDownloadsHarness } = require('./downloads-browser-checks.cjs');
const { buildDialogHarness } = require('./dialog-browser-checks.cjs');
const { buildProviderHarness } = require('./provider-browser-checks.cjs');
const { buildSeriesCardHarness } = require('./series-card-browser-checks.cjs');
const { buildHistoryHarness } = require('./history-browser-checks.cjs');
const { buildWatchNextHarness } = require('./watch-next-browser-checks.cjs');
const { buildNavbarHarness } = require('./navbar-browser-checks.cjs');
const { buildSearchKeyboardHarness } = require('./search-keyboard-browser-checks.cjs');
const { buildHomeHarness } = require('./home-a-voir-browser-checks.cjs');
const { buildMediaDetailHarness } = require('./media-detail-browser-checks.cjs');

const HARNESSES = [
  ['Dialogues', buildDialogHarness], ['Plateformes', buildProviderHarness], ['Carte série', buildSeriesCardHarness],
  ['Historique', buildHistoryHarness], ['À voir ensuite', buildWatchNextHarness], ['Navigation', buildNavbarHarness],
  ['Recherche clavier', buildSearchKeyboardHarness], ['Accueil', buildHomeHarness], ['Fiche média', buildMediaDetailHarness],
  ['Téléchargements', buildDownloadsHarness],
];

async function buildAllBrowserHarnesses(root) {
  for (const [label, build] of HARNESSES) {
    try { await build(root); }
    catch (error) {
      const detail = error && Array.isArray(error.errors) && error.errors.length
        ? error.errors.map(entry => `${entry.text}${entry.location ? ` (${entry.location.file}:${entry.location.line})` : ''}`).join('\n  ')
        : String(error && error.message || error);
      throw new Error(`Harnais « ${label} » non constructible :\n  ${detail}`);
    }
  }
}

if (require.main === module) {
  buildAllBrowserHarnesses(path.resolve(__dirname, '..')).then(
    () => console.log(`[Harnais navigateur] ✅ ${HARNESSES.length} harnais construits.`),
    error => { console.error(`[Harnais navigateur] ❌ ${error.message}`); process.exit(1); },
  );
}

module.exports = { HARNESSES, buildAllBrowserHarnesses };
