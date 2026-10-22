const fs=require('node:fs');
const path=require('node:path');
const esbuild=require('esbuild');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(client, expression) {
  const result=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||'Erreur navbar');
  return result.result?.value;
}
async function check(client, expression, message) {
  for(let i=0;i<50;i++){if(await evaluate(client,`Boolean(${expression})`))return;await delay(40);}
  throw new Error('#721 '+message+': '+JSON.stringify(await evaluate(client,'({text:document.body?.innerText,telemetry:window.__nav13j?.telemetry})')));
}
async function point(client, selector) {
  return evaluate(client,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:(r.x+r.width/2-visualViewport.offsetLeft)*visualViewport.scale,y:(r.y+r.height/2-visualViewport.offsetTop)*visualViewport.scale}})()`);
}
async function tap(client, selector, button='left', hold=0) {
  const p=await point(client,selector);
  await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button,clickCount:1});
  if(hold)await delay(hold);
  await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button,clickCount:1});
  await delay(35);
}
async function buildNavbarHarness(root) {
  const ports=path.join(root,'tests/fixtures/navbar13jRuntime.ts');
  await esbuild.build({entryPoints:[path.join(root,'tests/fixtures/navbar13j.tsx')],outfile:path.join(root,'dist/__seenit-navbar.js'),bundle:true,platform:'browser',format:'iife',target:['chrome120'],logLevel:'silent',plugins:[{name:'navbar-external-ports',setup(builder){builder.onResolve({filter:/\/(?:downloadConfigStore|liveDownloadStore|useShows|showsStore|logStore)$/},()=>({path:ports}));}}]});
  const css=fs.readdirSync(path.join(root,'dist/assets')).filter(file=>file.endsWith('.css'));
  fs.writeFileSync(path.join(root,'dist/__seenit-navbar.html'),`<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file=>`<link rel="stylesheet" href="/assets/${file}">`).join('')}<link rel="stylesheet" href="/__seenit-navbar.css"><style>body{margin:0;background:#08080c;color:white}</style></head><body><div id="root"></div><script>history.replaceState({tab:"watchlist",selectedShow:null,isRoot:true}, "");sessionStorage.removeItem("seenit-nav-consulted:nav-a");sessionStorage.removeItem("seenit-nav-consulted:nav-b");</script><script src="/__seenit-navbar.js"></script></body></html>`);
}
async function testNavbarHarness(client, root) {
  const reports=[];
  const selector=tab=>`[data-navigation-tab=${tab}]`;
  for(const width of [360,412,1280]) {
    await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
    await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-navbar.html'});
    await check(client,'document.querySelectorAll("[data-navigation-tab]").length===4','quatre onglets');
    await check(client,'[...document.querySelectorAll("[data-navigation-tab]")].map(el=>el.dataset.navigationTab).join(",")==="watchlist,discover,profile,downloads"','ordre 13j');
    const geometry=await evaluate(client,'(()=>{const nav=document.querySelector("nav").getBoundingClientRect();return{nav:nav.toJSON(),buttons:[...document.querySelectorAll("[data-navigation-tab]")].map(el=>el.getBoundingClientRect().toJSON()),doc:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth}})()');
    if(geometry.buttons.some(r=>r.width<68||r.height<46||r.x<0||r.right>width)||Math.abs(geometry.nav.height-58)>1||geometry.nav.x<0||geometry.nav.right>width||geometry.doc>geometry.viewport)throw new Error('#721 géométrie '+JSON.stringify(geometry));
    // Vraie détection : A->B->B n'arme pas un double sur B.
    await tap(client,selector('discover'));await tap(client,selector('discover'));
    await check(client,'window.__nav13j.telemetry.resets.length===0','A vers B puis B ne réinitialise pas');
    await delay(380);
    for(const tab of ['watchlist','discover','profile','downloads']) {
      if(await evaluate(client,'window.__nav13j.tab()')!==tab)await tap(client,selector(tab));
      await delay(380);
      await tap(client,selector(tab));await tap(client,selector(tab));
      await check(client,`window.__nav13j.telemetry.resets.filter(t=>t===${JSON.stringify(tab)}).length===1 && document.querySelector('[data-search=${tab}]').value===''`,'double local '+tab);
      await evaluate(client,'window.__nav13j.clearToasts()');
    }
    await tap(client,selector('downloads'));
    await check(client,'window.__nav13j.telemetry.resets.filter(t=>t==="downloads").length===1','triple ne répète pas le reset');
    await delay(380);
    await evaluate(client,'document.querySelector("[data-search=downloads]").value="à garder";document.querySelector("[data-app-tab=downloads] .overflow-y-auto").scrollTop=500');
    await tap(client,selector('downloads'));await delay(400);
    await check(client,'document.querySelector("[data-app-tab=downloads] .overflow-y-auto").scrollTop<5 && document.querySelector("[data-search=downloads]").value==="à garder"','simple remonte sans effacer');
    const before=await evaluate(client,'window.__nav13j.telemetry.resets.length');
    await evaluate(client,'document.querySelector("[data-navigation-tab=downloads]").focus()');
    for(let i=0;i<2;i++){await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});}
    await check(client,`window.__nav13j.telemetry.resets.length===${before}`,'activation clavier/assistée sans double involontaire');
    for(const tab of ['watchlist','discover','downloads']) {
      await tap(client,selector(tab),'left',530);
      await check(client,`window.__nav13j.telemetry.shortcuts.filter(t=>t===${JSON.stringify(tab)}).length===1`,'appui long unique '+tab);
      if(tab==='discover'||tab==='downloads') {
        const index=await evaluate(client,'navigation.currentEntry.index');
        await tap(client,selector(tab),'left',530);
        await check(client,`navigation.currentEntry.index===${index} && window.__nav13j.telemetry.shortcuts.filter(t=>t===${JSON.stringify(tab)}).length===2`,'raccourci actif sans entrée historique doublonnée');
      }
    }
    await tap(client,selector('profile'),'right');
    await check(client,'document.querySelector(".nav-quick-account") && getComputedStyle(document.querySelector(".bottom-nav-shell")).display==="none"','clic droit ouvre réglages et masque barre');
    await evaluate(client,'window.__nav13j.toast()');
    await check(client,'document.getElementById("toast-notification-wrapper") && parseFloat(getComputedStyle(document.getElementById("toast-notification-wrapper")).bottom)===24','toast sans barre');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await check(client,'!document.querySelector("[data-dialog-layer]")','Escape ferme un seul niveau');
    await evaluate(client,'window.__nav13j.clearToasts()');
    if(width===360) {
      const p=await point(client,selector('watchlist'));
      const shortcutCount=await evaluate(client,'window.__nav13j.telemetry.shortcuts.length');
      await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
      await client.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+15,y:p.y,button:'left'});
      await delay(530);
      await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+15,y:p.y,button:'left',clickCount:1});
      await check(client,`window.__nav13j.telemetry.shortcuts.length===${shortcutCount}`,'mouvement annule appui long et clic final');
      await evaluate(client,'document.querySelector("[data-navigation-tab=watchlist]").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,isPrimary:true,button:0}));document.querySelector("[data-navigation-tab=watchlist]").dispatchEvent(new PointerEvent("pointercancel",{bubbles:true}))');
      await delay(530);
      await check(client,`window.__nav13j.telemetry.shortcuts.length===${shortcutCount}`,'pointercancel annule le timer');
    }
    // États live, acquittement et isolation par compte.
    await tap(client,selector('discover'));
    const beforeSettings=await evaluate(client,'navigation.currentEntry.index');
    await tap(client,selector('profile'),'right');
    await check(client,'document.querySelector(".nav-quick-account")','feuille depuis Explorer');
    await tap(client,'.nav-quick-account > button');
    await check(client,`window.__nav13j.tab()==="profile" && !document.querySelector(".nav-quick-account") && navigation.currentEntry.index===${beforeSettings+1} && !history.state.seenitDialog`,'Tous les réglages dépile la feuille avant navigation réelle');
    await evaluate(client,'history.back()');
    await check(client,'window.__nav13j.tab()==="discover" && !document.querySelector(".nav-quick-account")','Retour après Réglages rejoint directement Explorer');
    await tap(client,selector('profile'));
    const profileIndex=await evaluate(client,'navigation.currentEntry.index');
    await tap(client,selector('profile'),'right');
    await check(client,'document.querySelector(".nav-quick-account")','feuille depuis Moi');
    await tap(client,'.nav-quick-account > button');
    await check(client,`window.__nav13j.tab()==="profile" && !document.querySelector(".nav-quick-account") && navigation.currentEntry.index===${profileIndex} && !history.state.seenitDialog`,'Moi actif sans entrée identique ni feuille fantôme');
    await evaluate(client,'history.back()');
    await check(client,'window.__nav13j.tab()==="discover"','un seul Retour depuis Moi rejoint la vraie destination précédente');
    if(width===360) {
      await evaluate(client,'document.querySelector("[data-navigation-tab=profile]").focus()');
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'F10',code:'F10',modifiers:8});
      await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'F10',code:'F10',modifiers:8});
      await check(client,'document.querySelector(".nav-quick-account")','raccourci clavier alternatif');
      await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
      await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
      await check(client,'!document.querySelector("[data-dialog-layer]")','fermeture raccourci clavier');
      const p=await point(client,selector('downloads'));
      const count=await evaluate(client,'window.__nav13j.telemetry.shortcuts.length');
      await client.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
      await evaluate(client,'window.__nav13j.enabled(false)');
      await delay(530);
      await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
      await check(client,`window.__nav13j.telemetry.shortcuts.length===${count} && window.__nav13j.telemetry.liveSubscriptions===0`,'démontage annule le long et la souscription');
      await evaluate(client,'window.__nav13j.enabled(true)');
      await check(client,'document.querySelectorAll("[data-navigation-tab]").length===4','rétablissement après démontage');
    }
    await tap(client,selector('watchlist'));await delay(380);
    await evaluate(client,'window.__nav13j.downloads([{id:"one",status:"downloading",progress:20}])');
    await check(client,'document.querySelector(".navigation-download-dot")?.dataset.kind==="active" && document.querySelector("[data-navigation-tab=downloads]").getAttribute("aria-label")==="Télécharger · en cours" && !document.querySelector(".navigation-download-dot").textContent.trim()','un actif = point sans nombre');
    await evaluate(client,'window.__nav13j.downloads([{id:"one",status:"downloading"},{id:"two",status:"queued"},{id:"bad",status:"error"}])');
    await check(client,'document.querySelector(".navigation-download-dot").textContent==="2"','plusieurs actifs prioritaires');
    await evaluate(client,'window.__nav13j.downloads([{id:"bad",status:"warning",progress:100}])');
    await check(client,'document.querySelector(".navigation-download-dot")?.dataset.kind==="attention"','import manuel attention');
    await evaluate(client,'window.__nav13j.downloads([{id:"done",status:"completed",progress:100}])');
    await check(client,'document.querySelector(".navigation-download-dot")?.dataset.kind==="ready"','prêt non consulté');
    await tap(client,selector('downloads'));
    await check(client,'!document.querySelector(".navigation-download-dot")','prêt acquitté à ouverture');
    await tap(client,selector('watchlist'));
    await evaluate(client,'window.__nav13j.account("nav-b")');
    await check(client,'document.querySelector(".navigation-download-dot")?.dataset.kind==="ready"','acquittement isolé par UID');
    await evaluate(client,'window.__nav13j.account("nav-a")');
    await check(client,'!document.querySelector(".navigation-download-dot")','retour compte retrouve son acquittement');
    await evaluate(client,'window.__nav13j.enabled(false)');
    await check(client,'document.querySelectorAll("[data-navigation-tab]").length===3 && !document.querySelector(".navigation-separator") && window.__nav13j.telemetry.liveSubscriptions===0','désactivé sans badge/souscription');
    await evaluate(client,'window.__nav13j.enabled(true)');
    await check(client,'document.querySelectorAll("[data-navigation-tab]").length===4','réactivation');
    await evaluate(client,'window.__nav13j.toast()');
    await check(client,'document.getElementById("toast-notification-wrapper") && parseFloat(getComputedStyle(document.getElementById("toast-notification-wrapper")).bottom)===80','toast au-dessus îlot');
    await delay(250);
    const capture=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(root,'quality-reports',`navbar-13j-${width}.png`),Buffer.from(capture.data,'base64'));
    await evaluate(client,'window.__nav13j.clearToasts();window.__nav13j.detail()');
    await check(client,'getComputedStyle(document.querySelector(".bottom-nav-shell")).display==="none" && document.querySelector("[data-dialog-layer]").getBoundingClientRect().height>=900','fiche plein écran sans barre');
    await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await check(client,'getComputedStyle(document.querySelector(".bottom-nav-shell")).display!=="none"','barre restaurée au retour');
    await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(client,'window.__nav13j.downloads([{id:"active",status:"downloading"}]);document.documentElement.style.fontSize="32px"');
    await check(client,'getComputedStyle(document.querySelector(".navigation-download-dot")).animationName==="none" && document.documentElement.scrollWidth<=document.documentElement.clientWidth','reduced-motion et texte agrandi');
    await evaluate(client,'document.documentElement.style.setProperty("--seenit-safe-area-bottom","24px")');
    await check(client,'parseFloat(getComputedStyle(document.querySelector(".bottom-nav-shell")).bottom)===34','safe area');
    if(await evaluate(client,'window.__nav13j.telemetry.mutations')!==0)throw new Error('#721 mutation métier depuis navigation');
    await client.send('Emulation.setEmulatedMedia',{features:[]});
    await evaluate(client,'document.documentElement.style.fontSize="";document.documentElement.style.removeProperty("--seenit-safe-area-bottom")');
    reports.push({width,status:'pass'});
  }
  return reports;
}
module.exports={buildNavbarHarness,testNavbarHarness};
