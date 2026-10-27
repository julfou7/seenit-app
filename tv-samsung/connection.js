/* SeenIt TV link. ES5, no Firebase SDK, no third-party QR service, no viewing writes. */
var TVConnection = (function () {
  'use strict';
  var ORIGIN = 'https://seenit.ai.studio', KEY = 'seenit.tv.v4.foyer';
  var storage, notify = function () {}, link = null, pending = null, timer = null, request = null;
  var epoch = 0, phase = 'local', error = '', online = false, pairingVisible = false;
  var items = [], syncedAt = 0, profile = '';
  function trimError(value) { return String(value || 'NETWORK').replace(/[^A-Z0-9_]/g, '').slice(0, 60); }
  function valid(value) { return value && /^[a-f0-9]{48}$/.test(value.id) && /^[a-f0-9]{64}$/.test(value.secret) && typeof value.profile === 'string' && Number(value.expiresAt) > new Date().getTime(); }
  function cacheKey(name) { return 'seenit.tv.v4.cache.films.' + encodeURIComponent(name); }
  function save() { try { if (link) storage.setItem(KEY, JSON.stringify(link)); else storage.removeItem(KEY); } catch (e) {} }
  function changed() { notify(view()); }
  function view() {
    var own = !!link && valid(link) && !link.revoking && link.profile === profile;
    return { phase: phase, linked: own, profile: profile, linkedProfile: link ? link.profile : '', accountName: own ? link.accountName || 'SeenIt' : '',
      online: own && online, syncedAt: own ? syncedAt : 0, items: own ? items.slice(0, 18) : [], error: error,
      code: pairingVisible && pending ? pending.code : '', approvalUrl: pairingVisible && pending ? pending.approvalUrl : '' };
  }
  function stop() {
    epoch++;
    if (timer !== null) clearTimeout(timer); timer = null;
    if (request) { request.onreadystatechange = null; request.onerror = null; request.ontimeout = null; request.abort(); request = null; }
  }
  function call(path, method, session, body, done) {
    var generation = epoch, xhr = new XMLHttpRequest(), complete = false;
    request = xhr;
    function finish(value, failure) {
      if (complete || generation !== epoch) return;
      complete = true; request = null; done(value, failure);
    }
    xhr.open(method, ORIGIN + path, true); xhr.timeout = 12000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (session) xhr.setRequestHeader('Authorization', 'Bearer ' + session.secret);
    xhr.onreadystatechange = function () {
      var value;
      if (xhr.readyState !== 4) return;
      try {
        if (xhr.responseText.length > 262144) throw new Error('Large response');
        value = JSON.parse(xhr.responseText);
        if (!value || typeof value !== 'object') throw new Error('Invalid response');
        if (xhr.status >= 200 && xhr.status < 300) finish(value, null);
        else finish(null, trimError(value.error));
      } catch (e) { finish(null, 'NETWORK'); }
    };
    xhr.onerror = xhr.ontimeout = function () { finish(null, 'NETWORK'); };
    try { xhr.send(body ? JSON.stringify(body) : null); } catch (e) { finish(null, 'NETWORK'); }
  }
  function removeCache() {
    items = []; syncedAt = 0;
    if (link) try { storage.removeItem(cacheKey(link.profile)); } catch (e) {}
  }
  function schedule() {
    if (timer !== null) clearTimeout(timer);
    if (pairingVisible && pending && !document.hidden) timer = setTimeout(poll, 5000);
  }
  function poll() {
    timer = null;
    if (!pending || !pairingVisible || document.hidden) return;
    if (Number(pending.expiresAt) <= new Date().getTime()) { pending = null; phase = 'expired'; error = 'LINK_EXPIRED'; changed(); return; }
    call('/api/tv/links/' + pending.id + '/status', 'POST', pending, null, function (value, failure) {
      if (failure) {
        error = failure;
        if (failure === 'LINK_EXPIRED' || failure === 'LINK_REVOKED' || failure === 'INVALID_TV_SESSION') { pending = null; phase = 'expired'; }
        changed(); schedule(); return;
      }
      if (value.state === 'active') {
        link = { id: pending.id, secret: pending.secret, profile: value.profile, expiresAt: value.expiresAt, accountName: value.accountName };
        pending = null; phase = 'linked'; error = ''; save(); changed(); sync(true);
      } else schedule();
    });
  }
  function sync(force) {
    if (document.hidden || request || !link || !valid(link) || link.revoking || link.profile !== profile) return;
    if (!force && new Date().getTime() - syncedAt < 300000) return;
    call('/api/tv/links/' + link.id + '/bootstrap', 'POST', link, null, function (value, failure) {
      if (failure) {
        online = false; error = failure;
        if (failure === 'LINK_EXPIRED' || failure === 'LINK_REVOKED' || failure === 'INVALID_TV_SESSION') { removeCache(); link = null; save(); phase = 'expired'; }
        changed(); return;
      }
      if (!value || value.profile !== profile || Object.prototype.toString.call(value.items) !== '[object Array]') return;
      items = value.items.slice(0, 18); syncedAt = Number(value.syncedAt) || new Date().getTime(); online = true; phase = 'linked'; error = '';
      try { storage.setItem(cacheKey(profile), JSON.stringify({ id: link.id, items: items, syncedAt: syncedAt })); } catch (e) {}
      changed();
    });
  }
  function revoke() {
    stop(); pending = null; removeCache(); online = false; phase = 'local';
    if (!link) { changed(); return; }
    link.revoking = true; save(); changed();
    if (document.hidden) return;
    call('/api/tv/links/' + link.id, 'DELETE', link, null, function (value, failure) {
      if (!failure || ['LINK_EXPIRED', 'LINK_REVOKED', 'INVALID_TV_SESSION'].indexOf(failure) >= 0) { link = null; save(); error = ''; }
      else error = 'REVOKE_PENDING';
      changed();
    });
  }
  return {
    init: function (store, onChange) {
      storage = store; notify = onChange;
      try { var saved = JSON.parse(storage.getItem(KEY) || 'null'); if (valid(saved)) link = saved; else storage.removeItem(KEY); } catch (e) {}
    },
    profile: function (name) {
      stop(); profile = name || ''; pairingVisible = false; pending = null; online = false; items = []; syncedAt = 0; error = ''; phase = link && valid(link) && link.profile === profile && !link.revoking ? 'linked' : 'local';
      if (phase === 'linked') try { var saved = JSON.parse(storage.getItem(cacheKey(profile)) || 'null'); if (saved && saved.id === link.id && Object.prototype.toString.call(saved.items) === '[object Array]') { items = saved.items.slice(0, 18); syncedAt = Number(saved.syncedAt) || 0; } } catch (e) {}
      changed(); sync(true);
    },
    start: function (deviceName) {
      stop();
      if (!profile || profile === 'Invité' || profile === 'Milo' || link) { error = link ? 'UNLINK_FIRST' : 'CHOOSE_ADULT_PROFILE'; changed(); return; }
      pairingVisible = true; pending = null; phase = 'creating'; error = ''; changed();
      call('/api/tv/links', 'POST', null, { profile: profile, deviceName: deviceName || 'SeenIt TV Samsung' }, function (value, failure) {
        if (failure || !valid(value) || !/^[A-F0-9]{4}-[A-F0-9]{4}$/.test(value.code || '')) { phase = 'error'; error = failure || 'NETWORK'; changed(); return; }
        pending = { id: value.id, secret: value.secret, code: value.code, profile: profile, expiresAt: value.expiresAt,
          approvalUrl: ORIGIN + '/tv/connect?tvLink=' + value.id + '&code=' + value.code };
        phase = 'pending'; changed(); schedule();
      });
    },
    pairingVisible: function (value) { if (pending || phase === 'creating') stop(); pairingVisible = !!value; if (phase === 'creating' && !pending) phase = 'local'; if (value) schedule(); },
    pause: stop,
    resume: function () { if (link && link.revoking) revoke(); else if (pairingVisible && pending) schedule(); else sync(false); },
    sync: function () { sync(true); }, revoke: revoke, view: view,
  };
}());
