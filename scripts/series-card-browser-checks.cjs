const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function buildSeriesCardHarness(root) {
  const dist = path.join(root, 'dist');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/seriesCard8f.tsx')], outfile: path.join(dist, '__seenit-series-8f.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent' });
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-series-8f.html'), `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('')}<link rel="stylesheet" href="/__seenit-series-8f.css"><style>body{background:#08080c;color:white;margin:0}</style></head><body><div id="root"></div><script src="/__seenit-series-8f.js"></script></body></html>`);
  fs.writeFileSync(path.join(dist, '__8f-poster.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="172" height="258"><defs><linearGradient id="a" x2=".8" y2="1"><stop stop-color="#b91c1c"/><stop offset="1" stop-color="#09091b"/></linearGradient></defs><rect width="172" height="258" fill="url(#a)"/><circle cx="86" cy="95" r="46" fill="#ffb347" opacity=".3"/><text x="86" y="178" text-anchor="middle" font-family="serif" font-weight="bold" font-size="24" fill="#fca5a5">STRANGER</text><text x="86" y="204" text-anchor="middle" font-family="serif" font-weight="bold" font-size="24" fill="#fca5a5">THINGS</text></svg>');
  fs.writeFileSync(path.join(dist, '__8f-backdrop.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="280"><rect width="500" height="280" fill="#300d26"/><circle cx="350" cy="70" r="90" fill="#7b232e"/><path d="M90 280L300 40L420 280" fill="#101027"/></svg>');
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Erreur fixture 8f');
  return response.result?.value;
}
async function check(client, expression, message) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await delay(50);
  }
  const state = await evaluate(client, '({telemetry:window.__series8f,focus:document.activeElement?.outerHTML.slice(0,250),dialogs:document.querySelectorAll("[role=dialog]").length})');
  throw new Error(`#690 : ${message} ${JSON.stringify(state)}`);
}
async function click(client, selector) {
  const point = await evaluate(client, `(() => {const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await delay(50);
}
async function escape(client) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await delay(100);
}
async function testSeriesCardHarness(client, root) {
  const reports = [];
  for (const width of [360, 412, 1280]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height: 915, deviceScaleFactor: 1, mobile: width < 640 });
    await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-series-8f.html' });
    await check(client, 'document.querySelectorAll("[data-series-card]").length===9', 'les trois contextes et leurs cas limites sont montés');
    const geometry = await evaluate(client, `(() => {
      const card=document.querySelector('#watch article'), poster=card.querySelector('.series-8f__poster'), title=document.querySelector('#long h3');
      const targets=[...document.querySelectorAll('article button')].map(el=>({label:el.getAttribute('aria-label'),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
      return {height:card.getBoundingClientRect().height, width:card.getBoundingClientRect().width, posterTop:poster.getBoundingClientRect().top-card.getBoundingClientRect().top, clamp:getComputedStyle(title).webkitLineClamp, titleHeight:title.getBoundingClientRect().height, targets, overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    if (geometry.height !== 180 || geometry.posterTop >= 0 || geometry.clamp !== '2' || geometry.overflow || geometry.targets.some(target => target.width < 44 || target.height < 44)) throw new Error(`#690 : géométrie/cibles ${JSON.stringify(geometry)}`);
    await check(client, 'document.querySelectorAll("#season-24 .series-8f__segment").length===24 && document.querySelectorAll("#season-40 .series-8f__segment").length<=6', 'les saisons longues gardent un DOM borné');
    await check(client, 'document.querySelectorAll("#unknown .series-8f__segment").length===4 && document.querySelector("#unknown .series-8f__unknown-tail") && document.querySelector("#unknown .series-8f__unknown-mark")?.textContent==="?" && document.querySelector("#unknown .series-8f__segments")?.getAttribute("aria-label").includes("total encore inconnu") && document.querySelector("#unknown .series-8f__provider")', 'Harry Potter garde les épisodes connus, la traîne inconnue, le point d’interrogation et le diffuseur');
    await check(client, '!document.querySelector("#long .series-8f__poster img") && document.querySelector("#upcoming-31 .series-8f__poster img")?.getAttribute("src").includes("__8f-backdrop.svg") && document.querySelector("#season-40 .series-8f__poster img")?.getAttribute("src").includes("__8f-backdrop.svg") && !document.querySelector("#season-24 .series-8f__check")', 'un poster absent ou cassé réutilise le visuel connu avant les initiales, sans fausse action');
    await check(client, '["watch","upcoming-0","upcoming-5","upcoming-31","history","season-24"].every(id=>document.querySelector(`#${id} article`).style.getPropertyValue("--series-hue") !== "260")', 'les cartes partageant une affiche réutilisent sa teinte sans second calcul');
    await click(client, '#watch .series-8f__check');
    await click(client, '#watch .series-8f__check');
    await check(client, 'window.__series8f.marks===1 && window.__series8f.opens===0 && document.querySelector("#watch .series-8f__code").textContent.includes("E05")', 'une coche avance une fois sans ouvrir la fiche');
    await click(client, '#upcoming-0 .series-8f__days');
    await check(client, 'window.__series8f.reminders===1 && window.__series8f.opens===0 && document.querySelector("#upcoming-0 button.series-8f__days").getAttribute("aria-pressed")==="true"', 'le rappel reste indépendant de l’ouverture');
    await check(client, 'document.querySelector("#upcoming-0 .series-8f__days--today") && document.querySelector("#upcoming-5 .series-8f__days--soon") && document.querySelector("#upcoming-31 .series-8f__days--later")', 'les trois urgences ont leur présentation');
    await click(client, '#history .series-8f__history');
    await check(client, '!document.querySelector("[role=dialog]") && window.__series8f.episodes===1 && window.__series8f.unseen===0 && !document.querySelector("#history .series-8f__check")', 'l’heure décorative laisse ouvrir l’épisode sans mutation');
    await evaluate(client, 'document.querySelector("#history .series-8f__open").dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true}))');
    await check(client, 'document.querySelector("[role=dialog]") && window.__series8f.unseen===0', 'le menu contextuel expose les actions historiques');
    await evaluate(client, '[...document.querySelectorAll("[role=dialog] button")].find(el=>el.textContent==="Marquer comme non vu").click()');
    await check(client, 'window.__series8f.unseen===1', 'l’historique transmet la demande au propriétaire');
    await click(client, '#history .series-8f__open');
    await check(client, 'window.__series8f.episodes===2 && window.__series8f.opens===0', 'la carte historique ouvre son épisode');
    await click(client, '#watch .series-8f__open');
    await check(client, 'window.__series8f.opens===1', 'un appui court ouvre la série');
    await evaluate(client, 'document.querySelector("#watch .series-8f__open").focus()');
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F10', code: 'F10', windowsVirtualKeyCode: 121, modifiers: 8 });
    await check(client, 'document.querySelector("[role=dialog]") && document.activeElement.getAttribute("aria-label")==="Fermer les actions"', 'Maj+F10 ouvre la feuille et place le focus');
    await escape(client);
    await check(client, '!document.querySelector("[role=dialog]") && document.activeElement.matches("#watch .series-8f__open")', 'Échap ferme la feuille et restaure le focus');
    const point = await evaluate(client, '(() => {const r=document.querySelector("#watch .series-8f__open").getBoundingClientRect();return{x:r.x+130,y:r.y+80};})()');
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await delay(530);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await check(client, 'document.querySelector("[role=dialog]") && window.__series8f.opens===1', 'l’appui long ouvre les actions sans navigation');
    await escape(client);
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await check(client, 'window.__series8f.opens===2', 'le clavier reste utilisable après un appui long');
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 20, y: point.y, button: 'left', buttons: 1 });
    await delay(530);
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 20, y: point.y, button: 'left', clickCount: 1 });
    await check(client, '!document.querySelector("[role=dialog]") && window.__series8f.opens===2', 'un mouvement annule appui long et ouverture');
    await evaluate(client, 'document.activeElement.blur(); window.scrollTo(0,0)');
    const metrics = await client.send('Page.getLayoutMetrics');
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: metrics.cssContentSize.height, scale: 1 } });
    fs.writeFileSync(path.join(root, 'quality-reports', `series-card-8f-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    reports.push({ width, status: 'pass', contexts: ['watch', 'upcoming', 'history'], geometry });
  }
  return reports;
}
module.exports = { buildSeriesCardHarness, testSeriesCardHarness };
