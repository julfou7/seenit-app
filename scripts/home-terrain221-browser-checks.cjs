const fs = require('node:fs');
const path = require('node:path');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Terrain221 runtime');
  return result.result?.value;
}
// Pendant l'attente, une exception (élément pas encore rendu) vaut « pas encore » : seul le délai fait échouer.
const poll = (client, expression) => evaluate(client, expression).catch(() => false);
async function check(client, expression, label) {
  for (let i=0; i<60; i++) { if(await poll(client,`Boolean(${expression})`)) return; await pause(50); }
  throw new Error(`Terrain221 ${label}: ${JSON.stringify(await evaluate(client,'({text:document.body.innerText,errors:window.__homeErrors,measure:window.__terrainMeasure})'))}`);
}
async function click(client, selector) {
  await evaluate(client,`document.querySelector(${JSON.stringify(selector)}).click()`);
  await pause(60);
}
async function testTerrain221Harness(client, root) {
  const reports=[];
  for (const width of [360,412,1280]) {
    await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
    await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
    await check(client,'window.__homeAVoir && document.querySelector(".bottom-nav-island")','vraie navigation et accueil');
    await evaluate(client,'window.__homeAVoir.terrain221Examples();document.documentElement.style.setProperty("--seenit-safe-area-bottom","28px");document.fonts.ready');
    await evaluate(client,'document.fonts.load(\'800 18px "Plus Jakarta Sans"\')');
    await check(client,'document.querySelector("[data-movie-ticket=movie-0] > h3").textContent.includes("Vaiana")','cas utilisateur');
    await check(client,`(()=>{const names=[...document.querySelectorAll('.home-watch .home-section-name')];return names.every(el=>el.scrollWidth<=el.clientWidth+1 && getComputedStyle(el).overflowY!=='hidden') && !document.querySelector('#home-series-2 .series-8f__status')})()`,'libellés entiers et aucun badge des anciennes séries');
    await check(client,`(()=>{const h=document.querySelector('[data-movie-ticket=movie-0] > h3'),actor=h.nextElementSibling,r=document.createRange();r.selectNodeContents(h);window.__terrainMeasure={movie:{height:h.clientHeight,scroll:h.scrollHeight,lineHeight:getComputedStyle(h).lineHeight,range:r.getBoundingClientRect().toJSON()}};return h.scrollHeight<=h.clientHeight+1 && actor.getBoundingClientRect().top>=r.getBoundingClientRect().bottom-1})()`,'titre Vaiana complet sans rognage ni acteur superposé');
    await check(client,"document.querySelectorAll('[data-series-id=series-0] .series-8f__segment').length===6 && !document.querySelector('[data-series-id=series-0] .series-8f__unknown-mark')",'Knight : six segments et aucun point d’interrogation après réparation');
    fs.writeFileSync(path.join(root,'quality-reports',`terrain221-top-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const headingFont=await evaluate(client,'getComputedStyle(document.querySelector(".home-section-heading h2")).fontSize');
    for (const tab of ['watch_next','upcoming','history']) {
      await click(client,`#home-tab-${tab}`);
      const heading=tab==='watch_next'?'.home-section-heading h2':tab==='upcoming'?'.home-upcoming-group h2':'.history-period__heading';
      await check(client,`getComputedStyle(document.querySelector(${JSON.stringify(heading)})).fontSize===${JSON.stringify(headingFont)}`,'typographie commune des trois panneaux');
      if(tab==='upcoming') {
        await evaluate(client,`(()=>{const el=document.querySelector('[data-series-id=upcoming-2] h3');el.style.fontFamily='Arial, sans-serif'})()`);
        await check(client,`(()=>{const a=document.querySelector('[data-series-id=upcoming-2]'),h=a.querySelector('h3'),t=a.querySelector('.series-8f__text'),p=t.querySelector('p'),bar=a.querySelector('.series-8f__season');window.__terrainMeasure={upcoming:{title:h.textContent,titleHeight:h.clientHeight,titleScroll:h.scrollHeight,textWidth:t.clientWidth,font:getComputedStyle(h).font,titleWidth:h.clientWidth,textBottom:t.getBoundingClientRect().bottom,episodeBottom:p.getBoundingClientRect().bottom,barTop:bar.getBoundingClientRect().top}};return h.scrollHeight<=h.clientHeight+1 && p.getBoundingClientRect().bottom<=bar.getBoundingClientRect().top+1})()`,'Seigneur des anneaux en entier et espace pour le code/épisode');
        await evaluate(client,`document.querySelector('[data-series-id=upcoming-2] h3').style.removeProperty('font-family')`);
        await check(client,`(()=>{const h=document.querySelector('[data-series-id=upcoming-2] h3');return h.scrollHeight<=h.clientHeight+1})()`,'titre long avec la police de production également');
      }
      if(tab==='history') {
        await click(client,'#home-panel-history .home-load-more');
        await check(client,`(()=>{const row=[...document.querySelectorAll('[data-history-row]')].find(r=>r.textContent.includes('A Knight'));if(!row)return false;const title=row.querySelector('h3');return row.textContent.includes('08:13') && row.querySelector('.history-entry__action-column time')?.textContent==='08:13' && getComputedStyle(title).whiteSpace==='normal' && title.scrollHeight<=title.clientHeight+1})()`,'historique avec heure réelle et titre complet');
        await evaluate(client,"[...document.querySelectorAll('[data-history-row]')].find(r=>r.textContent.includes('A Knight')).scrollIntoView({block:'center',behavior:'instant'})");
        fs.writeFileSync(path.join(root,'quality-reports',`terrain221-history-clock-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await click(client,'#home-panel-history .home-load-more');
      }
      await evaluate(client,'document.querySelector("#watchlist-container").scrollTop=1e8');
      await pause(100);
      const clearance=await evaluate(client,`(()=>{const panel=document.querySelector('[role=tabpanel]:not([hidden])'),nav=document.querySelector('.bottom-nav-island').getBoundingClientRect(),items=[...panel.querySelectorAll('.series-8f,.home-load-more,[data-history-row],.movie-ticket')].filter(el=>{const r=el.getBoundingClientRect();return r.width && r.height;});const bottom=Math.max(...items.map(el=>el.getBoundingClientRect().bottom));window.__terrainMeasure={clearance:nav.top-bottom,nav:nav.toJSON(),bottom};return nav.top-bottom})()`);
      if(clearance<8 || clearance>38) throw new Error(`Terrain221 bas ${tab}/${width}: espace ${clearance}`);
      fs.writeFileSync(path.join(root,'quality-reports',`terrain221-${tab}-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    // The real reminder handler is suspended before token registration: appearance must
    // change now, and success/storage must wait for durable acknowledgement.
    await click(client,'#home-tab-upcoming');
    const button='[data-series-id=upcoming-0] .series-8f__days';
    await evaluate(client,`window.__homeAVoir.clear();window.__homeAVoir.reminderControl.holdPermission=true;window.__homeAVoir.telemetry.writes.length=0;const b=document.querySelector('${button}');b.click();b.click();`);
    await check(client,`document.querySelector('${button}').getAttribute('aria-pressed')==='true' && document.querySelector('${button}').disabled && window.__homeAVoir.reminderControl.permissionCalls===1 && !window.__homeAVoir.telemetry.writes.some(w=>w.path.includes('reminders'))`,'cloche immédiatement active pendant le transport, sans double écriture');
    await evaluate(client,'window.__homeAVoir.reminderControl.release()');
    await check(client,`!document.querySelector('${button}').disabled && document.querySelector('${button}').getAttribute('aria-pressed')==='true' && window.__homeAVoir.telemetry.writes.filter(w=>w.path.includes('reminders')).length===1`,'rappel confirmé');
    await check(client, `window.__homeAVoir.reminderControl.nativeNotifications===0 && !window.__homeAVoir.toasts().some(t=>JSON.stringify(t.message).includes('Rappel activé'))`, 'aucune confirmation système ni toast tardif');
    await click(client,button);
    await check(client,`!document.querySelector('${button}').disabled && document.querySelector('${button}').getAttribute('aria-pressed')==='false'`,'désactivation');
    await evaluate(client,'window.__homeAVoir.reminderControl.failWrite=true;window.__homeAVoir.reminderControl.holdPermission=false');
    await click(client,button);
    await check(client,`!document.querySelector('${button}').disabled && document.querySelector('${button}').getAttribute('aria-pressed')==='false' && !window.__homeAVoir.snapshot().find(s=>s.id==='upcoming-0').notificationsEnabled && window.__homeAVoir.toasts().some(t=>t.message?.includes('Rappel impossible'))`,'échec persistance : retour à la cloche et préférence précédentes');
    await evaluate(client,`window.__homeAVoir.reminderControl.holdPermission=true;window.__homeAVoir.telemetry.writes.length=0;document.querySelector('${button}').click()`);
    await check(client,`document.querySelector('${button}').disabled`,'dernier rappel suspendu');
    await evaluate(client,'window.__homeAVoir.auth.currentUser.uid="fixture-b";window.__homeAVoir.reminderControl.release()');
    await check(client,`!document.querySelector('${button}').disabled && !window.__homeAVoir.telemetry.writes.length`,'changement UID : aucune écriture après attente');
    reports.push({width,headings:headingFont,footer:true,longTitles:true,noStaleBadge:true,reminder:'immediate/acknowledged/rollback/UID'});
  }
  return reports;
}
module.exports={testTerrain221Harness};
