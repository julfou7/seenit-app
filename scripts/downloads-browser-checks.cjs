const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function buildDownloadsHarness(root) {
  const dist = path.join(root, 'dist');
  const runtime = path.join(root, 'tests/fixtures/downloadsRuntime.ts');
  await esbuild.build({ entryPoints: [path.join(root, 'tests/fixtures/downloads.tsx')], outfile: path.join(dist, '__seenit-downloads.js'), bundle: true, platform: 'browser', format: 'iife', target: ['chrome120'], logLevel: 'silent', plugins: [{ name: 'download-ui-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:liveDownloadStore|downloadConfigStore|toastStore|showsStore|sonarrRadarr|sonarrRadarrTransport|c411|DownloadConfigSection|AlternativeReleaseModal|downloadLifecycle|useTabShortcut|useMediaPresence|episodeSeasonPackFallback|addNextEpisode)$/ }, () => ({ path: runtime }));
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
    await check(client, 'window.__downloads && document.querySelectorAll("article[data-download-id]").length===3', 'vrais écran et cartes montés');
    // Maquette DlOngletSuivi : À régler (échec + pas encore trouvé), En cours, puis Téléchargés ; un terminé déjà importé n'est pas répété.
    await check(client, '[...document.querySelectorAll("section h2")].map(el=>el.textContent).join(";")==="À régler;En cours;Téléchargés"&&document.querySelector(".downloads-subtitle")?.textContent==="1 en cours · 2 à régler"', 'sections de la maquette et sous-titre');
    await check(client, '(()=>{const b=document.querySelector(\'[aria-label="Recherche avancée"]\').getBoundingClientRect();const all=[...document.querySelectorAll(".downloads-header__actions button")];return b.width>=44&&b.height>=44&&!document.querySelector(".downloads-segments")&&all.length===2&&all.every(x=>{const r=x.getBoundingClientRect();return r.width>=44&&r.left>=0&&r.right<=innerWidth-8})})()', 'en-tête : recherche avancée et réglages, 44 px, jamais rognés');
    await check(client, '(()=>{const items=[...document.querySelectorAll("[data-recent-import]")];const text=items.map(i=>i.innerText.split("\\n").map(t=>t.trim()).filter(Boolean).join("|"));return items.length===3&&text[0]==="2 ép.|Severance|2 épisodes · S02E09–E10"&&text[1]==="A Knight of the Seven Kingdoms|S01E03 · hier"&&text[2].startsWith("Dune|Film · ")&&items.every(i=>Math.round(i.getBoundingClientRect().width)===104)&&getComputedStyle(items[0].querySelector("strong")).color==="rgb(242, 195, 107)"})()', 'Téléchargés : imports réels groupés, doublon et grab ignorés, titre or');
    await check(client, '(()=>{const q=[...document.querySelectorAll(\'[data-download-id="3"] .download-card__quick button\')];return q.map(b=>b.textContent).join("|")==="Choisir une version|Retirer"&&q.every(b=>b.getBoundingClientRect().height>=44)})()', 'à régler : deux actions visibles de 44 px');
    await check(client, '(()=>{const card=document.querySelector(\'[data-download-id="2"]\');return card.innerText.includes("Film · 1080p")&&card.querySelector(".download-card__track [role=progressbar]")&&card.querySelector(".download-card__track strong").textContent==="63 %"})()', 'film en cours : « Film · 1080p » et barre or en bas');
    await evaluate(client, 'document.querySelector(\'[data-recent-import="m40"] button\').click()');
    await check(client, 'window.__downloads.telemetry.opened.includes("4")', 'une affiche téléchargée ouvre sa fiche');
    await check(client, 'document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll(".download-card__poster")].every(el=>el.getBoundingClientRect().height>=60)', 'largeur 360/412 et affiches non rognées');
    await check(client, 'document.body.innerText.includes("Recherche interrompue · disponibilité à vérifier") && !document.body.innerText.includes("Surveillance active")', 'attente sans promesse inventée');
    await check(client, '!document.querySelector(".download-card__actions") && !document.body.innerText.includes(".1080p")', 'cartes sobres sans dump de release');
    await evaluate(client, 'document.querySelector(\'[data-download-id="1"] .download-card__more\').click()');
    await check(client, 'document.querySelector(\'[data-download-id="1"] .download-card__actions\') && !document.body.innerText.includes("Blade Runner.1080p")', 'actions utiles sans nom de fichier même dépliées');
    await evaluate(client, 'document.querySelector(\'[data-download-id="1"] .download-card__more\').click(); document.querySelector(\'[data-download-id="2"] .download-card__more\').click()');
    await check(client, 'document.querySelector(\'[data-download-id="2"] .download-card__actions button\')', 'actions actives dépliées');
    await evaluate(client, 'document.querySelector(\'[data-download-id="2"] .download-card__actions button\').click()');
    await check(client, 'document.querySelector("[role=alertdialog]") && document.activeElement.textContent.includes("Garder")', 'confirmation centrée avec focus sûr');
    await check(client, '(()=>{const r=document.querySelector("[role=alertdialog] > div").getBoundingClientRect();return r.top>=16&&r.bottom<=innerHeight-16})()', 'confirmation visible au-dessus du système');
    await evaluate(client, '[...document.querySelectorAll("button")].find(el=>el.textContent.trim()==="Garder").click()');
    await check(client, '!document.querySelector("[role=alertdialog]") && window.__downloads.telemetry.removed.length===0', 'abandon sans suppression');
    await evaluate(client, 'document.querySelector(\'[data-download-id="2"] .download-card__more\').click()');
    const capture = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(root, 'quality-reports', `downloads-prototype-${width}.png`), Buffer.from(capture.data, 'base64'));
    await evaluate(client, 'document.querySelector(\'[aria-label="Recherche avancée"]\').click()');
    await evaluate(client, `(()=>{const input=document.querySelector('input[data-navigation-search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Titre');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate(client, 'document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
    await check(client, 'document.body.innerText.includes("503") && !document.body.innerText.includes("Aucune version trouvée")', 'panne distincte d’un résultat vide');
    // Refonte du 07/11 : en-tête retour + titre, un champ, une rangée de filtres, la conseillée dépliée en tête.
    await check(client, '(()=>{const back=document.querySelector(\'[aria-label="Retour aux téléchargements"]\').getBoundingClientRect();return document.querySelector(".downloads-header--search h1").textContent==="Recherche avancée"&&back.width>=44&&!document.body.innerText.includes("TRI")&&!document.querySelector("select")&&document.querySelectorAll("form").length===1})()', 'recherche avancée : en-tête simple, sans tri ni liste Light');
    await evaluate(client, `(()=>{window.__downloads.telemetry.c411Results=true;document.querySelector("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));})()`);
    await check(client, '(()=>{const cards=[...document.querySelectorAll("[data-version-card]")];const chips=[...document.querySelectorAll("[aria-label=\'Filtrer les versions\'] button")];return cards.length===4&&cards[0].dataset.versionCard==="12"&&cards[0].querySelector("[aria-expanded=true]")&&cards[0].innerText.includes("Conseillée")&&cards[0].innerText.includes("214 sources")&&!cards[0].innerText.includes("Rapide")&&!cards[0].innerText.includes("qBittorrent")&&cards[0].querySelector("[data-release-badges]")&&!cards[0].querySelector("[data-release-name]")&&[...cards[0].querySelectorAll("button")].some(b=>b.textContent.includes("Magnet")&&b.getBoundingClientRect().height>=44)&&chips.length===5&&chips.every(b=>b.getBoundingClientRect().height>=44)&&document.documentElement.scrollWidth<=innerWidth})()', 'résultats en cartes de version, conseillée dépliée (sources et badges, sans vitesse ni phrase qBittorrent), filtres de 44 px');
    await evaluate(client, '[...document.querySelectorAll("[aria-label=\'Filtrer les versions\'] button")].find(b=>b.textContent==="4K").click()');
    await check(client, '[...document.querySelectorAll("[data-version-card]")].map(c=>c.dataset.versionCard).join()==="11"', 'filtre 4K de la recherche avancée');
    const searchCapture = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(root, 'quality-reports', `downloads-search-${width}.png`), Buffer.from(searchCapture.data, 'base64'));
    await evaluate(client, 'window.__downloads.telemetry.c411Results=false;document.querySelector(\'[aria-label="Retour aux téléchargements"]\').click()');
    await check(client, 'document.querySelector(".downloads-subtitle")?.textContent==="1 en cours · 2 à régler"', 'retour de la recherche vers le suivi');
    // #879 : mode téléchargement — le contrôle remplace le Vu, le prochain épisode est déjà coché.
    await evaluate(client, 'window.__downloads.mount("episodes")');
    await check(client, 'document.querySelector(\'[role=checkbox][aria-label="Télécharger l’épisode 1"][aria-checked="true"]\')', 'prochain épisode coché en mode');
    await check(client, '!document.querySelector(\'[aria-label^="Marquer l’épisode"]\')', 'en mode, le contrôle remplace le Vu');
    await evaluate(client, 'document.querySelector(\'[role=checkbox][aria-label="Télécharger l’épisode 4"]\').click()');
    await check(client, 'window.__downloads.telemetry.requested.includes(4)&&!window.__downloads.telemetry.opened.includes("episode:4")&&document.querySelector(\'[aria-label="Télécharger l’épisode 4"]\').getAttribute("aria-checked")==="true"', 'cocher ne déclenche pas l’ouverture');
    await check(client, '!document.querySelector(\'[role=checkbox][aria-label$="épisode 3"]\')&&document.querySelector(\'[aria-label="Épisode 3 téléchargé"]\')&&!document.querySelector(\'[role=checkbox][aria-label$="épisode 2"]\')&&document.querySelector(\'[aria-label="Épisode 2 : 30 %"]\')', 'présent et actif sans double envoi');
    await check(client, '(()=>{const b=document.querySelector(\'[aria-label="Télécharger l’épisode 1"]\').getBoundingClientRect();return b.width>=44&&b.height>=44})()', 'contrôle de 44 px');
    await check(client, 'document.documentElement.scrollWidth<=innerWidth&&!document.querySelector(\'[aria-label="Télécharger la saison 2"]\')', 'titres sans débordement, plus de bouton de saison');
    // Retour terrain du 07/11 : chaque segment du bandeau se touche (44 px) et la barre d'action tient sur une ligne.
    await check(client, '[...document.querySelectorAll("[data-mode-segment]")].every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44})&&document.querySelector(\'[data-mode-segment="1"]\').getAttribute("aria-pressed")==="true"', 'segments touchables de 44 × 44 px, état coché exposé');
    await evaluate(client, 'document.querySelector(\'[data-mode-segment="4"]\').click()');
    await check(client, 'document.querySelector(\'[aria-label="Télécharger l’épisode 4"]\').getAttribute("aria-checked")==="false"&&document.querySelector(\'[data-mode-segment="4"]\').getAttribute("aria-pressed")==="false"', 'toucher un segment décoche son épisode, ligne et bandeau synchrones');
    await evaluate(client, 'document.querySelector(\'[data-mode-segment="3"]\').click()');
    await check(client, '!document.querySelector(\'[data-mode-segment="3"]\').hasAttribute("aria-pressed")&&document.querySelector(\'[aria-label="Épisode 3 téléchargé"]\')', 'un segment téléchargé ne se coche pas');
    await check(client, '(()=>{const bar=document.querySelector("[data-mode-bar]").getBoundingClientRect();return bar.height<=64&&bar.bottom<=innerHeight&&document.querySelector(\'[aria-label="Quitter le mode téléchargement"]\')&&[...document.querySelectorAll("[data-mode-bar] button")].filter(b=>/^(1080p|4K)$/.test(b.textContent.trim())).length===2})()', 'barre d’action compacte sur une ligne (≤ 64 px) avec ✕, 1080p et 4K');
    // Une saison de 24 épisodes garde des cibles de 44 × 44 px : la rangée défile, la page ne déborde pas.
    await evaluate(client, 'window.__downloads.mount("banner-long")');
    await check(client, '(()=>{const segments=[...document.querySelectorAll("[data-mode-segment]")];const row=segments[0]?.parentElement;return segments.length===24&&segments.every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44})&&row.scrollWidth>row.clientWidth&&document.documentElement.scrollWidth<=innerWidth})()', 'saison longue : 24 segments de 44 × 44 px, défilement horizontal sans débordement');
    // #879 : un épisode à venir se coche en bleu pour être programmé ; un épisode déjà surveillé est « Programmé ».
    await evaluate(client, 'window.__downloads.mount("program")');
    await check(client, '(()=>{const box=document.querySelector(\'[role=checkbox][aria-label="Programmer l’épisode 5"]\');const r=box?.getBoundingClientRect();return box&&box.getAttribute("aria-checked")==="false"&&r.width>=44&&r.height>=44&&!document.querySelector(\'[role=checkbox][aria-label$="épisode 6"]\')&&document.querySelector(\'[aria-label="Épisode 6 programmé dans Sonarr"]\')&&!document.querySelector(\'[aria-label^="Marquer l’épisode"]\')})()', 'épisode à venir programmable en 44 px, épisode surveillé affiché programmé');
    await check(client, 'document.body.innerText.includes("En bleu : programmés pour leur sortie.")&&!document.querySelector(\'[data-mode-segment="6"]\').hasAttribute("aria-pressed")&&document.querySelector(\'[data-mode-segment="5"]\').getAttribute("aria-pressed")==="false"', 'bandeau : à venir cochable, programmé non cochable');
    await evaluate(client, 'document.querySelector(\'[role=checkbox][aria-label="Programmer l’épisode 5"]\').click()');
    await check(client, '(()=>{const row=document.querySelector(\'[data-episode-row="5"]\');return document.querySelector(\'[aria-label="Programmer l’épisode 5"]\').getAttribute("aria-checked")==="true"&&getComputedStyle(row).boxShadow.includes("125, 211, 252")&&!window.__downloads.telemetry.opened.includes("episode:5")&&document.documentElement.scrollWidth<=innerWidth})()', 'cocher en bleu sans ouvrir l’épisode, ligne bordée de bleu');
    await evaluate(client, 'window.__downloads.mount("program-normal")');
    await check(client, '!document.querySelector("[role=checkbox]")&&document.body.innerText.includes("Programmé")', 'hors mode, pastille « Programmé » passive');
    // Hors mode : aucune commande de téléchargement, seulement des pastilles passives.
    await evaluate(client, 'window.__downloads.mount("episodes-normal")');
    await check(client, '!document.querySelector("[role=checkbox]")&&!document.querySelector(\'[aria-label^="Télécharger l’épisode"]\')&&document.body.innerText.includes("✓ Prêt")&&document.body.innerText.includes("30 %")', 'fiche propre hors mode, pastilles passives');
    await evaluate(client, 'window.__downloads.mount("modal")');
    await check(client, 'document.querySelector(".download-dialog__choices") && document.querySelectorAll(".download-dialog__choices button").length===2', 'vrai sélecteur de qualité monté');
    await check(client, '(()=>{const d=document.querySelector(".download-dialog").getBoundingClientRect();return d.top>=16&&d.bottom<=innerHeight-16&&document.documentElement.scrollWidth<=innerWidth})()', 'popup et titre long contenus en 360/412');
    await check(client, '!document.body.innerText.includes("Sonarr")&&!document.body.innerText.includes("Cible")&&!document.body.innerText.includes("Téléchargement terminé")&&window.__downloads.telemetry.mutations.length===0', 'popup sans jargon ni historique ; ouverture sans mutation');
    const modalCapture = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(root, 'quality-reports', `downloads-dialog-${width}.png`), Buffer.from(modalCapture.data, 'base64'));
    await evaluate(client, 'document.querySelector(\'[aria-label="Fermer la fenêtre de téléchargement"]\').click()');
    await check(client, '!document.querySelector(".download-dialog")&&window.__downloads.telemetry.mutations.length===0', 'fermer sans lancer');
    await evaluate(client, 'window.__downloads.mount("movie-modal")');
    await check(client, 'document.querySelector(\'[aria-label="Télécharger en 1080p"]\')', 'choix film explicite');
    await evaluate(client, 'document.querySelector(\'[aria-label="Télécharger en 1080p"]\').click()');
    await check(client, 'window.__downloads.telemetry.mutations.length===1 && window.__downloads.telemetry.mutations[0].quality==="1080p" && !document.querySelector(".download-dialog")', 'choix qualité unique puis fermeture');
    await evaluate(client, 'window.__downloads.telemetry.mutations.length=0');
    // #879 : onglet Télécharger — les épisodes d'une même saison (TMDB exact) forment une seule carte.
    await evaluate(client, 'window.__downloads.mount("season-group")');
    await check(client, '(()=>{const cards=document.querySelectorAll(".download-season");const rows=document.querySelectorAll(".download-season [data-download-id]");return cards.length===1&&rows.length===2&&document.querySelectorAll(".download-season__bar span").length===2&&document.querySelectorAll("article[data-download-id=\'43\']").length===1&&[...document.querySelectorAll("section h2")].some(h=>h.textContent==="En cours")})()', 'saison groupée par TMDB exact, homonyme d’une autre série à part');
    await check(client, '(()=>{const row=document.querySelector(\'.download-season [data-download-id="41"]\');const x=row.querySelector("button").getBoundingClientRect();return row.innerText.includes("64 %")&&row.innerText.includes("≈ 12 min")&&row.querySelector("[role=progressbar]")&&document.querySelector(\'.download-season [data-download-id="42"]\').innerText.includes("En attente")&&x.width>=44&&x.height>=44&&document.documentElement.scrollWidth<=innerWidth})()', 'ligne d’épisode : état, progression et ✕ de 44 px');
    // « Ajouter E6 » : choix de qualité en ligne, « comme les autres » sur la qualité de la carte.
    await check(client, '(()=>{const b=[...document.querySelectorAll(".download-season__add")];const r=b[0]?.getBoundingClientRect();return b.length===1&&b[0].textContent==="Ajouter E6"&&r.height>=44})()', 'Ajouter E6 proposé une fois, 44 px');
    await evaluate(client, 'document.querySelector(".download-season__add").click()');
    await check(client, '(()=>{const g=document.querySelector(".download-season__pick");const buttons=[...g.querySelectorAll("button")];return g.innerText.includes("Ajouter E6 en quelle qualité ?")&&buttons.map(b=>b.textContent).join("|")==="1080p · comme les autres|4K|Plus tard|Autres…"&&buttons.every(b=>b.getBoundingClientRect().height>=44)&&document.documentElement.scrollWidth<=innerWidth})()', 'choix 1080p · comme les autres / 4K / Plus tard / Autres…');
    await evaluate(client, '[...document.querySelectorAll(".download-season__pick button")][0].click()');
    await check(client, 'window.__downloads.telemetry.added.at(-1)==="77:S1E6:1080p"&&!document.querySelector(".download-season__pick")', 'ajout de E6 en 1080p par la voie du mode');
    await evaluate(client, 'document.querySelector(\'[aria-label="Annuler le téléchargement de E4"]\').click()');
    await check(client, 'document.querySelector("[role=alertdialog]")&&document.body.innerText.includes("Annuler le téléchargement ?")&&window.__downloads.telemetry.removed.length===0', '✕ d’un épisode demande confirmation, sans annuler la saison');
    // #879 : section « Programmés » — calendrier Sonarr/Radarr, groupé par série, déprogrammable.
    await evaluate(client, 'window.__downloads.mount("programmed")');
    await check(client, '(()=>{const section=document.querySelector("[data-programmed]");return section&&section.querySelector("h2").textContent==="Programmés"&&section.querySelectorAll("[data-programmed-episode],[data-programmed-movie]").length===3&&section.querySelectorAll("[data-programmed-series]").length===1&&section.querySelectorAll("[data-programmed-episode]").length===2&&section.querySelector("[data-programmed-movie]")?.innerText.includes("Radarr le récupère dès sa sortie")&&!section.innerText.includes("Série en pause")&&!section.innerText.includes("Épisode 10")})()', 'programmés : surveillés sans fichier seulement, groupés par série, film inclus');
    await check(client, '[...document.querySelectorAll("[data-programmed] .programmed__cancel")].every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44})&&document.documentElement.scrollWidth<=innerWidth', 'Annuler de 44 px, sans débordement');
    await evaluate(client, '[...document.querySelectorAll("[data-programmed] .programmed__cancel")].find(b=>b.getAttribute("aria-label").endsWith("S01E08")).click()');
    await check(client, 'window.__downloads.telemetry.unmonitored.at(-1)?.endsWith("/api/v3/episode/801")&&!document.querySelector(\'[data-programmed-episode="801"]\')&&document.querySelectorAll("[data-programmed-episode],[data-programmed-movie]").length===2', 'Annuler retire la surveillance de cet épisode seulement');
    // #879 : page « Version précise » — pleine page, filtres de 44 px, conseillée en tête et dépliée.
    await evaluate(client, 'window.__downloads.mount("precise")');
    await check(client, '(()=>{const page=document.querySelector("[data-precise-version]").getBoundingClientRect();const first=document.querySelector("[data-version-card]");return first&&first.dataset.versionCard==="12"&&first.querySelector("[aria-expanded=true]")&&first.innerText.includes("Conseillée")&&[...first.querySelectorAll("[data-release-badges] li")].map(b=>b.textContent).join()==="VF,WEB,H.264"&&!first.querySelector("[data-release-name]")&&first.innerText.includes("Rapide")&&document.querySelectorAll("[data-version-card]").length===4&&page.top===0&&Math.round(page.height)===innerHeight&&window.__downloads.telemetry.queries.at(-1)==="L\u2019Arène S01E03".replace("\u2019","\x27")})()', 'version précise pleine page, conseillée (français 1080p) en tête et dépliée');
    await check(client, '(()=>{const chips=[...document.querySelectorAll("[aria-label=\'Filtrer les versions\'] button")];return chips.length===5&&chips.every(b=>b.getBoundingClientRect().height>=44)&&chips[0].getAttribute("aria-pressed")==="true"&&document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll("[data-version-card] > button")].every(b=>b.getBoundingClientRect().height>=44)})()', 'filtres et cartes touchables (44 px), sans débordement');
    await evaluate(client, '[...document.querySelectorAll("[aria-label=\'Filtrer les versions\'] button")].find(b=>b.textContent==="4K").click()');
    await check(client, '[...document.querySelectorAll("[data-version-card]")].map(c=>c.dataset.versionCard).join()==="11"', 'filtre 4K');
    await evaluate(client, '[...document.querySelectorAll("[aria-label=\'Filtrer les versions\'] button")].find(b=>b.textContent==="VO").click()');
    await check(client, '[...document.querySelectorAll("[data-version-card]")].map(c=>c.dataset.versionCard).sort().join()==="11,13"', 'filtre VO : Multi et VO sous-titrée');
    await evaluate(client, 'document.querySelector(\'[data-version-card="13"] > button\').click()');
    await check(client, '(()=>{const card=document.querySelector(\'[data-version-card="13"]\');return card.querySelector("[data-release-badges]").innerText.includes("Netflix")&&!card.innerText.includes("The.Arena.S01E03.VOSTFR")})()', 'déplier montre le type de release en badges, nom technique masqué');
    await evaluate(client, '[...document.querySelectorAll(\'[data-version-card="13"] button\')].find(b=>b.textContent.includes("Nom du fichier")).click()');
    await check(client, 'document.querySelector(\'[data-version-card="13"] [data-release-name]\')?.textContent.includes("The.Arena.S01E03.VOSTFR")', '« Nom du fichier » révèle le nom technique');
    await evaluate(client, '[...document.querySelectorAll(\'[data-version-card="13"] button\')].find(b=>b.textContent.includes("Télécharger cette version")).click()');
    await check(client, 'window.__downloads.telemetry.pushed.at(-1)==="The.Arena.S01E03.VOSTFR.1080p.NF.WEB-DL.DDP5.1.x264.mkv"&&window.__downloads.telemetry.opened.includes("precise:close")', 'la version choisie part au client, puis la page se ferme');
    await evaluate(client, 'window.__downloads.mount("precise")');
    await check(client, 'document.querySelectorAll("[data-version-card]").length===4', 'versions rechargées');
    await evaluate(client, '[...document.querySelectorAll("button")].find(b=>b.textContent==="Chercher sous un autre nom…").click()');
    await check(client, 'document.activeElement===document.querySelector("input[aria-label=\'Nom à chercher\']")', 'chercher sous un autre nom donne le focus au champ');
    await evaluate(client, `(()=>{const input=document.querySelector("input[aria-label='Nom à chercher']");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'The Arena S01E03');input.dispatchEvent(new Event('input',{bubbles:true}));input.form.requestSubmit();})()`);
    await check(client, 'window.__downloads.telemetry.queries.at(-1)==="The Arena S01E03"', 'nouvelle recherche sous le nom saisi');
    await evaluate(client, 'window.__downloads.mount("precise-error")');
    await check(client, 'document.querySelector("[data-precise-version] [role=alert]")?.textContent.includes("503")&&!document.body.innerText.includes("Aucune version trouvée")', 'version précise : panne distincte d’une absence de version');
    await evaluate(client, 'window.__downloads.telemetry.mutations.length=0');
    // Maquette DlFilm : bouton ⬇ de 56 px, barre 1080p/4K (bleue pour un film à venir), suivi avec Annuler confirmé.
    await evaluate(client, 'window.__downloads.mount("film")');
    await check(client, '(()=>{const b=document.querySelector("[data-film-download]");const r=b.getBoundingClientRect();return b.dataset.filmDownload==="idle"&&b.getAttribute("aria-label")==="Télécharger le film"&&r.width>=56&&r.height>=56})()', 'film : bouton ⬇ de 56 px à côté du bouton principal');
    await evaluate(client, 'document.querySelector("[data-film-download]").click()');
    await check(client, '(()=>{const bar=document.querySelector("[data-mode-bar]");return bar&&document.querySelector("[data-film-download]").getAttribute("aria-pressed")==="true"&&bar.innerText.includes("Version précise")&&bar.getBoundingClientRect().height<=64&&document.documentElement.scrollWidth<=innerWidth})()', 'film : mode ouvert, barre compacte avec Version précise');
    await evaluate(client, '[...document.querySelectorAll("[data-mode-bar] button")].find(b=>b.textContent==="4K").click()');
    await check(client, 'window.__downloads.telemetry.added.at(-1)==="film:lance:4k"&&!document.querySelector("[data-mode-bar]")', 'film : 4K lance puis referme le mode');
    await evaluate(client, 'window.__downloads.mount("film-upcoming")');
    await evaluate(client, 'document.querySelector("[data-film-download]").click()');
    await check(client, '(()=>{const bar=document.querySelector("[data-mode-bar]");const go=[...bar.querySelectorAll("button")].find(b=>b.textContent==="1080p");return getComputedStyle(go).backgroundColor==="rgb(125, 211, 252)"&&bar.innerText.includes("Programmer\\nDès sa sortie")&&[...bar.querySelectorAll("strong,span")].every(e=>e.scrollWidth<=e.clientWidth+1)&&!bar.innerText.includes("Version précise")})()', 'film à venir : barre bleue « Programmer · Dès sa sortie », libellés entiers');
    await evaluate(client, '[...document.querySelectorAll("[data-mode-bar] button")].find(b=>b.textContent==="1080p").click()');
    await check(client, 'window.__downloads.telemetry.added.at(-1)==="film:programme:1080p"', 'film à venir : programmé en 1080p');
    await evaluate(client, 'window.__downloads.mount("film-states")');
    await check(client, '(()=>{const a=document.querySelector(\'[data-film-download="active"]\');const p=document.querySelector(\'[data-film-download="programmed"]\');return a.innerText.trim()==="42 %"&&a.getAttribute("aria-label")==="Téléchargement en cours, 42 %"&&p.getAttribute("aria-label")==="Programmé pour sa sortie"&&document.querySelector(\'[data-film-track="active"]\').innerText.includes("42 % · ≈ 12 min")&&document.querySelector(\'[data-film-track="programmed"]\').innerText.includes("Radarr le récupère dès sa sortie")})()', 'film : états en cours (42 %) et programmé');
    await evaluate(client, '[...document.querySelectorAll(\'[data-film-track="active"] button\')].find(b=>b.textContent.includes("Annuler")).click()');
    await check(client, 'document.querySelector(\'[data-film-track="active"]\').innerText.includes("Annuler le téléchargement ?")&&!window.__downloads.telemetry.removed.includes("film")', 'film : annuler un téléchargement demande confirmation');
    await evaluate(client, '[...document.querySelectorAll(\'[data-film-track="active"] button\')].find(b=>b.textContent.includes("Annuler")).click()');
    await check(client, 'window.__downloads.telemetry.removed.includes("film")', 'film : annulation confirmée');
    await evaluate(client, '[...document.querySelectorAll(\'[data-film-track="programmed"] button\')].find(b=>b.textContent.includes("Annuler")).click()');
    await check(client, 'window.__downloads.telemetry.unmonitored.includes("film")', 'film : déprogrammer sans confirmation (rien n’est supprimé)');
    reports.push({ width, cards: true, confirmation: true, error: true, episodeActions: true, realQualityDialog: true });
  }
  return reports;
}
module.exports = { buildDownloadsHarness, testDownloadsHarness };
