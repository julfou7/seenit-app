const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
async function buildSearchKeyboardHarness(root){
 const runtime=path.join(root,'tests/fixtures/navbar13jRuntime.ts');
 await esbuild.build({entryPoints:[path.join(root,'tests/fixtures/searchKeyboard.tsx')],outfile:path.join(root,'dist/__seenit-search-keyboard.js'),bundle:true,platform:'browser',format:'iife',target:['chrome120'],logLevel:'silent',plugins:[{name:'search-ports',setup(b){b.onResolve({filter:/\/(?:downloadConfigStore|liveDownloadStore|useShows|showsStore|logStore|SettingsScreen)$/},()=>({path:runtime}));}}]});
 const css=fs.readdirSync(path.join(root,'dist/assets')).filter(f=>f.endsWith('.css'));
 fs.writeFileSync(path.join(root,'dist/__seenit-search-keyboard.html'),`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(f=>`<link rel="stylesheet" href="/assets/${f}">`).join('')}<link rel="stylesheet" href="/__seenit-search-keyboard.css"><style>body{margin:0;background:#101014;color:white}</style><div id="root"></div><script src="/__seenit-search-keyboard.js"></script>`);
}
async function evaluate(client,expression){const r=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function check(client,expression,label){for(let i=0;i<60;i++){if(await evaluate(client,expression))return;await new Promise(r=>setTimeout(r,40));}throw Error('#774 '+label+': '+JSON.stringify(await evaluate(client,'({height:innerHeight,field:document.querySelector("input")?.getBoundingClientRect().toJSON(),nav:getComputedStyle(document.querySelector(".bottom-nav-shell")).display})')));}
async function testSearchKeyboardHarness(client,root){
 const reports=[];
 for(const width of [360,412]){
  const metrics=height=>client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await metrics(915);await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-search-keyboard.html'});
  await check(client,'Boolean(document.querySelector("[data-navigation-search]"))','montage du dock de production');
  await evaluate(client,'document.querySelector("input").focus()');await client.send('Input.insertText',{text:'Harry Potter'});
  await evaluate(client,'window.__searchViewport(560)');
  await check(client,'Math.abs(document.querySelector("input").closest("[data-discover-search-editing]").getBoundingClientRect().bottom-560)<1 && Math.abs(document.querySelector("input").parentElement.parentElement.getBoundingClientRect().bottom-552)<1 && getComputedStyle(document.querySelector(".bottom-nav-shell")).display==="none"','dock à8px du clavier,nav masquée');
  fs.writeFileSync(path.join(root,'quality-reports',`search-keyboard-${width}.png`),Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate(client,'window.__searchViewport(915)');
  await check(client,'document.activeElement!==document.querySelector("input") && getComputedStyle(document.querySelector(".bottom-nav-shell")).display!=="none" && document.querySelector("input").value==="Harry Potter"','fermeture clavier restaure nav et requête');
  await evaluate(client,'document.querySelector("input").focus()');await metrics(560);await evaluate(client,'window.__searchViewport(560)');
  await check(client,'Math.abs(document.querySelector("input").parentElement.parentElement.getBoundingClientRect().bottom-552)<1','Android adjustResize sans double décalage');
  await metrics(915);await evaluate(client,'window.__searchViewport(915)');
  await evaluate(client,'document.querySelector("input").focus()');
  await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await check(client,'document.activeElement!==document.querySelector("input") && document.querySelector("input").value==="Harry Potter" && document.querySelector("input").closest("[data-discover-search-editing]").textContent.includes("1 filtre")','Entrée/clavier matériel préserve texte et filtre');
  reports.push({width,status:'pass',keyboardGap:8,navHidden:true,androidResize:true,preservesQueryAndFilters:true});
 }
 return reports;
}
module.exports={buildSearchKeyboardHarness,testSearchKeyboardHarness};
