const fs = require('node:fs'), path = require('node:path');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
 const result = await client.send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
 if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
 return result.result?.value;
}
async function check(client, expression, label) {
 for(let index=0;index<140;index++) { if(await evaluate(client,`Boolean(${expression})`))return; await pause(30); }
 throw Error('Terrain224 '+label+': '+JSON.stringify(await evaluate(client,'({errors:window.__homeErrors,text:document.body.innerText})')));
}
async function testTerrain224Harness(client,root) {
 const reports=[];
 for(const width of [360,412,1280]) {
  await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
  await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
  await check(client,'window.__terrain224 && window.__homeAVoir','production harness');
  await evaluate(client,'window.__terrain224.examples();document.fonts.ready');
  const card = id => `[data-series-id="${id}"]`;
  const a=card('series-0'), last=card('series-1');
  await check(client,`document.querySelector('${a} .series-8f__code').textContent.includes('E02')`,'initial real resume');
  await evaluate(client,`window.__homeAVoir.telemetry.holdNext=true;document.querySelector('${a} .seenit-check').click()`);
  await pause(750);
  await check(client,`document.querySelector('${a} .seenit-check').disabled && !document.querySelector('${a} .series-8f__stamp') && document.querySelector('${a} .series-8f__code').textContent.includes('E02')`,'slow-save');
  await evaluate(client,'window.__homeAVoir.releaseWrite()');
  await check(client,`document.querySelector('${a}').dataset.watchFeedback==='button' && document.querySelector('${a} .seenit-check').dataset.celebrate==='true' && !document.querySelector('${a} .series-8f__stamp') && document.querySelector('${a} .series-8f__code').textContent.includes('E02')`,'button-first');
  await check(client,`document.querySelector('${a}').dataset.watchFeedback==='stamp' && document.querySelector('${a} .series-8f__stamp') && document.querySelector('${a} .series-8f__code').textContent.includes('E02')`,'stamp-before-name');
  await check(client,`document.querySelector('${a}').dataset.watchFeedback==='advance' && document.querySelector('${a} .series-8f__code').textContent.includes('E03')`,'real next episode');
  await check(client,`!document.querySelector('${a}').dataset.watchFeedback && !document.querySelector('${a} .series-8f__stamp')`,'transient receipt');
  await evaluate(client,`document.querySelector('${last} .seenit-check').click()`);
  await check(client,`document.querySelector('${last} .seenit-check').getAttribute('aria-pressed')==='true' && !document.querySelector('${last} .seenit-check').disabled`,'last-available');
  await pause(1700);
  await check(client,`(()=>{const s=document.querySelector('${last} .series-8f__stamp');return s && parseFloat(getComputedStyle(s).opacity)>.99})()`,'last-available persistent stamp');
  await evaluate(client,`document.querySelector('#home-tab-upcoming').click()`);
  await pause(40);
  await evaluate(client,`document.querySelector('#home-tab-watch_next').click()`);
  await check(client,`document.querySelector('${last} .series-8f__stamp')`,'tab return preserves receipt');
  await evaluate(client,`document.querySelector('${last} .seenit-check').click()`);
  await check(client,`!document.querySelector('${last} .series-8f__stamp') && document.querySelector('${last} .seenit-check').getAttribute('aria-pressed')==='false'`,'undo');
  await evaluate(client,`window.__homeAVoir.telemetry.failNext=true;document.querySelector('${last} .seenit-check').click()`);
  await check(client,`document.querySelector('${last} .seenit-check').dataset.error==='true' && !document.querySelector('${last} .series-8f__stamp') && document.querySelector('${last} .series-8f__code').textContent.includes('E02')`,'failed write never stamped');
  await evaluate(client,`document.querySelector('${last} .seenit-check').click()`);
  await check(client,`document.querySelector('${last} .seenit-check').getAttribute('aria-pressed')==='true' && !document.querySelector('${last} .seenit-check').disabled`,'retry acknowledged');
  await evaluate(client,'window.__homeAVoir.reset()');
  await check(client,`!document.querySelector('${last} .series-8f__stamp')`,'refresh');
  await evaluate(client,'window.__homeAVoir.clear()');
  await evaluate(client,`document.querySelector('[data-series-id="series-3"] .seenit-check').click()`);
  await check(client,`document.querySelector('#home-series-1 [data-series-id="series-3"]')?.dataset.watchFeedback==='stamp'`,'undo during stamp ready');
  await evaluate(client,'window.__homeAVoir.toasts().find(toast=>toast.onUndo).onUndo()');
  await check(client,`window.__homeAVoir.snapshot().find(s=>s.id==='series-3').seenEpisodes.length===0 && !document.querySelector('[data-series-id="series-3"]').dataset.watchFeedback`,'undo during stamp settles');
  await check(client,`document.querySelector('#home-series-1 [data-series-id="series-3"]') && !document.querySelector('#home-series-0 [data-series-id="series-3"]')`,'undo cancels transfer as well as watched record');
  await evaluate(client,`document.querySelector('[data-series-id="series-3"] .seenit-check').click()`);
  await check(client,`document.querySelector('#home-series-1 [data-series-id="series-3"]')?.dataset.watchFeedback==='stamp'`,'new arrival remains during stamp');
  await check(client,`document.querySelector('#home-series-0 [data-series-id="series-3"]') && !document.querySelector('[data-series-id="series-3"]').dataset.watchFeedback`,'transfer after real sequence completion');
  await check(client,`(()=>{const bands=[...document.querySelectorAll('.series-ribbon')];return bands.length && bands.every(b=>{const r=b.getBoundingClientRect(),p=b.parentElement.getBoundingClientRect();return r.height<=22 && r.width<=p.width+2 && Math.abs(r.bottom-p.bottom)<=4 && getComputedStyle(b).transform==='none'})})()`,'bottom-band');
  await check(client,`(()=>{const btn=document.querySelector('.movie-ticket--poster .movie-ticket__check'),body=btn.parentElement,poster=body.querySelector('.movie-ticket__poster'),b=btn.getBoundingClientRect(),p=poster.getBoundingClientRect(),r=body.getBoundingClientRect();return b.top>=p.bottom-1 && b.bottom<=r.bottom+1 && /fin à|après minuit/.test(body.parentElement.querySelector('.movie-ticket__metadata')?.textContent || '')})()`,'ticket-action');
  await check(client,`getComputedStyle(document.querySelector('.navigation-tab'),'::after').content==='none'`,'navigation no bottom point');
  await check(client,`(()=>{const bell=document.querySelector('.home-notification-bell'),badge=bell.querySelector('span').getBoundingClientRect(),glyph=bell.querySelector('svg').getBoundingClientRect();return badge.height===16 && badge.bottom<=glyph.top+1 && badge.right<=innerWidth})()`,'notification count leaves the bell visible');
  await evaluate(client,`document.querySelector('#films-a-voir-18c').scrollIntoView({block:'center'});document.querySelector('#films-a-voir-18c').scrollLeft=0`);
  await pause(80);
  fs.writeFileSync(path.join(root,'quality-reports',`terrain224-tickets-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate(client,`document.querySelector('#home-tab-history').click()`);
  await check(client,`document.querySelector('.history-entry--today') && [...document.querySelectorAll('.history-entry--today .history-entry__text')].every(e=>!e.textContent.includes('Aujourd’hui')) && [...document.querySelectorAll('.history-entry--today .history-entry__action-column time')].every(e=>/[0-9]{2}:[0-9]{2}/.test(e.textContent))`,'today heading without repeated date in card');
  fs.writeFileSync(path.join(root,'quality-reports',`terrain224-today-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  if(width===360) {
   await evaluate(client,'window.__terrain224.splash.open(true)');
   await check(client,`document.querySelector('#seenit-splash-screen')?.dataset.ready==='false'`,'splash-complete start');
   await pause(950);
   await check(client,`!document.querySelector('.brand-stacked-logo svg > rect')`,'transparent splash artwork');
   fs.writeFileSync(path.join(root,'quality-reports','terrain225-splash-360.png'),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
   await check(client,`document.querySelector('#seenit-splash-screen') && !document.querySelector('.seenit-brand-splash--closing')`,'splash-complete not cut by ready');
   await check(client,`document.querySelector('.seenit-brand-splash--closing')?.dataset.ready==='true'`,'splash-complete final state');
   await check(client,`!document.querySelector('#seenit-splash-screen') && window.__terrain224.splash.closed===1`,'splash-complete close once');
   await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
   await evaluate(client,'window.__terrain224.splash.open(true)');
   await check(client,`!document.querySelector('#seenit-splash-screen') && window.__terrain224.splash.closed===2`,'reduced-motion');
  }
  reports.push({width,sequence:true,lastAvailable:true,bands:true,ticket:true});
 }
 await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 return reports;
}
module.exports={testTerrain224Harness};
