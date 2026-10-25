/* SeenIt TV launcher V2. Plain ES5 for Samsung Tizen 3+ / Chromium-era engines. */
(function () {
  'use strict';

  var DESIGN_WIDTH = 1920;
  var DESIGN_HEIGHT = 1080;
  var APPS_PER_PAGE = 18;
  var NAV_DEBOUNCE_MS = 170;
  var stage = document.getElementById('stage');
  var currentScreen = 'screenProfiles';
  var history = [];
  var currentProfile = null;
  var installedApps = [];
  var detectedSources = [];
  var memoryInfo = null;
  var storageInfo = null;
  var toastTimer = null;
  var memoryTimer = null;
  var storageTimer = null;
  var sportState = 'normal';
  var appsTab = 'favorites';
  var appsPage = 0;
  var appsKidOnly = false;
  var lastDirectionalAt = 0;

  var events = [
    { when: 'Ce soir · 20:45', title: 'Monaco — Lille', meta: 'Ligue 1 · confirmé' },
    { when: 'Mer. · 21:00', title: 'Monaco — Benfica', meta: 'Champions League · confirmé' },
    { when: '14 nov. · 20:45', title: 'France — Italie', meta: 'International · provisoire' }
  ];

  var favoriteNames = ['Plex', 'Netflix', 'YouTube', 'Prime Video', 'DAZN', 'CANAL+', 'Disney+', 'Spotify'];
  var kidAllowed = ['YouTube Kids', 'Netflix', 'Disney+', 'Plex'];

  function addClass(node, name) {
    if (!node || new RegExp('(^|\\s)' + name + '(\\s|$)').test(node.className)) return;
    node.className += ' ' + name;
  }

  function removeClass(node, name) {
    if (!node) return;
    node.className = node.className.replace(new RegExp('\\s*\\b' + name + '\\b', 'g'), '');
  }

  function resizeStage() {
    var scale = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
    var left = Math.round((window.innerWidth - DESIGN_WIDTH * scale) / 2);
    var top = Math.round((window.innerHeight - DESIGN_HEIGHT * scale) / 2);
    stage.style.transform = 'translate(' + left + 'px,' + top + 'px) scale(' + scale + ')';
  }

  function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast visible';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.className = 'toast'; }, 2800);
  }

  function updateConnectivity() {
    var offline = navigator.onLine === false;
    document.getElementById('offlineBadge').className = offline ? 'offline-badge visible' : 'offline-badge';
    document.getElementById('networkStatus').textContent = offline ? 'Réseau · hors ligne' : 'Réseau · en ligne';
    updateHero();
  }

  function screens() {
    return document.querySelectorAll('.screen');
  }

  function isVisible(node) {
    return !!node && !node.disabled && (node.offsetWidth > 0 || node.offsetHeight > 0);
  }

  function focusables() {
    var screen = document.getElementById(currentScreen);
    var nodes;
    var out = [];
    var i;
    if (!screen) return out;
    nodes = screen.querySelectorAll('.focusable');
    for (i = 0; i < nodes.length; i++) if (isVisible(nodes[i])) out.push(nodes[i]);
    return out;
  }

  function clearFocus() {
    var nodes = document.querySelectorAll('.focused');
    var i;
    for (i = 0; i < nodes.length; i++) removeClass(nodes[i], 'focused');
  }

  function setFocus(element) {
    if (!element || !isVisible(element)) return;
    clearFocus();
    addClass(element, 'focused');
    try { element.focus(); } catch (e) {}
  }

  function firstFocus() {
    var list = focusables();
    if (list.length) setFocus(list[0]);
  }

  function moveFocus(direction) {
    var list = focusables();
    var active = document.activeElement;
    var origin = null;
    var i;
    var r;
    var ox;
    var oy;
    var best = null;
    var bestScore = 9999999;
    if (!list.length) return;
    for (i = 0; i < list.length; i++) {
      if (list[i] === active || /\bfocused\b/.test(list[i].className)) origin = list[i];
    }
    if (!origin) { setFocus(list[0]); return; }
    r = origin.getBoundingClientRect();
    ox = r.left + r.width / 2;
    oy = r.top + r.height / 2;
    for (i = 0; i < list.length; i++) {
      var c;
      var cx;
      var cy;
      var dx;
      var dy;
      var valid;
      var primary;
      var secondary;
      var score;
      if (list[i] === origin) continue;
      c = list[i].getBoundingClientRect();
      cx = c.left + c.width / 2;
      cy = c.top + c.height / 2;
      dx = cx - ox;
      dy = cy - oy;
      valid = (direction === 'left' && dx < -6) || (direction === 'right' && dx > 6) || (direction === 'up' && dy < -6) || (direction === 'down' && dy > 6);
      if (!valid) continue;
      primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
      secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      score = primary + secondary * 2.15;
      if (score < bestScore) { bestScore = score; best = list[i]; }
    }
    if (best) setFocus(best);
  }

  function showScreen(id, push) {
    var list = screens();
    var i;
    if (push !== false && currentScreen !== id) history.push(currentScreen);
    for (i = 0; i < list.length; i++) {
      removeClass(list[i], 'active');
      if (list[i].id === id) addClass(list[i], 'active');
    }
    currentScreen = id;
    if (id === 'screenApps') renderAppsPage();
    if (id === 'screenSources') renderSources();
    if (id === 'screenSettings') updateDiagnosticPanel();
    setTimeout(firstFocus, 0);
  }

  function goBack() {
    if (history.length) showScreen(history.pop(), false);
    else if (currentScreen !== 'screenProfiles') showScreen('screenHome', false);
  }

  function profileInitial(name) {
    return name === 'Invité' ? '+' : name.charAt(0).toUpperCase();
  }

  function setProfile(name) {
    var home = document.getElementById('screenHome');
    currentProfile = name;
    try { localStorage.setItem('seenit.tv.profile', name); } catch (e) {}
    document.getElementById('hello').textContent = name === 'Milo' ? 'Salut Milo' : (name === 'Invité' ? 'Mode Invité' : 'Bonsoir ' + name);
    document.getElementById('profileInitial').textContent = profileInitial(name);
    removeClass(home, 'kid-mode');
    if (name === 'Milo') addClass(home, 'kid-mode');
    history = [];
    updateHero();
    renderHomeApps();
    showScreen('screenHome', false);
  }

  function colorForTitle(title) {
    var t = String(title || '').toLowerCase();
    if (t.indexOf('netflix') >= 0) return '#a72a32';
    if (t.indexOf('plex') >= 0) return '#b88628';
    if (t.indexOf('youtube') >= 0) return '#b63838';
    if (t.indexOf('prime') >= 0) return '#397d9f';
    if (t.indexOf('dazn') >= 0) return '#333640';
    if (t.indexOf('canal') >= 0) return '#35323a';
    if (t.indexOf('spotify') >= 0) return '#387a51';
    if (t.indexOf('disney') >= 0) return '#405c91';
    return '#343845';
  }

  function initials(title) {
    var words = String(title || '?').split(/\s+/);
    return (words[0] ? words[0].charAt(0) : '?') + (words.length > 1 ? words[1].charAt(0) : '');
  }

  function appButton(app, showClassification) {
    var button = document.createElement('button');
    var logo = document.createElement('span');
    var name = document.createElement('span');
    button.className = 'app-card focusable';
    button.setAttribute('data-action', app.launchable ? 'launch-app' : 'inspect-app');
    button.setAttribute('data-app-id', app.id);
    button.setAttribute('data-app-title', app.title);
    logo.className = 'app-logo';
    logo.style.background = colorForTitle(app.title);
    logo.textContent = initials(app.title);
    name.className = 'app-name';
    name.textContent = app.title;
    button.appendChild(logo);
    button.appendChild(name);
    if (showClassification) {
      var badge = document.createElement('span');
      badge.className = 'app-class';
      badge.textContent = app.classification;
      button.appendChild(badge);
    }
    return button;
  }

  function allAppsButton() {
    var button = document.createElement('button');
    var logo = document.createElement('span');
    var name = document.createElement('span');
    button.className = 'app-card all-apps-card focusable';
    button.setAttribute('data-action', 'all-apps');
    logo.className = 'app-logo';
    logo.textContent = '▦';
    name.className = 'app-name';
    name.textContent = 'Toutes les apps';
    button.appendChild(logo);
    button.appendChild(name);
    return button;
  }

  function scoreFavorite(app) {
    var i;
    var title = String(app.title || '').toLowerCase();
    for (i = 0; i < favoriteNames.length; i++) {
      if (title.indexOf(favoriteNames[i].toLowerCase()) >= 0) return i;
    }
    return 999;
  }

  function isKidAllowed(app) {
    var title = String(app.title || '').toLowerCase();
    var i;
    for (i = 0; i < kidAllowed.length; i++) if (title.indexOf(kidAllowed[i].toLowerCase()) >= 0) return true;
    return false;
  }

  function sortedUserApps() {
    var out = [];
    var i;
    for (i = 0; i < installedApps.length; i++) if (installedApps[i].classification === 'USER') out.push(installedApps[i]);
    out.sort(function (a, b) {
      var sa = scoreFavorite(a);
      var sb = scoreFavorite(b);
      var aa;
      var bb;
      if (sa !== sb) return sa - sb;
      aa = a.title.toLowerCase();
      bb = b.title.toLowerCase();
      return aa < bb ? -1 : aa > bb ? 1 : 0;
    });
    return out;
  }

  function countClassification(name) {
    var count = 0;
    var i;
    for (i = 0; i < installedApps.length; i++) if (installedApps[i].classification === name) count++;
    return count;
  }

  function favoriteApps() {
    var users = sortedUserApps();
    var out = [];
    var used = {};
    var i;
    for (i = 0; i < users.length && out.length < 7; i++) {
      if (scoreFavorite(users[i]) < 999) { out.push(users[i]); used[users[i].id] = true; }
    }
    for (i = 0; i < users.length && out.length < 7; i++) {
      if (!used[users[i].id]) { out.push(users[i]); used[users[i].id] = true; }
    }
    return out;
  }

  function renderHomeApps() {
    var row = document.getElementById('appRow');
    var kidRow = document.getElementById('kidAppRow');
    var favorites = favoriteApps();
    var users = sortedUserApps();
    var i;
    row.innerHTML = '';
    kidRow.innerHTML = '';
    for (i = 0; i < favorites.length; i++) row.appendChild(appButton(favorites[i], false));
    row.appendChild(allAppsButton());
    for (i = 0; i < users.length && kidRow.children.length < 5; i++) {
      if (isKidAllowed(users[i])) kidRow.appendChild(appButton(users[i], false));
    }
    document.getElementById('appsStatus').textContent = installedApps.length ? installedApps.length + ' détectées · ' + countClassification('USER') + ' utilisateur' : 'Aucune app détectée';
  }

  function appsForTab(tab) {
    var out = [];
    var favorites;
    var i;
    if (tab === 'favorites') {
      favorites = favoriteApps();
      if (!appsKidOnly) return favorites;
      for (i = 0; i < favorites.length; i++) if (isKidAllowed(favorites[i])) out.push(favorites[i]);
      return out;
    }
    for (i = 0; i < installedApps.length; i++) {
      if (tab === 'user' && installedApps[i].classification === 'USER' && (!appsKidOnly || isKidAllowed(installedApps[i]))) out.push(installedApps[i]);
      else if (tab === 'system' && !appsKidOnly && installedApps[i].classification !== 'USER') out.push(installedApps[i]);
    }
    out.sort(function (a, b) {
      var aa = a.title.toLowerCase();
      var bb = b.title.toLowerCase();
      return aa < bb ? -1 : aa > bb ? 1 : 0;
    });
    return out;
  }

  function updateTabClasses() {
    var map = { favorites: 'tabFavorites', user: 'tabUser', system: 'tabSystem' };
    var systemTab = document.getElementById('tabSystem');
    var key;
    systemTab.style.display = appsKidOnly ? 'none' : '';
    if (appsKidOnly && appsTab === 'system') appsTab = 'user';
    for (key in map) {
      if (map.hasOwnProperty(key)) {
        var node = document.getElementById(map[key]);
        removeClass(node, 'selected');
        if (key === appsTab) addClass(node, 'selected');
      }
    }
    removeClass(document.getElementById('screenApps'), 'apps-system-mode');
    if (appsTab === 'system') addClass(document.getElementById('screenApps'), 'apps-system-mode');
  }

  function configurePager(button, enabled) {
    button.disabled = !enabled;
    button.className = enabled ? 'pager-button focusable' : 'pager-button';
  }

  function renderAppsPage() {
    var grid = document.getElementById('allAppsGrid');
    var list = appsForTab(appsTab);
    var pageCount = Math.max(1, Math.ceil(list.length / APPS_PER_PAGE));
    var start;
    var end;
    var i;
    if (appsPage >= pageCount) appsPage = pageCount - 1;
    if (appsPage < 0) appsPage = 0;
    start = appsPage * APPS_PER_PAGE;
    end = Math.min(list.length, start + APPS_PER_PAGE);
    grid.innerHTML = '';
    for (i = start; i < end; i++) grid.appendChild(appButton(list[i], appsTab === 'system'));
    document.getElementById('appsCount').textContent = list.length + (list.length > 1 ? ' apps' : ' app');
    document.getElementById('pageStatus').textContent = 'Page ' + (appsPage + 1) + '/' + pageCount;
    configurePager(document.getElementById('pagePrev'), appsPage > 0);
    configurePager(document.getElementById('pageNext'), appsPage + 1 < pageCount);
    updateTabClasses();
  }

  function renderCalendar() {
    var row = document.getElementById('calendarList');
    var i;
    row.innerHTML = '';
    for (i = 0; i < events.length; i++) {
      var b = document.createElement('button');
      var when = document.createElement('span');
      var title = document.createElement('strong');
      var meta = document.createElement('small');
      b.className = 'calendar-item focusable';
      b.setAttribute('data-action', 'sport-event');
      when.textContent = events[i].when;
      title.textContent = events[i].title;
      meta.textContent = events[i].meta;
      b.appendChild(when);
      b.appendChild(title);
      b.appendChild(meta);
      row.appendChild(b);
    }
  }

  function sourceLabel(source) {
    var type = String(source.type || 'SOURCE').toUpperCase();
    return type + (source.number !== undefined ? ' ' + source.number : '');
  }

  function renderSources() {
    var grid = document.getElementById('sourceGrid');
    var i;
    grid.innerHTML = '';
    if (!detectedSources.length) {
      var empty = document.createElement('div');
      empty.className = 'source-card';
      empty.innerHTML = '<span>DIAGNOSTIC</span><strong>Aucune source détectée</strong><small>Le launcher ne suppose aucune entrée HDMI.</small>';
      grid.appendChild(empty);
      return;
    }
    for (i = 0; i < detectedSources.length; i++) {
      var b = document.createElement('button');
      var status = document.createElement('span');
      var title = document.createElement('strong');
      var meta = document.createElement('small');
      b.className = 'source-card focusable';
      b.setAttribute('data-action', 'source');
      b.setAttribute('data-source-type', detectedSources[i].type);
      b.setAttribute('data-source-number', detectedSources[i].number);
      status.textContent = detectedSources[i].connected ? 'CONNECTÉE' : 'DÉTECTÉE';
      title.textContent = sourceLabel(detectedSources[i]);
      meta.textContent = detectedSources[i].connected ? 'Basculer vers cette entrée' : 'Entrée connue, périphérique non signalé';
      b.appendChild(status);
      b.appendChild(title);
      b.appendChild(meta);
      grid.appendChild(b);
    }
  }

  function updateSourceSummary() {
    var connected = 0;
    var i;
    for (i = 0; i < detectedSources.length; i++) if (detectedSources[i].connected) connected++;
    document.getElementById('sourcesCopy').textContent = detectedSources.length ? connected + ' connectée(s) · ' + detectedSources.length + ' détectée(s)' : 'Aucune entrée détectée';
    document.getElementById('sourceStatus').textContent = detectedSources.length ? 'Sources · ' + detectedSources.length + ' détectée(s)' : 'Sources · aucune détectée';
  }

  function updateSportTile() {
    var tile = document.getElementById('sportTile');
    var badge = document.getElementById('sportBadge');
    var copy = document.getElementById('sportCopy');
    var feature = document.getElementById('sportFeatureBadge');
    removeClass(tile, 'live');
    if (sportState === 'live') {
      addClass(tile, 'live');
      badge.textContent = '● EN DIRECT';
      copy.textContent = 'AS Monaco — Lille';
      feature.textContent = '● EN DIRECT';
    } else if (sportState === 'imminent') {
      badge.textContent = 'DANS 23 MIN';
      copy.textContent = 'AS Monaco — Lille · 20:45';
      feature.textContent = 'DANS 23 MIN';
    } else {
      badge.textContent = 'CE SOIR';
      copy.textContent = 'Monaco · 20:45';
      feature.textContent = 'PRIORITÉ';
    }
    updateHero();
  }

  function updateHero() {
    var hero = document.getElementById('heroCard');
    var eyebrow = document.getElementById('heroEyebrow');
    var title = document.getElementById('heroTitle');
    var meta = document.getElementById('heroMeta');
    var cta = document.getElementById('heroCta');
    removeClass(hero, 'live');
    if (navigator.onLine === false) {
      hero.setAttribute('data-action', 'all-apps');
      eyebrow.textContent = 'HORS LIGNE';
      title.textContent = 'Le Home local reste disponible.';
      meta.textContent = 'Apps installées, TNT et sources peuvent continuer sans service distant.';
      cta.textContent = 'Voir les apps locales';
    } else if (sportState === 'live') {
      addClass(hero, 'live');
      hero.setAttribute('data-action', 'sport');
      eyebrow.textContent = '● EN DIRECT';
      title.textContent = 'AS Monaco — Lille';
      meta.textContent = 'Ligue 1 · le diffuseur reste résolu dynamiquement pour ce foyer.';
      cta.textContent = 'Ouvrir Sport';
    } else if (sportState === 'imminent') {
      hero.setAttribute('data-action', 'sport');
      eyebrow.textContent = 'DANS 23 MIN';
      title.textContent = 'Monaco joue ce soir.';
      meta.textContent = 'AS Monaco — Lille · 20:45 · horaire confirmé.';
      cta.textContent = 'Voir le rendez-vous';
    } else {
      hero.setAttribute('data-action', 'films');
      eyebrow.textContent = currentProfile ? 'BONSOIR ' + currentProfile.toUpperCase() : 'SEENIT TV';
      title.textContent = 'Que voulez-vous regarder ?';
      meta.textContent = 'TNT, apps, sources et contenus réunis dans un Home unique.';
      cta.textContent = 'Explorer Films & séries';
    }
  }

  function formatBytes(value) {
    var bytes = Number(value) || 0;
    var mb;
    var gb;
    if (!bytes) return '';
    mb = bytes / 1024 / 1024;
    if (mb < 1024) return Math.round(mb) + ' Mo';
    gb = mb / 1024;
    return (Math.round(gb * 10) / 10).toFixed(gb < 10 ? 1 : 0).replace('.', ',') + ' Go';
  }

  function renderTelemetry() {
    var parts = [];
    if (memoryInfo && memoryInfo.available) parts.push('RAM ' + formatBytes(memoryInfo.available));
    if (storageInfo && storageInfo.available) parts.push('STOCK ' + formatBytes(storageInfo.available));
    document.getElementById('telemetry').textContent = parts.join('  •  ');
    updateDiagnosticPanel();
  }

  function refreshMemory() {
    TVDevice.getMemoryInfo(function (info) { memoryInfo = info; renderTelemetry(); });
  }

  function refreshStorage() {
    TVDevice.getStorageInfo(function (info) { storageInfo = info; renderTelemetry(); });
  }

  function stopTelemetryTimers() {
    if (memoryTimer) clearInterval(memoryTimer);
    if (storageTimer) clearInterval(storageTimer);
    memoryTimer = null;
    storageTimer = null;
  }

  function startTelemetryTimers() {
    stopTelemetryTimers();
    if (document.hidden === true) return;
    refreshMemory();
    refreshStorage();
    memoryTimer = setInterval(refreshMemory, 15000);
    storageTimer = setInterval(refreshStorage, 60000);
  }

  function updateDiagnosticPanel() {
    var userCount = countClassification('USER');
    var systemCount = countClassification('SYSTEM');
    var unknownCount = countClassification('UNKNOWN');
    var memory = memoryInfo && memoryInfo.available ? formatBytes(memoryInfo.available) + (memoryInfo.total ? ' / ' + formatBytes(memoryInfo.total) : '') : '—';
    var storage = storageInfo && storageInfo.available ? formatBytes(storageInfo.available) + (storageInfo.total ? ' / ' + formatBytes(storageInfo.total) : '') : '—';
    document.getElementById('diagMemory').textContent = 'RAM · ' + memory;
    document.getElementById('diagStorage').textContent = 'Stockage · ' + storage;
    document.getElementById('diagApps').textContent = 'Apps · ' + userCount + ' user · ' + systemCount + ' système · ' + unknownCount + ' ambiguë(s)';
    document.getElementById('diagSources').textContent = 'Sources · ' + detectedSources.length;
    document.getElementById('diagRuntime').textContent = (TVDevice.isSamsung() ? 'Samsung Tizen' : 'Preview navigateur') + ' · ' + (navigator.onLine === false ? 'hors ligne' : 'en ligne');
  }

  function findAppByTitle(fragment) {
    var needle = String(fragment || '').toLowerCase();
    var i;
    for (i = 0; i < installedApps.length; i++) {
      if (installedApps[i].classification === 'USER' && installedApps[i].title.toLowerCase().indexOf(needle) >= 0) return installedApps[i];
    }
    return null;
  }

  function launchAppFromButton(button) {
    var id = button.getAttribute('data-app-id');
    var title = button.getAttribute('data-app-title') || 'Application';
    TVDevice.launchApp(id, function (ok) {
      if (!ok) showToast('Impossible d’ouvrir ' + title + ' sur cette TV.');
    });
  }

  function openPlex() {
    var plex = findAppByTitle('plex');
    if (!plex) { showToast('Plex n’est pas détecté dans les applications utilisateur.'); return; }
    TVDevice.launchApp(plex.id, function (ok) {
      if (!ok) showToast('Plex est détecté mais son lancement a échoué.');
    });
  }

  function runDiagnostics() {
    TVDevice.diagnostics(function (d) {
      if (d.memory) memoryInfo = d.memory;
      if (d.storage) storageInfo = d.storage;
      if (d.sources) detectedSources = d.sources;
      updateSourceSummary();
      renderTelemetry();
      document.getElementById('diagCopy').textContent = (d.samsung ? 'Samsung Tizen' : 'Preview navigateur') + ' · ' + d.apps + ' apps · ' + d.sources.length + ' sources';
      showToast('Diagnostic local mis à jour.');
    });
  }

  function selectAppsTab(tab) {
    if (appsKidOnly && tab === 'system') return;
    appsTab = tab;
    appsPage = 0;
    renderAppsPage();
    setFocus(document.getElementById(tab === 'favorites' ? 'tabFavorites' : tab === 'user' ? 'tabUser' : 'tabSystem'));
  }

  function changeAppsPage(delta) {
    var list = appsForTab(appsTab);
    var pageCount = Math.max(1, Math.ceil(list.length / APPS_PER_PAGE));
    var next = appsPage + delta;
    if (next < 0 || next >= pageCount) return;
    appsPage = next;
    renderAppsPage();
    setTimeout(function () {
      var cards = document.getElementById('allAppsGrid').querySelectorAll('.focusable');
      if (cards.length) setFocus(cards[0]);
    }, 0);
  }

  function clickAction(element) {
    var profile = element.getAttribute('data-profile');
    var action;
    if (profile) { setProfile(profile); return; }
    action = element.getAttribute('data-action');
    if (!action) return;
    if (action === 'live-tv') TVDevice.openLiveTv(function (ok) { if (!ok) showToast('Impossible de basculer vers la TNT sur cette TV.'); });
    else if (action === 'films') showScreen('screenFilms');
    else if (action === 'sport' || action === 'sport-event') showScreen('screenSport');
    else if (action === 'settings') showScreen('screenSettings');
    else if (action === 'sources') showScreen('screenSources');
    else if (action === 'switch-profile') showScreen('screenProfiles');
    else if (action === 'all-apps') { appsKidOnly = false; appsTab = 'favorites'; appsPage = 0; showScreen('screenApps'); }
    else if (action === 'kid-apps') { appsKidOnly = true; appsTab = 'user'; appsPage = 0; showScreen('screenApps'); }
    else if (action === 'apps-tab') selectAppsTab(element.getAttribute('data-tab') || 'favorites');
    else if (action === 'page-prev') changeAppsPage(-1);
    else if (action === 'page-next') changeAppsPage(1);
    else if (action === 'launch-app') launchAppFromButton(element);
    else if (action === 'inspect-app') showToast('Composant système conservé pour diagnostic ; lancement désactivé par sécurité.');
    else if (action === 'back') goBack();
    else if (action === 'source') {
      var type = element.getAttribute('data-source-type') || '';
      var number = Number(element.getAttribute('data-source-number'));
      TVDevice.openSource(type, number, function (ok) { if (!ok) showToast(sourceLabel({ type: type, number: number }) + ' n’a pas pu être ouverte.'); });
    }
    else if (action === 'samsung-settings') TVDevice.openSamsungSettings(function (ok) { if (!ok) showToast('Réglages Samsung non accessibles depuis ce firmware.'); });
    else if (action === 'diagnostics') runDiagnostics();
    else if (action === 'ambient') showScreen('screenAmbient');
    else if (action === 'plex-demo') openPlex();
    else if (action === 'watch-match') showToast('Diffuseur dynamique : SeenIt n’ouvre rien tant que la cible réelle du match n’est pas résolue.');
  }

  function shouldAcceptDirectional() {
    var now = new Date().getTime();
    if (now - lastDirectionalAt < NAV_DEBOUNCE_MS) return false;
    lastDirectionalAt = now;
    return true;
  }

  function handleKey(event) {
    var code = event.keyCode || event.which;
    var active;
    if (code === 37 || code === 38 || code === 39 || code === 40) {
      if (!shouldAcceptDirectional()) { event.preventDefault(); return; }
      if (code === 37) moveFocus('left');
      else if (code === 38) moveFocus('up');
      else if (code === 39) moveFocus('right');
      else moveFocus('down');
      event.preventDefault();
    } else if (code === 13) {
      active = document.activeElement;
      if (active && /\bfocusable\b/.test(active.className)) clickAction(active);
      event.preventDefault();
    } else if (code === 10009 || code === 461 || code === 8) {
      goBack();
      event.preventDefault();
    } else if (code === 403) {
      sportState = sportState === 'normal' ? 'imminent' : sportState === 'imminent' ? 'live' : 'normal';
      updateSportTile();
      showToast('Démo Sport · ' + sportState);
    }
  }

  function attachClicks() {
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node !== document.body && !/\bfocusable\b/.test(node.className || '')) node = node.parentNode;
      if (node && node !== document.body && !node.disabled) { setFocus(node); clickAction(node); }
    });
  }

  function updateClock() {
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    document.getElementById('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function registerRemoteKeys() {
    try {
      if (window.tizen && window.tizen.tvinputdevice) window.tizen.tvinputdevice.registerKey('ColorF0Red');
    } catch (e) {}
  }

  function discoverDevice() {
    TVDevice.listApps(function (apps) {
      installedApps = apps || [];
      renderHomeApps();
      if (currentScreen === 'screenApps') renderAppsPage();
      updateDiagnosticPanel();
      if (currentScreen === 'screenProfiles') firstFocus();
    });
    TVDevice.getSources(function (sources) {
      detectedSources = sources || [];
      updateSourceSummary();
      if (currentScreen === 'screenSources') renderSources();
      updateDiagnosticPanel();
    });
  }

  function handleVisibility() {
    if (document.hidden === true) stopTelemetryTimers();
    else startTelemetryTimers();
  }

  function init() {
    resizeStage();
    renderCalendar();
    renderHomeApps();
    updateSportTile();
    updateConnectivity();
    updateClock();
    updateSourceSummary();
    updateDiagnosticPanel();
    setInterval(updateClock, 30000);
    window.addEventListener('resize', resizeStage);
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('keydown', handleKey);
    attachClicks();
    registerRemoteKeys();
    discoverDevice();
    startTelemetryTimers();
    firstFocus();
  }

  init();
}());
