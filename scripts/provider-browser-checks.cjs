const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function buildProviderHarness(root) {
  const dist = path.join(root, 'dist');
  const fixture = path.join(root, 'tests/fixtures/providerRuntime.issue337.ts');
  await esbuild.build({
    entryPoints: [path.join(root, 'tests/fixtures/providerCards.issue337.tsx')],
    outfile: path.join(dist, '__seenit-providers.js'), bundle: true, platform: 'browser',
    format: 'iife', target: ['chrome120'], logLevel: 'silent',
    plugins: [{ name: 'provider-external-boundaries', setup(build) {
      build.onResolve({ filter: /(?:lib\/(?:firebase|apiAuth)|plex\/plexAvailability)$/ }, () => ({ path: fixture }));
    } }],
  });
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-providers.html'), `<!doctype html><html lang="fr"><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    ${css.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('')}
    <style>body{background:#08080c;color:white}button{padding:8px 12px;border:1px solid #777}</style>
    </head><body><div id="root"></div><script>window.__providerFixtureErrors=[];window.addEventListener('error',event=>window.__providerFixtureErrors.push(event.message));</script><script src="/__seenit-providers.js"></script></body></html>`);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Erreur fixture #337');
  return response.result?.value;
}
async function check(client, expression, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await delay(60);
  }
  const telemetry = await evaluate(client, 'window.__provider337?.telemetry');
  const errors = await evaluate(client, 'window.__providerFixtureErrors');
  throw new Error(`#337 : ${message} ${JSON.stringify({ telemetry, errors })}`);
}
async function testProviderHarness(client, root) {
  const reports = [];
  for (const width of [360, 412]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height: 915, deviceScaleFactor: 1, mobile: true });
    await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-providers.html' });
    await check(client, 'document.getElementById("login")', 'fixture montée');
    await evaluate(client, 'window.IntersectionObserver = undefined; document.getElementById("login").click()');
    await check(client, 'document.querySelector("#card-tv img") && window.__provider337.telemetry.reads === 1', 'cartes montées avant hydratation cloud');
    await evaluate(client, 'window.__card337 = document.querySelector("#card-tv > div"); window.__provider337.finishCloud([531])');
    const logo = id => `document.querySelector('#${id} img')?.getAttribute('src') || ''`;
    await check(client, `(${logo('card-tv')}).includes('paramount.png') && (${logo('card-movie')}).includes('paramount.png')`, 'hydratation sans Réglages met à jour les cartes réelles et le cache hérité');
    await check(client, `(${logo('card-unavailable')}).startsWith('data:image/svg')`, 'Paramount seulement en achat ne gagne pas sur Plex');
    await check(client, 'window.__provider337.telemetry.requests === 1', 'seul le média sans cache déclenche TMDB');
    await check(client, `!document.querySelector('#card-pending img')`, 'aucun ancien badge ni Plex provisoire avant réponse TMDB');
    await evaluate(client, 'window.__provider337.finishProviderNetwork()');
    await check(client, `(${logo('card-pending')}).includes('paramount.png')`, 'le média voisin utilise la réponse TMDB réelle du hook');
    await evaluate(client, 'window.__provider337.setPlatforms([])');
    await check(client, `(${logo('card-tv')}).startsWith('data:image/svg') && (${logo('card-movie')}).startsWith('data:image/svg')`, 'OFF affiche Plex sur les mêmes cartes');
    await evaluate(client, 'window.__provider337.setPlatforms([531])');
    await check(client, `(${logo('card-tv')}).includes('paramount.png') && (${logo('card-movie')}).includes('paramount.png')`, 'ON restaure Paramount sans refaire TMDB');
    await evaluate(client, 'void window.__provider337.startHydration()');
    await check(client, 'window.__provider337.telemetry.reads === 2', 'refresh cloud démarré');
    await evaluate(client, 'window.__provider337.setPlatforms([]); window.__provider337.setPlatforms([531]); window.__provider337.finishCloud([])');
    await check(client, `(${logo('card-tv')}).includes('paramount.png') && window.__provider337.telemetry.saves[0]?.[0] === 531`, 'une réponse cloud retardée préserve ON/OFF/ON local');
    await evaluate(client, 'window.__provider337.setPlatforms([]); window.__provider337.setPlex(false)');
    await check(client, `(${logo('card-tv')}).includes('netflix.png') && (${logo('card-unavailable')}).includes('netflix.png')`, 'Plex absent permet le fallback public');
    await check(client, 'window.__card337 === document.querySelector("#card-tv > div") && window.__provider337.telemetry.requests === 1', 'les cartes restent montées sans purge ni requête doublée');
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(root, 'quality-reports', `providers-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    reports.push({ width, status: 'pass', productionComponents: ['ContinueWatchingCard', 'MovieWatchCard'], requests: 1, cloudReads: 2 });
  }
  return reports;
}
module.exports = { buildProviderHarness, testProviderHarness };
