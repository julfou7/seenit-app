const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Erreur accueil');
  return r.result?.value;
}
async function wait(client, expression) {
  for (let i=0;i<100;i++) { if (await evaluate(client, expression)) return; await delay(30); }
  throw new Error('État accueil absent : '+expression);
}
async function testHomePerformanceHarness(root, client) {
  await client.send('Emulation.setDeviceMetricsOverride', { width:412, height:915, deviceScaleFactor:1, mobile:true });
  await client.send('Emulation.setCPUThrottlingRate', {rate:4});
  try {
    await client.send('Page.navigate', {url:'http://127.0.0.1:4173/__seenit-home.html'});
    await wait(client,'Boolean(window.__homeLargeHistory)');
    await evaluate(client,'window.__homeLargeHistory()');
    await delay(250);
    const started=Date.now();
    await evaluate(client,'document.getElementById("home-tab-history").click()');
    await wait(client,'document.querySelectorAll("#home-panel-history [data-history-row]").length===10');
    await delay(250);
    const cold=await evaluate(client,'({calls:window.__homePerf?.periodCalls||0, rows:document.querySelectorAll("[data-history-row]").length, pending:document.querySelector("#home-panel-history .home-load-more")?.textContent, errors:window.__homeErrors.filter(Boolean)})');
    assert.ok(cold.calls<=1100,'SEENIT-PERF-001 : première page rescane/formate toute la bibliothèque : '+cold.calls);
    assert.match(cold.pending,/63\d\d en attente/);
    assert.equal(cold.rows,10);
    assert.deepEqual(cold.errors,[]);
    await evaluate(client,'document.querySelector("#home-panel-history .home-load-more").click()');
    await wait(client,'document.querySelectorAll("[data-history-row]").length===20');
    for (let i=0;i<10;i++) for (const tab of ['watch_next','upcoming','history']) {
      await evaluate(client,`new Promise(resolve=>{document.getElementById('home-tab-${tab}').click();requestAnimationFrame(()=>requestAnimationFrame(resolve));})`);
      await wait(client,`document.getElementById('home-tab-${tab}').getAttribute('aria-selected')==='true'`);
    }
    const warm=await evaluate(client,'({calls:window.__homePerf?.periodCalls||0,rows:document.querySelectorAll("[data-history-row]").length,errors:window.__homeErrors.filter(Boolean),panels:document.querySelectorAll("[role=tabpanel]:not([hidden])").length,heap:performance.memory?.usedJSHeapSize})');
    assert.equal(warm.calls,cold.calls,'SEENIT-PERF-001 : bascules/pagination relancent l’index complet');
    assert.equal(warm.rows,20,'La pagination est conservée');
    assert.equal(warm.panels,1);
    assert.deepEqual(warm.errors,[]);
    const pendingBefore=await evaluate(client,'parseInt(document.querySelector("#home-panel-history .home-load-more>span:last-child").textContent,10)');
    await evaluate(client,'document.querySelector("#home-panel-history .history-entry__action-column button").click()');
    await wait(client,'Boolean([...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent==="Marquer non vu"))');
    await evaluate(client,'[...document.querySelectorAll("[role=dialog] button")].find(b=>b.textContent==="Marquer non vu").click()');
    await wait(client,'Boolean(document.querySelector("[role=alertdialog]"))');
    await evaluate(client,'[...document.querySelectorAll("[role=alertdialog] button")].find(b=>b.textContent==="Oui, marquer non vu").click()');
    await wait(client,`parseInt(document.querySelector('#home-panel-history .home-load-more>span:last-child').textContent,10)===${pendingBefore-1}`);
    return {views:6300,switches:30,periodClassifications:cold.calls,coldAndSwitchMs:Date.now()-started,heap:warm.heap,renderedRows:warm.rows};
  } finally { await client.send('Emulation.setCPUThrottlingRate',{rate:1}); }
}
module.exports={testHomePerformanceHarness};
