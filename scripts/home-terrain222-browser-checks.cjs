const fs=require('node:fs'),path=require('node:path');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(client,expression){const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function check(client,expression,label){for(let i=0;i<80;i++){if(await evaluate(client,`Boolean(${expression})`))return;await pause(50);}throw Error(`Terrain222 ${label}: `+JSON.stringify(await evaluate(client,'({text:document.body.innerText,errors:window.__homeErrors,measure:window.__terrain222})')));}
async function testTerrain222Harness(client,root){const reports=[];for(const width of [360,412,1280]){
 await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-watch-next.html'});
 await check(client,'window.__watch18c && document.querySelector("#home-series-0")','rail prêt');
 await evaluate(client,'window.__watch18c.pagination()');
 await pause(150);
 for(let batch=0;batch<3;batch++){
  const ids=await evaluate(client,`(()=>{const rail=document.querySelector('#home-series-0'),ids=[...rail.querySelectorAll('[data-series-id]')].map(el=>el.dataset.seriesId);rail.scrollLeft=rail.scrollWidth;return ids})()`);
  await pause(80);
  await evaluate(client,'document.querySelector("#home-series-0 .home-load-more").click()');
  await pause(150);
  const next=await evaluate(client,`(()=>{const rail=document.querySelector('#home-series-0'),items=[...rail.querySelectorAll('[data-series-id]')],item=items[${ids.length}],delta=item.getBoundingClientRect().left-rail.getBoundingClientRect().left;window.__terrain222={ids:items.map(i=>i.dataset.seriesId),delta,scroll:rail.scrollLeft};return {delta,id:item.dataset.seriesId,padding:parseFloat(getComputedStyle(rail).scrollPaddingInlineStart)||16}})()`);
  if(Math.abs(next.delta-next.padding)>2)throw Error(`Terrain222 pagination ${width}/${batch}: ${JSON.stringify(next)}`);
 }
 for(let batch=0;batch<3;batch++){
  const count=await evaluate(client,`(()=>{const rail=document.querySelector('#films-a-voir-18c');rail.scrollLeft=rail.scrollWidth;return rail.querySelectorAll('[data-movie-ticket]').length})()`);
  await pause(80);await evaluate(client,`document.querySelector('#films-a-voir-18c .home-load-more').click()`);await pause(120);
  const metric=await evaluate(client,`(()=>{const rail=document.querySelector('#films-a-voir-18c'),item=rail.querySelectorAll('[data-movie-ticket]')[${count}];return {delta:item.getBoundingClientRect().left-rail.getBoundingClientRect().left,padding:parseFloat(getComputedStyle(rail).scrollPaddingInlineStart)||16}})()`);
  if(Math.abs(metric.delta-metric.padding)>2)throw Error('Terrain222 dernier lot films '+width+': '+JSON.stringify(metric));
 }
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-history.html'});
 await check(client,'window.__history16d','historique prêt');
 await evaluate(client,'window.__history16d.paul()');
 await check(client,`document.querySelector('.history-period__summary')?.textContent.includes('0 h 59') && document.querySelectorAll('[data-history-row]').length===1`,'Paul29+30 dès entrée sans ouvrir la fiche');
 await check(client,`(()=>{const row=document.querySelector('[data-history-row]'),img=row.querySelector('.history-entry__image'),h=row.querySelector('h3'),clock=row.querySelector('.history-entry__action-column time');return Math.abs(img.getBoundingClientRect().height-row.getBoundingClientRect().height)<1 && clock.textContent==='09:08' && h.scrollHeight<=h.clientHeight+1 && row.querySelector('.seenit-check[aria-pressed=true]')})()`,'affiche plein cadre, heure du plus récent et bouton Vu commun');
 fs.writeFileSync(path.join(root,'quality-reports',`terrain222-history-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
 await check(client,'window.__homeAVoir','accueil prêt');
 await evaluate(client,'window.__homeAVoir.terrain221Examples();document.fonts.ready');
 await check(client,`(()=>{const h=document.querySelector('[data-movie-ticket=movie-0] > h3'),actor=h.nextElementSibling;return actor.getBoundingClientRect().top-h.getBoundingClientRect().bottom<=8 && h.scrollHeight<=h.clientHeight+1})()`,'Vaiana sans réserve vide de trois lignes');
 await check(client,`(()=>{const series=document.querySelector('.series-8f__check .seenit-check__circle'),movie=document.querySelector('.movie-ticket__check .seenit-check__circle');return [series,movie].every(el=>el&&getComputedStyle(el).width==='42px'&&getComputedStyle(el).height==='42px'&&getComputedStyle(el).boxShadow.includes('242, 195, 107'))})()`,'même contour or et diamètre séries/films');
 await evaluate(client,`window.__homeAVoir.progress({uid:'fixture-a',mode:'full',phase:'watched',processed:67,total:304,historyTotal:304,watchlistTotal:38,servers:[{id:'home',name:'Serveur personnel',owned:true,watchedItems:67,inventoryItems:1284},{id:'friend',name:'Serveur partagé',owned:false,reason:'hors ligne'}]})`);
 await check(client,`document.querySelector('.home-sync-button')`,'indicateur de progression monté');
 await evaluate(client,`document.querySelector('.home-sync-button').click()`);
 await check(client,`document.querySelector('.home-sync-sheet')?.textContent.includes('67 / 304') && document.querySelector('.home-sync-sheet__servers').textContent.includes('Serveur personnel') && document.querySelector('.home-sync-sheet__servers').textContent.includes('hors ligne')`,'bilan réel personnels/partagés et quantités reçues');
 await evaluate(client,`window.__renders222=window.__homeListRenders;document.querySelector('.home-sync-sheet__pause').click()`);
 await check(client,`document.querySelector('.home-sync-sheet__pause')?.textContent==='Reprendre' && window.__homeListRenders===window.__renders222`,'pause sans rendu supplémentaire de la liste');
 await evaluate(client,`document.querySelector('.home-sync-sheet__pause').click();document.querySelector('[aria-label="Fermer la synchronisation"]').click();window.__homeAVoir.sync(null)`);
 fs.writeFileSync(path.join(root,'quality-reports',`terrain222-home-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 reports.push({width,firstNew:true,paulMinutes:59,historyPosterFullHeight:true,sharedSeenButton:true});
}return reports;}
module.exports={testTerrain222Harness};
