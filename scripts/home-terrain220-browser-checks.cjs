const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Erreur terrain220');
  return result.result?.value;
}
async function check(client, expression, label) {
  for(let i=0;i<70;i++) { if(await evaluate(client,`Boolean(${expression})`)) return; await delay(50); }
  throw new Error(`Terrain220 ${label}: ${JSON.stringify(await evaluate(client,'({errors:window.__watch18cErrors||window.__homeErrors,renders:window.__homeListRenders,before:window.__renderCount,firstY:window.__firstTitleY,active:document.querySelector("[aria-selected=true]")?.id,titles:[...document.querySelectorAll("[role=tabpanel]:not([hidden]) h2")].slice(0,2).map(el=>{const r=document.createRange();r.selectNodeContents(el.querySelector(".home-section-name")||el);return {text:el.textContent,top:r.getBoundingClientRect().top,height:el.getBoundingClientRect().height,lineHeight:getComputedStyle(el).lineHeight};}),text:document.body.innerText,telemetry:window.__watch18c?.telemetry||window.__homeAVoir?.telemetry})'))}`);
}
async function click(client, selector) {
  await evaluate(client,`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'center',behavior:'instant'})`);
  await delay(180);
  const point=await evaluate(client,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function testTerrain220Harness(client, root) {
  const reports=[];
  for(const width of [360,412,1280]) {
    await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
    await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
    await check(client,'window.__homeAVoir && document.querySelector("#home-series-1")','accueil réel prêt');
    await check(client,'!document.querySelector("#home-panel-history [data-history-row]")','historique masqué sans rendu de lignes');
    await evaluate(client,'document.fonts.ready');
    await evaluate(client,'window.__firstTitleY=(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector("#home-section-0 .home-section-name"));return range.getBoundingClientRect().top})()');
    for(const tab of ['upcoming','history']) {
      await click(client,`#home-tab-${tab}`);
      await check(client,`(()=>{const title=document.querySelector('${tab==='upcoming'?'#home-panel-upcoming .home-upcoming-group > h2':'#home-panel-history .history-period__heading'}');if(!title)return false;const range=document.createRange();range.selectNodeContents(title);return Math.abs(range.getBoundingClientRect().top-window.__firstTitleY)<=1})()`,'premier titre au même repère dans les trois onglets');
    }
    await click(client,'#home-tab-watch_next');

    await evaluate(client,`document.querySelector('[aria-label="Nouveautés en liste"]').addEventListener('pointerdown',()=>{const card=document.querySelector('#home-series-1 article'),heading=document.querySelector('#home-section-1'),previous=document.querySelector('#home-series-0 article');window.__geometry={card:card.getBoundingClientRect().top,heading:heading.getBoundingClientRect().top,previous:previous.getBoundingClientRect().top,scroll:document.querySelector('#watchlist-container').scrollTop};},{once:true})`);
    await click(client,'[aria-label="Nouveautés en liste"]');
    await check(client,`(()=>{const b=window.__geometry;return document.querySelector('#home-series-1.home-series-list') && Math.abs(document.querySelector('#home-series-1 article').getBoundingClientRect().top-b.card)<1 && Math.abs(document.querySelector('#home-section-1').getBoundingClientRect().top-b.heading)<1 && Math.abs(document.querySelector('#home-series-0 article').getBoundingClientRect().top-b.previous)<1 && Math.abs(document.querySelector('#watchlist-container').scrollTop-b.scroll)<1;})()`,'bascule série : première carte, en-tête et section précédente fixes');
    await check(client,'window.__homeAVoir.telemetry.actorPrimes===32 && typeof window.__homeListRenders==="number"','hydratation initiale et instrumentation réelles');
    await delay(1000);
    await evaluate(client,'window.__homeAVoir.sync("Analyse Plex")'); await delay(100);
    await evaluate(client,'(async()=>{window.__renderCount=window.__homeListRenders;for(let i=1;i<=100;i++){window.__homeAVoir.sync(`Synchronisation (${i}/100)`);if(i%20===0)await new Promise(resolve=>setTimeout(resolve,20));}})()');
    await delay(250);
    await check(client,'window.__homeListRenders===window.__renderCount','100 messages Plex sans rerendre les cartes');
    await click(client,'.home-sync-button');
    await check(client,'document.querySelector(".home-sync-sheet").textContent.includes("100 sur 100")','détail réel de synchronisation');
    await evaluate(client,'window.__homeAVoir.sync("Analyse Plex")');
    await check(client,'!document.querySelector(".home-sync-sheet [role=progressbar]").hasAttribute("aria-valuenow")','aucun pourcentage inventé');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await check(client,'!document.querySelector(".home-sync-sheet")','fermeture du détail');

    await evaluate(client,'window.__homeAVoir.examples()');
    await click(client,'#home-tab-upcoming');
    await check(client,'document.querySelector("[data-series-id=upcoming-count-1] .series-8f__unknown-mark") && !document.querySelector("[data-series-id=upcoming-count-6] .series-8f__unknown-mark") && document.querySelectorAll("[data-series-id=upcoming-count-6] .series-8f__segment").length===6','adaptateur À venir : Harry inconnu et Knight six confirmés');
    await evaluate(client,'document.querySelector("[data-series-id=upcoming-collection]").scrollIntoView({block:"center",behavior:"instant"})');
    await check(client,'document.querySelectorAll("[data-series-id=upcoming-collection] .series-8f__segment").length===3','collection TMDB : trois barres pour le troisième film');
    await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-watch-next.html'});
    await check(client,'window.__watch18c && document.querySelector("#home-series-1 [data-series-id=news-only]")','vraie nouveauté non vue');
    await evaluate(client,'window.__watch18c.telemetry.holdNext=true');
    await click(client,'#home-series-1 .series-8f__check');
    await check(client,'window.__watch18c.telemetry.writes.length===1','marquage par le handler de production');
    await delay(300);
    await check(client,'document.querySelector("#home-series-1 [data-series-id=news-only]") && !document.querySelector("#home-series-1 .series-8f__ghost")','la carte reste en place pendant l’écriture');
    await evaluate(client,'window.__watch18c.releaseWrite()');
    await check(client,'document.querySelector("#home-series-1 .series-8f__ghost")','animation visible dans Nouveautés après acquittement');
    await check(client,'document.querySelector("#home-series-0 article").dataset.seriesId==="news-only" && !document.querySelector("#home-series-1 [data-series-id=news-only]")','arrivée en tête de Continuer à regarder');
    await delay(600);
    await check(client,'document.querySelector("#home-series-0 article").getBoundingClientRect().top<220','remontée automatique après animation');

    await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-watch-next.html'});
    await check(client,'window.__watch18c && document.querySelector("#home-series-1")','remontage swipe');
    await click(client,'[aria-label="Nouveautés en liste"]');
    await evaluate(client,'document.querySelector("#home-series-1 .home-swipe").scrollIntoView({block:"center",behavior:"instant"});window.__swipeHeight=document.querySelector("#home-series-1 .home-swipe").getBoundingClientRect().height');
    await delay(100);
    const point=await evaluate(client,'(()=>{const r=document.querySelector("#home-series-1 .home-swipe").getBoundingClientRect();return{x:r.x+r.width*.65,y:r.y+r.height*.55}})()');
    await client.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    for(let offset=15;offset<=110;offset+=15) await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-offset,y:point.y}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await check(client,'document.querySelector(".home-swipe--open") && document.querySelector(".home-swipe--open").getBoundingClientRect().height===window.__swipeHeight && document.querySelector(".home-swipe__actions").getBoundingClientRect().height===150','swipe réel sans changer la hauteur de carte');
    await click(client,'.home-swipe__actions button');
    await check(client,'window.__watch18c.telemetry.opens.filter(value=>value==="archive:news-only").length===1 && !document.querySelector(".home-swipe--open")','premier tap sur Archiver reconnu');
    await client.send('Emulation.setTouchEmulationEnabled',{enabled:false});
    await evaluate(client,'window.__watch18c.telemetry.failNext=true');
    await click(client,'#home-series-1 .series-8f__check');
    await check(client,'document.querySelector("#home-series-1 [data-error=true]") && !document.querySelector("#home-series-0 [data-series-id=news-only]") && window.__watch18c.snapshot().find(show=>show.id==="news-only").seenEpisodes.length===0','échec Nouveautés : aucun transfert ni faux succès');

    if(width===412) {
      await check(client,'window.__watch18c.telemetry.actorPrimes===32','cache initial hydraté une fois');
      await evaluate(client,'window.__watch18c.stress()');
      await check(client,'window.__watch18c.telemetry.actorPrimes===192','160 titres traités en petits lots');
      await delay(500);
      await evaluate(client,'window.__primes=window.__watch18c.telemetry.actorPrimes;window.__watch18c.burst()');
      await delay(700);
      await check(client,'window.__watch18c.telemetry.actorPrimes===window.__primes && window.__watch18c.telemetry.actorRequests===0','rafale Plex sans relire 192 caches ni télécharger des filmographies');
    }
    fs.writeFileSync(path.join(root,'quality-reports',`home-terrain220-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    reports.push({width,stableSwitch:true,swipe:true,seenTransfer:true,plexMessagesWithoutListRender:100});
  }
  return reports;
}
module.exports={testTerrain220Harness};
