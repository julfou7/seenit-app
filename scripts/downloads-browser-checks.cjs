const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function buildDownloadsHarness(root) {
  const dist = path.join(root, 'dist');
  const runtime = path.join(root, 'tests/fixtures/downloadsRuntime.ts');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/downloads.tsx')], outfile: path.join(dist, '__seenit-downloads.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent', plugins: [{ name: 'download-ui-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:liveDownloadStore|downloadConfigStore|toastStore|showsStore|sonarrRadarr|c411|DownloadConfigSection|AlternativeReleaseModal|DownloadModal|downloadLifecycle|useTabShortcut)$/ }, () => ({ path: runtime }));
  } }] });
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-downloads.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('')}<link rel="stylesheet" href="/__seenit-downloads.css"><style>body{margin:0;background:#09090b;color:white}</style></head><body><div id="root"></div><script>window.__downloadErrors=[];addEventListener('error',e=>__downloadErrors.push(e.message));addEventListener('unhandledrejection',e=>__downloadErrors.push(String(e.reason)));</script><script src="/__seenit-downloads.js"></script></body></html>`);
}
async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Erreur Téléchargements');
  return response.result?.value;
}
async function check(client, expression, label) {
  for (let i = 0; i < 50; i++) { if (await evaluate(client, `Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`SEENIT-DOWNLOAD-013 ${label}: ${JSON.stringify(await evaluate(client, '({errors:window.__downloadErrors,text:document.body.innerText.slice(0,1000)})'))}`);
}
async function testDownloadsHarness(client, root) {
  const reports = [];
  for (const width of [360, 412]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
    await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-downloads.html' });
    await check(client, 'window.__downloads && document.querySelectorAll("article[data-download-id]").length===4', 'vrais écran et cartes montés');
    await check(client, '[...document.querySelectorAll("section h2")].map(el=>el.textContent).join(";").startsWith("À traiter · 1;En cours · 1;En attente de disponibilité · 1;Terminés · 1")', 'erreurs prioritaires sans doublon');
    await check(client, 'document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll(".download-card__poster")].every(el=>el.getBoundingClientRect().height>=60)', 'largeur 360/412 et affiches non rognées');
    await check(client, 'document.body.innerText.includes("Recherche interrompue · disponibilité à vérifier") && !document.body.innerText.includes("Surveillance active")', 'attente sans promesse inventée');
    await evaluate(client, 'document.querySelector(\'[data-download-id="2"] .download-card__actions button\').click()');
    await check(client, 'document.querySelector("[role=alertdialog]") && document.activeElement.textContent.includes("Garder")', 'confirmation centrée avec focus sûr');
    await check(client, '(()=>{const r=document.querySelector("[role=alertdialog] > div").getBoundingClientRect();return r.top>=16&&r.bottom<=innerHeight-16})()', 'confirmation visible au-dessus du système');
    await evaluate(client, '[...document.querySelectorAll("button")].find(el=>el.textContent.trim()==="Garder").click()');
    await check(client, '!document.querySelector("[role=alertdialog]") && window.__downloads.telemetry.removed.length===0', 'abandon sans suppression');
    const capture = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(root, 'quality-reports', `downloads-prototype-${width}.png`), Buffer.from(capture.data, 'base64'));
    await evaluate(client, '[...document.querySelectorAll("button")].find(el=>el.textContent.trim()==="Recherche C411").click()');
    await evaluate(client, `(()=>{const input=document.querySelector('input[data-navigation-search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Titre');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(client, 'document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
    await check(client, 'document.body.innerText.includes("503") && !document.body.innerText.includes("Aucune release trouvée")', 'panne distincte d’un résultat vide');
    await evaluate(client, 'window.__downloads.mount("episodes")');
    await check(client, 'document.querySelector(\'[aria-label="Télécharger l’épisode 1"]\')', 'commande épisode réelle');
    await evaluate(client, 'document.querySelector(\'[aria-label="Télécharger l’épisode 1"]\').click()');
    await check(client, 'window.__downloads.telemetry.requested.includes(1)&&!window.__downloads.telemetry.opened.includes("episode:1")', 'télécharger ne déclenche pas l’ouverture');
    await check(client, 'document.querySelector(\'[aria-label="Épisode 3 disponible"]\').disabled && document.querySelector(\'[aria-label^="Téléchargement de l’épisode 2"]\').disabled', 'présent et actif sans double envoi');
    await check(client, 'document.documentElement.scrollWidth<=innerWidth', 'titres et actions épisode sans débordement');
    reports.push({ width, cards: true, confirmation: true, error: true, episodeActions: true });
  }
  return reports;
}
module.exports = { buildDownloadsHarness, testDownloadsHarness };
