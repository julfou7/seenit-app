const fs=require('node:fs'),path=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function evaluate(c,expression){const r=await c.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function check(c,expression,label){for(let i=0;i<100;i++){if(await evaluate(c,`Boolean(${expression})`))return;await pause(40);}throw Error('Terrain227 '+label);}
async function testTerrain227Harness(client,root){const reports=[];for(const width of [360,412,1280]){
 await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:width<640});
 await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-home.html'});
 await check(client,'window.__homeAVoir && window.__terrain224','production');
 await evaluate(client,'window.__terrain224.examples();window.__homeAVoir.terrain221Examples();document.fonts.ready');await pause(500);
 await evaluate(client,`document.querySelector('[data-series-id="series-0"] .seenit-check').click()`);
 await check(client,`document.querySelector('[data-series-id="series-0"]').dataset.watchFeedback==='button'`,'début animation');
 const tick=await evaluate(client,`(()=>{const e=document.querySelector('[data-series-id="series-0"] .brand-ring-tick'),a=e.getAnimations()[0];if(!a)return null;a.pause();const samples=[0,759,760,1000].map(time=>{a.currentTime=time;const s=getComputedStyle(e);return {time,opacity:+s.opacity,offset:parseFloat(s.strokeDashoffset)}});a.currentTime=0;a.play();return {length:e.getTotalLength(),normal:e.pathLength.baseVal,samples}})()`);
 if(!tick||tick.normal!==1||tick.length<=40||tick.samples.slice(0,3).some(s=>s.opacity!==0)||tick.samples[3].offset!==0||tick.samples[3].opacity!==1)throw Error('Terrain227 coche prématurée '+JSON.stringify(tick));
 await evaluate(client,`document.querySelector('#films-a-voir-18c').scrollIntoView({block:'center'});document.querySelector('#films-a-voir-18c').scrollLeft=0`);await pause(80);
 const ticket=await evaluate(client,`(()=>{const cards=[...document.querySelectorAll('.movie-ticket--poster')],slots=cards.map(c=>c.querySelector('.movie-actor-slot').getBoundingClientRect().top),c=cards[0],b=c.querySelector('.movie-ticket__check').getBoundingClientRect(),end=c.querySelector('.movie-ticket__stub span').getBoundingClientRect(),glyph=c.querySelector('.seenit-ring-glyph').getBoundingClientRect();return{slots,button:b.toJSON(),end:end.toJSON(),glyph:glyph.width,hasTime:/fin à|après minuit/.test(c.querySelector('.movie-ticket__stub').textContent),metadata:c.querySelector('.movie-ticket__metadata').textContent,titles:cards.map(c=>{const h=c.querySelector('h3');return h.scrollHeight<=h.clientHeight+1})}})()`);
 if(ticket.slots.length<3||Math.max(...ticket.slots)-Math.min(...ticket.slots)>.5||ticket.glyph!==36||ticket.button.width<44||ticket.button.height<44||ticket.end.right>ticket.button.left||!ticket.hasTime||/fin à/.test(ticket.metadata)||!ticket.titles.every(Boolean))throw Error('Terrain227 billet rail '+JSON.stringify(ticket));
 fs.writeFileSync(path.join(root,'quality-reports',`terrain227-tickets-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate(client,`document.querySelector('[aria-label="Films en liste"]').click()`);
 await check(client,`(()=>{const e=document.querySelector('.movie-ticket--horizontal .movie-ticket__main'),s=document.querySelector('.movie-ticket--horizontal .movie-ticket__stub');return e && /at 100% 0/.test(getComputedStyle(e).maskImage) && /at 0(?:px|%) 0/.test(getComputedStyle(s).maskImage)})()`,'deux parties découpées');
 fs.writeFileSync(path.join(root,'quality-reports',`terrain227-list-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate(client,'window.__homeAVoir.clearDismissed();document.querySelector(".home-notification-bell").focus();document.querySelector(".home-notification-bell").click()');
 await check(client,`document.querySelectorAll('.home-notice').length>0 && !document.querySelector('.home-notifications [role=status]')`,'notifications prêtes');
 for(let n=0;n<100&&await evaluate(client,'!!document.querySelector(".home-notice__dismiss")');n++){
  await evaluate(client,'window.__homeAVoir.clear();document.querySelector(".home-notice__dismiss").click()');await pause(30);
 }
 await check(client,`!document.querySelector('.home-notifications') && document.activeElement===document.querySelector('.home-notification-bell')`,'dernière retirée ferme et restitue le focus');
 await evaluate(client,'window.__homeAVoir.toasts().find(t=>t.onUndo)?.onUndo()');
 await evaluate(client,'document.querySelector(".home-notification-bell").click()');
 await check(client,`document.querySelectorAll('.home-notice').length===1`,'Annuler restaure sans perte');
 await evaluate(client,'document.querySelector(".home-notice__dismiss").click()');await check(client,`!document.querySelector('.home-notifications')`,'dernier retrait après Annuler');
 await evaluate(client,'document.querySelector(".home-notification-bell").click()');
 await check(client,`document.querySelector('.home-notifications')?.textContent.includes('Aucune notification')`,'boîte déjà vide reste consultable');
 await evaluate(client,'document.querySelector("[aria-label=\\"Fermer les notifications\\"]").click()');
 if(width===360){
  await evaluate(client,'window.__terrain224.splash.open(true)');await check(client,`document.querySelector('.seenit-brand-splash__episodes')`,'splash');
  const cadence=await evaluate(client,`(()=>{const e=document.querySelector('.seenit-brand-splash__episodes'),all=e.getAnimations({subtree:true}),a=all.find(a=>a.animationName==='brandEpisodeReveal');if(!a)return null;a.pause();const values=Array.from({length:9},(_,i)=>{a.currentTime=i*160+1;return new DOMMatrix(getComputedStyle(e,'::after').transform).m41});a.currentTime=0;a.play();return {count:all.length,duration:a.effect.getTiming().duration,values}})()`);
  if(!cadence||cadence.count!==1||cadence.duration!==1280||cadence.values.some((v,i)=>Math.abs(v-(-220+27.5*i))>.5))throw Error('Terrain227 cadence '+JSON.stringify(cadence));
  await check(client,`!document.querySelector('#seenit-splash-screen') && window.__terrain224.splash.closed===1`,'splash termine');
 }
 reports.push({width,tick,ticket,notifications:true});
}return reports;}
module.exports={testTerrain227Harness};
