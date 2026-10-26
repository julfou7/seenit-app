const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function buildTvHarness(root) {
  const target = path.join(root, 'dist/__seenit-tv');
  fs.mkdirSync(target, { recursive: true });
  for (const file of ['index.html', 'styles.css', 'tv.js', 'model.js', 'app.js']) fs.copyFileSync(path.join(root, 'tv-samsung', file), path.join(target, file));
  fs.cpSync(path.join(root, 'tv-samsung/assets'), path.join(target, 'assets'), { recursive: true });
  const mock = `(function(){
    localStorage.clear();
    var apps=[{id:'real.netflix.id',name:'Netflix',show:true},{id:'real.plex.id',name:'Plex',show:true},{id:'real.youtube.id',name:'YouTube',show:true}];
    for(var i=0;i<127;i++)apps.push({id:'custom.'+i,name:'Custom '+('000'+i).slice(-3),show:true});
    apps[3].iconPath='/__seenit-tv/assets/apps/netflix.svg';
    apps.push({id:'org.tizen.menu',name:'Samsung Menu',show:false},{id:'ambiguous'});
    var t=window.__tv={apps:apps,launches:[],clicks:[],errors:[],inventoryCalls:0,settings:0,exits:0,hidden:false,intervals:{},failLaunch:false};
    document.addEventListener('click',function(e){t.clicks.push(e.target.id+':'+e.target.getAttribute('data-action'))},true);
    window.addEventListener('error',function(e){if(e.message)t.errors.push(e.message)});
    var nativeSet=window.setInterval,nativeClear=window.clearInterval;
    window.setInterval=function(fn,ms){var id=nativeSet(fn,ms);t.intervals[id]=ms;return id};
    window.clearInterval=function(id){delete t.intervals[id];nativeClear(id)};
    Object.defineProperty(document,'hidden',{get:function(){return t.hidden}});
    t.visibility=function(hidden){t.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'))};
    window.tizen={ApplicationControl:function(){},application:{
      getAppsInfo:function(done){t.inventoryCalls++;setTimeout(function(){done(t.apps)},0)},
      launch:function(id,done,fail){t.launches.push(id);if(t.failLaunch)fail();else done()},
      getAppInfo:function(id){if(id==='org.tizen.menu')return{id:id};throw Error('missing')},
      findAppControl:function(c,done){done([{id:'verified.settings'}])},
      launchAppControl:function(c,id,done){t.settings++;done()},
      getCurrentApplication:function(){return{exit:function(){t.exits++}}}
    },systeminfo:{getTotalMemory:function(){return 1610612736},getAvailableMemory:function(){return 0},getPropertyValue:function(kind,done){
      done(kind==='STORAGE'?{units:[{capacity:4000000000,availableCapacity:0,isRemovable:false}]}:{connected:[{type:'HDMI',number:1},{type:'TV',number:0}],disconnected:[{type:'HDMI',number:2}]})
    }},tvwindow:{setSource:function(source,done){t.source=source;done()}}};
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
  throw new Error('SEENIT-TV-001 ' + message + ': ' + JSON.stringify(await evaluate(client, '({errors:window.__tv.errors,clicks:window.__tv.clicks,storage:JSON.stringify(localStorage),screen:document.querySelector(".screen.active").id,focus:document.activeElement.outerHTML,toast:document.getElementById("toast").textContent})')));
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
    await key(client, 13);
    await check(client, 'document.activeElement.id === "primaryTv"', 'focus initial TV');
    await check(client, 'document.querySelectorAll("#appRow .app-card").length===6 && document.querySelectorAll("#homeSources .source-card").length===2', 'rails 5+1 et deux sources');
    await check(client, '!document.getElementById("homeEvents").textContent.includes("Monaco")', 'aucun faux événement en mode Samsung');
    await check(client, 'getComputedStyle(document.getElementById("homeEvents")).display==="none"', 'aucun bloc sport vide sur Home');
    await check(client, `Array.from(document.querySelectorAll('.screen.active .focusable')).every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=${width}&&r.bottom<=${height}})`, 'aucune carte coupée');
    await key(client, 13); await check(client, 'window.__tv.source.type==="TV"', 'tuner réel');
    for (let i = 0; i < 3; i++) await key(client, 39);
    await check(client, 'document.activeElement.dataset.action==="settings"', 'télécommande quatre destinations');
    await key(client, 13); await click(client, '#screenSettings [data-action=samsung-settings]');
    await check(client, 'window.__tv.settings===1', 'menu natif vérifié');
    await click(client, '#screenSettings [data-action=appearance]'); await click(client, '[data-theme=mist]');
    await check(client, 'document.getElementById("stage").classList.contains("light-theme") && document.querySelector(".brand").getAttribute("src")==="assets/seenit-tv-dark.svg"', 'thème clair avec contraste du logo');
    await click(client, '#screenAppearance [data-action=motion]');
    await check(client, 'document.getElementById("stage").classList.contains("reduced-motion")', 'mouvements désactivables');
    await screenshot(client, root, `tv-appearance-${width}.png`);
    await key(client, 8);
    await click(client, '#screenSettings [data-action=diagnostics]');
    await check(client, 'document.getElementById("diagMemory").textContent.includes("0 Mo") && document.getElementById("diagStorage").textContent.includes("0 Mo")', 'zéro libre ne devient pas indisponible');
    await key(client, 8); await key(client, 8);
    await screenshot(client, root, `tv-home-${width}.png`);
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
    await check(client, 'document.querySelectorAll("#allAppsGrid .app-card").length===18 && document.getElementById("appsCount").textContent==="130 apps"', '132 packages / 130 apps / 18 cartes');
    await click(client, '#pageNext'); await check(client, 'document.getElementById("pageStatus").textContent==="Page 2/8"', 'pagination accessible');
    await click(client, '#manageApps');
    const pin = await evaluate(client, 'document.querySelector("#allAppsGrid .app-card").dataset.appId');
    await click(client, '#allAppsGrid .app-card');
    await check(client, `TVModel.preferences(localStorage,'Julian').pins().includes(${JSON.stringify(pin)})`, 'favori de nouvelle app');
    await click(client, '#manageApps');
    await click(client, '#tabSystem');
    await check(client, 'document.querySelectorAll("#allAppsGrid .app-card").length===2', 'système et inconnu conservés');
    const launches = await evaluate(client, 'window.__tv.launches.length');
    await click(client, '#allAppsGrid .app-card'); await check(client, `window.__tv.launches.length===${launches}`, 'pas de lancement système');
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
    await check(client, 'window.__tv.errors.length===0', 'aucune erreur JavaScript');
    reports.push({ width, height, apps: 133, libraryDomMax: 18, backgroundIntervals: 0, resumeCycles: 4, remote: 'passed', native: 'mocked' });
  }
  return reports;
}
module.exports = { buildTvHarness, testTvHarness };
