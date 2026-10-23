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
    await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-watch-next.html' });
    await check(client, 'document.querySelectorAll("#home-series-0 article").length===3 && document.querySelectorAll("[data-movie-ticket]").length===3', 'trois cartes par rail et trois billets films');
    await check(client, 'document.querySelectorAll(".home-series-section").length===3 && document.documentElement.scrollWidth<=innerWidth', 'trois sections distinctes sans débordement');
    await click(client, '[aria-label="Continuer à regarder en liste"]');
    await check(client, 'document.querySelector("#home-series-0.home-series-list")', 'l’icône liste ouvre la liste');
    const seriesCheck = '#home-series-0 .series-8f__check';
    await evaluate(client, 'window.__watch18c.telemetry.holdNext=true');
    await click(client, seriesCheck);
    await delay(4300);
    await check(client, 'window.__watch18c.telemetry.writes.length===1 && !document.querySelector(".series-8f__ghost") && !document.querySelector("[data-error=true]")', 'Firestore lent : aucun rollback, faux échec ou succès prématuré');
    await evaluate(client, 'window.__watch18c.releaseWrite()');
    await check(client, 'document.querySelector("#home-series-0 .series-8f__code").textContent.includes("E03") && window.__watch18c.toasts().some(toast=>toast.type==="success")', 'succès annoncé seulement après confirmation Firestore');
    await evaluate(client, 'window.__watch18c.telemetry.failNext=true;window.__watch18c.clearToasts()');
    await click(client, seriesCheck);
    await check(client, 'document.querySelector("#home-series-0 [data-error=true]") && window.__watch18c.snapshot()[0].seenEpisodes.length===2', 'échec restauré et réessayable');
    await click(client, seriesCheck);
    await check(client, 'document.querySelector("#home-series-0 .series-8f__check--watched")', 'état à jour conservé');
    await click(client, seriesCheck);
    await check(client, 'window.__watch18c.snapshot()[0].seenEpisodes.length===2', 'retour Non vu du dernier épisode');
    await evaluate(client, 'window.__watch18c.clearToasts()');
    const movie = '[data-movie-ticket="movie-1"]';
    await click(client, `${movie} .movie-ticket__check`);
    await check(client, `document.querySelector('${movie}.movie-ticket--watched') && document.querySelector('${movie} .movie-ticket__undo')`, 'billet déchiré et tampon réversible');
    await click(client, `${movie} .movie-ticket__undo`);
    await check(client, `!document.querySelector('${movie}.movie-ticket--watched') && document.querySelector('${movie}.movie-ticket--back')`, 'tap tampon Vu recolle le billet');
    await click(client, '.watch-next-18c__more-films');
    await check(client, 'document.querySelectorAll("[data-movie-ticket]").length===6', 'pagination films de trois en trois');
    await click(client, '[aria-label="Films en liste"]');
    await check(client, 'document.querySelector(".home-movie-list") && document.querySelectorAll("[data-movie-ticket]").length===6', 'la liste de billets conserve les films chargés');
    await client.send('Emulation.setEmulatedMedia', { media: '', features: [{ name:'prefers-reduced-motion',value:'reduce' }] });
    await click(client, `${movie} .movie-ticket__check`);
    await check(client, `document.querySelector('${movie}.movie-ticket--watched') && parseFloat(getComputedStyle(document.querySelector('${movie} .movie-ticket__stub')).animationDuration)<=.01`, 'animations réduites et même résultat métier');
    await check(client, 'window.__watch18cErrors.length===0', 'aucune erreur runtime');
    fs.writeFileSync(path.join(root,'quality-reports',`watch-next-18c-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    reports.push({width,status:'pass',realActions:['markEpisodeWatched','markMovieWatched','markWatchRecordUnseen'],reducedMotion:true});
  }
  return reports;
}
module.exports = { buildWatchNextHarness, testWatchNextHarness };
