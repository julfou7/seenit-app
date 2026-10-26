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
  const before=await evaluate(client,`({left:document.querySelector('#home-series-0').scrollLeft,top:window.scrollY,tile:document.querySelector('#home-series-0 .home-load-more').getBoundingClientRect().left})`);
  await evaluate(client,'document.querySelector("#home-series-0 .home-load-more").click()');
  await pause(150);
  const next=await evaluate(client,`(()=>{const rail=document.querySelector('#home-series-0'),items=[...rail.querySelectorAll('[data-series-id]')],item=items[${ids.length}],delta=item.getBoundingClientRect().left-rail.getBoundingClientRect().left;window.__terrain222={ids:items.map(i=>i.dataset.seriesId),delta,scroll:rail.scrollLeft};return {scroll:rail.scrollLeft,left:item.getBoundingClientRect().left,delta,id:item.dataset.seriesId,padding:parseFloat(getComputedStyle(rail).scrollPaddingInlineStart)||16}})()`);
  if(Math.abs(next.scroll-before.left)>1 || Math.abs(next.left-before.tile)>2)throw Error(`Terrain222 pagination ${width}/${batch}: ${JSON.stringify({before,next})}`);
 }
 for(let batch=0;batch<3;batch++){
  const count=await evaluate(client,`(()=>{const rail=document.querySelector('#films-a-voir-18c');rail.scrollLeft=rail.scrollWidth;return rail.querySelectorAll('[data-movie-ticket]').length})()`);
  await pause(80);const movieBefore=await evaluate(client,`document.querySelector('#films-a-voir-18c').scrollLeft`);await evaluate(client,`document.querySelector('#films-a-voir-18c .home-load-more').click()`);await pause(120);
  const metric=await evaluate(client,`(()=>{const rail=document.querySelector('#films-a-voir-18c'),item=rail.querySelectorAll('[data-movie-ticket]')[${count}];return {left:rail.scrollLeft,delta:item.getBoundingClientRect().left-rail.getBoundingClientRect().left,padding:parseFloat(getComputedStyle(rail).scrollPaddingInlineStart)||16}})()`);
  if(Math.abs(metric.left-movieBefore)>1)throw Error('Terrain222 dernier lot films '+width+': '+JSON.stringify(metric));
 }
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-history.html'});
 await check(client,'window.__history16d','historique prêt');
 await evaluate(client,'window.__history16d.paul()');
 await pause(50);
 if(await evaluate(client,`document.querySelector('.history-period__summary')?.textContent.includes('0 h 58')`))throw Error('Terrain222 une moyenne série ne prouve pas la durée des deux épisodes');
 await evaluate(client,'window.__history16d.releasePaul()');
 await check(client,`document.querySelector('.history-period__summary')?.textContent.includes('0 h 59') && document.querySelectorAll('[data-history-row]').length===2 && !document.querySelector('.history-entry__group')`,'Paul29+30 dès entrée avec deux visionnages individuels sans ouvrir la fiche');
 await check(client,`(()=>{const row=document.querySelector('[data-history-row]'),img=row.querySelector('.history-entry__image'),h=row.querySelector('h3'),clock=row.querySelector('.history-entry__action-column time');return Math.abs(img.getBoundingClientRect().height-row.getBoundingClientRect().height)<1 && clock.textContent==='09:08' && h.scrollHeight<=h.clientHeight+1 && row.querySelector('.seenit-check[aria-pressed=true]')})()`,'affiche plein cadre, heure du plus récent et bouton Vu commun');
 fs.writeFileSync(path.join(root,'quality-reports',`terrain222-history-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
 await check(client,'window.__homeAVoir','accueil prêt');
 await evaluate(client,'window.__homeAVoir.terrain221Examples();document.fonts.ready');
 await check(client,`(()=>{const h=document.querySelector('[data-movie-ticket=movie-0] > h3'),actor=h.nextElementSibling;return h.scrollHeight<=h.clientHeight+1 && [...document.querySelectorAll('.movie-ticket--poster .movie-actor-slot')].every(e=>Math.abs(e.getBoundingClientRect().top-document.querySelector('.movie-ticket--poster .movie-actor-slot').getBoundingClientRect().top)<1)})()`,'titres lisibles et acteurs alignés avec réserve dans les titres');
 await check(client,`(()=>{const series=document.querySelector('.series-8f__check .seenit-ring-glyph'),movie=document.querySelector('.movie-ticket__check .seenit-ring-glyph');return series&&movie&&getComputedStyle(series).width==='42px'&&getComputedStyle(movie).width==='36px'&&[series,movie].every(el=>el.querySelector('.brand-ring-track')&&el.querySelector('.brand-ring-tick'))})()`,'même tracé séries/films, taille compacte demandée sur billets');
 await evaluate(client,`window.__homeAVoir.progress({uid:'fixture-a',mode:'full',phase:'watched',processed:67,total:304,historyTotal:304,watchlistTotal:38,servers:[{id:'home',name:'Serveur personnel',owned:true,watchedItems:67,inventoryItems:1284},{id:'friend',name:'Serveur partagé',owned:false,reason:'hors ligne'}]})`);
 await check(client,`document.querySelector('.home-sync-button')`,'indicateur de progression monté');
 await evaluate(client,`document.querySelector('.home-sync-button').click()`);
 await check(client,`document.querySelector('.home-sync-sheet')?.textContent.includes('67 / 304') && document.querySelector('.home-sync-sheet__servers').textContent.includes('Serveur personnel') && document.querySelector('.home-sync-sheet__servers').textContent.includes('hors ligne')`,'bilan réel personnels/partagés et quantités reçues');
 // Wait for idle/debounced metadata commits before isolating a sync-only update.
 await evaluate(client,`(async()=>{const started=performance.now();let count=window.__homeListRenders,quietSince=started;while(performance.now()-quietSince<1500){await new Promise(requestAnimationFrame);const next=window.__homeListRenders;if(next!==count){count=next;quietSince=performance.now();}if(performance.now()-started>6000)throw Error('Liste non stabilisée avant pause Plex');}})()`);
 await evaluate(client,`window.__renders222=window.__homeListRenders;document.querySelector('.home-sync-sheet__pause').click()`);
 await check(client,`document.querySelector('.home-sync-sheet__pause')?.textContent==='Reprendre' && window.__homeListRenders===window.__renders222`,'pause sans rendu supplémentaire de la liste');
 await evaluate(client,`document.querySelector('.home-sync-sheet__pause').click();window.__homeAVoir.report({uid:'fixture-a',mode:'full',phase:'error',processed:0,servers:[]});window.__homeAVoir.sync(null)`);
 await check(client,`document.querySelector('.home-sync-sheet') && !document.querySelector('.home-sync-sheet__pause') && document.querySelector('.home-sync-sheet').textContent.includes('incomplète')`,'un bilan incomplet conservé ne peut pas armer une pause sans tâche active');
 await evaluate(client,`document.querySelector('[aria-label="Fermer la synchronisation"]').click()`);
 fs.writeFileSync(path.join(root,'quality-reports',`terrain222-home-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 reports.push({width,scrollUnchanged:true,paulMinutes:59,historyPosterFullHeight:true,sharedSeenButton:true});
}return reports;}
module.exports={testTerrain222Harness};
