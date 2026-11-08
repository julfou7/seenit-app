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
      builder.onResolve({ filter: /^firebase\/(?:firestore|auth)$|\/(?:firebase|tmdb|showsStore|syncPlex|DownloadModal|PreciseVersionPage|PersonDetailModal|PersonProfile|TrailerModal|useShows|toastStore|useDetailsSyncWorker|useMediaPresence|downloadConfigStore|downloadLaunch)$/ }, () => ({ path: runtime }));
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
async function pressEnter(client) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
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
    await check(client, '(()=>{const chip=[...document.querySelectorAll("span")].find(el=>/^★ .* TMDB$/.test(el.textContent.trim()));const progress=' + byLabel('65 épisodes vus sur 68') + ';return chip&&progress&&(chip.compareDocumentPosition(progress)&Node.DOCUMENT_POSITION_FOLLOWING)})()', 'série : note et âge au-dessus de la progression (#857)');
    await click(client, byText('button', 'Voir S05 | E14'));
    await check(client, 'window.__mediaDetail.telemetry.opens.includes("next") && document.body.innerText.includes("65 / 68 épisodes")', 'le bouton or ouvre le prochain épisode sans le marquer');
    await check(client, 'document.body.innerText.includes("Drame, Crime") && ' + byText('[aria-label="Genres et thèmes"] span', 'Téléréalité') + ' && !document.body.innerText.includes("Reality")', 'genres TMDB traduits en français');
    await check(client, byText('[aria-labelledby=detail-cast-title] button', 'Elle-même') + ' && !document.body.innerText.match(/\\bSelf\\b/)', 'rôle « Self » traduit et accordé');
    await check(client, '(()=>{const themes=document.querySelector("[aria-label=\\"Genres et thèmes\\"]"),chart=[...document.querySelectorAll("span")].find(el=>el.textContent==="Moyenne par saison");return themes&&chart&&(themes.compareDocumentPosition(chart)&Node.DOCUMENT_POSITION_FOLLOWING)&&new Set([...themes.children].filter(el=>el.getBoundingClientRect().height>0).map(el=>Math.round(el.getBoundingClientRect().height))).size===1})()', 'genres et thèmes sous le synopsis, pastilles alignées');
    await check(client, 'document.body.innerText.includes("Moyenne par saison") && document.querySelectorAll("[role=group][aria-label=Saisons] button").length===5', 'courbe des saisons et pastilles');
    await click(client, byLabel('Saison 1, vue'));
    await check(client, '' + byLabel('Saison 1, vue') + '?.getAttribute("aria-pressed")==="true" && document.body.innerText.includes("Saison 1 · 13/13")', 'une pastille sélectionne sa saison');
    await check(client, '(()=>{const pills=[...document.querySelectorAll("[aria-label^=\\"Saison \\"][aria-pressed]")];const full=' + byLabel('Saison 1, vue') + '?.querySelector("[data-season-bar] i");return pills.length>1&&pills.every(p=>p.querySelector("[data-season-bar]")&&p.getBoundingClientRect().height>=44)&&full?.style.width==="100%"})()', 'pastilles de saison avec mini-barre « vu » (#879)');
    // Retour terrain du 08/11 : saison finie = anneau Vu de SeenIt (plus de « ✓ vue »), saison choisie cerclée d'or sur fond sombre.
    await check(client, '(()=>{const pill=' + byLabel('Saison 1, vue') + ';const group=document.querySelector("[role=group][aria-label=Saisons]");return pill&&pill.querySelector("[data-brand-ring]")&&!group.innerText.includes("✓")&&getComputedStyle(pill).backgroundColor!=="rgb(229, 169, 61)"})()', 'pastille de saison vue : anneau Vu, sans « ✓ vue » ni aplat or (08/11)');
    // Lignes d'épisode : numéro coloré à la place de la note (déjà dans les barres), image sans repère.
    await check(client, '(()=>{const rows=[...document.querySelectorAll("[data-episode-row]")];const code=rows[0]?.querySelector("[data-episode-code]");return rows.length>3&&code?.textContent==="E01"&&rows.every(r=>r.querySelector("[data-episode-code]")&&!r.innerText.includes("★")&&!r.querySelector(".seenit-watched-stamp"))})()', 'lignes d’épisode : « E01 » coloré, sans note ni tampon sur l’image (08/11)');
    await click(client, byText('button', 'Tout marquer non vu'));
    await check(client, 'document.body.innerText.includes("Saison 1 · 0/13") && ' + byText('button', 'Tout marquer vu'), 'tout marquer non vu puis vu depuis la carte saison');
    await click(client, byLabel('Marquer l’épisode 1 vu'));
    await check(client, 'document.body.innerText.includes("Saison 1 · 1/13") && ' + byLabel('Marquer l’épisode 1 non vu') + '?.getAttribute("aria-pressed")==="true"', 'la coche d’une ligne bascule l’épisode');
    await check(client, byLabel('Marquer l’épisode 2 vu') + '?.classList.contains("seenit-check") && ' + byLabel('Marquer l’épisode 2 vu') + '.querySelector(".seenit-ring-glyph")', 'bouton Vu des lignes = celui de l’Accueil, anneau animé (#857)');
    // #845 : Entrée sur le bouton Vu imbriqué bascule l'épisode sans ouvrir sa fiche ; Entrée sur la ligne l'ouvre.
    await evaluate(client, `${byLabel('Marquer l’épisode 2 vu')}.focus()`);
    await pressEnter(client);
    await check(client, 'document.body.innerText.includes("Saison 1 · 2/13") && !window.__mediaDetail.telemetry.opens.includes("episode:1x2")', 'Entrée sur Vu ne fait que basculer l’épisode');
    await evaluate(client, 'document.querySelector(\'[aria-label^="Épisode 3 :"]\').focus()');
    await pressEnter(client);
    await check(client, 'window.__mediaDetail.telemetry.opens.includes("episode:1x3") && document.body.innerText.includes("Saison 1 · 2/13")', 'Entrée sur la ligne ouvre l’épisode sans le marquer');
    // #859 : animation au toucher, sans atténuation, entièrement sur le compositeur (aucune animation SVG).
    await evaluate(client, `${byLabel('Marquer l’épisode 5 vu')}.click()`);
    await check(client, '(()=>{const b=document.querySelector(\'[aria-label="Marquer l’épisode 5 vu"],[aria-label="Marquer l’épisode 5 non vu"]\');if(!b||b.dataset.celebrate!=="true"||!b.classList.contains("seenit-check--compositor")||!b.querySelector(".seenit-check__sweep"))return false;const all=b.getAnimations({subtree:true});return all.length>=5&&all.every(a=>!(a.effect.target instanceof SVGElement))&&getComputedStyle(b).opacity==="1"})()', 'anneau Vu dessiné par le compositeur, sans atténuation (#859)');
    await check(client, '(()=>{const b=' + byLabel('Marquer l’épisode 5 non vu') + ';return b&&b.getAttribute("aria-pressed")==="true"&&!b.dataset.celebrate&&!b.querySelector(".seenit-check__sweep")})()', 'anneau Vu final net après l’animation (#859)');
    await check(client, byText('a,button,div', 'Inclus dans ton abonnement') + ' && ' + byLabel('Actualiser Plex') + ' && ' + byText('button', 'Sur Julien-NAS'), 'Où regarder en lignes avec Plex et actualisation');
    await check(client, 'document.querySelectorAll(\'[aria-labelledby=detail-cast-title] > button[aria-label^="Ouvrir la fiche"]\').length===6 && (()=>{const more=document.querySelector("[aria-labelledby=detail-cast-title] [data-load-more]");return more&&more.textContent.includes("Afficher le dernier")&&!more.textContent.includes("en attente")&&more.getBoundingClientRect().height>=44})()', 'Personnages : six lignes puis le seul « Afficher plus » (#873)');
    // #873 : le focus clavier suit le dépliage (premier personnage révélé) puis le repli (« Afficher plus »).
    await click(client, 'document.querySelector("[aria-labelledby=detail-cast-title] [data-load-more]")');
    await check(client, '(()=>{const rows=document.querySelectorAll("[aria-labelledby=detail-cast-title] [data-cast-row]");return rows.length===7&&document.activeElement===rows[6]})()', 'Afficher plus : le focus passe au premier personnage révélé (#873)');
    await click(client, '[...document.querySelectorAll("[aria-labelledby=detail-cast-title] button")].find(b=>b.textContent.trim()==="Réduire")');
    await check(client, 'document.activeElement===document.querySelector("[aria-labelledby=detail-cast-title] [data-load-more]")', 'Réduire : le focus revient sur « Afficher plus » (#873)');
    await check(client, byText('button', 'Better Call Saul') + ' && document.body.innerText.includes("Dans le même univers")', 'univers TVDB en lignes');
    await click(client, byLabel('Actions de la fiche'));
    await check(client, ['Partager la fiche', 'Synchroniser la série', 'Téléchargement', 'Abandonner la série', 'Supprimer la série'].map(label => byText('[role=dialog] button', label)).join(' && '), 'menu ⋮ : toutes les actions existantes');
    await check(client, '(()=>{const menu=document.querySelector("[data-anchored-menu]"),button=' + byLabel('Actions de la fiche') + ';if(!menu||!button)return false;const m=menu.getBoundingClientRect(),b=button.getBoundingClientRect();return menu.getAttribute("role")==="menu"&&m.top>=b.bottom-1&&m.top<=b.bottom+24&&Math.abs(m.right-b.right)<=12&&m.bottom<innerHeight-40&&m.width<=300})()', 'menu ⋮ ancré sous son bouton, plus de feuille du bas (#879)');
    await evaluate(client, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    const seriesGeometry = await evaluate(client, geometry);
    if (seriesGeometry.overflow) throw new Error(`SEENIT-UX-019 série ${width}px déborde ${JSON.stringify(seriesGeometry)}`);

    await mount(client, width, 'movie');
    await check(client, 'document.querySelector("h1")?.textContent==="Dune : Deuxième partie" && document.body.innerText.includes("2024 · 2 h 46 · Science-fiction, Aventure")', 'hero film');
    await check(client, 'document.body.innerText.includes("Si tu lances maintenant") && /Fin à \\d\\d:\\d\\d/.test(document.body.innerText)', 'heure de fin du film');
    await check(client, '!/il est \\d/.test(document.body.innerText) && !document.body.innerText.includes("avant minuit")', 'Fin à épuré : ni « il est », ni « Fini … avant minuit » (#857)');
    await check(client, '(()=>{const chip=[...document.querySelectorAll("span")].find(el=>/^★ .* TMDB$/.test(el.textContent.trim()));const cta=' + byText('button', 'Suivre le film') + ';return chip&&cta&&(chip.compareDocumentPosition(cta)&Node.DOCUMENT_POSITION_FOLLOWING)})()', 'note et âge au-dessus de Marquer vu (#857)');
    await check(client, byText('button', 'Bande-annonce') + '?.textContent.trim()==="Bande-annonce"', 'bande-annonce en bouton entier, comme la série (#857)');
    // #871 Saga v2 : repères numérotés, film affiché encadré « TU ES ICI », X / N vus, tampon VU sur l'affiche, alignement.
    await check(client, '(()=>{const saga=document.querySelector("[data-saga-timeline]");if(!saga||!saga.textContent.includes("Saga Dune")||!saga.textContent.includes("1 / 3 vus"))return false;const rows=[...saga.querySelectorAll("[data-saga-row]")];if(rows.map(r=>r.querySelector("[data-saga-marker]").textContent).join()!=="1,2,3")return false;const here=saga.querySelector("[aria-current=page]");return here&&here.dataset.sagaRow==="2"&&here.textContent.includes("TU ES ICI")&&rows[0].querySelector(".seenit-watched-stamp")&&rows[0].textContent.includes(", vu")&&rows[2].textContent.includes("À voir")&&!rows[2].querySelector(".seenit-watched-stamp")&&saga.querySelectorAll("[data-saga-segment]").length===3})()', 'saga v2 : numérotée, TU ES ICI, 1 / 3 vus, tampon VU annoncé (#871)');
    await check(client, '[...document.querySelectorAll("[data-saga-row]")].every(row=>{const m=row.querySelector("[data-saga-marker]").getBoundingClientRect(),p=row.querySelector("[data-saga-poster]").getBoundingClientRect(),c=row.getBoundingClientRect();return Math.abs((m.top+m.height/2)-(p.top+p.height/2))<=1&&Math.abs((m.top+m.height/2)-(c.top+c.height/2))<=1})', 'saga v2 : repère, affiche et ligne centrés sur le même axe (#871)');
    await check(client, '(()=>{const rows=[...document.querySelectorAll("[data-saga-row]")];const gold=rows.filter(r=>getComputedStyle(r.querySelector("strong:not(.sr-only)")).color==="rgb(242, 195, 107)");return gold.length===1&&gold[0].getAttribute("aria-current")==="page"&&getComputedStyle(rows[0].querySelector("[data-saga-marker]")).backgroundColor!=="rgb(229, 169, 61)"})()', 'saga v3 : l’or réservé au film affiché, repères des films vus neutres');
    await check(client, byLabel('Blade Runner 2049 — Même réalisateur · Denis Villeneuve') + ' && ' + byLabel('Interstellar — Avec Timothée Chalamet') + ' && !document.body.innerText.includes("Oppenheimer")', 'similaires : seulement avec une raison prouvée');
    // #859 : un seul bouton à états, avec les tuiles diffuseur et Plex comme la série.
    await check(client, '(()=>{const cta=' + byText('button', 'Suivre le film') + ';if(!cta||' + byText('button', 'Marquer vu') + ')return false;const row=cta.parentElement;return row.querySelector(\'[aria-label="Ouvrir Netflix"]\')&&!row.querySelector(\'[aria-label="Ouvrir Plex"]\')})()', 'film : un seul bouton Suivre et une seule tuile diffuseur, ta plateforme avant Plex (#859, 08/11)');
    await click(client, byText('button', 'Suivre le film'));
    await check(client, byText('button', 'Marquer vu') + '?.textContent.includes("Film suivi") && !' + byText('button', 'Suivre le film'), 'film suivi : le bouton devient Marquer vu (#859)');
    await click(client, byText('button', 'Marquer vu'));
    await check(client, '(()=>{const cta=document.querySelector(\'button[aria-label="Vu, toucher pour annuler"]\');return cta&&cta.querySelector("[data-movie-seen] svg[data-brand-ring][data-active=true]")&&cta.textContent.trim()==="Vu"&&!document.body.innerText.includes("annuler")})() && !document.body.innerText.includes("Si tu lances maintenant")', 'film vu : logo Vu de SeenIt, plus de « Vu · annuler », plus d’heure de fin');
    const movieGeometry = await evaluate(client, geometry);
    if (movieGeometry.overflow) throw new Error(`SEENIT-UX-019 film ${width}px déborde ${JSON.stringify(movieGeometry)}`);

    await mount(client, width, 'episode');
    await check(client, 'document.querySelector("[role=dialog] h1")?.textContent==="Ozymandias" && document.body.innerText.includes("S05 | E14")', 'fiche épisode titrée');
    await check(client, 'document.querySelector(\'[role=dialog] button.seenit-check[aria-label="Marquer vu"] .seenit-ring-glyph\') && !/il est \\d/.test(document.body.innerText)', 'Vu de la fiche épisode = anneau de l’Accueil, sans « il est » (#857)');
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
    await mount(client, width, 'episodeSkeleton');
    await check(client, 'document.querySelector("[data-episode-skeleton]") && document.body.innerText.includes("S05 | E14") && ' + byLabel('Retour à la série') + ' && !document.querySelector(\'[class*="h-[280px]"]\')', 'squelette épisode au gabarit actuel (#857)');
    const episodeGeometry = await evaluate(client, geometry);
    if (episodeGeometry.overflow) throw new Error(`SEENIT-UX-019 épisode ${width}px déborde ${JSON.stringify(episodeGeometry)}`);
    const errors = await evaluate(client, 'window.__mediaErrors');
    if (errors.length) throw new Error(`SEENIT-UX-019 erreurs ${JSON.stringify(errors)}`);
    reports.push({ width, series: 'pass', movie: 'pass', episode: 'pass' });
  }
  return reports;
}

module.exports = { buildMediaDetailHarness, testMediaDetailHarness };
