const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
async function buildWatchNextHarness(root) {
  const dist = path.join(root, 'dist');
  const ports = path.join(root, 'tests/fixtures/watchNext18cRuntime.ts');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/watchNext18c.tsx')], outfile: path.join(dist, '__seenit-watch-next.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent',
    plugins: [{ name: 'watch-next-ports', setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$|\/(?:firebase|tmdb|showsStore|logStore|plexAvailability)$/ }, () => ({ path: ports }));
    } }],
  });
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-watch-next.html'), `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('')}<link rel="stylesheet" href="/__seenit-watch-next.css"><style>body{background:#08080c;color:white;margin:0}</style></head><body><div id="root"></div><script>window.__watch18cErrors=[];window.addEventListener('error',e=>window.__watch18cErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__watch18cErrors.push(String(e.reason)));</script><script src="/__seenit-watch-next.js"></script></body></html>`);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Erreur 18c');
  return result.result?.value;
}
async function check(client, expression, label) {
  for (let index = 0; index < 60; index++) { if (await evaluate(client, `Boolean(${expression})`)) return; await delay(50); }
  throw new Error(`#712 ${label}: ${JSON.stringify(await evaluate(client, '({telemetry:window.__watch18c?.telemetry,errors:window.__watch18cErrors,text:document.body.innerText})'))}`);
}
async function click(client, selector) {
  await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
  await delay(60);
  const point = await evaluate(client, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect();return{x:(r.x+r.width/2-visualViewport.offsetLeft)*visualViewport.scale,y:(r.y+r.height/2-visualViewport.offsetTop)*visualViewport.scale}})()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await delay(40);
}
async function testWatchNextHarness(client, root) {
  const reports = [];
  for (const width of [360, 412, 1280]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height: 915, deviceScaleFactor: 1, mobile: width < 640 });
    await client.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-watch-next.html' });
    await check(client, 'document.querySelectorAll("#watch-next-series article").length===3 && document.querySelectorAll("[data-movie-ticket]").length===8', 'premier rendu borné à trois séries et huit films');
    await check(client, 'document.querySelector(".watch-next-18c__more").textContent.includes("5 en attente") && document.querySelectorAll(".watch-next-18c__avatars img").length===3', 'bouton verre et compteur unique');
    const targets = await evaluate(client, '[...document.querySelectorAll("button,input")].filter(el=>el.getClientRects().length).map(el=>({label:el.getAttribute("aria-label")||el.textContent,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))');
    if (targets.some(item => item.width < 44 || item.height < 44)) throw new Error(`#712 cible <44px ${JSON.stringify(targets)}`);
    await check(client, 'document.documentElement.scrollWidth<=document.documentElement.clientWidth && document.querySelector("[data-movie-ticket]").dataset.movieTicket==="movie-1" && document.querySelector("[data-movie-ticket=movie-0] .movie-ticket__late")', 'tri de fin, après minuit et absence de débordement');
    const initialCapture = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(root, 'quality-reports', `watch-next-18c-initial-${width}.png`), Buffer.from(initialCapture.data, 'base64'));
    await click(client, '.watch-next-18c__more');
    await check(client, 'document.querySelectorAll("#watch-next-series article").length===6 && document.querySelector(".watch-next-18c__more").textContent.includes("Afficher les 2")', 'lot suivant');
    await click(client, '.watch-next-18c__more');
    await check(client, 'document.querySelectorAll("#watch-next-series article").length===8 && !document.querySelector(".watch-next-18c__more")', 'dernier lot');
    await click(client, '.watch-next-18c__reduce');
    await check(client, 'document.querySelectorAll("#watch-next-series article").length===3', 'Réduire à trois');
    await click(client, '#watch-next-series .series-8f__check');
    await check(client, 'document.querySelector("#watch-next-series .series-8f__code").textContent.includes("E03") && (document.querySelector(".series-8f__ghost")?.textContent || "").includes("E02") && window.__watch18c.telemetry.writes.length===1 && window.__watch18c.telemetry.opens.length===0', 'la façade réelle marque exactement E02 et anime la reprise E03');
    if (width === 360) {
      await delay(300);
      const actionCapture = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(root, 'quality-reports', 'watch-next-18c-series-action-360.png'), Buffer.from(actionCapture.data, 'base64'));
    }
    await evaluate(client, 'window.__watch18c.clearToasts()');
    await click(client, '#watch-next-series .series-8f__check');
    await check(client, 'document.querySelector("#watch-next-series .series-8f__code").textContent.includes("à jour") && (document.querySelector(".series-8f__ghost")?.textContent || "").includes("E03") && document.querySelector(".series-8f__check--watched") && window.__watch18c.telemetry.writes.length===2', 'deuxième animation et état à jour conservé à sa place');
    await evaluate(client, 'window.__watch18c.clearToasts()');
    await click(client, '#watch-next-series .series-8f__check');
    await check(client, 'document.querySelector("#watch-next-series .series-8f__code").textContent.includes("E03") && window.__watch18c.snapshot()[0].seenEpisodes.length===2 && !document.querySelector(".series-8f__ghost")', 'à jour revient uniquement sur le dernier épisode marqué');
    await click(client, '#watch-undo');
    await check(client, 'document.querySelector("#watch-next-series .series-8f__code").textContent.includes("à jour")', 'Annuler rétablit le dernier visionnage');
    const movie = '[data-movie-ticket="movie-1"]';
    const position = await evaluate(client, '[...document.querySelectorAll("[data-movie-ticket]")].map(el=>el.dataset.movieTicket).join(",")');
    await evaluate(client, 'window.__watch18c.clearToasts()');
    await click(client, `${movie} .movie-ticket__check`);
    await check(client, `document.querySelector('${movie}').classList.contains('movie-ticket--watched') && document.querySelector('${movie} .movie-ticket__stamp') && window.__watch18c.snapshot().find(show=>show.id==='movie-1').episodeRecords.movie.watchedAt`, 'écriture film réelle et ticket déchiré');
    await check(client, `[...document.querySelectorAll('[data-movie-ticket]')].map(el=>el.dataset.movieTicket).join(',')===${JSON.stringify(position)}`, 'le film vu garde exactement sa place');
    await click(client, '#watch-undo');
    await check(client, `!document.querySelector('${movie}').classList.contains('movie-ticket--watched') && !document.querySelector('${movie} .movie-ticket__stamp')`, 'Annuler recolle le ticket');
    if (width === 360) {
      await click(client, `${movie} .movie-ticket__check`);
      await check(client, `document.querySelector('${movie}').classList.contains('movie-ticket--watched')`, 'nouveau Vu film');
      await evaluate(client, 'window.__watch18c.clearToasts()');
      await click(client, `${movie} .movie-ticket__check`);
      await check(client, `!document.querySelector('${movie}').classList.contains('movie-ticket--watched') && document.querySelector('${movie}').classList.contains('movie-ticket--back') && !window.__watch18c.snapshot().find(show=>show.id==='movie-1').seenEpisodes.includes('movie')`, 'retoucher la coche exécute le vrai retour Non vu et recolle');
      await click(client, '#watch-undo');
      await check(client, `document.querySelector('${movie}').classList.contains('movie-ticket--watched')`, 'Annuler le Non vu restaure le film');
      await click(client, `${movie} .movie-ticket__check`);
      await check(client, `!document.querySelector('${movie}').classList.contains('movie-ticket--watched')`, 'retour à non vu avant le cas échec');
    }
    await evaluate(client, 'window.__watch18c.telemetry.failNext=true;window.__watch18c.clearToasts()');
    await click(client, `${movie} .movie-ticket__check`);
    await check(client, `document.querySelector('${movie} [data-error=true]') && !document.querySelector('${movie}').classList.contains('movie-ticket--watched')`, 'échec de transport sans faux succès ni progression conservée');
    await click(client, '.watch-next-18c__all-films');
    await check(client, 'document.querySelector(".movie-ticket-grid") && document.querySelectorAll("[data-movie-ticket]").length===8', 'Voir tout conserve un lot initial borné');
    await click(client, '.watch-next-18c__more-films');
    await check(client, 'document.querySelectorAll("[data-movie-ticket]").length===10 && !document.querySelector("[data-movie-ticket=movie-2] .movie-ticket__stub strong")', 'suite exhaustive et durée inconnue sans fausse heure');
    await check(client, 'document.querySelector("[data-movie-ticket=movie-3] .movie-ticket__poster img").getAttribute("src").includes("__8f-backdrop.svg") && document.querySelector("[data-movie-ticket=movie-0] .movie-ticket__provider").getAttribute("aria-label").includes("Thomas")', 'poster cassé réutilisé et serveur Plex nommé');
    await evaluate(client, 'window.__watch18c.clearToasts();window.__watch18c.telemetry.holdNext=true');
    await click(client, `${movie} .movie-ticket__check`);
    await evaluate(client, 'window.__watch18c.switchAccount();window.__watch18c.releaseWrite()');
    await check(client, 'window.__watch18c.snapshot().every(show=>show.userId==="fixture-b") && !document.querySelector(".movie-ticket--watched") && document.querySelectorAll("#watch-next-series article").length===3', 'changement de compte pendant écriture sans fuite visuelle');
    await client.send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate(client, 'window.__watch18c.clearToasts()');
    await click(client, `${movie} .movie-ticket__check`);
    await check(client, `document.querySelector('${movie}').classList.contains('movie-ticket--watched') && parseFloat(getComputedStyle(document.querySelector('${movie} .movie-ticket__stub')).animationDuration)<=.01`, 'état final identique en réduction des animations');
    await evaluate(client, 'window.scrollTo(0,0)');
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(root, 'quality-reports', `watch-next-18c-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    await check(client, 'window.__watch18cErrors.length===0 && window.__watch18c.telemetry.vibrations.every(value=>value===15)', 'aucune erreur runtime et haptique de confirmation');
    reports.push({ width, status: 'pass', realActions: ['markEpisodeWatched', 'markMovieWatched', 'markWatchRecordUnseen'], reducedMotion: true, uidSwitch: true });
  }
  const before = await evaluate(client, 'document.querySelector("[data-movie-ticket=movie-4] .movie-ticket__stub strong").textContent');
  await evaluate(client, 'window.__watch18c.advanceClock(1)');
  await client.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 60_050 });
  await check(client, `document.querySelector('[data-movie-ticket=movie-4] .movie-ticket__stub strong').textContent!==${JSON.stringify(before)}`, 'le timer minute recalcule la fin sans navigation');
  return reports;
}
module.exports = { buildWatchNextHarness, testWatchNextHarness };
