const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
async function buildHistoryHarness(root) {
  const dist = path.join(root, 'dist');
  const ports = path.join(root, 'tests/fixtures/history16dRuntime.ts');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/history16d.tsx')], outfile: path.join(dist, '__seenit-history.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent',
    plugins: [{ name: 'history-ports', setup(builder) {
      builder.onResolve({ filter: /\/(?:useShows|firebase|tmdb|plexLinks|plexAvailability)$/ }, () => ({ path: ports }));
    } }],
  });
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-history.html'), `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('')}<link rel="stylesheet" href="/__seenit-history.css"><style>body{background:#08080c;color:white;margin:0}</style></head><body><div id="root"></div><script src="/__seenit-history.js"></script></body></html>`);
  fs.writeFileSync(path.join(dist, '__history-provider.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><rect width="26" height="26" rx="6" fill="#111"/><text x="13" y="20" fill="#e50914" text-anchor="middle" font-size="22" font-weight="bold">N</text></svg>');
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Erreur historique');
  return result.result?.value;
}
// Pendant l'attente, une exception (élément pas encore rendu) vaut « pas encore » : seul le délai fait échouer.
const poll = (client, expression) => evaluate(client, expression).catch(() => false);
async function check(client, expression, label) {
  for (let index = 0; index < 50; index++) { if (await poll(client,`Boolean(${expression})`)) return; await delay(50); }
  throw new Error(`#708 ${label}: ${JSON.stringify(await evaluate(client, '({telemetry:window.__history16d,text:document.body.innerText})'))}`);
}
async function testHistoryHarness(client, root) {
  const reports = [];
  for (const width of [360, 412, 1280]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height: 915, deviceScaleFactor: 1, mobile: width < 640 });
    await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-history.html' });
    await check(client, 'document.querySelectorAll("[data-history-row]").length===4 && document.body.innerText.includes("Confessions")', 'chronologie et métadonnées montées');
    await check(client, 'document.querySelectorAll(".history-entry-list").length>=1 && !document.querySelector(".history-16d__group-title,.series-8f__segments") && document.querySelectorAll(".history-entry__text time").length===2 && !document.querySelector(".history-entry--today .history-entry__text time") && document.querySelector(".history-entry__image").getBoundingClientRect().width===64 && document.querySelector(".history-entry__image").getBoundingClientRect().height===96', 'liste v3 unique, vignette 64×96 et dates hors cartes du jour, sans groupes ni progression');
    await check(client, '!document.body.innerText.includes("E09") && !document.body.innerText.includes("00:00") && document.documentElement.scrollWidth===innerWidth', 'pas de record orphelin, heure inventée ou débordement');
    const open = 'document.querySelector("[data-history-row] .history-entry__open")';
    await evaluate(client, `${open}.click()`);
    await check(client, 'window.__history16d.episodeOpens[0]==="tv:5x14" && window.__history16d.writes.length===0', 'tap épisode exact sans mutation');
    const hold = await evaluate(client, `(()=>{const r=${open}.getBoundingClientRect();return{x:r.x+125,y:r.y+r.height/2}})()`);
    await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...hold,button:'left',clickCount:1});
    await delay(520);
    await check(client,'document.querySelector("[role=dialog]")', 'appui long sur la ligne compacte');
    await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...hold,button:'left',clickCount:1});
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await check(client,'!document.querySelector("[role=dialog]") && window.__history16d.episodeOpens.length===1', 'relâcher l’appui long n’ouvre pas l’épisode');
    await evaluate(client, `${open}.focus(); ${open}.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}))`);
    await check(client, 'document.querySelector("[role=dialog]")', 'actions accessibles au clavier');
    await evaluate(client, '[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent==="Revoir").click()');
    await check(client, 'window.__history16d.playback[0]?.startsWith("https://www.netflix.com/search") && window.__history16d.providerRequests===0 && window.__history16d.writes.length===0', 'Revoir utilise le diffuseur résolu sans nouvelle requête');
    await evaluate(client, `${open}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    await evaluate(client, '[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent==="Changer la date/heure").click()');
    await check(client, 'document.querySelector("input[type=date]")', 'éditeur ouvert');
    await evaluate(client, `(()=>{const el=document.querySelector('input[type=time]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(client, '[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent==="Enregistrer").click()');
    await check(client, 'window.__history16d.writes.length===1 && window.__history16d.writes[0].updates.episodeRecords["5x14"].watchedTimeKnown===false && window.__history16d.writes[0].updates.episodeRecords["5x14"].rating===9', 'édition préserve les métadonnées et l’heure inconnue');
    await evaluate(client, 'document.getElementById("history-undo").click()');
    await check(client, 'window.__history16d.writes.length===2 && [...document.querySelectorAll(".history-entry__open")].filter(el=>el.getAttribute("aria-label").includes(" à ")).length===2', 'Annuler restaure date et heure');
    await evaluate(client, `${open}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    await evaluate(client, '[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent==="Marquer non vu").click()');
    await check(client, 'document.querySelector("[role=alertdialog]") && window.__history16d.writes.length===2', 'confirmation avant retrait');
    await evaluate(client, '[...document.querySelectorAll("[role=alertdialog] button")].find(button=>button.textContent==="Oui, marquer non vu").click()');
    await check(client, 'window.__history16d.writes.length===3 && document.querySelectorAll("[data-history-row]").length===3 && window.__history16d.writes[2].updates.seenEpisodes.length===1', 'retrait de la clé legacy exacte');
    await evaluate(client, 'document.getElementById("history-undo").click()');
    await check(client, 'document.querySelectorAll("[data-history-row]").length===4 && window.__history16d.writes.length===4', 'Annuler restaure le visionnage');
    await evaluate(client, 'document.querySelectorAll("[data-history-row] .history-entry__open")[1].click()');
    await check(client, 'window.__history16d.movieOpens[0]==="movie:movie"', 'tap film exact');
    await evaluate(client, 'window.scrollTo(0,0)');
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(root, 'quality-reports', `history-16d-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    await evaluate(client, 'window.__legacyDay=window.__history16d.makeLegacy()');
    await check(client, '[...document.querySelectorAll(".history-entry__open")].filter(el=>el.getAttribute("aria-label").includes(" à ")).length===1', 'les épisodes recordless gardent leur heure inconnue');
    const legacyOpen = `document.querySelector(${JSON.stringify('.history-entry__open[aria-label*="épisode 14"]')})`;
    await evaluate(client, `${legacyOpen}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    await evaluate(client, '[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent==="Changer la date/heure").click()');
    await check(client, 'document.querySelector("input[type=date]")', 'éditeur legacy');
    await evaluate(client, `(()=>{const el=document.querySelector('input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'2026-10-25');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(client, '[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent==="Enregistrer").click()');
    await check(client, 'window.__history16d.writes.at(-1).updates.episodeRecords["5x13"].watchedAt===window.__legacyDay && window.__history16d.writes.at(-1).updates.episodeRecords["5x13"].watchedTimeKnown===false', 'éditer un legacy préserve le jour de son voisin');
    await evaluate(client, 'document.getElementById("history-undo").click()');
    await check(client, 'Object.keys(window.__history16d.writes.at(-1).updates.episodeRecords).length===0', 'Annuler restaure les records legacy originaux');
    await evaluate(client, `${legacyOpen}.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    await evaluate(client, '[...document.querySelectorAll("[role=dialog] button")].find(button=>button.textContent==="Marquer non vu").click()');
    await check(client, 'document.querySelector("[role=alertdialog]")', 'confirmation legacy');
    await evaluate(client, '[...document.querySelectorAll("[role=alertdialog] button")].find(button=>button.textContent==="Oui, marquer non vu").click()');
    await check(client, 'window.__history16d.writes.at(-1).updates.episodeRecords["5x13"].watchedAt===window.__legacyDay && window.__history16d.writes.at(-1).updates.lastWatchedAt===window.__legacyDay', 'retirer un legacy ne déplace pas son voisin à aujourd’hui');
    await evaluate(client,'window.__history16d.grouped()');
    await check(client,'!document.querySelector(".history-entry__group") && document.querySelectorAll("[data-history-row]").length===5 && document.querySelector(".history-entry__text strong").textContent==="S05 | E13"', 'trois épisodes consécutifs gardent trois lignes individuelles');
    await evaluate(client,'window.__episodeBefore=window.__history16d.episodeOpens.length;document.querySelector(".history-entry__open").click()');
    await check(client,'window.__history16d.episodeOpens.length===window.__episodeBefore+1 && window.__history16d.episodeOpens.at(-1)==="tv:5x13"', 'la ligne ouvre son épisode exact');
    await evaluate(client,'document.querySelector(".history-entry__action-column button").click()');
    await check(client,'!document.querySelector(".history-entry__action-group") && [...document.querySelectorAll("[role=dialog] button")].some(b=>b.textContent==="Marquer non vu")','actions individuelles sans groupe');
    await evaluate(client,'[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent==="Marquer non vu").click()');
    await check(client,'document.querySelector("[role=alertdialog]")','retrait individuel confirmé depuis un groupe');
    await evaluate(client,'[...document.querySelectorAll("[role=alertdialog] button")].find(button=>button.textContent==="Oui, marquer non vu").click()');
    await check(client,'window.__history16d.writes.at(-1).updates.seenEpisodes.length===2 && window.__history16d.writes.at(-1).updates.episodeRecords["5x12"].rating===9','retirer E11 préserve les autres épisodes et leurs notes');
    await evaluate(client,'window.__history16d.bulk()');
    await check(client,'!document.querySelector(".history-entry__group") && document.querySelectorAll("[data-history-row]").length===10 && document.querySelector(".history-entry__text strong").textContent==="S01 | E12"','saison marquée en une fois : dix lignes initiales avec tri stable');
    await evaluate(client,'document.querySelector(".home-load-more").click()');
    await check(client,'document.querySelectorAll("[data-history-row]").length===13 && !document.querySelector(".history-entry__group")','douze épisodes et film tous présents après pagination');
    reports.push({ width, status: 'pass', productionComponent: 'HistoryFeed', dateUndo: true, unseenUndo: true });
  }
  return reports;
}
module.exports = { buildHistoryHarness, testHistoryHarness };
