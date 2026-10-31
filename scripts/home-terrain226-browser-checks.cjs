const fs=require('node:fs'),path=require('node:path');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(client,expression){const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
// Pendant l'attente, une exception (élément pas encore rendu) vaut « pas encore » : seul le délai fait échouer.
const poll = (client, expression) => evaluate(client, expression).catch(() => false);
async function check(client,expression,label){for(let i=0;i<150;i++){if(await poll(client,`Boolean(${expression})`))return;await pause(30);}throw Error(`Terrain226 ${label}`);}
async function testTerrain226Harness(client,root){
 const reports=[];
 for(const width of [360,412,1280]){
  await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
  await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
  await check(client,'window.__terrain224 && window.__cardRenders','points d’entrée de production');
  await evaluate(client,'window.__terrain224.examples()');await pause(2200);
  await evaluate(client,`window.__cardRenders={};window.__terrainLongTasks=[];window.__terrainObserver=new PerformanceObserver(list=>__terrainLongTasks.push(...list.getEntries().map(e=>e.duration)));__terrainObserver.observe({type:'longtask'});document.querySelector('[data-series-id="series-0"] .seenit-check').click()`);
  await check(client,`document.querySelector('[data-series-id="series-0"]').dataset.watchFeedback==='button'`,'bouton avant tampon');
  const drawing=await evaluate(client,`(()=>{const card=document.querySelector('[data-series-id="series-0"]'),ring=card.querySelector('.brand-ring-fill'),tick=card.querySelector('.brand-ring-tick');const a=ring.getAnimations().find(a=>a.animationName==='brandCheckRing'),b=tick.getAnimations().find(a=>a.animationName==='brandCheckTick');if(!a||!b)return null;const running=a.playState==='running';a.currentTime=380;b.currentTime=0;return {running,ring:parseFloat(getComputedStyle(ring).strokeDashoffset),tick:parseFloat(getComputedStyle(tick).strokeDashoffset),stamp:!!card.querySelector('.series-8f__stamp'),code:card.querySelector('.series-8f__code').textContent}})()`);
  if(!drawing?.running||drawing.ring<=0||drawing.ring>=239||drawing.tick<.99||drawing.stamp||!drawing.code.includes('E02'))throw Error('Terrain226 remplissage non progressif '+JSON.stringify(drawing));
  fs.writeFileSync(path.join(root,'quality-reports',`terrain226-ring-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await check(client,`document.querySelector('[data-series-id="series-0"]').dataset.watchFeedback==='stamp'`,'tampon après dessin');
  await check(client,`!document.querySelector('[data-series-id="series-0"]').dataset.watchFeedback && document.querySelector('[data-series-id="series-0"] .series-8f__code').textContent.includes('E03')`,'reprise après tampon');
  const perf=await evaluate(client,`(__terrainObserver.disconnect(),{renders:__cardRenders,longTasks:__terrainLongTasks})`);
  if(Object.entries(perf.renders).some(([id,count])=>id!=='series-0'&&count>0))throw Error('Terrain226 cartes voisines recalculées '+JSON.stringify(perf));
  await check(client,`[...document.querySelectorAll('.navigation-tab')].every(e=>{const i=e.querySelector('svg').getBoundingClientRect(),t=e.querySelector('.navigation-tab__label').getBoundingClientRect();return Math.abs(i.left+i.width/2-t.left-t.width/2)<.5})`,'centres de navigation partagés');
  if(width===360){
   await evaluate(client,'window.__terrain224.splash.open(true)');
   await check(client,'document.querySelector("#seenit-splash-screen")?.dataset.ready==="false"','splash démarre');
   await pause(2300);
   await check(client,`(()=>{const s=document.querySelector('#seenit-splash-screen');return s && !s.classList.contains('seenit-brand-splash--closing') && parseFloat(getComputedStyle(s.querySelector('p')).opacity)>.99 && s.querySelectorAll('i').length===8 && new DOMMatrix(getComputedStyle(s.querySelector('.seenit-brand-splash__episodes'),'::after').transform).m41===0})()`,'signature lisible et huit segments avant maintien');
   fs.writeFileSync(path.join(root,'quality-reports','terrain226-splash-hold.png'),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
   await pause(950);
   await check(client,'document.querySelector("#seenit-splash-screen") && !document.querySelector(".seenit-brand-splash--closing")','durée actuelle conservée pendant la lecture');
   await check(client,'document.querySelector(".seenit-brand-splash--closing")','fermeture à durée inchangée');
   await check(client,'!document.querySelector("#seenit-splash-screen") && window.__terrain224.splash.closed===1','fermeture unique');
  }
  await evaluate(client,'window.__terrain226.calendar()');
  await check(client,`document.querySelector('[data-series-id="series-0"] [data-series-badge=today]') && document.querySelectorAll('[data-series-id="series-0"] .series-8f__segment')[2].classList.contains('series-8f__segment--future')`,'date courante avant minuit');
  await evaluate(client,`window.__calendarShow=window.__homeAVoir.snapshot().find(s=>s.id==='series-0');window.__calendarRealDate=Date;const day=new Date();day.setDate(day.getDate()+1);window.Date=class extends window.__calendarRealDate{constructor(...args){super(...(args.length?args:[day.getTime()]));}};window.__terrain226.advanceClock(1440);window.dispatchEvent(new Event('focus'))`);
  await check(client,`window.__homeAVoir.snapshot().find(s=>s.id==='series-0')===window.__calendarShow && document.querySelector('[data-series-id="series-0"] [data-series-badge=yesterday]') && document.querySelectorAll('[data-series-id="series-0"] .series-8f__segment')[2].classList.contains('series-8f__segment--unseen')`,'retour le lendemain sans mutation ni fiche : date et épisode dégrisé');
  await evaluate(client,`window.__cardRenders={};window.__terrain226.advanceClock(1);window.dispatchEvent(new Event('focus'))`);await pause(120);
  await check(client,`Object.keys(window.__cardRenders).length===0`,'même jour : aucun rendu de carte au rafraîchissement');
  await evaluate(client,'window.Date=window.__calendarRealDate');
  reports.push({width,progressiveRing:drawing,renderIsolation:perf,calendarRefresh:true,sameDayRenders:0});
 }
 fs.writeFileSync(path.join(root,'quality-reports','terrain226-performance.json'),JSON.stringify(reports,null,2));
 return reports;
}
module.exports={testTerrain226Harness};
