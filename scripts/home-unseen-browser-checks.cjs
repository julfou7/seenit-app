const assert=require('node:assert/strict');
async function evaluate(client,expression){const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function wait(client,expression,label){for(let i=0;i<60;i++){if(await evaluate(client,expression))return;await new Promise(r=>setTimeout(r,30));}throw Error('#729 '+label+': '+JSON.stringify(await evaluate(client,'({details:window.__historyUnseen.control.detailCalls,seen:window.__homeAVoir.snapshot().find(s=>s.id==="series-0")?.seenEpisodes,errors:window.__homeErrors})')));}
async function touch(client,expression,block='center'){
 const point=await evaluate(client,`(()=>{const el=${expression};el.scrollIntoView({block:'${block}',inline:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
async function testHomeUnseenHarness(root,client){
 await client.send('Emulation.setDeviceMetricsOverride',{width:393,height:851,deviceScaleFactor:1,mobile:true});
 await client.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html?production'});
 await wait(client,'Boolean(window.__historyUnseen)','montage écran de production');
 await evaluate(client,'window.__homeInteractionExamples();window.__historyUnseen.setup();');
 // setup after the large group also covers a series moving from history into stale.
 await evaluate(client,'document.querySelector("#home-tab-history").click()');
 await wait(client,'Boolean([...document.querySelectorAll("[data-history-row]")].find(e=>e.textContent.includes("A Knight")))','épisode réel dans historique');
 await evaluate(client,'window.__historyUnseen.control.holdDetails=true;window.__historyUnseen.control.detailCalls=0;[...document.querySelectorAll("[data-history-row]")].find(e=>e.textContent.includes("A Knight")).querySelector(".history-entry__action-column button").click()');
 await wait(client,'Boolean([...document.querySelectorAll("[role=dialog] button")].find(e=>e.textContent==="Marquer non vu"))','menu historique');
 await evaluate(client,'[...document.querySelectorAll("[role=dialog] button")].find(e=>e.textContent==="Marquer non vu").click()');
 await wait(client,'Boolean(document.querySelector("[role=alertdialog]"))','confirmation non vu');
 await evaluate(client,'[...document.querySelectorAll("[role=alertdialog] button")].find(e=>e.textContent==="Oui, marquer non vu").click()');
 await wait(client,'window.__homeAVoir.snapshot().find(s=>s.id==="series-0").seenEpisodes.length===0','non vu enregistré même si TMDB ne répond jamais');
 assert.equal(await evaluate(client,'window.__historyUnseen.control.detailCalls'),0,'La suppression ne demande pas TMDB');
 assert.deepEqual(await evaluate(client,'(()=>{const ep=window.__homeAVoir.snapshot().find(s=>s.id==="series-0").nextEpisodeToWatch;return[ep.episode_number,ep.episode_count]})()'),[1,6],'La reprise exacte conserve le total connu');
 await evaluate(client,'window.__homeAVoir.clear()');await new Promise(r=>setTimeout(r,400));
 for(let i=0;i<3;i++)for(const tab of ['watch_next','upcoming','history'])await evaluate(client,`new Promise(r=>{document.querySelector('#home-tab-${tab}').click();requestAnimationFrame(()=>requestAnimationFrame(r));})`);
 await evaluate(client,'document.querySelector("#home-tab-watch_next").click()');
 await wait(client,'!document.querySelector("#home-panel-watch_next").hidden','retour au suivi');
 await evaluate(client,'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const bounds=await evaluate(client,'(()=>{const rail=document.querySelector("#home-series-2");rail.scrollIntoView({block:"center"});rail.scrollLeft=0;return rail.getBoundingClientRect().toJSON()})()');
 await new Promise(r=>setTimeout(r,100));
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:bounds.x+bounds.width*.7,y:bounds.y+bounds.height*.5}]});
 for(let i=1;i<=12;i++){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bounds.x+bounds.width*(.7-.6*i/12),y:bounds.y+bounds.height*.5}]});await new Promise(r=>setTimeout(r,18));}
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await wait(client,'document.querySelector("#home-series-2").scrollLeft>100','swipe tactile après non vu etbascules');
 await new Promise(r=>setTimeout(r,700));
 const counts=await evaluate(client,'(()=>{const rail=document.querySelector("#home-series-2");rail.scrollLeft=rail.scrollWidth;return{before:rail.querySelectorAll("[data-series-id]").length}})()');
 await new Promise(r=>setTimeout(r,400));
 await touch(client,'document.querySelector("#home-series-2 .home-load-more")');
 await wait(client,`document.querySelectorAll('#home-series-2 [data-series-id]').length===${counts.before+6}`,'Afficher6deplus après retrait historique etbascules');
 await touch(client,'document.querySelector(\'[aria-label="Pas vu depuis un moment en liste"]\')');
 await wait(client,'document.querySelector("#home-series-2").className==="home-series-list"','liste tactile');
 const listCount=await evaluate(client,'document.querySelectorAll("#home-series-2 [data-series-id]").length');
 await touch(client,'document.querySelector("#home-series-2 + .home-load-more")','end');
 await wait(client,`document.querySelectorAll('#home-series-2 [data-series-id]').length===${listCount+6}`,'Afficherplus reste au-dessus de la nav');
 await evaluate(client,'window.__homeAVoir.clear();window.__historyUnseen.setup();document.querySelector("#home-tab-history").click()');
 await wait(client,'Boolean([...document.querySelectorAll("[data-history-row]")].find(e=>e.textContent.includes("A Knight")))','retour épisode pour échec écriture');
 await evaluate(client,'[...document.querySelectorAll("[data-history-row]")].find(e=>e.textContent.includes("A Knight")).querySelector(".history-entry__action-column button").click()');
 await wait(client,'Boolean([...document.querySelectorAll("[role=dialog] button")].find(e=>e.textContent==="Marquer non vu"))','menu après bascules');
 await evaluate(client,'[...document.querySelectorAll("[role=dialog] button")].find(e=>e.textContent==="Marquer non vu").click()');
 await wait(client,'Boolean(document.querySelector("[role=alertdialog]"))','confirmation erreur');
 await evaluate(client,'window.__homeAVoir.telemetry.failNext=true;[...document.querySelectorAll("[role=alertdialog] button")].find(e=>e.textContent==="Oui, marquer non vu").click()');
 await wait(client,'window.__homeAVoir.toasts().some(t=>t.type==="error")','échec explicite sans faux succès');
 assert.deepEqual(await evaluate(client,'window.__homeErrors'),[],'Aucune promesse de mutation non gérée');
 await client.send('Emulation.setTouchEmulationEnabled',{enabled:false});
 return {status:'pass',productionScreen:true,historyUnseenWithoutProvider:true,tabSwitches:9,nativeSwipe:true,railLoadMore:6,listLoadMore:6,knownEpisodeCount:6,writeErrorVisible:true};
}
module.exports={testHomeUnseenHarness};
