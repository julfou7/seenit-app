/* SeenIt TV prototype shell. Plain ES5 for Samsung Tizen 3 / Chromium-era engines. */
(function () {
  'use strict';

  var DESIGN_WIDTH = 1920;
  var DESIGN_HEIGHT = 1080;
  var stage = document.getElementById('stage');
  var currentScreen = 'screenProfiles';
  var history = [];
  var currentProfile = null;
  var installedApps = [];
  var toastTimer = null;
  var sportState = 'normal';

  var events = [
    { when: 'Ce soir · 20:45', title: 'Monaco — Lille', meta: 'Ligue 1 · confirmé' },
    { when: 'Mer. · 21:00', title: 'Monaco — Benfica', meta: 'Champions League · confirmé' },
    { when: '14 nov. · 20:45', title: 'France — Italie', meta: 'International · provisoire' }
  ];

  var favoriteNames = ['Plex', 'Netflix', 'YouTube', 'Prime Video', 'DAZN', 'CANAL+', 'Disney+', 'Spotify'];
  var kidAllowed = ['YouTube Kids', 'Netflix', 'Disney+', 'Plex'];

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
    toastTimer = setTimeout(function () { toast.className = 'toast'; }, 2600);
  }

  function updateConnectivity() {
    document.getElementById('offlineBadge').className = navigator.onLine === false ? 'offline-badge visible' : 'offline-badge';
  }

  function screens() {
    return document.querySelectorAll('.screen');
  }

  function focusables() {
    var screen = document.getElementById(currentScreen);
    if (!screen) return [];
    return screen.querySelectorAll('.focusable');
  }

  function clearFocus() {
    var nodes = document.querySelectorAll('.focused');
    var i;
    for (i = 0; i < nodes.length; i++) nodes[i].className = nodes[i].className.replace(/\s*focused\b/g, '');
  }

  function setFocus(element) {
    if (!element) return;
    clearFocus();
    if (element.className.indexOf('focused') < 0) element.className += ' focused';
    try { element.focus(); } catch (e) {}
  }

  function firstFocus() {
    var list = focusables();
    if (list.length) setFocus(list[0]);
  }

  function moveFocus(direction) {
    var list = focusables();
    if (!list.length) return;
    var active = document.activeElement;
    var origin = null;
    var i;
    for (i = 0; i < list.length; i++) if (list[i] === active || /\bfocused\b/.test(list[i].className)) origin = list[i];
    if (!origin) { setFocus(list[0]); return; }
    var r = origin.getBoundingClientRect();
    var ox = r.left + r.width / 2;
    var oy = r.top + r.height / 2;
    var best = null;
    var bestScore = 9999999;
    for (i = 0; i < list.length; i++) {
      if (list[i] === origin) continue;
      var c = list[i].getBoundingClientRect();
      var cx = c.left + c.width / 2;
      var cy = c.top + c.height / 2;
      var dx = cx - ox;
      var dy = cy - oy;
      var valid = (direction === 'left' && dx < -6) || (direction === 'right' && dx > 6) || (direction === 'up' && dy < -6) || (direction === 'down' && dy > 6);
      if (!valid) continue;
      var primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
      var secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
      var score = primary + secondary * 2.2;
      if (score < bestScore) { bestScore = score; best = list[i]; }
    }
    if (best) setFocus(best);
  }

  function showScreen(id, push) {
    var list = screens();
    var i;
    if (push !== false && currentScreen !== id) history.push(currentScreen);
    for (i = 0; i < list.length; i++) list[i].className = list[i].id === id ? list[i].className.replace(/\s*active\b/g, '') + ' active' : list[i].className.replace(/\s*active\b/g, '');
    currentScreen = id;
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
    currentProfile = name;
    try { localStorage.setItem('seenit.tv.profile', name); } catch (e) {}
    document.getElementById('hello').textContent = name === 'Milo' ? 'Salut Milo' : (name === 'Invité' ? 'Mode Invité' : 'Bonsoir ' + name);
    document.getElementById('profileInitial').textContent = profileInitial(name);
    var home = document.getElementById('screenHome');
    home.className = home.className.replace(/\s*kid-mode\b/g, '');
    if (name === 'Milo') home.className += ' kid-mode';
    history = [];
    showScreen('screenHome', false);
    renderApps();
  }

  function colorForTitle(title) {
    var t = title.toLowerCase();
    if (t.indexOf('netflix') >= 0) return '#b81d24';
    if (t.indexOf('plex') >= 0) return '#d79d18';
    if (t.indexOf('youtube') >= 0) return '#d62d2d';
    if (t.indexOf('prime') >= 0) return '#2a8dbe';
    if (t.indexOf('dazn') >= 0) return '#222';
    if (t.indexOf('canal') >= 0) return '#161616';
    if (t.indexOf('spotify') >= 0) return '#1b8f4b';
    return '#2a2931';
  }

  function initials(title) {
    var words = title.split(/\s+/);
    return (words[0] ? words[0].charAt(0) : '?') + (words.length > 1 ? words[1].charAt(0) : '');
  }

  function appButton(app) {
    var button = document.createElement('button');
    button.className = 'app-card focusable';
    button.setAttribute('data-action', 'launch-app');
    button.setAttribute('data-app-id', app.id);
    button.setAttribute('data-app-title', app.title);
    var logo = document.createElement('span');
    logo.className = 'app-logo';
    logo.style.background = colorForTitle(app.title);
    logo.textContent = initials(app.title);
    var name = document.createElement('span');
    name.className = 'app-name';
    name.textContent = app.title;
    button.appendChild(logo);
    button.appendChild(name);
    return button;
  }

  function scoreFavorite(app) {
    var i;
    var title = app.title.toLowerCase();
    for (i = 0; i < favoriteNames.length; i++) if (title.indexOf(favoriteNames[i].toLowerCase()) >= 0) return i;
    return 999;
  }

  function isKidAllowed(app) {
    var title = app.title.toLowerCase();
    var i;
    for (i = 0; i < kidAllowed.length; i++) if (title.indexOf(kidAllowed[i].toLowerCase()) >= 0) return true;
    return false;
  }

  function renderApps() {
    var row = document.getElementById('appRow');
    var kidRow = document.getElementById('kidAppRow');
    var grid = document.getElementById('allAppsGrid');
    row.innerHTML = '';
    kidRow.innerHTML = '';
    grid.innerHTML = '';
    var sorted = installedApps.slice(0);
    sorted.sort(function (a, b) {
      var sa = scoreFavorite(a), sb = scoreFavorite(b);
      if (sa !== sb) return sa - sb;
      return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1;
    });
    var shown = 0;
    var i;
    for (i = 0; i < sorted.length; i++) {
      if (scoreFavorite(sorted[i]) < 999 && shown < 7) {
        row.appendChild(appButton(sorted[i]));
        shown++;
      }
    }
    for (i = 0; i < sorted.length && shown < 6; i++) {
      if (scoreFavorite(sorted[i]) === 999) { row.appendChild(appButton(sorted[i])); shown++; }
    }
    for (i = 0; i < sorted.length; i++) {
      grid.appendChild(appButton(sorted[i]));
      if (isKidAllowed(sorted[i]) && kidRow.children.length < 5) kidRow.appendChild(appButton(sorted[i]));
    }
    document.getElementById('appsStatus').textContent = installedApps.length ? installedApps.length + ' détectée(s)' : 'Aucune app détectée';
  }

  function renderEvents() {
    var row = document.getElementById('eventRow');
    row.innerHTML = '';
    var i;
    for (i = 0; i < events.length; i++) {
      var b = document.createElement('button');
      b.className = 'event-card focusable';
      b.setAttribute('data-action', 'sport');
      b.innerHTML = '<span>' + events[i].when + '</span><strong>' + events[i].title + '</strong><small>' + events[i].meta + '</small>';
      row.appendChild(b);
    }
  }

  function updateSportTile() {
    var tile = document.getElementById('sportTile');
    var badge = document.getElementById('sportBadge');
    var copy = document.getElementById('sportCopy');
    tile.className = tile.className.replace(/\s*live\b/g, '');
    if (sportState === 'live') {
      tile.className += ' live'; badge.textContent = '● EN DIRECT'; copy.textContent = 'AS Monaco — Lille · Regarder';
    } else if (sportState === 'imminent') {
      badge.textContent = 'DANS 23 MIN'; copy.textContent = 'AS Monaco — Lille · 20:45';
    } else {
      badge.textContent = 'CE SOIR'; copy.textContent = 'Monaco · 20:45';
    }
  }

  function launchAppFromButton(button) {
    var id = button.getAttribute('data-app-id');
    var title = button.getAttribute('data-app-title') || 'Application';
    TVDevice.launchApp(id, function (ok) { if (!ok) showToast('Impossible d’ouvrir ' + title + ' sur cette TV.'); });
  }

  function clickAction(element) {
    var profile = element.getAttribute('data-profile');
    if (profile) { setProfile(profile); return; }
    var action = element.getAttribute('data-action');
    if (!action) return;
    if (action === 'live-tv') TVDevice.openLiveTv(function (ok) { if (!ok) showToast('La bascule vers la TV TNT doit être validée sur la Q6F.'); });
    else if (action === 'films') showScreen('screenFilms');
    else if (action === 'sport') showScreen('screenSport');
    else if (action === 'settings') showScreen('screenSettings');
    else if (action === 'switch-profile') showScreen('screenProfiles');
    else if (action === 'all-apps' || action === 'kid-apps') showScreen('screenApps');
    else if (action === 'launch-app') launchAppFromButton(element);
    else if (action === 'back') goBack();
    else if (action === 'source') {
      var source = element.getAttribute('data-source') || '';
      var number = source === 'HDMI2' ? 2 : 1;
      TVDevice.openSource('HDMI', number, function (ok) { if (!ok) showToast(source + ' non détecté : configure la vraie entrée après le probe Q6F.'); });
    }
    else if (action === 'samsung-settings') TVDevice.openSamsungSettings(function (ok) { if (!ok) showToast('Réglages Samsung non accessibles depuis ce firmware.'); });
    else if (action === 'diagnostics') TVDevice.diagnostics(function (d) { document.getElementById('diagCopy').textContent = (d.samsung ? 'Samsung Tizen' : 'Preview navigateur') + ' · ' + d.apps + ' apps · ' + d.sources.length + ' sources'; showToast('Diagnostic local mis à jour.'); });
    else if (action === 'ambient') showScreen('screenAmbient');
    else if (action === 'plex-demo') showToast('V1 : raccord Plex exact à brancher après validation du launcher sur la TV.');
    else if (action === 'watch-match') showToast('Cible Sport dynamique : DAZN, CANAL+, HDMI ou info seule selon le foyer.');
  }

  function handleKey(event) {
    var code = event.keyCode || event.which;
    if (code === 37) { moveFocus('left'); event.preventDefault(); }
    else if (code === 38) { moveFocus('up'); event.preventDefault(); }
    else if (code === 39) { moveFocus('right'); event.preventDefault(); }
    else if (code === 40) { moveFocus('down'); event.preventDefault(); }
    else if (code === 13) { var active = document.activeElement; if (active && /\bfocusable\b/.test(active.className)) clickAction(active); event.preventDefault(); }
    else if (code === 10009 || code === 461 || code === 8) { goBack(); event.preventDefault(); }
    else if (code === 403) { sportState = sportState === 'normal' ? 'imminent' : sportState === 'imminent' ? 'live' : 'normal'; updateSportTile(); showToast('Démo Sport : ' + sportState); }
  }

  function attachClicks() {
    document.addEventListener('click', function (event) {
      var node = event.target;
      while (node && node !== document.body && !/\bfocusable\b/.test(node.className || '')) node = node.parentNode;
      if (node && node !== document.body) { setFocus(node); clickAction(node); }
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

  function init() {
    resizeStage();
    updateConnectivity();
    renderEvents();
    updateSportTile();
    updateClock();
    setInterval(updateClock, 30000);
    window.addEventListener('resize', resizeStage);
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    document.addEventListener('keydown', handleKey);
    attachClicks();
    registerRemoteKeys();
    TVDevice.listApps(function (apps) { installedApps = apps || []; renderApps(); if (currentScreen === 'screenProfiles') firstFocus(); });
    var remembered = null;
    try { remembered = localStorage.getItem('seenit.tv.profile'); } catch (e) {}
    if (remembered === 'Julian' || remembered === 'Camille' || remembered === 'Milo') {
      // Keep the profile chooser visible on launch by product decision; remembered profile is only preselection later.
    }
    firstFocus();
  }

  init();
}());
