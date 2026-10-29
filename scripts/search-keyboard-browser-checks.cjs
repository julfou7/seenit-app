const fs = require('node:fs'), path = require('node:path'), esbuild = require('esbuild');
async function buildSearchKeyboardHarness(root) {
 const runtime = path.join(root,'tests/fixtures/explorerRefonteRuntime.ts');
 const nav = path.join(root,'tests/fixtures/navbar13jRuntime.ts');
 await esbuild.build({ entryPoints:[path.join(root,'tests/fixtures/explorerRefonte.tsx')], outfile:path.join(root,'dist/__seenit-search-keyboard.js'), bundle:true, platform:'browser', format:'iife', target:['chrome120'], logLevel:'silent', plugins:[{name:'explorer-ports',setup(b){
   b.onResolve({filter:/^firebase\/firestore$/},args=>args.importer.endsWith('removeTrackedMedia.ts')?{path:runtime}:undefined);
   b.onResolve({filter:/\/(?:downloadConfigStore|liveDownloadStore|logStore)$/},()=>({path:nav}));
   b.onResolve({filter:/\/(?:tmdb|useShows|showsStore|toastStore|firebase|recommendations|usePassiveWatchProvider|parentalRatingStore|progressiveAgeFilter|cinemaSearchEvidence|apiAuth)$/},()=>({path:runtime}));
 }}]});
 const css = fs.readdirSync(path.join(root,'dist/assets')).filter(file=>file.endsWith('.css'));
 fs.writeFileSync(path.join(root,'dist/__seenit-search-keyboard.html'),`<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(file=>`<link rel="stylesheet" href="/assets/${file}">`).join('')}<link rel="stylesheet" href="/__seenit-search-keyboard.css"><style>body{margin:0;background:#0B0B0D;color:white}</style><div id="root"></div><script src="/__seenit-search-keyboard.js"></script></html>`);
}
async function evaluate(client, expression) {
 const result = await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
 if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 return result.result?.value;
}
async function check(client, expression, label) {
 for(let attempt=0;attempt<100;attempt++){
  if(await evaluate(client, expression))return;
  await new Promise(resolve=>setTimeout(resolve,40));
 }
 throw Error('#787 '+label+' '+JSON.stringify(await evaluate(client,'({text:document.body.innerText.slice(0,1000),input:document.querySelector("input")?.getBoundingClientRect().toJSON(),scroll:document.querySelector(".explorer-scroll")?.scrollTop,editing:document.querySelector("[data-discover-search-editing]")?.getAttribute("data-discover-search-editing"),viewport:visualViewport.height,dock:document.querySelector(".explorer-search-dock")?.getAttribute("style"),active:document.activeElement?.id,homePages:window.__explorer?.telemetry.homePages,mode:document.querySelector("[data-discover-search-mode]")?.getAttribute("data-discover-search-mode"),sentinel:{text:document.querySelector(".explorer-page-sentinel")?.textContent,rect:document.querySelector(".explorer-page-sentinel")?.getBoundingClientRect().toJSON()},buttons:[...document.querySelectorAll("button")].map(b=>b.getAttribute("aria-label")).filter(Boolean),geometry:[...document.querySelectorAll("main,[data-app-tab],.explorer-root,.explorer-scroll,.explorer-content")].map(n=>({class:n.className,rect:n.getBoundingClientRect().toJSON(),height:n.scrollHeight}))})')));
}
async function testSearchKeyboardHarness(client, root) {
 await client.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 const reports=[];
 const click = expression => evaluate(client, `(${expression}).click()`);
 const find = text => `[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
 const shot = async name => fs.writeFileSync(path.join(root,'quality-reports',name+'.png'), Buffer.from((await client.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 for(const width of [360,390,412]){
  await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:true});
  await client.send('Page.navigate',{url:'http://127.0.0.1:4173/__seenit-search-keyboard.html'});
  await check(client,'Boolean(document.querySelector(".media-grid-card"))','grille de production');
  await shot('explorer-repos-'+width);
  const navs=[];
  for(const downloads of [true,false]){
   for(const tab of ['watchlist','discover','profile']){
    await evaluate(client,`window.__explorer.enabled(${downloads});window.__explorer.tab("${tab}")`);
    await check(client,`document.querySelector('[data-navigation-tab="${tab}"]')?.getAttribute('aria-current')==="page"`,'onglet actif');
    navs.push({downloads,tab,rect:await evaluate(client,'document.querySelector(".bottom-nav-island").getBoundingClientRect().toJSON()')});
   }
  }
  for(const downloads of [true,false]){
   const same=navs.filter(row=>row.downloads===downloads);
   if(same.some(row=>Math.abs(row.rect.width-same[0].rect.width)>.1||Math.abs(row.rect.x-same[0].rect.x)>.1))throw Error('#787 nav différente selon onglet');
  }
  await evaluate(client,'window.__explorer.tab("discover")');
  await check(client,'document.querySelector("[data-app-tab=discover]").getAttribute("aria-hidden")==="false"','retour Explorer');
  await click(find('Films'));
  await check(client,'document.querySelector(".media-grid-card")?.textContent.includes("Page 1")','catalogue première page');
  await check(client,'(()=>{const scroll=document.querySelector(".explorer-scroll");scroll.scrollTop=scroll.scrollHeight;return [...document.querySelectorAll(".media-grid-card")].some(n=>n.textContent.includes("Page 3 |"))})()','catalogue trois pages via défilement');
  await evaluate(client,'document.querySelector(".explorer-scroll").scrollTop=Math.floor(document.querySelector(".explorer-scroll").scrollHeight*.72)');
  await new Promise(resolve=>setTimeout(resolve,100));
  const pagedScroll=await evaluate(client,'document.querySelector(".explorer-scroll").scrollTop');
  const homeCalls=await evaluate(client,'window.__explorer.telemetry.homePages.length');
  await click('document.querySelector("[aria-label=Rechercher]")');
  await client.send('Input.insertText',{text:'game'});
  await check(client,'document.querySelector("[aria-label=\\\"Films et séries TMDB\\\"]")?.textContent.includes("Game of Thrones")','recherche après trois pages');
  await click('document.querySelector("[aria-label=\\\"Quitter la recherche\\\"]")');
  await check(client,'Math.abs(document.querySelector(".explorer-scroll").scrollTop-'+pagedScroll+')<1 && window.__explorer.telemetry.homePages.length==='+homeCalls,'retour conserve trois pages et défilement exact sans requête catalogue');
  await click(find('Tout'));
  await check(client,'Boolean(document.querySelector(".explorer-hero"))','retour catalogue Tout');
  await evaluate(client,'document.querySelector(".explorer-scroll").scrollTop=530');
  await check(client,'Math.abs(document.querySelector(".explorer-controls").getBoundingClientRect().top)<1','commandes collantes');
  const originalScroll=await evaluate(client,'document.querySelector(".explorer-scroll").scrollTop');
  await click('document.querySelector("[aria-label=Rechercher]")');
  await check(client,'document.querySelector("[data-discover-search-editing]")?.dataset.discoverSearchEditing==="true" && document.activeElement===document.querySelector("[data-navigation-search]") && getComputedStyle(document.querySelector(".bottom-nav-shell")).display==="none"','entrée recherche cache nav');
  await evaluate(client,'window.__explorer.keyboard(560)');
  await check(client,'Math.abs(document.querySelector(".explorer-circle").getBoundingClientRect().bottom-552)<1','dock à8px du clavier');
  await evaluate(client,'window.__explorer.keyboard(915)');
  await check(client,`!document.querySelector('[data-navigation-search]') && Math.abs(document.querySelector('.explorer-scroll').scrollTop-${originalScroll})<1`,'clavier vide restaure scroll');
  await click('document.querySelector("[aria-label=Rechercher]")');
  await evaluate(client,'window.__explorer.keyboard(560)');
  await client.send('Input.insertText',{text:'b'});
  await check(client,'document.querySelector("[aria-label=\\\"Dans ta bibliothèque\\\"]")?.textContent.includes("Breaking Bad")','bibliothèque instantanée');
  await check(client,'document.querySelector("[aria-label=\\\"Films et séries TMDB\\\"]")?.textContent.includes("au cinéma")','type+id ne supprime pas le film homonyme');
  await shot('explorer-recherche-'+width);
  await evaluate(client,'window.__explorer.keyboard(915)');
  await check(client,'getComputedStyle(document.querySelector(".bottom-nav-shell")).display==="none" && document.querySelector("input").value==="b" && Math.abs(document.querySelector(".explorer-circle").getBoundingClientRect().bottom-(innerHeight-30))<1','clavier fermé avec texte conserve mode');
  await evaluate(client,'document.querySelector("input").focus()');
  await check(client,'document.querySelector("[data-discover-search-editing]").getAttribute("data-discover-search-editing")==="true"','focus matériel');
  await client.send('Emulation.setDeviceMetricsOverride',{width,height:560,deviceScaleFactor:1,mobile:true});
  await evaluate(client,'window.__explorer.keyboard(560)');
  await check(client,'Math.abs(document.querySelector(".explorer-circle").getBoundingClientRect().bottom-552)<1','adjustResize sans double compensation');
  await client.send('Emulation.setDeviceMetricsOverride',{width,height:915,deviceScaleFactor:1,mobile:true});
  await evaluate(client,'window.__explorer.keyboard(915)');
  await click('document.querySelector("[aria-label=\\\"Ajouter Breaking Bad au cinéma à À voir\\\"]")');
  await check(client,'window.__explorer.telemetry.statuses.includes("plan_to_watch")','ajout plan_to_watch');
  const toastAboveSearch = '(()=>{const toast=document.querySelector("#toast-notification-wrapper"),field=document.querySelector(".explorer-circle");return toast&&field&&toast.getBoundingClientRect().bottom<=field.getBoundingClientRect().top-6})()';
  await check(client,toastAboveSearch,'toast au-dessus du champ clavier fermé');
  await evaluate(client,'document.querySelector("input").focus();window.__explorer.keyboard(560)');
  await check(client,toastAboveSearch,'toast au-dessus du champ clavier ouvert');
  await evaluate(client,'window.__explorer.clearToast();window.__explorer.keyboard(915)');
  await click('document.querySelector("[aria-label=\\\"Quitter la recherche\\\"]")');
  await check(client,'getComputedStyle(document.querySelector(".bottom-nav-shell")).display!=="none"','sortie recherche');
  await click('document.querySelector("[aria-label=Rechercher]")');
  await client.send('Input.insertText',{text:'Game of Thrones'});
  await check(client,'Boolean(document.querySelector("[aria-label=\\\"Retirer Game of Thrones d’À voir\\\"]"))','titre alternatif suivi conservé dans TMDB');
  await click('document.querySelector("[aria-label=\\\"Retirer Game of Thrones d’À voir\\\"]")');
  await check(client,'!window.__explorer.shows().some(show=>show.id==="local-got")','retrait du document original');
  await evaluate(client,'window.__explorer.undoToast()');
  await check(client,'window.__explorer.shows().some(show=>show.id==="local-got") && window.__explorer.telemetry.documentWrites.at(-1)==="users/explorer-test/shows/local-got"','annulation restaure le même document sans attendre le listener');
  await click('document.querySelector("[aria-label=\\\"Retirer Game of Thrones d’À voir\\\"]")');
  await check(client,'window.__explorer.telemetry.deleted.at(-1)==="local-got"','second retrait vise la même identité');
  await evaluate(client,'window.__explorer.undoToast();window.__explorer.clearToast()');
  await click('document.querySelector("[aria-label=\\\"Quitter la recherche\\\"]")');
  await click('document.querySelector(".explorer-control-filter")');
  await check(client,'Boolean(document.querySelector(".explorer-filter-sheet"))','panneau filtres');
  await click('document.querySelector("[role=switch]")');
  await check(client,'document.querySelectorAll(".explorer-platform-grid [aria-pressed=true]").length===3 && !document.querySelector(".explorer-hero") && Boolean(document.querySelector(".explorer-filter-sheet"))','Mes plateformes exactes et mise à jour directe');
  await new Promise(resolve=>setTimeout(resolve,220));
  await shot('explorer-filtres-'+width);
  await click('document.querySelector("[aria-label=\\\"Fermer les filtres\\\"]")');
  await click('document.querySelector(".explorer-chips span button")');
  await check(client,'document.querySelector("#filter-tab-Plateformes")?.getAttribute("aria-selected")==="true"','pastille rouvre le bon onglet');
  await click(find('Réinitialiser'));
  await click(find('Année'));
  await evaluate(client,`(()=>{const s=document.querySelector('select');s.value='2015';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await check(client,'document.querySelector(".explorer-category[aria-pressed=true]")?.textContent==="Films"','année force Films');
  await click('document.querySelector("[aria-label=\\\"Fermer les filtres\\\"]")');
  await testCharacterJourney(client,root,width,shot);
  await evaluate(client,'window.__explorer.library(true);window.__explorer.clearToast()');
  await check(client,'[...document.querySelectorAll(".media-grid-card")].some(n=>n.textContent.includes("Le Trône de fer"))','bibliothèque réelle montée');
  await evaluate(client,'[...document.querySelectorAll(".media-grid-card")].find(n=>n.textContent.includes("Le Trône de fer")).querySelector("button").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');
  await check(client,'[...document.querySelectorAll("[aria-label=\\\"Aperçu du média\\\"] button")].some(b=>b.textContent===\"Retirer d’À voir\" && !b.disabled)','retrait actif dans bibliothèque');
  await click('[...document.querySelectorAll("[aria-label=\\\"Aperçu du média\\\"] button")].find(b=>b.textContent===\"Retirer d’À voir\")');
  await check(client,'!window.__explorer.shows().some(show=>show.id==="local-got")','bibliothèque retire le document');
  await evaluate(client,'window.__explorer.undoToast()');
  await check(client,'window.__explorer.shows().find(show=>show.id==="local-got")?.episodeRecords["1x1"]?.watchedAt===123','annuler bibliothèque conserve la progression');
  await evaluate(client,'window.__explorer.library(false)');

  reports.push({width,navs,status:'pass'});
 }
 fs.writeFileSync(path.join(root,'quality-reports/explorer-refonte.json'),JSON.stringify(reports,null,2));
 return reports;
}
module.exports={buildSearchKeyboardHarness,testSearchKeyboardHarness};

async function testCharacterJourney(client,root,width,shot) {
 const q=selector=>'document.querySelector('+JSON.stringify(selector)+')';
 const click=expression=>evaluate(client,'('+expression+').click()');
 const button=text=>'[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+')';
 await evaluate(client,'window.__explorer.clearToast()');
 await click(button('Tout'));
 await check(client,'Boolean(document.querySelector(".explorer-hero"))','hero après reset');
 await click(button('Bande-annonce'));
 await check(client,'document.querySelector("[aria-label=\\\"Aperçu du média\\\"]")?.textContent.includes("Ouvrir la fiche")','E-01 ouvre le même aperçu');
 await shot('explorer-apercu-'+width);
 await check(client,'[...document.querySelectorAll("[aria-label=\\\"Aperçu du média\\\"] button")].some(b=>b.textContent===\"Ajouter à À voir\" && !b.disabled)','aperçu film distinct de la série au même identifiant');
 await click(q('[aria-label="Fermer l’aperçu"]'));
 await check(client,'!document.querySelector("[aria-label=\\\"Aperçu du média\\\"]")','fermeture aperçu');
 await click(q('[aria-label="Rechercher"]'));
 await client.send('Input.insertText',{text:'saul'});
 await check(client,q('section[aria-label="Personnages"]')+'?.textContent.includes("Saul Goodman")','recherche personnage de production');
 await evaluate(client,'window.__explorer.keyboard(560)');
 await click(q('section[aria-label="Personnages"] button'));
 await check(client,'document.querySelector(".character-sheet h1")?.textContent==="Saul Goodman" && document.activeElement!==document.querySelector("[data-navigation-search]")','P-01/E-19 personnage, clavier fermé');
 await evaluate(client,'window.__explorer.keyboard(915)');
 await check(client,'document.querySelector(".character-stats").getAttribute("aria-busy")==="false" && document.querySelector(".character-stats").textContent.includes("0/3")','preuves exactes avant ratio');
 await shot('explorer-personnage-'+width);
 await click(q('[aria-label="Suivre ce personnage"]'));
 await check(client,q('[aria-label="Ne plus suivre ce personnage"]')+'?.getAttribute("aria-pressed")==="true"','favori personnage');
 await evaluate(client,'window.__explorer.uid("character-other")');
 await check(client,q('[aria-label="Suivre ce personnage"]')+'?.getAttribute("aria-pressed")==="false"','favori isolé par UID');
 await evaluate(client,'window.__explorer.uid("explorer-test")');
 await check(client,q('[aria-label="Ne plus suivre ce personnage"]')+'?.getAttribute("aria-pressed")==="true"','favori compte précédent conservé');
 await click(q('[aria-label="Ne plus suivre ce personnage"]'));
 await click(q('.character-neighbors button[data-available=true]'));
 await check(client,'document.querySelector(".character-sheet h1")?.textContent==="Walter White"','P-07 ouvre la fiche voisine');
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 await check(client,'document.querySelector(".character-sheet h1")?.textContent==="Saul Goodman"','P-09 premier retour au personnage précédent');
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 await check(client,'!document.querySelector(".character-sheet")','P-09 second Retour ferme le personnage');
 await click('[...document.querySelectorAll("[aria-label=Personnages] button")].find(b=>b.textContent.includes("Saul Goodman"))');
 await check(client,'document.querySelector(".character-sheet h1")?.textContent==="Saul Goodman"','réouverture personnage après retours successifs');
 await click(q('[aria-label="Joué par Bob Odenkirk"]'));
 await check(client,'[...document.querySelectorAll("[data-dialog-layer]")].some(n=>n.getAttribute("aria-label")==="Fiche personne" && n.textContent.includes("Bob Odenkirk"))','P-04 ouvre la fiche acteur réelle');
 await check(client,'[...document.querySelectorAll("[aria-label=\\\"Fiche personne\\\"] .media-grid-card")].some(n=>n.textContent.includes("Game of Thrones"))','filmographie acteur chargée');
 await evaluate(client,'[...document.querySelectorAll("[aria-label=\\\"Fiche personne\\\"] .media-grid-card")].find(n=>n.textContent.includes("Game of Thrones")).querySelector("button").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');
 await check(client,'[...document.querySelectorAll("[aria-label=\\\"Aperçu du média\\\"] button")].some(b=>b.textContent===\"Retirer d’À voir\" && !b.disabled)','retrait actif depuis la fiche acteur');
 await click('[...document.querySelectorAll("[aria-label=\\\"Aperçu du média\\\"] button")].find(b=>b.textContent===\"Retirer d’À voir\")');
 await check(client,'!window.__explorer.shows().some(show=>show.id==="local-got")','aperçu acteur retire sans réinitialiser');
 await evaluate(client,'window.__explorer.undoToast()');
 await check(client,'window.__explorer.shows().find(show=>show.id==="local-got")?.episodeRecords["1x1"]?.watchedAt===123','annuler acteur conserve les données de visionnage');
 await evaluate(client,'history.back()');
 await check(client,'![...document.querySelectorAll("[data-dialog-layer]")].some(n=>n.getAttribute("aria-label")==="Fiche personne") && document.querySelector(".character-sheet h1")?.textContent==="Saul Goodman"','retour acteur vers personnage');
 await click(q('.character-works>button'));
 await check(client,'Boolean(document.querySelector("#media-target")) && history.state.selectedShow?.id===1396 && history.state.selectedShow?.episode===2','P-06 épisode propre au personnage');
 await click(q('#mark-character-seen'));
 await click(q('#back-from-media'));
 await check(client,'!document.querySelector("#media-target") && document.querySelector(".character-stats")?.textContent.includes("1/3")','P-08 vus mis à jour au retour');
 await click(q('[aria-label="Retour depuis la fiche personnage"]'));
 await check(client,'!document.querySelector(".character-sheet") && document.querySelector("[data-navigation-search]")?.value==="saul" && document.activeElement!==document.querySelector("[data-navigation-search]")','E-19 retour aux résultats, même requête et clavier fermé');
}
