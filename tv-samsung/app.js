/* SeenIt TV: ES5, bounded DOM, no background work or personal viewing writes. */
(function () {
  'use strict';
  var DESIGN_WIDTH = 1920, DESIGN_HEIGHT = 1080;
  var APPS_PER_PAGE = 18, NAV_DEBOUNCE_MS = 170;
  var currentScreen = 'screenProfiles', currentProfile = null, history = [];
  var installedApps = [], detectedSources = [], appsTab = 'favorites', appsPage = 0, organizing = false;
  var memoryInfo = null, storageInfo = null, memoryTimer = null, storageTimer = null, clockTimer = null, toastTimer = null;
  var focusMemory = {}, suspendedFocus = null, inventoryBusy = false, lastDiscovery = 0, lastDirectionalAt = 0;
  var launchPending = false, sportState = 'normal';
  var enterTimer = null, enterTarget = null, longActivated = false, selectedAppId = '';
  var storage;
  try { storage = window.localStorage; } catch (e) { storage = { getItem: function () {}, setItem: function () {}, removeItem: function () {} }; }
  var prefs = TVModel.preferences(storage, '');
  var demoEvents = [
    { when: 'Exemple · 20:45', title: 'Monaco — Lille', meta: 'Ligue 1', home: { id: 'preview-monaco', name: 'Monaco', logo: 'assets/sport/monaco.svg' }, away: { id: 'preview-lille', name: 'Lille', logo: 'assets/sport/lille.png' } },
    { when: 'Exemple · 21:00', title: 'Monaco — Benfica', meta: 'Champions League', home: { id: 'preview-monaco', name: 'Monaco', logo: 'assets/sport/monaco.svg' }, away: { id: 'preview-benfica', name: 'Benfica', logo: 'assets/sport/benfica.png' } },
    { when: 'Exemple · 20:45', title: 'France — Italie', meta: 'International', home: { id: 'preview-france', name: 'France', logo: 'assets/sport/france.svg' }, away: { id: 'preview-italy', name: 'Italie', logo: 'assets/sport/italy.svg' } }
  ];
  var dynamicIds = ['appRow', 'homeSources', 'homeEvents', 'recentApps', 'filmApps', 'calendarList', 'sourceGrid', 'allAppsGrid', 'linkedFilms'];
  var lastQr = '';
  function el(id) { return document.getElementById(id); }
  function hidden() { return document.hidden === true; }
  function addClass(node, name) { if (node && !new RegExp('(^|\\s)' + name + '(\\s|$)').test(node.className)) node.className += ' ' + name; }
  function removeClass(node, name) { if (node) node.className = node.className.replace(new RegExp('\\s*\\b' + name + '\\b', 'g'), ''); }
  function resizeStage() {
    var scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
    el('stage').style.transform = 'translate(' + Math.round((window.innerWidth - DESIGN_WIDTH * scale) / 2) + 'px,' + Math.round((window.innerHeight - DESIGN_HEIGHT * scale) / 2) + 'px) scale(' + scale + ')';
  }
  function showToast(message) {
    if (hidden()) return;
    el('toast').textContent = message; el('toast').className = 'toast visible';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el('toast').className = 'toast'; toastTimer = null; }, 2800);
  }
  function updateConnectivity() {
    var offline = navigator.onLine === false;
    el('offlineBadge').className = offline ? 'offline-badge visible' : 'offline-badge';
    el('networkStatus').textContent = offline ? 'Hors ligne' : '';
  }
  function isVisible(node) { return !!node && !node.disabled && (node.offsetWidth > 0 || node.offsetHeight > 0); }
  function focusables() {
    var nodes = el(currentScreen).querySelectorAll('.focusable'), out = [], i;
    for (i = 0; i < nodes.length; i++) if (isVisible(nodes[i])) out.push(nodes[i]);
    return out;
  }
  function token(node) {
    if (!node || !node.getAttribute) return null;
    return { id: node.id || '', action: node.getAttribute('data-action'), app: node.getAttribute('data-app-id'), tab: node.getAttribute('data-tab'), source: node.getAttribute('data-source-type'), number: node.getAttribute('data-source-number'), profile: node.getAttribute('data-profile') };
  }
  function matches(node, saved) {
    var t = token(node);
    return saved && t && t.id === saved.id && t.action === saved.action && t.app === saved.app && t.tab === saved.tab && t.source === saved.source && t.number === saved.number && t.profile === saved.profile;
  }
  function setFocus(node) {
    var old = document.querySelectorAll('.focused'), i;
    if (!isVisible(node) || hidden()) return;
    for (i = 0; i < old.length; i++) removeClass(old[i], 'focused');
    addClass(node, 'focused'); node.focus();
    if (currentScreen === 'screenHome') {
      var lower = /\bhome-setting-card\b/.test(node.className), row = el('appRow');
      el('screenHome').setAttribute('data-lower', lower ? 'true' : 'false');
      if (node.parentNode === row) { var left = node.offsetLeft; if (left < row.scrollLeft) row.scrollLeft = left; else if (left + node.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + node.offsetWidth - row.clientWidth; }
    }
    el('focusDetail').textContent = currentScreen === 'screenHome' && node.getAttribute('data-app-id') ? node.getAttribute('data-app-title') + '   ·   OK : ouvrir   ·   Maintenir OK : organiser' : '';
  }
  function firstFocus(saved) {
    var list = focusables(), i;
    if (saved) for (i = 0; i < list.length; i++) if (matches(list[i], saved)) { setFocus(list[i]); return; }
    if (currentScreen === 'screenHome') setFocus(el('primaryTv'));
    else if (currentScreen === 'screenExit') setFocus(el('stayButton'));
    else if (list.length) setFocus(list[0]);
  }
  function moveFocus(direction) {
    var list = focusables(), origin = document.activeElement, r, ox, oy, i, c, dx, dy, primary, secondary, score, best = null, bestScore = Infinity;
    if (list.indexOf(origin) < 0) { firstFocus(); return; }
    r = origin.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2;
    for (i = 0; i < list.length; i++) {
      if (list[i] === origin) continue;
      c = list[i].getBoundingClientRect(); dx = c.left + c.width / 2 - ox; dy = c.top + c.height / 2 - oy;
      if (!((direction === 'left' && dx < -6) || (direction === 'right' && dx > 6) || (direction === 'up' && dy < -6) || (direction === 'down' && dy > 6))) continue;
      primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
      secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      score = primary + secondary * 2.15;
      /* Keep a directional step in its row/column before crossing to another rail. */
      if (direction === 'left' || direction === 'right') { if (c.bottom <= r.top || c.top >= r.bottom) score += 100000; }
      else if (c.right <= r.left || c.left >= r.right) score += 100000;
      if (score < bestScore) { bestScore = score; best = list[i]; }
    }
    if (best) setFocus(best);
  }
  function releaseDynamic() {
    var i, j, images;
    for (i = 0; i < dynamicIds.length; i++) {
      images = el(dynamicIds[i]).querySelectorAll('img');
      for (j = 0; j < images.length; j++) {
        images[j].onerror = null;
        /* Detach tiny shared vectors intact; blank raster sources before dropping the grid. */
        if (!/\.svg(?:[?#]|$)/i.test(images[j].getAttribute('src') || '')) images[j].removeAttribute('src');
      }
      el(dynamicIds[i]).innerHTML = '';
    }
  }
  function showScreen(id, push) {
    var screens = document.querySelectorAll('.screen'), i;
    focusMemory[currentScreen] = token(document.activeElement);
    if (push !== false && currentScreen !== id) history.push(currentScreen);
    releaseDynamic();
    for (i = 0; i < screens.length; i++) { removeClass(screens[i], 'active'); if (screens[i].id === id) addClass(screens[i], 'active'); }
    currentScreen = id; TVConnection.pairingVisible(id === 'screenAccount'); renderCurrent(); firstFocus(focusMemory[id]);
    if (id !== 'screenAccount') { el('pairQr').innerHTML = ''; lastQr = ''; }
  }
  function goBack() {
    if (currentScreen === 'screenHome' && el('screenHome').getAttribute('data-lower') === 'true') { setFocus(el('primaryTv')); return; }
    if (history.length) showScreen(history.pop(), false);
    else if (currentScreen === 'screenHome' || currentScreen === 'screenProfiles') showScreen('screenExit');
    else showScreen('screenHome', false);
  }
  function setProfile(name) {
    if (['Julian', 'Camille', 'Milo', 'Invité'].indexOf(name) < 0) return;
    currentProfile = name; prefs = TVModel.preferences(storage, name);
    TVConnection.profile(name);
    applyAppearance();
    el('profileInitial').textContent = name === 'Invité' ? '+' : name.charAt(0);
    el('profileName').textContent = name;
    history = []; focusMemory = {}; appsPage = 0; organizing = false;
    showScreen('screenHome', false);
  }
  function appendText(parent, tag, value, className) {
    var node = document.createElement(tag); if (className) node.className = className; node.textContent = value; parent.appendChild(node); return node;
  }
  function appButton(app, system) {
    var button = document.createElement('button'), logo, nativePath = TVModel.localIcon(app.iconPath), brand = TVModel.brand(app.title), paths = [], image, next = 0;
    button.className = 'app-card focusable';
    if (brand) addClass(button, 'brand-' + brand.file);
    button.setAttribute('data-action', system && app.classification !== 'USER' ? 'inspect-app' : (organizing && currentScreen === 'screenApps' ? 'pin-app' : 'launch-app'));
    button.setAttribute('data-app-id', app.id); button.setAttribute('data-app-title', app.title); button.setAttribute('aria-label', app.title);
    logo = appendText(button, 'span', '', 'app-logo');
    if (brand) paths.push('assets/apps/' + brand.file + '.svg');
    if (nativePath) paths.push(nativePath);
    function fallback() {
      if (hidden() || (next > 0 && !document.documentElement.contains(logo))) return;
      if (next >= paths.length) { logo.textContent = TVModel.initials(app.title); return; }
      image = document.createElement('img'); image.alt = ''; image.onerror = fallback; image.src = paths[next++]; logo.innerHTML = ''; logo.appendChild(image);
    }
    fallback();
    appendText(button, 'span', app.title, 'app-name');
    if (prefs.pins().indexOf(app.id) >= 0) appendText(button, 'span', '★', 'pin-star');
    if (system) appendText(button, 'span', app.classification === 'USER' ? 'VARIANTE' : app.classification, 'app-class');
    return button;
  }
  function allAppsButton() {
    var b = document.createElement('button'); b.className = 'app-card all-apps-card focusable'; b.setAttribute('data-action', 'all-apps');
    var logo = appendText(b, 'span', '', 'app-logo');
    logo.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/></svg>';
    appendText(b, 'span', 'Toutes les apps', 'app-name'); return b;
  }
  function sourceLabel(s) { return String(s.type).toUpperCase() + (s.number !== undefined ? ' ' + s.number : ''); }
  function sourceButton(s, compact) {
    var b = document.createElement('button'); b.className = 'source-card focusable'; b.setAttribute('data-action', 'source');
    b.setAttribute('data-source-type', s.type); b.setAttribute('data-source-number', s.number);
    appendText(b, 'strong', sourceLabel(s)); appendText(b, 'small', s.connected ? 'Connectée' : 'Non connectée');
    if (!compact) appendText(b, 'span', 'Ouvrir cette entrée');
    return b;
  }
  function renderSources() {
    var row = el(currentScreen === 'screenHome' ? 'homeSources' : 'sourceGrid'), list = [], i;
    row.innerHTML = '';
    for (i = 0; i < detectedSources.length; i++) if (String(detectedSources[i].type).toUpperCase() !== 'TV') list.push(detectedSources[i]);
    list.sort(function (a, b) { return Number(b.connected) - Number(a.connected); });
    for (i = 0; i < list.length && i < (currentScreen === 'screenHome' ? 4 : 12); i++) row.appendChild(sourceButton(list[i], currentScreen === 'screenHome'));
    if (!list.length) appendText(row, 'p', 'Aucune entrée détectée', 'rail-status');
  }
  function renderHomeApps() {
    var row = el('appRow'), previousLeft = row.scrollLeft, favorites = profileApps(8), i;
    var recent = TVModel.byIds(currentProfile === 'Milo' ? TVModel.byIds(installedApps, prefs.pins()) : installedApps, prefs.recent());
    el('filmsCopy').textContent = recent.length ? recent[0].title : 'Films & séries';
    el('filmsHint').textContent = recent.length ? 'Rouvrir l’app' : 'Vos apps';
    row.innerHTML = '';
    for (i = 0; i < favorites.length; i++) row.appendChild(appButton(favorites[i], false));
    var add = allAppsButton(); add.setAttribute('data-action', 'manage-apps'); add.setAttribute('aria-label', 'Ajouter une app'); add.querySelector('.app-name').textContent = 'Ajouter'; add.querySelector('.app-logo').textContent = '+'; row.appendChild(add);
    row.appendChild(allAppsButton()); el('appsStatus').textContent = currentProfile === 'Milo' && !favorites.length ? 'Choisissez ses apps' : '';
    row.scrollLeft = previousLeft;
    var view = TVConnection.view();
    if (view.linked && view.items.length) { el('filmsCopy').textContent = view.items[0].title; el('filmsHint').textContent = 'Ma liste SeenIt'; }
  }
  function profileApps(limit) {
    return currentProfile === 'Milo' ? TVModel.byIds(installedApps, prefs.pins()).slice(0, limit) : TVModel.favorites(installedApps, prefs.pins(), limit, prefs.hidden());
  }
  function renderFilms() {
    var allowed = currentProfile === 'Milo' ? TVModel.byIds(installedApps, prefs.pins()) : installedApps;
    var recent = TVModel.byIds(allowed, prefs.recent()).slice(0, 5), favorites = profileApps(5), i;
    el('recentApps').innerHTML = ''; el('filmApps').innerHTML = '';
    for (i = 0; i < recent.length; i++) el('recentApps').appendChild(appButton(recent[i], false));
    for (i = 0; i < favorites.length; i++) el('filmApps').appendChild(appButton(favorites[i], false));
    el('filmApps').appendChild(allAppsButton()); el('recentHint').style.display = recent.length ? 'none' : '';
    var view = TVConnection.view(), row = el('linkedFilms'), image, item, card;
    row.innerHTML = '';
    for (i = 0; i < view.items.length; i++) {
      item = view.items[i]; card = document.createElement('div'); card.className = 'linked-film';
      if (/^\/[a-zA-Z0-9._/-]+$/.test(item.posterPath || '') && String(item.posterPath).indexOf('..') < 0) { image = document.createElement('img'); image.alt = ''; image.src = 'https://image.tmdb.org/t/p/w185' + item.posterPath; card.appendChild(image); }
      appendText(card, 'strong', String(item.title || '').slice(0, 180)); row.appendChild(card);
    }
  }
  function renderAccount() {
    var view = TVConnection.view(), qr = el('pairQr'), blocked = currentProfile === 'Milo' || currentProfile === 'Invité';
    el('accountTitle').textContent = view.linked ? view.accountName : 'Connecter SeenIt';
    var statuses = { creating: 'Création du code…', pending: 'Confirmez sur votre téléphone pour ' + currentProfile + '.', expired: 'Le code a expiré. Affichez un nouveau code.', error: 'Connexion indisponible. Réessayez.' };
    el('accountStatus').textContent = view.linked ? (view.online ? 'Associé à ' + view.profile + ' · à jour' : 'Associé à ' + view.profile + ' · données en cache') : (blocked ? 'Sélectionnez le profil adulte qui utilisera son compte SeenIt.' : (view.linkedProfile ? 'Un compte est déjà associé à ' + view.linkedProfile + '.' : statuses[view.phase] || 'Votre liste SeenIt sur la TV, avec votre accord.'));
    if (view.error === 'REVOKE_PENDING') el('accountStatus').textContent = 'Données retirées. La dissociation sera confirmée au retour du réseau.';
    el('pairButton').style.display = view.linked || view.linkedProfile || blocked ? 'none' : '';
    el('pairButton').disabled = view.phase === 'creating' || view.phase === 'pending';
    el('syncButton').style.display = view.linked ? '' : 'none';
    el('unlinkButton').style.display = view.linkedProfile && !blocked ? '' : 'none';
    el('pairPanel').style.display = view.approvalUrl ? '' : 'none'; el('pairCode').textContent = view.code;
    if (view.approvalUrl && view.approvalUrl !== lastQr) {
      var code = qrcode(0, 'M'); code.addData(view.approvalUrl); code.make();
      qr.innerHTML = code.createSvgTag({ cellSize: 7, margin: 28, scalable: true }); lastQr = view.approvalUrl;
    } else if (!view.approvalUrl) { qr.innerHTML = ''; lastQr = ''; }
  }
  function connectionChanged() {
    if (hidden()) return;
    var saved = token(document.activeElement);
    if (currentScreen === 'screenAccount') { renderAccount(); if (!isVisible(document.activeElement) || document.activeElement.disabled) firstFocus(saved); }
    else if (currentScreen === 'screenHome') { renderHomeApps(); firstFocus(saved); }
    else if (currentScreen === 'screenFilms') renderFilms();
  }
  function appendTeam(parent, team) {
    var name = team && team.name ? String(team.name) : 'Équipe', url = TVModel.teamArtwork(team && team.logo);
    var group = appendText(parent, 'span', '', 'event-team'), badge = appendText(group, 'span', '', 'team-badge'), image;
    badge.setAttribute('aria-hidden', 'true');
    if (url) {
      image = document.createElement('img'); image.alt = ''; image.width = 48; image.height = 48;
      image.onerror = function () { badge.textContent = TVModel.initials(name); };
      image.src = url; badge.appendChild(image);
    } else badge.textContent = TVModel.initials(name);
    appendText(group, 'span', name, 'team-name');
  }
  function renderEvents() {
    var preview = !TVDevice.isSamsung(), events = preview ? demoEvents : [], row = el(currentScreen === 'screenHome' ? 'homeEvents' : 'calendarList'), i, b;
    row.innerHTML = '';
    if (currentScreen === 'screenHome') { row.style.display = events.length ? '' : 'none'; el('homeSportHeading').style.display = events.length ? '' : 'none'; }
    el('sportStatus').textContent = preview ? 'Aperçu' : '';
    el('calendarHint').textContent = preview ? 'Exemples de maquette. Le diffuseur dépend de chaque événement.' : 'Aucun calendrier connecté pour le moment.';
    for (i = 0; i < events.length && (currentScreen !== 'screenHome' || i < 2); i++) {
      b = document.createElement('button'); b.className = 'event-card focusable'; b.setAttribute('data-action', 'sport-event');
      b.setAttribute('aria-label', events[i].title + ' · ' + events[i].when);
      appendText(b, 'span', events[i].when);
      if (events[i].home && events[i].away) {
        var clubs = appendText(b, 'div', '', 'event-clubs');
        appendTeam(clubs, events[i].home); appendText(clubs, 'span', '—', 'event-versus'); appendTeam(clubs, events[i].away);
      } else appendText(b, 'strong', events[i].title);
      appendText(b, 'small', events[i].meta); row.appendChild(b);
    }
    if (!events.length) appendText(row, 'div', 'Vos rendez-vous sportifs apparaîtront ici.', 'empty-event');
  }
  function updateSportTile() {
    var demo = !TVDevice.isSamsung();
    el('sportBadge').textContent = demo && sportState === 'live' ? 'EN DIRECT' : demo && sportState === 'imminent' ? 'DANS 23 MIN' : '';
    el('sportCopy').textContent = demo && sportState !== 'normal' ? 'Monaco — Lille' : 'Mes rendez-vous';
    removeClass(el('sportTile'), 'live'); if (demo && sportState !== 'normal') addClass(el('sportTile'), 'live');
  }
  function appsForTab() {
    var list = [];
    if (currentProfile === 'Milo' && appsTab === 'system') return list;
    if (appsTab === 'favorites') return TVModel.byIds(installedApps, prefs.pins());
    if (currentProfile === 'Milo' && !organizing) return TVModel.byIds(installedApps, prefs.pins());
    return appsTab === 'user' ? TVModel.userApps(installedApps) : TVModel.advancedApps(installedApps);
  }
  function renderAppsPage() {
    var list = appsForTab(), pageCount = Math.max(1, Math.ceil(list.length / APPS_PER_PAGE)), start, end, i, map = { favorites: 'tabFavorites', user: 'tabUser', system: 'tabSystem' }, key;
    appsPage = Math.max(0, Math.min(appsPage, pageCount - 1)); start = appsPage * APPS_PER_PAGE; end = Math.min(list.length, start + APPS_PER_PAGE);
    el('allAppsGrid').innerHTML = '';
    for (i = start; i < end; i++) el('allAppsGrid').appendChild(appButton(list[i], appsTab === 'system'));
    el('appsCount').textContent = list.length + ' apps';
    el('pageStatus').textContent = 'Page ' + (appsPage + 1) + '/' + pageCount;
    configurePager(el('pagePrev'), appsPage > 0); configurePager(el('pageNext'), appsPage + 1 < pageCount);
    for (key in map) if (map.hasOwnProperty(key)) { removeClass(el(map[key]), 'selected'); if (key === appsTab) addClass(el(map[key]), 'selected'); }
    removeClass(el('screenApps'), 'apps-system-mode'); removeClass(el('screenApps'), 'organizing');
    if (appsTab === 'system') addClass(el('screenApps'), 'apps-system-mode');
    else if (organizing) addClass(el('screenApps'), 'organizing');
    el('manageApps').style.display = appsTab === 'system' ? 'none' : ''; el('manageApps').textContent = organizing ? 'Terminer' : 'Organiser';
    el('tabSystem').style.display = currentProfile === 'Milo' ? 'none' : '';
  }
  function configurePager(button, enabled) { button.disabled = !enabled; button.className = enabled ? 'pager-button focusable' : 'pager-button'; }
  function renderCurrent() {
    if (hidden()) return;
    if (currentScreen === 'screenHome') { renderHomeApps(); renderSources(); renderEvents(); }
    else if (currentScreen === 'screenFilms') renderFilms();
    else if (currentScreen === 'screenSport') renderEvents();
    else if (currentScreen === 'screenSources') renderSources();
    else if (currentScreen === 'screenApps') renderAppsPage();
    else if (currentScreen === 'screenDiagnostics') updateDiagnosticPanel();
    else if (currentScreen === 'screenAppearance') renderAppearance();
    else if (currentScreen === 'screenAccount') renderAccount();
  }
  function applyAppearance() {
    var hour = new Date().getHours(), theme = prefs.theme(), light = theme === 'mist' || (theme === 'auto' && hour >= 7 && hour < 20);
    var reduced = !prefs.motion(), logos = document.querySelectorAll('.brand'), i, source = light ? 'assets/seenit-tv-dark.svg' : 'assets/seenit-tv.svg';
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) reduced = true; } catch (e) {}
    el('stage').className = (light ? 'light-theme' : '') + (reduced ? ' reduced-motion' : '');
    for (i = 0; i < logos.length; i++) if (logos[i].getAttribute('src') !== source) logos[i].setAttribute('src', source);
  }
  function renderAppearance() {
    var buttons = el('screenAppearance').querySelectorAll('[data-theme]'), i;
    for (i = 0; i < buttons.length; i++) { removeClass(buttons[i], 'selected'); buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-theme') === prefs.theme())); if (buttons[i].getAttribute('data-theme') === prefs.theme()) addClass(buttons[i], 'selected'); }
    el('motionValue').textContent = prefs.motion() ? 'Activés' : 'Désactivés';
  }
  function openAppMenu(button) {
    var app = TVModel.byIds(installedApps, [button.getAttribute('data-app-id')])[0];
    if (!app) return;
    selectedAppId = app.id; el('appMenuTitle').textContent = app.title;
    el('menuPin').textContent = prefs.pins().indexOf(app.id) < 0 ? 'Ajouter aux favoris' : 'Retirer des favoris';
    showScreen('screenAppMenu');
  }
  function moveApp(offset) {
    var list = profileApps(8), pins = prefs.pins(), order = [], i, index, target, moved;
    for (i = 0; i < list.length; i++) order.push(list[i].id);
    for (i = 0; i < pins.length && order.length < 32; i++) if (order.indexOf(pins[i]) < 0) order.push(pins[i]);
    index = order.indexOf(selectedAppId);
    if (index < 0 && order.length < 32) { order.push(selectedAppId); index = order.length - 1; }
    if (index < 0) { showToast('8 favoris maximum.'); return; }
    target = Math.max(0, Math.min(order.length - 1, index + offset));
    moved = order.splice(index, 1)[0]; order.splice(target, 0, moved); prefs.order(order);
  }
  function formatBytes(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '—';
    return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(1) + ' Go' : Math.round(bytes / 1048576) + ' Mo';
  }
  function updateDiagnosticPanel() {
    var users = 0, system = 0, unknown = 0, i;
    for (i = 0; i < installedApps.length; i++) {
      if (installedApps[i].classification === 'USER') users++; else if (installedApps[i].classification === 'SYSTEM') system++; else unknown++;
    }
    el('diagMemory').textContent = 'RAM libre · ' + (memoryInfo ? formatBytes(memoryInfo.available) + ' / ' + formatBytes(memoryInfo.total) : 'Indisponible');
    el('diagStorage').textContent = 'Stockage libre · ' + (storageInfo ? formatBytes(storageInfo.available) + ' / ' + formatBytes(storageInfo.total) : 'Indisponible');
    el('diagApps').textContent = 'Apps · ' + users + ' utilisateur · ' + system + ' système · ' + unknown + ' ambiguës';
    el('diagSources').textContent = 'Sources · ' + detectedSources.length;
    el('diagRuntime').textContent = TVDevice.isSamsung() ? 'Samsung Tizen' : 'Aperçu navigateur · valeurs simulées';
  }
  function refreshMemory() { TVDevice.getMemoryInfo(function (info) { memoryInfo = info; if (!hidden()) updateDiagnosticPanel(); }); }
  function refreshStorage() { TVDevice.getStorageInfo(function (info) { storageInfo = info; if (!hidden()) updateDiagnosticPanel(); }); }
  function updateClock() {
    var now = new Date(), h = now.getHours(), m = now.getMinutes();
    el('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    el('date').textContent = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][now.getDay()] + ' ' + now.getDate() + ' ' + ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][now.getMonth()];
    applyAppearance();
  }
  function stopTelemetryTimers() {
    if (memoryTimer !== null) clearInterval(memoryTimer); if (storageTimer !== null) clearInterval(storageTimer); if (clockTimer !== null) clearInterval(clockTimer);
    memoryTimer = null; storageTimer = null; clockTimer = null;
    if (toastTimer !== null) clearTimeout(toastTimer); toastTimer = null; el('toast').className = 'toast';
    if (enterTimer !== null) clearTimeout(enterTimer); enterTimer = null; enterTarget = null; longActivated = false;
  }
  function startTelemetryTimers() {
    stopTelemetryTimers(); if (hidden()) return; refreshMemory(); refreshStorage(); updateClock();
    memoryTimer = setInterval(refreshMemory, 15000); storageTimer = setInterval(refreshStorage, 60000); clockTimer = setInterval(updateClock, 30000);
  }
  function discoverDevice(force) {
    var now = new Date().getTime(), pending = 2;
    if (inventoryBusy || hidden() || (!force && now - lastDiscovery < 30000)) return;
    inventoryBusy = true;
    function complete() {
      pending--; if (pending) return;
      inventoryBusy = false; lastDiscovery = now;
      if (!hidden()) { var saved = token(document.activeElement); renderCurrent(); updateDiagnosticPanel(); firstFocus(saved); }
    }
    TVDevice.listApps(function (apps) { if (apps) installedApps = apps; complete(); });
    TVDevice.getSources(function (sources) { if (sources) detectedSources = sources; complete(); });
  }
  function launchAppFromButton(button) {
    var id = button.getAttribute('data-app-id'), app = TVModel.byIds(installedApps, [id])[0], ownerPrefs = prefs;
    if (!app || launchPending) return;
    launchPending = true;
    TVDevice.launchApp(app.id, function (ok) {
      launchPending = false;
      if (ok) ownerPrefs.opened(app.id); else showToast('Impossible d’ouvrir ' + app.title + '.');
    });
  }
  function clickAction(button) {
    var profile = button.getAttribute('data-profile'), action = button.getAttribute('data-action'), saved, first;
    if (profile) { setProfile(profile); return; }
    if (action === 'live-tv') TVDevice.openLiveTv(function (ok) { if (!ok) showToast('Le tuner TV n’est pas accessible.'); });
    else if (action === 'films') showScreen('screenFilms');
    else if (action === 'sport') showScreen('screenSport');
    else if (action === 'sport-event') showToast('La source de ce rendez-vous n’est pas encore connectée.');
    else if (action === 'settings') { if (currentScreen === 'screenHome') setFocus(el('screenHome').querySelector('.home-setting-card')); else showScreen('screenSettings'); }
    else if (action === 'quick') showScreen('screenQuick');
    else if (action === 'sources') showScreen('screenSources');
    else if (action === 'diagnostics') { showScreen('screenDiagnostics'); refreshMemory(); refreshStorage(); }
    else if (action === 'ambient') showScreen('screenAmbient');
    else if (action === 'appearance') showScreen('screenAppearance');
    else if (action === 'account') showScreen('screenAccount');
    else if (action === 'pair') { TVConnection.start('Samsung SeenIt TV'); renderAccount(); firstFocus(); }
    else if (action === 'sync-account') TVConnection.sync();
    else if (action === 'unlink-account') showScreen('screenUnlink');
    else if (action === 'confirm-unlink') { TVConnection.revoke(); goBack(); }
    else if (action === 'samsung-home') { TVDevice.exitApp(function (ok) { if (!ok) showToast('Utilisez la touche Home pour revenir à Samsung.'); }); }
    else if (action === 'theme') { prefs.setTheme(button.getAttribute('data-theme')); applyAppearance(); renderAppearance(); }
    else if (action === 'motion') { prefs.toggleMotion(); applyAppearance(); renderAppearance(); }
    else if (action === 'menu-pin') { if (!prefs.toggle(selectedAppId)) showToast('8 favoris maximum.'); else goBack(); }
    else if (action === 'menu-hide') { prefs.hideApp(selectedAppId); goBack(); }
    else if (action === 'menu-left' || action === 'menu-right') { moveApp(action === 'menu-left' ? -1 : 1); goBack(); }
    else if (action === 'switch-profile') { history = []; showScreen('screenProfiles', false); }
    else if (action === 'all-apps' || action === 'manage-apps') { organizing = action === 'manage-apps'; appsTab = currentProfile === 'Milo' && !organizing ? 'favorites' : 'user'; appsPage = 0; showScreen('screenApps'); }
    else if (action === 'apps-tab') { appsTab = button.getAttribute('data-tab'); appsPage = 0; saved = token(button); renderAppsPage(); firstFocus(saved); }
    else if (action === 'toggle-manage') { organizing = !organizing; if (currentProfile === 'Milo') { appsTab = organizing ? 'user' : 'favorites'; appsPage = 0; } saved = token(button); renderAppsPage(); firstFocus(saved); }
    else if (action === 'pin-app') {
      if (!TVModel.byIds(installedApps, [button.getAttribute('data-app-id')]).length) return;
      saved = token(button); if (!prefs.toggle(saved.app)) { showToast('8 favoris maximum.'); return; }
      renderAppsPage(); firstFocus(saved);
    }
    else if (action === 'page-prev' || action === 'page-next') {
      appsPage += action === 'page-prev' ? -1 : 1; renderAppsPage(); first = el('allAppsGrid').querySelector('.focusable'); if (first) setFocus(first); else firstFocus();
    }
    else if (action === 'refresh') discoverDevice(true);
    else if (action === 'launch-app') launchAppFromButton(button);
    else if (action === 'inspect-app') showToast('Composant système · lancement désactivé.');
    else if (action === 'source') TVDevice.openSource(button.getAttribute('data-source-type'), Number(button.getAttribute('data-source-number')), function (ok) { if (!ok) showToast('Cette entrée n’est pas accessible.'); });
    else if (action === 'samsung-settings') TVDevice.openSamsungSettings(function (ok) { if (!ok) showToast('Menu Samsung indisponible ici. Utilisez la touche Réglages de la TV.'); });
    else if (action === 'exit') TVDevice.exitApp(function (ok) { if (!ok) showToast('Impossible de quitter depuis cet aperçu.'); });
    else if (action === 'back') goBack();
  }
  function shouldAcceptDirectional() { var now = new Date().getTime(); if (now - lastDirectionalAt < NAV_DEBOUNCE_MS) return false; lastDirectionalAt = now; return true; }
  function handleKey(event) {
    var code = event.keyCode || event.which, active;
    if (hidden()) return;
    if (code >= 37 && code <= 40) { if (shouldAcceptDirectional()) moveFocus({ 37: 'left', 38: 'up', 39: 'right', 40: 'down' }[code]); event.preventDefault(); }
    else if (code === 13) {
      event.preventDefault(); if (enterTarget !== null || longActivated) return;
      active = document.activeElement; enterTarget = token(active);
      enterTimer = setTimeout(function () {
        enterTimer = null;
        if (isVisible(active) && matches(document.activeElement, enterTarget) && active.getAttribute('data-app-id')) { longActivated = true; openAppMenu(active); }
      }, 550);
    }
    else if (code === 10009 || code === 461 || code === 8) { goBack(); event.preventDefault(); }
    else if (code === 403 && !TVDevice.isSamsung()) { sportState = sportState === 'normal' ? 'imminent' : sportState === 'imminent' ? 'live' : 'normal'; updateSportTile(); }
  }
  function handleVisibility() {
    if (hidden()) { suspendedFocus = token(document.activeElement); TVConnection.pause(); stopTelemetryTimers(); releaseDynamic(); el('pairQr').innerHTML = ''; lastQr = ''; }
    else { launchPending = false; startTelemetryTimers(); renderCurrent(); firstFocus(suspendedFocus); TVConnection.resume(); discoverDevice(false); }
  }
  function handleKeyUp(event) {
    if ((event.keyCode || event.which) !== 13) return;
    event.preventDefault();
    if (enterTimer !== null) clearTimeout(enterTimer);
    enterTimer = null;
    if (!hidden() && !longActivated && enterTarget && matches(document.activeElement, enterTarget)) clickAction(document.activeElement);
    enterTarget = null; longActivated = false;
  }
  function init() {
    TVConnection.init(storage, connectionChanged);
    resizeStage(); updateConnectivity(); updateSportTile(); startTelemetryTimers();
    window.addEventListener('resize', resizeStage); window.addEventListener('online', updateConnectivity); window.addEventListener('offline', updateConnectivity);
    document.addEventListener('visibilitychange', handleVisibility); document.addEventListener('keydown', handleKey);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node !== document.body && !/\bfocusable\b/.test(node.className || '')) node = node.parentNode;
      if (node && node !== document.body && isVisible(node) && !hidden()) { setFocus(node); clickAction(node); }
    });
    discoverDevice(true); firstFocus();
  }
  init();
}());
