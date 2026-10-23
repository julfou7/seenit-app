const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
async function buildWatchNextHarness(root) {
  const dist = path.join(root, 'dist');
  const ports = path.join(root, 'tests/fixtures/watchNext18cRuntime.ts');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/watchNext18c.tsx')], outfile: path.join(dist, '__seenit-watch-next.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent',
    plugins: [{ name: 'watch-next-ports', setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$|\/(?:favoritePeopleStore|useShows|firebase|tmdb|showsStore|logStore|plexAvailability)$/ }, () => ({ path: ports }));
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
    await check(client, 'document.querySelectorAll("#home-series-0 article").length===6 && document.querySelectorAll("[data-movie-ticket]").length===6', 'rails de six billets films');
    await check(client, 'document.querySelectorAll(".home-series-section").length===3 && document.documentElement.scrollWidth<=innerWidth', 'trois sections distinctes sans débordement');
    await click(client, '#home-series-0 .home-rail-more');
    await check(client, 'document.querySelectorAll("#home-series-0 article").length===8', 'la tuile donne accès aux huit séries réelles');
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
    await click(client, '.home-rail-more--movies');
    await check(client, 'document.querySelectorAll("[data-movie-ticket]").length===12', 'la tuile du rail ouvre les douze premiers films en liste');
    await click(client, '[aria-label="Films en liste"]');
    await check(client, 'document.querySelector(".home-movie-list") && document.querySelectorAll("[data-movie-ticket]").length===12', 'la liste de billets conserve les films chargés');
    await click(client, '.watch-next-18c__more-films');
    await check(client, 'document.querySelectorAll("[data-movie-ticket]").length===22', 'la pagination donne accès aux22films');
    await check(client, 'document.querySelector("[data-movie-ticket=movie-0] .movie-ticket__info h3").textContent==="The Punisher : One Last Kill" && document.querySelector("[data-movie-ticket=movie-0] .movie-ticket__info h3").getBoundingClientRect().height<37', 'Punisher deux lignes de18px sans rognage');
    await check(client, 'Array.from(document.querySelectorAll(".movie-ticket__info")).every(info=>{const r=info.getBoundingClientRect(),b=info.closest(".movie-ticket__body").getBoundingClientRect();return r.top>=b.top && r.bottom<=b.bottom})', 'titre acteur et année tiennent dans104px');
    await check(client, 'window.__watch18c.telemetry.actorRequests===0', 'aucune requête acteur pour les billets');
    await evaluate(client, 'window.__actorOpenBefore=window.__watch18c.telemetry.opens.length;window.__movieOrderBefore=[...document.querySelectorAll("[data-movie-ticket]")].map(el=>el.dataset.movieTicket).join(",")');
    await evaluate(client, 'localStorage.removeItem("seenit_user:fixture-a:home_actor_credits_501")');
    await click(client, '[data-movie-ticket="movie-0"] .movie-actor-line');
    await check(client, 'document.querySelector(".movie-actor-sheet") && document.querySelector(".movie-actor-sheet h2").textContent==="Sean Astin" && window.__watch18c.telemetry.opens.length===window.__actorOpenBefore', 'acteur ouvre sa mini-fiche sans ouvrir le film');
    await check(client, 'window.__watch18c.telemetry.actorRequests===1 && document.querySelectorAll(".movie-actor-sheet__seen > button").length===8', 'filmographie à la demande et vrais titres vus');
    await click(client, '.movie-actor-sheet__heart');
    await check(client, 'document.querySelector(".movie-actor-sheet__heart").getAttribute("aria-pressed")==="true"', 'favori écrit dans le vrai store partagé');
    await click(client, '.movie-actor-sheet__add');
    await check(client, 'window.__watch18c.snapshot().some(show=>show.tmdbId===999 && show.status==="plan_to_watch") && document.querySelectorAll(".movie-actor-sheet__add").length===0', 'ajout À voir par le handler de production');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await check(client, '!document.querySelector(".movie-actor-sheet") && document.activeElement.getAttribute("aria-label")==="Acteur : Sean Astin"', 'Échap ferme et restaure le focus acteur');
    await click(client, '[data-movie-ticket="movie-0"] .movie-actor-line');
    await check(client, 'document.querySelector(".movie-actor-sheet") && window.__watch18c.telemetry.actorRequests===1', 'réouverture en cache sans seconde requête');
    await client.send('Page.captureScreenshot',{format:'png'}).then(result=>fs.writeFileSync(path.join(root,'quality-reports',`movie-actor-${width}.png`),Buffer.from(result.data,'base64')));
    await evaluate(client, 'history.back()');
    await check(client, '!document.querySelector(".movie-actor-sheet")', 'Retour système ferme la mini-fiche');
    await client.send('Emulation.setEmulatedMedia', { media: '', features: [{ name:'prefers-reduced-motion',value:'reduce' }] });
    await click(client, `${movie} .movie-ticket__check`);
    await check(client, `document.querySelector('${movie}.movie-ticket--watched') && parseFloat(getComputedStyle(document.querySelector('${movie} .movie-ticket__stub')).animationDuration)<=.01`, 'animations réduites et même résultat métier');
    await check(client, 'window.__watch18cErrors.length===0', 'aucune erreur runtime');
    fs.writeFileSync(path.join(root,'quality-reports',`watch-next-18c-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
    await evaluate(client, 'window.__watch18c.switchAccount()');
    await check(client, 'document.querySelector("[data-movie-ticket=movie-0] .movie-actor-line").getAttribute("aria-label")==="Acteur : Premier Rôle" && !document.querySelector("[data-movie-ticket=movie-0] .movie-actor-line small") && localStorage.getItem("seenit_user:fixture-b:home_actor_index")==="{}"', 'le compte suivant ne reçoit pas les titres vus ni les raisons du précédent');
    reports.push({width,status:'pass',realActions:['markEpisodeWatched','markMovieWatched','markWatchRecordUnseen'],reducedMotion:true});
  }
  return reports;
}
module.exports = { buildWatchNextHarness, testWatchNextHarness };
