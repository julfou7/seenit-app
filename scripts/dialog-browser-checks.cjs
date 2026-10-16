const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function buildDialogHarness(root) {
  const dist = path.join(root, 'dist');
  await esbuild.build({
    entryPoints: [path.join(root, 'tests/fixtures/dialogLayer.issue181.tsx')],
    outfile: path.join(dist, '__seenit-dialogs.js'), bundle: true, platform: 'browser',
    format: 'iife', target: ['chrome120'], logLevel: 'silent',
  });
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-dialogs.html'), `<!doctype html><html lang="fr"><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    ${css.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('')}
    <style>body{background:#08080c;color:white}button{min-height:44px;padding:8px 12px;border:1px solid #777;border-radius:8px}input{color:white;border:1px solid #777}main{padding:24px}</style>
    </head><body><div id="root"></div><script src="/__seenit-dialogs.js"></script></body></html>`);
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Erreur harness dialogue');
  return response.result?.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(client, expression, message) {
  if (!await evaluate(client, `Boolean(${expression})`)) throw new Error(`#181 : ${message}`);
}
async function click(client, id) {
  await evaluate(client, `document.getElementById(${JSON.stringify(id)}).focus(); document.getElementById(${JSON.stringify(id)}).click()`);
  await delay(80);
}
async function key(client, name, shift = false) {
  const code = name === 'Tab' ? 9 : 27;
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
  await delay(80);
}

async function testDialogHarness(client, root) {
  const reports = [];
  for (const viewport of [
    { id: '360', width: 360, height: 800 }, { id: '412', width: 412, height: 915 },
    { id: 'landscape', width: 740, height: 360 }, { id: 'keyboard-large-text', width: 360, height: 330, largeText: true },
  ]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: true });
    await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-dialogs.html' });
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(client, 'Boolean(document.getElementById("open-sheet"))')) break;
      await delay(100);
    }
    if (viewport.largeText) await evaluate(client, 'document.documentElement.style.fontSize="32px"');
    const originalHistory = await evaluate(client, 'navigation.currentEntry.index');
    await click(client, 'open-sheet');
    await check(client, `Number(getComputedStyle(document.getElementById("bottom-nav")).zIndex) > Number(getComputedStyle(document.getElementById("sheet")).zIndex)`, 'la fiche média non bloquante reste sous la navigation basse');
    await check(client, `!document.getElementById("bottom-nav").inert`, 'la navigation basse reste interactive sur la fiche média');
    await evaluate(client, `document.getElementById("sheet").focus()`);
    await check(client, `getComputedStyle(document.getElementById("sheet")).outlineStyle === "none"`, 'la surface média focalisée n’affiche aucun cadre UA plein écran');
    await click(client, 'open-dialog');
    await check(client, `Number(getComputedStyle(document.getElementById("parent-dialog")).zIndex) > Number(getComputedStyle(document.getElementById("bottom-nav")).zIndex)`, 'un vrai dialogue bloquant passe au-dessus de la navigation basse');
    await check(client, 'navigation.currentEntry.index === ' + (originalHistory + 2), 'StrictMode ajoute une seule entrée par niveau');
    await check(client, 'document.getElementById("root").inert && document.activeElement.id === "parent-close"', 'focus initial et fond inerte');
    await evaluate(client, 'document.getElementById("replace").focus()');
    await key(client, 'Tab');
    await check(client, 'document.activeElement.id === "parent-close"', 'Tab revient au premier contrôle');
    await key(client, 'Tab', true);
    await check(client, 'document.activeElement.id === "replace"', 'Maj+Tab revient au dernier contrôle');
    await click(client, 'open-child');
    await check(client, 'document.activeElement.id === "keep" && document.querySelectorAll("[data-dialog-blocking=true]").length === 2', 'confirmation imbriquée focalise Garder');
    await evaluate(client, 'document.getElementById("background").focus()');
    await check(client, 'document.activeElement.id === "keep"', 'le fond ne peut recevoir le focus');
    const bounds = await evaluate(client, `(() => {
      const panel = document.getElementById('keep').closest('section');
      const r = panel.getBoundingClientRect();
      const action = document.getElementById('keep').getBoundingClientRect();
      return { top:r.top, bottom:r.bottom, height:visualViewport.height, actionTop:action.top, actionBottom:action.bottom };
    })()`);
    if (bounds.top < -1 || bounds.bottom > bounds.height + 1) throw new Error(`#181 : panneau hors viewport ${JSON.stringify(bounds)}`);
    if (bounds.actionTop < bounds.top - 1 || bounds.actionBottom > bounds.bottom + 1) throw new Error(`#181 : focus initial hors zone visible ${JSON.stringify(bounds)}`);
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(root, 'quality-reports', `dialogs-${viewport.id}.png`), Buffer.from(screenshot.data, 'base64'));
    await evaluate(client, 'window.__dialogBack(); window.__dialogBack()');
    await delay(120);
    await check(client, 'document.querySelectorAll("[data-dialog-blocking=true]").length === 1 && document.activeElement.id === "open-child" && document.getElementById("sheet")', 'retour répété ferme un seul niveau et restitue le focus');
    await evaluate(client, 'history.back()');
    await delay(120);
    await check(client, '!document.querySelector("[data-dialog-blocking=true]") && document.activeElement.id === "open-dialog" && !document.getElementById("root").inert', 'Retour navigateur ferme le dialogue et garde la fiche');
    await evaluate(client, 'window.__dialogBack()'); await delay(120);
    await check(client, 'document.getElementById("location").textContent === "sous-vue"', 'retour fiche vers onglet sans saut');
    await evaluate(client, 'window.__dialogBack()'); await delay(80);
    await check(client, 'document.getElementById("location").textContent === "profile"', 'retour ferme uniquement la sous-vue');
    await evaluate(client, 'window.__dialogBack()'); await delay(80);
    await check(client, 'document.getElementById("location").textContent === "watchlist"', 'retour racine vers accueil');
    await click(client, 'open-sheet'); await click(client, 'open-dialog');
    await click(client, 'lock'); await click(client, 'open-child');
    await key(client, 'Escape');
    await check(client, 'document.querySelectorAll("[data-dialog-blocking=true]").length === 2', 'mise à jour en cours conserve son dialogue');
    await evaluate(client, 'history.back()'); await delay(120);
    await check(client, 'document.querySelectorAll("[data-dialog-blocking=true]").length === 2', 'retour navigateur respecte le verrou de mise à jour');
    await click(client, 'unlock'); await key(client, 'Escape');
    await check(client, 'document.querySelectorAll("[data-dialog-blocking=true]").length === 1', 'Échap ferme un seul niveau après déverrouillage');
    await key(client, 'Escape');
    await check(client, '!document.querySelector("[data-dialog-blocking=true]") && !document.getElementById("root").inert', 'le dernier dialogue libère le fond');
    await click(client, 'open-dialog');
    const beforeReplacement = await evaluate(client, 'navigation.currentEntry.index');
    await click(client, 'replace');
    await check(client, 'navigation.currentEntry.index === ' + beforeReplacement, 'un remplacement réutilise le niveau local au lieu de laisser une entrée fantôme');
    await key(client, 'Escape');
    await check(client, '!document.querySelector("[data-dialog-blocking=true]")', 'le remplacement se ferme sans dialogue fantôme');
    await click(client, 'open-external'); await click(client, 'external-child');
    await evaluate(client, 'window.__dialogBack()'); await delay(120);
    await check(client, 'document.querySelectorAll("[data-dialog-blocking=true]").length === 1 && history.state.isPersonDetailModal && document.activeElement.id === "external-child"', 'un enfant local préserve la fiche historique et ses flags');
    await key(client, 'Escape');
    await check(client, '!document.querySelector("[data-dialog-blocking=true]") && document.getElementById("sheet")', 'la fiche historique se ferme par son propriétaire et préserve la fiche média');
    await evaluate(client, 'window.__dialogBack()'); await delay(120);
    await click(client, 'open-origin-person'); await click(client, 'person-open-media');
    await check(client, 'document.getElementById("origin-person").inert && !document.getElementById("sheet").inert', 'la nouvelle fiche média passe devant la personne d’origine');
    await evaluate(client, 'window.__dialogBack()'); await delay(120);
    await check(client, '!document.getElementById("sheet") && !document.getElementById("origin-person").inert && document.activeElement.id === "person-open-media"', 'Retour restaure la personne et son focus');
    await key(client, 'Escape');
    await check(client, '!document.querySelector("[data-dialog-blocking=true]")', 'la personne d’origine se ferme sans quitter l’onglet');
    reports.push({ viewport: viewport.id, status: 'pass', bounds });
  }
  return reports;
}
module.exports = { buildDialogHarness, testDialogHarness };
