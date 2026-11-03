const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

/** SEENIT-UX-019 — Harnais navigateur des fiches série, film et épisode (vraie ShowDetailView). */
async function buildMediaDetailHarness(root) {
  const dist = path.join(root, 'dist');
  const runtime = path.join(root, 'tests/fixtures/mediaDetailRuntime.ts');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/mediaDetail.tsx')], outfile: path.join(dist, '__seenit-media-detail.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent',
    plugins: [{ name: 'media-detail-ports', setup(builder) {
      // La fiche épisode réelle est montée par la fixture ; seule ShowDetailView reçoit le bouchon.
      builder.onResolve({ filter: /\/EpisodeDetailModal$/ }, args => args.importer.endsWith('ShowDetailView.tsx') ? { path: runtime } : undefined);
      builder.onResolve({ filter: /^firebase\/(?:firestore|auth)$|\/(?:firebase|tmdb|showsStore|syncPlex|DownloadModal|PersonDetailModal|PersonProfile|TrailerModal|useShows|toastStore|useDetailsSyncWorker|useMediaPresence|downloadConfigStore)$/ }, () => ({ path: runtime }));
    } }],
  });
  const fonts = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<link[^>]+fonts.googleapis.com\/css[^>]*>/)?.[0] || '';
  const css = fs.readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.css'));
  fs.writeFileSync(path.join(dist, '__seenit-media-detail.html'), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${fonts}${css.map(file => `<link rel="stylesheet" href="/assets/${file}">`).join('')}<style>body{margin:0;background:#09090b;color:white}</style></head><body><div id="root"></div><script>window.__mediaErrors=[];addEventListener('error',e=>__mediaErrors.push(e.message));addEventListener('unhandledrejection',e=>__mediaErrors.push(String(e.reason)));</script><script src="/__seenit-media-detail.js"></script></body></html>`);
}

let currentStep = '';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || 'Erreur fiche média');
  return response.result?.value;
}
const poll = (client, expression) => evaluate(client, expression).catch(() => false);
async function check(client, expression, label) {
  for (let attempt = 0; attempt < 60; attempt++) { if (await poll(client, `Boolean(${expression})`)) return; await delay(60); }
  throw new Error(`SEENIT-UX-019 ${label}: ${JSON.stringify(await evaluate(client, '({errors:window.__mediaErrors,text:document.body.innerText.slice(0,1500)})'))}`);
}
async function click(client, expression) {
  for (let attempt = 0; attempt < 40 && !(await poll(client, `Boolean(${expression})`)); attempt++) await delay(60);
  if (!(await poll(client, `Boolean(${expression})`))) throw new Error(`SEENIT-UX-019 [${currentStep}] élément introuvable : ${expression} — ${JSON.stringify(await evaluate(client, 'document.body.innerText.slice(0,600)'))}`);
  const point = await evaluate(client, `(()=>{const element=${expression};element.scrollIntoView({block:'center',inline:'center'});const r=element.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.includes(${JSON.stringify(text)}))`;
const byLabel = label => `document.querySelector('[aria-label=${JSON.stringify(label)}]')`;
const geometry = '({overflow:document.documentElement.scrollWidth>innerWidth+1,width:document.documentElement.scrollWidth})';

async function mount(client, width, kind) {
  currentStep = `${kind} ${width}px`;
  await client.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
  await client.send('Page.navigate', { url: 'http://127.0.0.1:4173/__seenit-media-detail.html' });
  await check(client, 'window.__mediaDetail', 'fixture chargée');
  await evaluate(client, `window.__mediaDetail.mount(${JSON.stringify(kind)})`);
}

async function testMediaDetailHarness(client) {
  const reports = [];
  for (const width of [360, 412]) {
    await mount(client, width, 'series');
    await check(client, 'document.querySelector("h1")?.textContent==="Breaking Bad" && document.body.innerText.includes("2008–2013 · 5 saisons · Drame, Crime")', 'hero série titré en or avec années, saisons et genres');
    await check(client, '!document.body.innerText.match(/^À propos$/m) && !' + byText('button', 'Casting').replace(/;$/, ''), 'plus d’onglets : un seul défilement');
    await check(client, 'document.body.innerText.includes("65 / 68 épisodes") && ' + byLabel('65 épisodes vus sur 68') + '', 'progression et segments par saison');
    await click(client, byText('button', 'Voir S05 | E14'));
    await check(client, 'window.__mediaDetail.telemetry.opens.includes("next") && document.body.innerText.includes("65 / 68 épisodes")', 'le bouton or ouvre le prochain épisode sans le marquer');
    await check(client, 'document.body.innerText.includes("Drame, Crime") && ' + byText('[aria-label="Genres et thèmes"] span', 'Téléréalité') + ' && !document.body.innerText.includes("Reality")', 'genres TMDB traduits en français');
    await check(client, byText('[aria-labelledby=detail-cast-title] button', 'Elle-même') + ' && !document.body.innerText.match(/\\bSelf\\b/)', 'rôle « Self » traduit et accordé');
    await check(client, '(()=>{const themes=document.querySelector("[aria-label=\\"Genres et thèmes\\"]"),chart=[...document.querySelectorAll("span")].find(el=>el.textContent==="Moyenne par saison");return themes&&chart&&(themes.compareDocumentPosition(chart)&Node.DOCUMENT_POSITION_FOLLOWING)&&new Set([...themes.children].filter(el=>el.getBoundingClientRect().height>0).map(el=>Math.round(el.getBoundingClientRect().height))).size===1})()', 'genres et thèmes sous le synopsis, pastilles alignées');
    await check(client, 'document.body.innerText.includes("Moyenne par saison") && document.querySelectorAll("[role=group][aria-label=Saisons] button").length===5', 'courbe des saisons et pastilles');
    await click(client, byLabel('Saison 1, ✓ vue'));
    await check(client, '' + byLabel('Saison 1, ✓ vue') + '?.getAttribute("aria-pressed")==="true" && document.body.innerText.includes("Saison 1 · 13/13")', 'une pastille sélectionne sa saison');
    await click(client, byText('button', 'Tout marquer non vu'));
    await check(client, 'document.body.innerText.includes("Saison 1 · 0/13") && ' + byText('button', 'Tout marquer vu'), 'tout marquer non vu puis vu depuis la carte saison');
    await click(client, byLabel('Marquer l’épisode 1 vu'));
    await check(client, 'document.body.innerText.includes("Saison 1 · 1/13") && ' + byLabel('Marquer l’épisode 1 non vu') + '?.getAttribute("aria-pressed")==="true"', 'la coche d’une ligne bascule l’épisode');
    await check(client, byText('a,button,div', 'Inclus dans ton abonnement') + ' && ' + byLabel('Actualiser Plex') + ' && ' + byText('button', 'Sur Julien-NAS'), 'Où regarder en lignes avec Plex et actualisation');
    await check(client, 'document.querySelectorAll(\'[aria-labelledby=detail-cast-title] > button[aria-label^="Ouvrir la fiche"]\').length===6 && ' + byText('button', 'Afficher tout le casting (7)'), 'Personnages : six lignes puis tout le casting');
    await check(client, byText('button', 'Better Call Saul') + ' && document.body.innerText.includes("Dans le même univers")', 'univers TVDB en lignes');
    await click(client, byLabel('Actions de la fiche'));
    await check(client, ['Partager la fiche', 'Synchroniser la série', 'Téléchargement', 'Abandonner la série', 'Supprimer la série'].map(label => byText('[role=dialog] button', label)).join(' && '), 'menu ⋮ : toutes les actions existantes');
    await evaluate(client, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    const seriesGeometry = await evaluate(client, geometry);
    if (seriesGeometry.overflow) throw new Error(`SEENIT-UX-019 série ${width}px déborde ${JSON.stringify(seriesGeometry)}`);

    await mount(client, width, 'movie');
    await check(client, 'document.querySelector("h1")?.textContent==="Dune : Deuxième partie" && document.body.innerText.includes("2024 · 2 h 46 · Science-fiction, Aventure")', 'hero film');
    await check(client, 'document.body.innerText.includes("Si tu lances maintenant") && /Fin à \\d\\d:\\d\\d/.test(document.body.innerText)', 'heure de fin du film');
    await check(client, 'document.body.innerText.includes("Saga Dune") && document.body.innerText.includes("Tu es ici") && document.querySelector("[aria-current=true]")', 'saga en frise avec position courante');
    await check(client, byLabel('Blade Runner 2049 — Même réalisateur · Denis Villeneuve') + ' && ' + byLabel('Interstellar — Avec Timothée Chalamet') + ' && !document.body.innerText.includes("Oppenheimer")', 'similaires : seulement avec une raison prouvée');
    await click(client, byLabel('Ajouter à ma liste'));
    await check(client, byLabel('Retirer de ma liste') + '?.getAttribute("aria-pressed")==="true"', 'signet À voir');
    await click(client, byText('button', 'Marquer vu'));
    await check(client, byText('button', '✓ Vu · annuler') + ' && !document.body.innerText.includes("Si tu lances maintenant")', 'film vu : bouton annulable, plus d’heure de fin');
    const movieGeometry = await evaluate(client, geometry);
    if (movieGeometry.overflow) throw new Error(`SEENIT-UX-019 film ${width}px déborde ${JSON.stringify(movieGeometry)}`);

    await mount(client, width, 'episode');
    await check(client, 'document.querySelector("[role=dialog] h1")?.textContent==="Ozymandias" && document.body.innerText.includes("S05 | E14")', 'fiche épisode titrée');
    await check(client, 'document.body.innerText.includes("Si tu lances maintenant") && document.querySelectorAll(\'[aria-label^="Ouvrir E"]\').length===3', 'soirée de trois épisodes');
    await check(client, 'document.body.innerText.includes("Meilleure note de la saison") && document.querySelectorAll("[aria-current=true]").length>=1', 'courbe et rang dans la saison');
    await check(client, '(document.querySelector("[role=dialog]").innerText.match(/^Netflix$/gm) || []).length===1 && !document.body.innerText.includes("with Ads")', 'un seul Netflix, sans « Standard with Ads »');
    for (const label of ['Épisode précédent', 'Épisode suivant']) await check(client, `${byLabel(label)}?.getBoundingClientRect().height>=44`, `${label} garde 44 px (SEENIT-UX-008)`);
    await click(client, byLabel('Épisode 16'));
    await check(client, 'document.querySelector("[role=dialog] h1")?.textContent==="Felina" && document.body.innerText.includes("Résumé masqué")', 'une case ouvre l’épisode et masque son résumé si le précédent n’est pas vu');
    await click(client, byText('button', 'Résumé masqué'));
    await check(client, 'document.body.innerText.includes("Fin de Walt") && !document.body.innerText.includes("Résumé masqué")', 'le résumé se révèle au toucher');
    await delay(400);
    await click(client, byLabel('Épisode 14'));
    await check(client, 'document.querySelector("[role=dialog] h1")?.textContent==="Ozymandias"', 'retour sur E14 par la case');
    await delay(400);
    await click(client, byText('button', 'Vu, puis E15'));
    await check(client, 'document.querySelector("[role=dialog] h1")?.textContent==="Granite State"', '« Vu, puis E15 » marque et enchaîne');
    await delay(400); // une navigation d’épisode ignore les touches pendant sa transition (300 ms)
    await click(client, byLabel('Épisode 14, vu'));
    await check(client, 'document.body.innerText.includes("✓ Vu") && ' + byLabel('Ta réaction') + '', 'l’épisode marqué est vu et propose une réaction');
    await click(client, byLabel('J’adore'));
    await check(client, byLabel('J’adore') + '?.getAttribute("aria-pressed")==="true"', 'réaction enregistrée dans l’épisode');
    const episodeGeometry = await evaluate(client, geometry);
    if (episodeGeometry.overflow) throw new Error(`SEENIT-UX-019 épisode ${width}px déborde ${JSON.stringify(episodeGeometry)}`);
    const errors = await evaluate(client, 'window.__mediaErrors');
    if (errors.length) throw new Error(`SEENIT-UX-019 erreurs ${JSON.stringify(errors)}`);
    reports.push({ width, series: 'pass', movie: 'pass', episode: 'pass' });
  }
  return reports;
}

module.exports = { buildMediaDetailHarness, testMediaDetailHarness };
