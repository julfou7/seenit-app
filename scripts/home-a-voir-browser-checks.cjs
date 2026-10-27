const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
async function buildHomeHarness(root) {
  const dist = path.join(root, 'dist');
  const runtime = path.join(root, 'tests/fixtures/homeAVoirRuntime.ts');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/homeAVoir.tsx')], outfile: path.join(dist, '__seenit-home.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent',
    plugins: [{ name: 'home-ports', setup(builder) {
      builder.onLoad({filter:/[\\/]features[\\/]history[\\/]history(?:Timeline|Presentation)\.ts$/}, args => ({contents:fs.readFileSync(args.path,'utf8').replace('  const day = historyLocalDayKey(watchedAt), today = historyLocalDayKey(now)', '  window.__homePerf = window.__homePerf || {periodCalls:0}; window.__homePerf.periodCalls++;\n  const day = historyLocalDayKey(watchedAt), today = historyLocalDayKey(now)'),loader:'ts',resolveDir:path.dirname(args.path)}));
      builder.onLoad({filter:/[\\/]components[\\/]HistoryFeed\.tsx$/}, args => ({contents:fs.readFileSync(args.path,'utf8'),loader:'tsx',resolveDir:path.dirname(args.path)}));
      builder.onLoad({filter:/[\\/]screens[\\/]WatchNextSection\.tsx$/}, args => ({contents:fs.readFileSync(args.path,'utf8').replace(/(export function WatchNextSection[^\n]+\{)\r?\n/,'$1\n  window.__homeListRenders = (window.__homeListRenders || 0) + 1;\n'),loader:'tsx',resolveDir:path.dirname(args.path)}));
      builder.onLoad({filter:/[\\/]cards[\\/]ContinueWatchingCard\.tsx$/}, args => ({contents:fs.readFileSync(args.path,'utf8').replace(/(function ContinueWatchingCardContent[^\n]+\{)\r?\n/,'$1\n  window.__cardRenders ||= {}; window.__cardRenders[show.id] = (window.__cardRenders[show.id] || 0) + 1;\n'),loader:'tsx',resolveDir:path.dirname(args.path)}));
      builder.onResolve({ filter: /^firebase\/(?:firestore|auth)$|\/(?:favoritePeopleStore|useShows|firebase|tmdb|showsStore|logStore|plexAvailability|plexLinks|useShows|downloadConfigStore|updateStore|liveDownloadStore|EpisodeDetailModal|PersonDetailModal)$/ }, () => ({ path: runtime }));
    } }],
  });
  const fonts = fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<link[^>]+fonts.googleapis.com\/css[^>]*>/)?.[0] || '';
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file=>file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-home.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts}${css.map(file=>`<link rel="stylesheet" href="/assets/${file}">`).join('')}<link rel="stylesheet" href="/__seenit-home.css"><style>body{margin:0;background:#0b0b0f;color:white}</style></head><body><div id="root"></div><script>window.__homeErrors=[];addEventListener('error',e=>__homeErrors.push(e.message));addEventListener('unhandledrejection',e=>__homeErrors.push(String(e.reason)));</script><script src="/__seenit-home.js"></script></body></html>`);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Erreur accueil');
  return response.result?.value;
}
async function check(client, expression, label) {
  for (let attempt=0;attempt<50;attempt++) { if (await evaluate(client,`Boolean(${expression})`)) return; await delay(60); }
  throw new Error(`#729 ${label}: ${JSON.stringify(await evaluate(client,'({errors:window.__homeErrors,text:document.body.innerText})'))}`);
}
async function click(client, selector) {
  const point = await evaluate(client,`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:'center',inline:'center'});const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function testHomeHarness(client, root) {
  const reports=[];
  for (const width of [360,412,1280]) {
    await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
    await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
    await check(client,'document.querySelectorAll(".home-tabs [role=tab]").length===3 && document.querySelectorAll(".home-series-section").length===3','trois onglets et trois sections');
    await evaluate(client,'window.__homeAVoir.clearDismissed()');
    await check(client,'[...document.querySelectorAll(".home-watch > section,.home-watch > .home-section-heading")].map(el=>el.textContent).at(-1).includes("Pas vu depuis") && ![...document.querySelectorAll(".home-section-heading button")].some(el=>el.textContent.includes("Voir tout"))','ordre corrigé et icônes de vue');
    await check(client,'getComputedStyle(document.querySelector(".home-header"),"::after").height==="26px" && getComputedStyle(document.querySelector(".home-header"),"::after").pointerEvents==="none"','fondu sous les filtres');
    await check(client,'document.documentElement.scrollWidth<=innerWidth && document.querySelectorAll("[role=tabpanel]:not([hidden])").length===1','un panneau visible sans débordement');
    fs.writeFileSync(path.join(root,'quality-reports',`home-watch-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click(client,'[aria-label="Films en liste"]');
    await check(client,'document.querySelector(".movie-ticket--horizontal").getBoundingClientRect().height===120 && document.querySelector(".movie-ticket--horizontal .movie-ticket__poster").getBoundingClientRect().width===80 && document.querySelector(".movie-ticket--horizontal .movie-ticket__stub").getBoundingClientRect().width===84 && getComputedStyle(document.querySelector(".movie-ticket--horizontal .movie-ticket__check svg")).opacity==="1"','billet 120 px conforme au prototype avec glyphe Vu visible');
    await evaluate(client,'document.querySelector("#films-a-voir-18c").scrollIntoView({block:"center"})');
    fs.writeFileSync(path.join(root,'quality-reports',`home-films-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click(client,'#home-tab-upcoming');
    await check(client,'document.querySelectorAll(".home-upcoming-group").length===3 && document.querySelectorAll("#home-panel-upcoming .series-8f__days").length===3','groupes Aujourd’hui Cette semaine Plus tard');
    await check(client,'[...document.querySelectorAll(".series-8f__days strong")].map(el=>el.textContent).join(",")==="auj.,J-3,J-12"','J-X et auj. exacts de la SPEC v3');
    fs.writeFileSync(path.join(root,'quality-reports',`home-upcoming-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click(client,'#home-panel-upcoming .series-8f__open');
    await check(client,'window.__homeAVoir.telemetry.opens.at(-1).includes(":2x1")', 'un tap À venir ouvre l’épisode exact');
    await click(client,'#home-tab-history');
    await check(client,'document.querySelectorAll("#home-panel-history [data-history-row]").length===10','historique initial de dix');
    await click(client,'#home-panel-history .home-load-more');
    await check(client,'document.querySelectorAll("#home-panel-history [data-history-row]").length>10','suite historique');
    fs.writeFileSync(path.join(root,'quality-reports',`home-history-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click(client,'.home-notification-bell');
    await check(client,'document.querySelector(".home-notifications") && document.querySelectorAll(".home-notice").length>=2','feuille notifications réelles');
    await check(client,'!document.querySelector(".home-notice button[aria-label=\\"Marquer Stranger Things comme vu\\"]") && document.querySelector(".home-notice button[aria-label=\\"Marquer The Punisher : One Last Kill comme vu\\"]")','la vraie feuille refuse Vu pour une série partielle et conserve le film Plex exact');
    fs.writeFileSync(path.join(root,'quality-reports',`home-notifications-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(client,'window.__homeAVoir.clear()');
    const notice='[data-notice-id="update:1.4.999"]';
    await evaluate(client,'window.__noticeCount=document.querySelectorAll(".home-notice").length;window.__noticeOpens=window.__homeAVoir.telemetry.opens.length');
    await click(client,notice+' .home-notice__dismiss');
    await check(client,'!document.querySelector(\'[data-notice-id="update:1.4.999"]\') && document.querySelectorAll(".home-notice").length===window.__noticeCount-1','retirer une seule notification par bouton');
    await evaluate(client,'window.__homeAVoir.toasts().find(toast=>toast.onUndo)?.onUndo()');
    await check(client,'document.querySelectorAll(".home-notice").length===window.__noticeCount','Annuler restaure la notification');
    const swipe=await evaluate(client,`(()=>{const el=document.querySelector(${JSON.stringify(notice)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width*.6,y:r.y+r.height/2}})()`);
    await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...swipe,button:'left',clickCount:1});
    for(let distance=20;distance<=110;distance+=15) await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:swipe.x+distance,y:swipe.y,button:'left',buttons:1});
    await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:swipe.x+110,y:swipe.y,button:'left',clickCount:1});
    await check(client,'!document.querySelector(\'[data-notice-id="update:1.4.999"]\') && document.querySelector(".home-notifications") && window.__homeAVoir.telemetry.opens.length===window.__noticeOpens','swipe droit retire une notification sans ouvrir sa fiche');
    await client.send('Page.reload');
    await check(client,'document.querySelector(".home-notification-bell")','remontage après retrait');
    await click(client,'.home-notification-bell');
    await check(client,'document.querySelector(".home-notifications") && !document.querySelector(\'[data-notice-id="update:1.4.999"]\')','le retrait individuel persiste après remontage');
    if (await evaluate(client,'Boolean(document.querySelector(".home-notifications__read"))')) await click(client,'.home-notifications__read');
    await check(client,'!document.querySelector(".home-notification-bell > span")','Tout marquer lu acquitté');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await check(client,'!document.querySelector(".home-notifications")','Échap ferme la feuille');
    await click(client,'#home-tab-watch_next');
    await check(client,'document.querySelector("#home-tab-watch_next").getAttribute("aria-selected")==="true" && window.__homeErrors.length===0','retour À regarder sans erreur');
    if (width===412) {
      await evaluate(client,'window.__homeAVoir.empty()');
      for (const tab of ['watch_next','upcoming','history']) {
        await click(client,`#home-tab-${tab}`);
        await check(client,`document.querySelector('#home-panel-${tab} .home-explore')`, 'CTA Explorer de chaque onglet vide');
        await click(client,`#home-panel-${tab} .home-explore`);
        await check(client,'window.__homeAVoir.telemetry.opens.at(-1)==="discover"', 'CTA Explorer branché');
      }
    }
    reports.push({width,status:'pass',tabs:3,upcomingGroups:3,historyPage:10,notifications:true});
  }
  return reports;
}
module.exports = { buildHomeHarness, testHomeHarness };
if (require.main === module) buildHomeHarness(path.resolve(__dirname,'..')).catch(error=>{console.error(error);process.exitCode=1;});
