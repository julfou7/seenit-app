const fs=require('node:fs'),path=require('node:path');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(client,expression){const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function check(client,expression,label){for(let i=0;i<60;i++){if(await evaluate(client,`Boolean(${expression})`))return;await pause(60);}throw Error(`Terrain223 ${label}`);}
async function testTerrain223Harness(client,root){const reports=[];for(const width of [360,412,1280]){
 await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
 await check(client,'window.__homeAVoir && document.querySelector(".home-wordmark img")?.complete','logo fourni');
 await evaluate(client,'window.__homeAVoir.terrain223Examples();document.fonts.ready');await pause(120);
 await check(client,`(()=>{const b=[...document.querySelectorAll('.series-ribbon')].filter(e=>/Plus que [23]/i.test(e.textContent));return b.length>=1 && b.every(e=>{const r=document.createRange();r.selectNodeContents(e);const t=r.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return t.left>=p.left && t.right<=p.right && t.top>=p.top && t.bottom<=p.bottom})})()`,'texte des rubans Plus que 2/3 contenu dans l’affiche');
 fs.writeFileSync(path.join(root,'quality-reports',`terrain223-marque-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate(client,`window.__homeAVoir.progress({uid:'fixture-a',mode:'full',phase:'done',processed:70,historyTotal:68,watchlistTotal:2,servers:Array.from({length:10},(_,i)=>({id:String(i),name:'Serveur '+i,owned:i===0,watchedItems:25,inventoryItems:0}))})`);
 await check(client,`document.querySelector('.home-sync-button')`,'indicateur monté');
 await evaluate(client,`document.querySelector('.home-sync-button').click()`);await pause(100);
 await check(client,`(()=>{const sheet=document.querySelector('.home-sync-sheet'),r=sheet.getBoundingClientRect(),close=sheet.querySelector('header button').getBoundingClientRect();return r.top>=10 && r.bottom<=innerHeight-10 && sheet.scrollHeight>sheet.clientHeight && close.top>=r.top && close.bottom<=r.bottom})()`,'dialogue centré borné et fermeture visible');
 await evaluate(client,`document.querySelector('.home-sync-sheet').scrollTop=1e8`);await pause(60);
 fs.writeFileSync(path.join(root,'quality-reports',`terrain223-plex-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate(client,`document.querySelector('[aria-label="Fermer la synchronisation"]').click();document.querySelector('#home-tab-history').click()`);await pause(80);
 await check(client,`!document.querySelector('#home-panel-history').textContent.toLowerCase().includes('ce soir')`,'aucun ce soir dans le vrai historique');
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-history.html'});await check(client,'window.__history16d','historique');
 await evaluate(client,'window.__history16d.paul();window.__history16d.releasePaul()');await pause(120);
 await check(client,`(()=>{const b=document.querySelector('.history-entry__group');return b?.classList.contains('series-ribbon') && b.textContent==='×2' && Math.abs(parseFloat(getComputedStyle(b).borderRadius))<1})()`,'groupe ×2 en bandeau');
 fs.writeFileSync(path.join(root,'quality-reports',`terrain223-historique-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 reports.push({width,brand:true,ribbons:true,historyNoTonight:true,plexViewport:true});
 }return reports;}
module.exports={testTerrain223Harness};
