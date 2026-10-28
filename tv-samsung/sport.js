/* Public fixture snapshots only. ES5, no provider key or result polling. */
var TVSport = (function () {
  'use strict';
  var KEY = 'seenit.tv.sport.v1', TTL = 21600000, MAX_AGE = 172800000;
  var storage, notify = function () {}, data = null, xhr = null, epoch = 0, failed = false, nextTry = 0;
  function view(selected) {
    var now = new Date().getTime(), events = [], sources = [], i, e;
    if (data && now - data.fetchedAt <= MAX_AGE) {
      for (i = 0; i < data.events.length; i++) {
        e = data.events[i];
        if (selected.indexOf(e.sourceId) >= 0 && new Date(e.kickoff).getTime() > now) events.push(e);
      }
      for (i = 0; i < data.sources.length; i++) if (selected.indexOf(data.sources[i].id) >= 0) sources.push(data.sources[i]);
    }
    return { events: events, sources: sources, loading: !!xhr, failed: failed,
      stale: !!data && (now - data.fetchedAt > TTL || sources.some(function (s) { return s.state === 'stale'; })), fetchedAt: data ? data.fetchedAt : 0 };
  }
  function safe(value) {
    var i, e;
    if (!value || !value.fetchedAt || Object.prototype.toString.call(value.events) !== '[object Array]' || value.events.length > 24 || Object.prototype.toString.call(value.sources) !== '[object Array]' || value.sources.length > 16) return false;
    for (i = 0; i < value.events.length; i++) {
      e = value.events[i];
      if (!e || typeof e.id !== 'string' || typeof e.sourceId !== 'string' || !e.home || !e.away || typeof e.home.name !== 'string' || typeof e.away.name !== 'string' || typeof e.competition !== 'string' || !isFinite(new Date(e.kickoff).getTime())) return false;
    }
    return true;
  }
  function pause() {
    epoch++;
    if (xhr) { xhr.onreadystatechange = xhr.onerror = xhr.ontimeout = null; xhr.abort(); xhr = null; }
  }
  function refresh(force) {
    var now = new Date().getTime(), generation, request, completed = false;
    if (document.hidden || xhr || (!force && now < nextTry)) return;
    generation = epoch; request = new XMLHttpRequest(); xhr = request;
    function finish(value) {
      if (completed || epoch !== generation) return;
      completed = true; xhr = null;
      if (safe(value) && now - value.fetchedAt <= MAX_AGE) { data = value; failed = false; nextTry = now + TTL; try { storage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
      else { failed = true; nextTry = now + 1800000; }
      notify();
    }
    request.open('GET', 'https://seenit.ai.studio/api/tv/sport', true); request.timeout = 20000;
    request.onreadystatechange = function () {
      if (request.readyState !== 4) return;
      try { finish(request.status === 200 && request.responseText.length <= 65536 ? JSON.parse(request.responseText) : null); } catch (e) { finish(null); }
    };
    request.onerror = request.ontimeout = function () { finish(null); };
    try { request.send(null); } catch (e) { finish(null); }
  }
  return {
    init: function (store, changed) {
      storage = store; notify = changed;
      try { var raw = storage.getItem(KEY); if (raw && raw.length <= 65536) { var saved = JSON.parse(raw); if (safe(saved)) { data = saved; nextTry = saved.fetchedAt + TTL; } } } catch (e) {}
    },
    refresh: refresh, pause: pause, view: view
  };
}());
