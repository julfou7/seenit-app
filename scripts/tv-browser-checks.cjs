const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fulfillTvFixtureImage(client, event, root) {
  const url = new URL(event.request.url);
  if (url.origin !== 'https://image.tmdb.org' || !/^\/t\/p\/(?:w500|w1280)\/__seenit_fixture_(?:poster|backdrop)\.jpg$/.test(url.pathname)) return false;
  await client.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }], body: fs.readFileSync(path.join(root, 'tests/fixtures/tv-film-scene.svg')).toString('base64') });
  return true;
}

async function buildTvHarness(root) {
  const target = path.join(root, 'dist/__seenit-tv');
  fs.mkdirSync(target, { recursive: true });
  for (const file of ['index.html', 'styles.css', 'tv.js', 'model.js', 'connection.js', 'sport.js', 'app.js']) fs.copyFileSync(path.join(root, 'tv-samsung', file), path.join(target, file));
  fs.cpSync(path.join(root, 'tv-samsung/assets'), path.join(target, 'assets'), { recursive: true });
  fs.cpSync(path.join(root, 'tv-samsung/vendor'), path.join(target, 'vendor'), { recursive: true });
  const mock = `(function(){
    localStorage.clear();
    var apps=${JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/tv-samsung-tizen4-apps.json'), 'utf8')))};
    for(var i=0;i<123;i++)apps.push({id:'custom.'+i,name:'Custom '+('000'+i).slice(-3),show:true});
    apps[13].iconPath='/__seenit-tv/assets/apps/netflix.svg';
    var t=window.__tv={apps:apps,launches:[],clicks:[],errors:[],inventoryCalls:0,settings:0,exits:0,hidden:false,intervals:{},failLaunch:false};
    document.addEventListener('click',function(e){t.clicks.push(e.target.id+':'+e.target.getAttribute('data-action'))},true);
    window.addEventListener('error',function(e){if(e.message)t.errors.push(e.message)});
    t.connectionRequests=[];t.pairApproved=false;
    window.XMLHttpRequest=function(){var xhr=this;this.open=function(method,url){xhr.method=method;xhr.url=url};this.setRequestHeader=function(){};this.abort=function(){xhr.aborted=true};this.send=function(body){t.connectionRequests.push(xhr.url);setTimeout(function(){if(xhr.aborted)return;var response;if(xhr.url.endsWith('/api/tv/sport'))response={events:t.sportEvents||[],sources:[],fetchedAt:Date.now()};else if(xhr.url.endsWith('/api/tv/links')){var input=JSON.parse(body);response={id:'a'.repeat(48),secret:'b'.repeat(64),code:'ABCD-EF12',profile:input.profile,expiresAt:Date.now()+600000}}else if(xhr.url.endsWith('/status'))response={state:t.pairApproved?'active':'pending',profile:'Julian',expiresAt:Date.now()+3600000,accountName:'Test account'};else if(xhr.url.endsWith('/bootstrap'))response={state:'active',profile:'Julian',syncedAt:Date.now(),items:Array.from({length:7},function(_,i){return{tmdbId:i+1,title:i===0?'Une très longue série dont le titre reste lisible dans le grand visuel':'Contenu '+(i+1),mediaType:i%3===0?'movie':'tv',status:i<5?'watching':'plan_to_watch',posterPath:'/__seenit_fixture_poster.jpg',backdropPath:'/__seenit_fixture_backdrop.jpg',nextEpisode:i%3?{season:2,episode:3,name:'Épisode de reprise'}:null}})};else response={revoked:true};xhr.status=200;xhr.readyState=4;xhr.responseText=JSON.stringify(response);if(xhr.onreadystatechange)xhr.onreadystatechange()},20)}};
    var nativeSet=window.setInterval,nativeClear=window.clearInterval;
    window.setInterval=function(fn,ms){var id=nativeSet(fn,ms);t.intervals[id]=ms;return id};
    window.clearInterval=function(id){delete t.intervals[id];nativeClear(id)};
    Object.defineProperty(document,'hidden',{get:function(){return t.hidden}});
    t.visibility=function(hidden){t.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'))};
    if(location.search.indexOf('preview=1')>=0)return;
    window.tizen={ApplicationControl:function(){},application:{
      getAppsInfo:function(done){t.inventoryCalls++;setTimeout(function(){done(t.apps)},0)},
      launch:function(id,done,fail){t.launches.push(id);if(t.failLaunch)fail();else done()},
      getAppInfo:function(id){if(id==='org.tizen.menu')return{id:id};throw Error('missing')},
      findAppControl:function(c,done){done(t.noSettings?[]:[{id:'verified.settings'}])},
      launchAppControl:function(c,id,done){t.settings++;done()},
      getCurrentApplication:function(){return{appInfo:{id:'SeenItTV01.SeenItTV'},exit:function(){t.exits++}}}
    },systeminfo:{getTotalMemory:function(){return 1610612736},getAvailableMemory:function(){return 0},getPropertyValue:function(kind,done){
      var sources={connected:[{type:'HDMI',number:1},{type:'TV',number:0}],disconnected:[{type:'HDMI',number:2},{type:'HDMI',number:3},{type:'HDMI',number:4}]};t.nativeSources=sources.connected.concat(sources.disconnected);
      done(kind==='STORAGE'?{units:[{capacity:4000000000,availableCapacity:0,isRemovable:false}]}:sources)
    }},tvwindow:{setSource:function(source,done){if(t.nativeSources.indexOf(source)<0)throw Error('Native descriptor identity lost');t.source=source;done()}}};
  })();`;
  const html = fs.readFileSync(path.join(target, 'index.html'), 'utf8').replace('<script src="tv.js">', '<script>' + mock + '</script><script src="tv.js">');
  fs.writeFileSync(path.join(target, 'index.html'), html);
}
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function check(client, expression, message) {
  for (let i = 0; i < 35; i++) { if (await evaluate(client, expression)) return; await delay(40); }
  throw new Error('SEENIT-TV-001 ' + message + ': ' + JSON.stringify(await evaluate(client, '({appHeight:document.querySelector("#appRow .app-card")?.getBoundingClientRect().height,headingFont:document.querySelector("#screenHome h2")&&getComputedStyle(document.querySelector("#screenHome h2")).fontSize,gear:!!document.querySelector(".header-settings svg"),errors:window.__tv.errors,clicks:window.__tv.clicks,storage:JSON.stringify(localStorage),screen:document.querySelector(".screen.active").id,focus:document.activeElement.outerHTML,toast:document.getElementById("toast").textContent})')));
}
async function key(client, code) {
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await delay(180);
}
async function click(client, selector) { await evaluate(client, `document.querySelector(${JSON.stringify(selector)}).click()`); await delay(40); }
async function screenshot(client, root, name) {
  fs.mkdirSync(path.join(root, 'quality-reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'quality-reports', name), Buffer.from((await client.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
}
async function testTvHarness(client, root) {
  const reports = [];
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-tv/index.html' });
    await check(client, 'window.__tv && window.TVModel && document.activeElement.dataset.profile === "Julian"', 'entrée profils');
    await check(client, `Math.abs(document.querySelector('.profiles-wrap').getBoundingClientRect().left+document.querySelector('.profiles-wrap').getBoundingClientRect().width/2-${width}/2)<2`, 'choix des profils centré');
    await check(client, 'Array.from(document.querySelectorAll(".profile-card strong,.profile-card small")).every(n=>{const range=document.createRange();range.selectNodeContents(n);const text=range.getBoundingClientRect(),card=n.closest("button").getBoundingClientRect();return Math.abs(text.left+text.width/2-card.left-card.width/2)<2})', 'noms et sous-titre Invité centrés sous chaque avatar');
    await screenshot(client, root, 'tv-profiles-'+width+'.png');
    await key(client, 13);
    await check(client, 'document.activeElement.id === "primaryTv"', 'focus initial TV');
    await check(client, `document.querySelectorAll('#appRow .app-card').length===8 && document.querySelectorAll('#homeSources .source-card').length===4 && document.querySelector('#homeSources [data-source-number="4"]')`, 'rail favoris utiles plus Ajouter/Toutes et quatre HDMI réellement déclarés');
    await check(client, `Array.from(document.querySelectorAll('#appRow [data-app-id]')).filter(n=>n.dataset.appTitle==='Netflix').length===1 && document.querySelector('#appRow [data-app-title=Netflix]').dataset.appId==='RN1MCdNq8t.Netflix'`, 'inventaire réel Tizen4 : une seule tuile Netflix, variante installée');
    await check(client, `Array.from(document.querySelectorAll('#appRow [data-app-id] img')).every(n=>n.naturalWidth>0)`, 'logos vectoriels homogènes avant les icônes natives');
    await check(client, `Math.round(document.querySelector('#appRow .app-card').getBoundingClientRect().height)>=${Math.floor(height / 1080 * 128)} && getComputedStyle(document.querySelector('.home-settings-zone h2')).fontSize==='24px' && document.querySelector('.header-settings svg')`, 'logos et libellés lisibles sans emoji de réglages');
    await check(client, '!document.getElementById("homeEvents").textContent.includes("Monaco")', 'aucun faux événement en mode Samsung');
    await check(client, 'getComputedStyle(document.getElementById("homeEvents")).display==="none"', 'aucun bloc sport vide sur Home');
    await check(client, `Array.from(document.querySelectorAll('.screen.active .primary-card')).every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=${width}&&r.bottom<=${height}})`, 'aucune carte coupée');
    await key(client, 13); await check(client, 'window.__tv.source.type==="TV"', 'tuner réel');
    await key(client, 39); await key(client, 39);
    await check(client, 'document.activeElement.id==="sportTile"', 'télécommande trois destinations');
    await click(client, '.header-settings');
    await check(client, 'document.getElementById("screenHome").dataset.lower==="true" && document.activeElement.classList.contains("home-setting-card")', 'roue mène aux réglages bas sans déplacer l’en-tête');
    await screenshot(client, root, `tv-home-lower-${width}.png`);
    await click(client, '#screenHome [data-action=samsung-settings]');
    await check(client, 'window.__tv.settings===1', 'menu natif vérifié');
    await evaluate(client, 'window.__tv.noSettings=true');
    await click(client, '#screenHome [data-action=samsung-settings]');
    await check(client, 'document.querySelector(".screen.active").id==="screenSamsungSettings" && document.querySelector("#screenSamsungSettings p").textContent.includes("télécommande")', 'sans handler natif, alternative visible et utilisable');
    await key(client, 8);
    await click(client, '#screenHome [data-action=appearance]'); await click(client, '[data-theme=mist]');
    await check(client, 'document.getElementById("stage").classList.contains("light-theme") && document.querySelector(".brand").getAttribute("src")==="assets/seenit-tv-dark.svg"', 'thème clair avec contraste du logo');
    await check(client, 'localStorage.getItem("seenit.tv.appearance.v1")==="mist" && document.fonts.check("600 24px \\"Plus Jakarta Sans\\"")', 'apparence de démarrage et police locale disponibles');
    await click(client, '#screenAppearance [data-action=motion]');
    await check(client, 'document.getElementById("stage").classList.contains("reduced-motion")', 'mouvements désactivables');
    await screenshot(client, root, `tv-appearance-${width}.png`);
    await key(client, 8);
    await click(client, '#screenHome [data-action=diagnostics]');
    await check(client, 'document.getElementById("diagMemory").textContent.includes("0 Mo") && document.getElementById("diagStorage").textContent.includes("0 Mo")', 'zéro libre ne devient pas indisponible');
    await key(client, 8); await key(client, 8);
    await check(client, 'document.activeElement.id==="primaryTv" && document.getElementById("screenHome").dataset.lower==="false"', 'Retour remonte la Home avant de quitter');
    await screenshot(client, root, `tv-home-${width}.png`);
    await click(client, '#screenHome [data-action=account]');
    await click(client, '#pairButton');
    await check(client, 'document.querySelector("#pairQr svg") && document.getElementById("pairCode").textContent==="ABCD-EF12"', 'QR produit réel et code lisible');
    await check(client, '!document.getElementById("pairQr").innerHTML.includes("b".repeat(64))', 'secret absent du QR');
    await screenshot(client, root, `tv-account-qr-${width}.png`);
    await evaluate(client, 'window.__tv.pairApproved=true'); await delay(5100);
    await check(client, 'TVConnection.view().linked && TVConnection.view().items.length===7 && document.getElementById("accountTitle").textContent==="Test account"', 'approbation et bootstrap via vrai client TV');
    await key(client, 8); await click(client, '#screenHome [data-action=films]');
    await check(client, 'document.querySelectorAll("#linkedFilms .film-content-card").length===4 && !document.querySelector("#screenFilms .app-card")', 'Films : quatre contenus, aucune rangée apps');
    await check(client, 'document.getElementById("filmHeroTitle").textContent.length>0 && document.querySelector("#filmBackdrop img").naturalWidth>0 && Array.from(document.querySelectorAll("#linkedFilms img")).every(n=>n.naturalWidth>0)', 'hero et rail chargent les images du bootstrap');
    await check(client, `Array.from(document.querySelectorAll('#linkedFilms .film-content-card')).every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=${width}&&r.bottom<=${height}})`, 'cartes paysage dans viewport');
    await screenshot(client, root, 'tv-films-'+width+'.png');
    await key(client, 40); await check(client, 'document.activeElement.dataset.filmIndex!==undefined', 'rail accessible depuis hero');
    await key(client, 39);
    await check(client, 'document.getElementById("filmHeroTitle").textContent===document.activeElement.getAttribute("aria-label")', 'focus actualise le contenu du hero');
    const filmFocus=await evaluate(client,'document.activeElement.id');
    const filmTitle=await evaluate(client,'document.getElementById("filmHeroTitle").textContent');
    await key(client, 13); await check(client, `document.querySelector('.screen.active').id==='screenFilmDetail' && document.getElementById('filmDetailTitle').textContent===${JSON.stringify(filmTitle)} && document.getElementById('filmDetailMeta').textContent.length>0`, 'OK rend la vraie fiche immédiatement, sans nouveau bootstrap');
    await check(client, 'getComputedStyle(document.querySelector("#screenFilmDetail .dialog-panel")).color==="rgb(41, 61, 81)"', 'fiche conserve le contraste Brume');
    await key(client, 8); await check(client, `document.activeElement.id===${JSON.stringify(filmFocus)}`, 'retour garde contenu et focus');
    await click(client, '#filmNext'); await check(client, 'document.querySelectorAll("#linkedFilms .film-content-card").length===3', 'suite de la liste accessible');
    await click(client, '#filmTabs [data-film-filter=movie]'); await check(client, 'document.querySelectorAll("#linkedFilms .film-content-card").length===3 && document.getElementById("filmNext").disabled', 'filtre films indépendant des séries');
    await click(client, '#screenFilms [data-action=account]');
    await click(client, '#unlinkButton'); await check(client, 'document.querySelector(".screen.active").id==="screenUnlink"', 'dissociation exige confirmation');
    await click(client, '#screenUnlink [data-action=confirm-unlink]');
    await check(client, '!TVConnection.view().linked && !localStorage.getItem("seenit.tv.v4.foyer")', 'dissociation enlève session et données privées');
    await key(client, 8); await key(client, 8);
    const homeId = await evaluate(client, 'document.querySelector("#appRow [data-app-id]").dataset.appId');
    await evaluate(client, 'document.querySelector("#appRow [data-app-id]").focus()');
    await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await delay(620); await client.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await check(client, 'document.querySelector(".screen.active").id==="screenAppMenu" && window.__tv.launches.length===1', 'appui long ouvre le menu sans lancer');
    await click(client, '#screenAppMenu [data-action=menu-right]');
    await check(client, `document.querySelectorAll('#appRow [data-app-id]')[1].dataset.appId===${JSON.stringify(homeId)}`, 'ordre modifiable par télécommande');
    await evaluate(client, 'document.querySelector("#appRow [data-app-id]").focus()');
    await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await delay(620); await client.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    const hiddenId = await evaluate(client, 'document.getElementById("appMenuTitle").textContent');
    await click(client, '#screenAppMenu [data-action=menu-hide]');
    await check(client, `!Array.from(document.querySelectorAll('#appRow [data-app-id]')).some(n=>n.dataset.appTitle===${JSON.stringify(hiddenId)})`, 'masquage sans réapparition automatique');
    await click(client, '#appRow [data-action=all-apps]');
    await check(client, 'document.querySelectorAll("#allAppsGrid .app-card").length===18 && document.getElementById("appsCount").textContent==="130 apps"', '136 packages / 130 apps distinctes / 18 cartes');
    await click(client, '#pageNext'); await check(client, 'document.getElementById("pageStatus").textContent==="Page 2/8"', 'pagination accessible');
    await click(client, '#manageApps');
    const pin = await evaluate(client, 'document.querySelector("#allAppsGrid .app-card").dataset.appId');
    await click(client, '#allAppsGrid .app-card');
    await check(client, `TVModel.preferences(localStorage,'Julian').pins().includes(${JSON.stringify(pin)})`, 'favori de nouvelle app');
    await click(client, '#manageApps');
    await click(client, '#tabSystem');
    await check(client, 'document.querySelectorAll("#allAppsGrid .app-card").length===6 && document.querySelectorAll("#allAppsGrid .app-class")[0]', 'système, inconnu et variantes conservés');
    const launches = await evaluate(client, 'window.__tv.launches.length');
    await click(client, '#allAppsGrid .app-card'); await check(client, `window.__tv.launches.length===${launches}`, 'pas de lancement système');
    await click(client, '#allAppsGrid [data-app-title=Netflix]');
    await check(client, `window.__tv.launches.length===${launches + 1} && ['org.tizen.netflix-app','org.tizen.netflixlowmem'].includes(window.__tv.launches.at(-1))`, 'variante utilisateur accessible explicitement par son ID détecté');
    await click(client, '#tabUser');
    const launched = await evaluate(client, 'document.querySelector("#allAppsGrid .app-card").dataset.appId');
    await click(client, '#allAppsGrid .app-card');
    await check(client, `TVModel.preferences(localStorage,'Julian').recent()[0]===${JSON.stringify(launched)}`, 'réouverture réussie');
    await evaluate(client, 'window.__tv.failLaunch=true'); await click(client, '#allAppsGrid .app-card:nth-child(2)');
    await check(client, `TVModel.preferences(localStorage,'Julian').recent()[0]===${JSON.stringify(launched)}`, 'échec ne crée pas de reprise');
    await evaluate(client, 'window.__tv.failLaunch=false');
    await check(client, 'document.querySelector("#allAppsGrid img").naturalWidth>0', 'icône native chargée avant libération');
    for (let i = 0; i < 4; i++) {
      await evaluate(client, 'window.__tv.visibility(true)');
      await check(client, 'Object.keys(window.__tv.intervals).length===0 && document.querySelectorAll("#allAppsGrid img").length===0 && document.querySelectorAll("#appRow .app-card").length===0', 'libération en arrière-plan');
      await evaluate(client, 'window.__tv.visibility(false)');
      await check(client, 'Object.keys(window.__tv.intervals).length===3 && document.querySelectorAll("#allAppsGrid .app-card").length===18', 'reprise sans accumulation');
    }
    await evaluate(client, 'window.__tv.apps.push({id:"new.installed",name:"New App",show:true})');
    await click(client, '#screenApps [data-action=refresh]');
    await check(client, 'document.getElementById("appsCount").textContent==="131 apps"', 'nouvelle installation détectée');
    await key(client, 8);
    await evaluate(client, `window.__tv.sportEvents=Array.from({length:7},(_,i)=>({id:'fixture-'+i,sourceId:'monaco',kickoff:new Date(Date.now()+(i+1)*86400000).toISOString(),confirmed:i!==2,home:{name:'Monaco',logo:'assets/sport/monaco.svg'},away:{name:'Italie',logo:'assets/sport/italy.svg'},competition:'Calendrier de test',venue:'Stade de test'}));TVSport.refresh(true)`);
    await check(client, 'document.getElementById("sportCopy").textContent==="Monaco — Italie"', 'prochain rendez-vous normalisé dans la tuile Home');
    await check(client, 'getComputedStyle(document.getElementById("sportCopy")).display!=="none" && getComputedStyle(document.querySelector("#sportTile small")).display!=="none"', 'prochain match et heure réellement visibles sans entrer dans Sport');
    await check(client, 'document.querySelectorAll("#homeEvents .event-card").length===0', 'Home V4 utilise la tuile Sport sans créer de cartes/images cachées');
    await click(client, '#sportTile');
    await check(client, 'document.querySelectorAll("#calendarList .event-card").length===6 && document.getElementById("sportPage").textContent==="1 / 2"', 'calendrier réel borné à six cartes');
    await check(client, 'document.querySelectorAll("#calendarList .event-card")[2].textContent.includes("horaire à confirmer")', 'horaire provisoire distinct');
    await check(client, `Array.from(document.querySelectorAll('#calendarList .event-card')).every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=${width}&&r.bottom<=${height}})`, 'six matchs sans carte coupée');
    await click(client, '#calendarList .event-card');
    await check(client, 'getComputedStyle(document.getElementById("toast")).color!==getComputedStyle(document.getElementById("toast")).backgroundColor && getComputedStyle(document.getElementById("toast")).color==="rgb(36, 48, 68)"', 'message Brume lisible');
    await screenshot(client, root, 'tv-sport-fixtures-'+width+'.png');
    await click(client, '#sportNext');
    await check(client, 'document.querySelectorAll("#calendarList .event-card").length===1 && document.getElementById("sportPage").textContent==="2 / 2"', 'septième match accessible');
    await click(client, '#sportTeams [data-team=monaco]');
    await check(client, 'document.querySelectorAll("#calendarList .event-card").length===0', 'désélection sans score ni héritage');
    await click(client, '#sportTeams [data-team=monaco]');
    await key(client, 8);
    await click(client, '#appRow [data-action=all-apps]');
    await screenshot(client, root, `tv-apps-${width}.png`);
    await key(client, 8); await click(client, '#screenHome [data-action=switch-profile]');
    await click(client, '[data-profile=Camille]');
    await check(client, 'TVModel.preferences(localStorage,"Camille").recent().length===0', 'pas de reprise Netflix inventée pour Camille');
    await click(client, '#screenHome [data-action=switch-profile]'); await click(client, '[data-profile=Milo]');
    await check(client, 'document.querySelectorAll("#appRow [data-app-id]").length===0', 'Milo sans apps ajoutées automatiquement');
    await click(client, '#appRow [data-action=all-apps]');
    await check(client, 'document.querySelectorAll("#allAppsGrid .app-card").length===0 && getComputedStyle(document.getElementById("tabSystem")).display==="none"', 'sélection Milo uniquement, système masqué');
    await click(client, '#manageApps'); await click(client, '#allAppsGrid .app-card'); await click(client, '#manageApps');
    await check(client, 'document.querySelectorAll("#allAppsGrid .app-card").length===1 && TVModel.preferences(localStorage,"Milo").pins().length===1', 'sélection des apps Milo sans code');
    await key(client, 8); await check(client, 'document.querySelectorAll("#appRow [data-app-id]").length===1', 'Home Milo après sélection');
    await key(client, 8); await check(client, 'document.activeElement.id==="stayButton" && window.__tv.exits===0', 'confirmation de sortie défaut rester');
    await key(client, 13); await check(client, 'document.querySelector(".screen.active").id==="screenHome"', 'annulation de sortie');
    await key(client, 8); await key(client, 39); await key(client, 13);
    await check(client, 'window.__tv.exits===1', 'sortie seulement après choix explicite');
    await click(client, '#screenExit [data-action=back]');
    await click(client, '#screenHome [data-action=switch-profile]');
    await evaluate(client, '(function(){var p=TVModel.preferences(localStorage,"Julian");if(p.pins().indexOf("RN1MCdNq8t.Netflix")<0)p.toggle("RN1MCdNq8t.Netflix")})()');
    await click(client, '[data-profile=Julian]');
    const pinsBeforeVariant = await evaluate(client, 'JSON.stringify(TVModel.preferences(localStorage,"Julian").pins())');
    await click(client, '#appRow [data-action=all-apps]'); await click(client, '#tabSystem');
    await evaluate(client, 'document.querySelector("#allAppsGrid [data-app-id=\\"org.tizen.netflix-app\\"]").focus()');
    await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await delay(620); await client.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await check(client, 'document.querySelector(".screen.active").id==="screenAppMenu" && document.getElementById("menuTarget").offsetWidth>0', 'choix explicite de variante réellement inventoriée');
    await click(client, '#menuTarget'); await key(client, 8);
    await click(client, '#appRow [data-app-title=Netflix]');
    await check(client, `window.__tv.launches[window.__tv.launches.length-1]==='org.tizen.netflix-app' && JSON.stringify(TVModel.preferences(localStorage,'Julian').pins())===${JSON.stringify(pinsBeforeVariant)}`, 'la tuile ouvre la version choisie sans changer ses favoris');
    await check(client, 'window.__tv.errors.length===0', 'aucune erreur JavaScript');
    reports.push({ width, height, apps: 137, distinctUserApps: 131, advancedApps: 6, libraryDomMax: 18, backgroundIntervals: 0, resumeCycles: 4, remote: 'passed', native: 'mocked-from-tizen4-fixture' });
  }
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-tv/index.html?preview=1' });
  await check(client, 'window.TVModel && document.querySelector("[data-profile=Julian]")', 'preview sans API Samsung');
  await click(client, '[data-profile=Julian]');
  await check(client, 'document.querySelectorAll("#homeEvents .event-card").length===2 && Array.from(document.querySelectorAll("#homeEvents .team-badge img")).every(n=>n.naturalWidth>0)', 'logos explicites des deux équipes dans chaque rendez-vous');
  await click(client, '#sportTile');
  await check(client, 'document.querySelectorAll("#calendarList .team-badge img").length===6 && Array.from(document.querySelectorAll("#calendarList .team-badge img")).every(n=>n.naturalWidth>0)', 'calendrier avec six logos chargés');
  await screenshot(client, root, 'tv-calendar-logos-1920.png');
  await evaluate(client, 'document.querySelector("#calendarList img").dispatchEvent(new Event("error"))');
  await check(client, 'document.querySelector("#calendarList .team-badge").textContent==="M" && document.querySelectorAll("#calendarList .team-name").length===6', 'logo manquant conserve initiale et noms');
  await evaluate(client, 'window.__tv.visibility(true)');
  await check(client, 'document.querySelectorAll("#calendarList img").length===0 && Object.keys(window.__tv.intervals).length===0', 'logos du calendrier libérés en arrière-plan');
  return reports;
}
module.exports = { buildTvHarness, testTvHarness, fulfillTvFixtureImage };
