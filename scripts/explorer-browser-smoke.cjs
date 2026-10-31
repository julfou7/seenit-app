const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { spawn } = require('node:child_process');
const { CdpClient, findChrome, waitForHttp } = require('./pwa-browser-smoke.cjs');
const { buildSearchKeyboardHarness, testSearchKeyboardHarness } = require('./search-keyboard-browser-checks.cjs');
async function main() {
 const root = path.resolve(__dirname,'..');
 fs.mkdirSync(path.join(root,'quality-reports'),{recursive:true});
 await buildSearchKeyboardHarness(root);
 let preview, chrome, client;
 const errors=[];
 try {
  preview=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','4173','--strictPort'],{cwd:root,stdio:'ignore',windowsHide:true});
  await waitForHttp('http://127.0.0.1:4173');
  chrome=spawn(findChrome(),['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+fs.mkdtempSync(path.join(os.tmpdir(),'seenit-explorer-')),'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
  const url=await new Promise((resolve,reject)=>{
   let log=''; chrome.stderr.on('data',chunk=>{log+=chunk;if(log.includes('DevTools listening on '))resolve(log.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);});
   chrome.on('exit',code=>reject(Error('Chrome '+code))); setTimeout(()=>reject(Error('Chrome délai dépassé')),10000).unref();
  });
  const list=await (await fetch('http://127.0.0.1:'+new URL(url).port+'/json/list')).json();
  client=new CdpClient(list.find(page=>page.type==='page').webSocketDebuggerUrl); await client.connect();
  await Promise.all([client.send('Page.enable'),client.send('Runtime.enable'),client.send('Network.enable'),client.send('Fetch.enable',{patterns:[{urlPattern:'*'}]})]);
  await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  client.on('Runtime.exceptionThrown', event=>errors.push(event.exceptionDetails.exception?.description||event.exceptionDetails.text));
  client.on('Fetch.requestPaused',async event=>{
   const local=event.request.url.startsWith('http://127.0.0.1:4173/');
   if(local){await client.send('Fetch.continueRequest',{requestId:event.requestId});return;}
   if(event.request.url.includes('image.tmdb.org')) {
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="780" height="500"><defs><linearGradient id="a"><stop stop-color="#644719"/><stop offset="1" stop-color="#112d44"/></linearGradient></defs><rect width="780" height="500" fill="url(#a)"/><circle cx="500" cy="160" r="110" fill="#886c4633"/></svg>';
    await client.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'}],body:Buffer.from(svg).toString('base64')});
   } else await client.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});
  });
  let report;
  try { report=await testSearchKeyboardHarness(client,root); } catch(error) { throw Error(error.message+"\n"+errors.join("\n")); }
  if(errors.length)throw Error(errors.join('\n'));
  console.log('[Explorer #787] PASS '+report.length+' largeurs, composants et écran de production ; réseau externe isolé.');
 } finally {client?.close();chrome?.kill();preview?.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
