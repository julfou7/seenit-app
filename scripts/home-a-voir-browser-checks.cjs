const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
async function buildHomeHarness(root) {
  const dist = path.join(root, 'dist');
  const runtime = path.join(root, 'tests/fixtures/homeAVoirRuntime.ts');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/homeAVoir.tsx')], outfile: path.join(dist, '__seenit-home.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent',
    plugins: [{ name: 'home-ports', setup(builder) {
      builder.onResolve({ filter: /^firebase\/(?:firestore|auth)$|\/(?:firebase|tmdb|showsStore|logStore|plexAvailability|plexLinks|useShows|downloadConfigStore|updateStore|liveDownloadStore|EpisodeDetailModal|PersonDetailModal)$/ }, () => ({ path: runtime }));
    } }],
  });
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file=>file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-home.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file=>`<link rel="stylesheet" href="/assets/${file}">`).join('')}<link rel="stylesheet" href="/__seenit-home.css"><style>body{margin:0;background:#0b0b0f;color:white}</style></head><body><div id="root"></div><script>window.__homeErrors=[];addEventListener('error',e=>__homeErrors.push(e.message));addEventListener('unhandledrejection',e=>__homeErrors.push(String(e.reason)));</script><script src="/__seenit-home.js"></script></body></html>`);
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
    await check(client,'document.documentElement.scrollWidth<=innerWidth && document.querySelectorAll("[role=tabpanel]:not([hidden])").length===1','un panneau visible sans débordement');
    fs.writeFileSync(path.join(root,'quality-reports',`home-watch-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(client,'document.querySelector("#films-a-voir-18c").scrollIntoView({block:"center"})');
    fs.writeFileSync(path.join(root,'quality-reports',`home-films-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click(client,'#home-tab-upcoming');
    await check(client,'document.querySelectorAll(".home-upcoming-group").length===3 && document.querySelectorAll("#home-panel-upcoming .series-8f__days").length===3','groupes Aujourd’hui Cette semaine Plus tard');
    await check(client,'[...document.querySelectorAll(".series-8f__days strong")].map(el=>el.textContent).join(",")==="0,3,12"','jours exacts et aucun emoji');
    fs.writeFileSync(path.join(root,'quality-reports',`home-upcoming-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click(client,'#home-tab-history');
    await check(client,'document.querySelectorAll("#home-panel-history article").length===10','historique initial de dix');
    await click(client,'#home-panel-history > div > button');
    await check(client,'document.querySelectorAll("#home-panel-history article").length>10','suite historique');
    fs.writeFileSync(path.join(root,'quality-reports',`home-history-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click(client,'.home-notification-bell');
    await check(client,'document.querySelector(".home-notifications") && document.querySelectorAll(".home-notice").length>=2','feuille notifications réelles');
    fs.writeFileSync(path.join(root,'quality-reports',`home-notifications-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    if (await evaluate(client,'Boolean(document.querySelector(".home-notifications__read"))')) await click(client,'.home-notifications__read');
    await check(client,'!document.querySelector(".home-notification-bell > span")','Tout marquer lu acquitté');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await check(client,'!document.querySelector(".home-notifications")','Échap ferme la feuille');
    await click(client,'#home-tab-watch_next');
    await check(client,'document.querySelector("#home-tab-watch_next").getAttribute("aria-selected")==="true" && window.__homeErrors.length===0','retour À regarder sans erreur');
    reports.push({width,status:'pass',tabs:3,upcomingGroups:3,historyPage:10,notifications:true});
  }
  return reports;
}
module.exports = { buildHomeHarness, testHomeHarness };
if (require.main === module) buildHomeHarness(path.resolve(__dirname,'..')).catch(error=>{console.error(error);process.exitCode=1;});
