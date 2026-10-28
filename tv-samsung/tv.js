/*
 * SeenIt TV device adapter for Samsung Tizen 3+.
 * ES5 only. Patterns are informed by the MIT-licensed Free My TV project.
 * See NOTICE-FreeMyTV.md.
 */
var TVDevice = (function () {
  'use strict';

  var samsung = typeof window.tizen !== 'undefined' && !!window.tizen.application;
  var viewerId = 'org.tizen.tv-viewer';
  var settingsMenuId = 'org.tizen.menu';
  var nativeSources = {};
  var operationLog = [];

  function record(kind, target, error) {
    operationLog.push({ at: new Date().getTime(), kind: kind, target: String(target || '').slice(0, 160), error: error ? String(error.name || 'UnknownError').slice(0, 80) : null });
    if (operationLog.length > 24) operationLog.shift();
  }

  function sourceKey(type, number) { return String(type).toUpperCase() + ':' + Number(number); }

  var sampleApps = [
    { id: 'sample.plex', name: 'Plex', show: true },
    { id: 'sample.netflix', name: 'Netflix', show: true },
    { id: 'sample.youtube', name: 'YouTube', show: true },
    { id: 'sample.prime', name: 'Prime Video', show: true },
    { id: 'sample.dazn', name: 'DAZN', show: true },
    { id: 'sample.spotify', name: 'Spotify', show: true },
    { id: 'sample.system.viewer', name: 'TV Viewer', show: false }
  ];

  function safeTitle(app) {
    return String((app && (app.name || app.title)) || '').replace(/^\s+|\s+$/g, '');
  }

  function isSystemAppHint(app) {
    var id = String((app && app.id) || '');
    if (!id) return true;
    if (id === viewerId || id === settingsMenuId) return true;
    if (/^com\.samsung\./.test(id) && /(?:ambient|account|commonsearch|voice|mybixby|preview|notification|aria-dummy|csfs)/i.test(id)) return true;
    if (/^(?:AmbientSupport|AmbientApp|CSAccount(?:OOBE)?|Apps|csfs|VoiceDiscoveryMenu|Samsung TV Plus Privacy Settings)$/i.test(safeTitle(app))) return true;
    if (/^(?:com\.samsung\.|org\.tizen\.)/.test(safeTitle(app))) return true;
    if (/^org\.tizen\./.test(id) && !/^(?:Netflix|Prime Video|Internet|Browser|Samsung TV Plus)$/i.test(safeTitle(app))) return true;
    if (/^(ise-|ug-|org\.volt\.)/.test(id)) return true;
    if (/Service$|Daemon|Keyboard|syspopup|Helper$/i.test(id)) return true;
    if (/^com\.samsung\.tv\.(cobalt-|airplay-app|built-in-app-info-viewer|commonsearch|preview-|notification-app)/.test(id)) return true;
    return false;
  }

  function normalizeApp(app) {
    var id = String((app && app.id) || '');
    var title = safeTitle(app);
    var classification = 'UNKNOWN';
    var visible = app && app.show !== false;
    if (!id) return null;
    if (!visible || isSystemAppHint(app)) classification = 'SYSTEM';
    else if (title) classification = 'USER';
    return {
      id: id,
      title: title || id,
      show: visible,
      classification: classification,
      favorite: false,
      hidden: false,
      launchable: classification === 'USER',
      iconPath: app && app.iconPath ? String(app.iconPath) : ''
    };
  }

  function listApps(done) {
    var finish = typeof done === 'function' ? done : function () {};
    if (!samsung) {
      setTimeout(function () {
        var preview = [];
        var p;
        for (p = 0; p < sampleApps.length; p++) {
          var item = normalizeApp(sampleApps[p]);
          if (item) preview.push(item);
        }
        finish(preview);
      }, 0);
      return;
    }
    try {
      window.tizen.application.getAppsInfo(function (apps) {
        var out = [];
        var i, ownId = '';
        try { ownId = window.tizen.application.getCurrentApplication().appInfo.id; } catch (e) {}
        for (i = 0; i < apps.length; i++) {
          var normalized = normalizeApp(apps[i]);
          if (normalized && normalized.id === ownId) { normalized.classification = 'SYSTEM'; normalized.launchable = false; }
          if (normalized) out.push(normalized);
        }
        out.sort(function (a, b) {
          var aa = a.title.toLowerCase();
          var bb = b.title.toLowerCase();
          return aa < bb ? -1 : aa > bb ? 1 : 0;
        });
        finish(out);
      }, function () { finish(null); });
    } catch (e) {
      finish(null);
    }
  }

  function launchApp(id, done) {
    if (!samsung) {
      if (done) setTimeout(function () { done(true); }, 0);
      return;
    }
    try {
      window.tizen.application.launch(id, function () { record('launch-accepted', id); if (done) done(true); }, function (error) { record('launch-failed', id, error); if (done) done(false); });
    } catch (e) {
      record('launch-failed', id, e);
      if (done) done(false);
    }
  }

  function launchViewer(done) {
    launchApp(viewerId, done);
  }

  function openLiveTv(done) {
    if (!samsung) {
      if (done) setTimeout(function () { done(true); }, 0);
      return;
    }
    getSources(function (sources) {
      var i;
      for (i = 0; sources && i < sources.length; i++) {
        if (String(sources[i].type).toUpperCase() === 'TV') {
          openSource(sources[i].type, sources[i].number, done);
          return;
        }
      }
      if (done) done(false);
    });
  }

  function getSources(done) {
    var finish = typeof done === 'function' ? done : function () {};
    if (!samsung) {
      setTimeout(function () {
        finish([
          { type: 'HDMI', number: 1, connected: true },
          { type: 'HDMI', number: 2, connected: false }
        ]);
      }, 0);
      return;
    }
    if (!window.tizen.systeminfo || !window.tizen.tvwindow) { finish(null); return; }
    try {
      window.tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (value) {
        var out = [];
        var connected = value && value.connected ? value.connected : [];
        var disconnected = value && value.disconnected ? value.disconnected : [];
        var i;
        nativeSources = {};
        for (i = 0; i < connected.length; i++) {
          if (connected[i] && connected[i].type && connected[i].number !== undefined) {
            nativeSources[sourceKey(connected[i].type, connected[i].number)] = connected[i];
            out.push({ type: connected[i].type, number: connected[i].number, connected: true });
          }
        }
        for (i = 0; i < disconnected.length; i++) {
          if (disconnected[i] && disconnected[i].type && disconnected[i].number !== undefined) {
            nativeSources[sourceKey(disconnected[i].type, disconnected[i].number)] = disconnected[i];
            out.push({ type: disconnected[i].type, number: disconnected[i].number, connected: false });
          }
        }
        finish(out);
      }, function () { finish(null); });
    } catch (e) {
      finish(null);
    }
  }

  function openSource(type, number, done) {
    if (!samsung) {
      if (done) setTimeout(function () { done(true); }, 0);
      return;
    }
    getSources(function (sources) {
      var wanted = null;
      var i;
      for (i = 0; sources && i < sources.length; i++) {
        if (String(sources[i].type).toUpperCase() === String(type).toUpperCase() && Number(sources[i].number) === Number(number)) {
          wanted = sources[i];
          break;
        }
      }
      if (!wanted) {
        if (done) done(false);
        return;
      }
      try {
        var nativeSource = nativeSources[sourceKey(wanted.type, wanted.number)];
        if (!nativeSource) { if (done) done(false); return; }
        window.tizen.tvwindow.setSource(nativeSource, function () {
          record('source-selected', sourceKey(wanted.type, wanted.number)); launchViewer(done);
        }, function (error) { record('source-failed', sourceKey(wanted.type, wanted.number), error); if (done) done(false); });
      } catch (e) {
        record('source-failed', sourceKey(wanted.type, wanted.number), e);
        if (done) done(false);
      }
    });
  }

  function getMemoryInfo(done) {
    var finish = typeof done === 'function' ? done : function () {};
    if (!samsung) {
      setTimeout(function () { finish({ available: 612 * 1024 * 1024, total: 1536 * 1024 * 1024, preview: true }); }, 0);
      return;
    }
    if (!window.tizen.systeminfo) { finish(null); return; }
    try {
      var total = window.tizen.systeminfo.getTotalMemory();
      var available = window.tizen.systeminfo.getAvailableMemory();
      finish({ available: Number(available) || 0, total: Number(total) || 0, preview: false });
    } catch (e) {
      finish(null);
    }
  }

  function selectStorageUnit(value) {
    var units = value && value.units ? value.units : [];
    var fallback = null;
    var i;
    for (i = 0; i < units.length; i++) {
      if (!units[i]) continue;
      if (!fallback) fallback = units[i];
      if (units[i].isRemovable === false) return units[i];
    }
    return fallback;
  }

  function getStorageInfo(done) {
    var finish = typeof done === 'function' ? done : function () {};
    if (!samsung) {
      setTimeout(function () { finish({ available: 1800 * 1024 * 1024, total: 3900 * 1024 * 1024, preview: true }); }, 0);
      return;
    }
    if (!window.tizen.systeminfo) { finish(null); return; }
    try {
      window.tizen.systeminfo.getPropertyValue('STORAGE', function (value) {
        var unit = selectStorageUnit(value);
        if (!unit) { finish(null); return; }
        finish({
          available: Number(unit.availableCapacity) || 0,
          total: Number(unit.capacity) || 0,
          preview: false
        });
      }, function () { finish(null); });
    } catch (e) {
      finish(null);
    }
  }

  function openSamsungSettings(done) {
    if (!samsung) {
      if (done) setTimeout(function () { done(true); }, 0);
      return;
    }
    function fallback() {
      // The internal menu can capture the remote without showing on older TVs.
      // Leave SeenIt responsive and explain the physical Settings/Home route.
      if (done) done(false);
    }
    try {
      var control = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/setting', null, null, null, []);
      window.tizen.application.findAppControl(control, function (handlers) {
        if (!handlers || !handlers.length || !handlers[0].id) { fallback(); return; }
        try {
          window.tizen.application.launchAppControl(control, handlers[0].id, function () { if (done) done(true); }, fallback);
        } catch (e) { fallback(); }
      }, fallback);
    } catch (e) { fallback(); }
  }

  function exitApp(done) {
    if (!samsung) { if (done) done(false); return; }
    try { window.tizen.application.getCurrentApplication().exit(); if (done) done(true); }
    catch (e) { if (done) done(false); }
  }

  function diagnostics(done) {
    var result = {
      samsung: samsung,
      platform: navigator.userAgent || '',
      apps: 0,
      userApps: 0,
      systemApps: 0,
      unknownApps: 0,
      sources: [],
      memory: null,
      storage: null
    };
    listApps(function (apps) {
      var i;
      apps = apps || [];
      result.apps = apps.length;
      for (i = 0; i < apps.length; i++) {
        if (apps[i].classification === 'USER') result.userApps++;
        else if (apps[i].classification === 'SYSTEM') result.systemApps++;
        else result.unknownApps++;
      }
      getSources(function (sources) {
        result.sources = sources || [];
        getMemoryInfo(function (memory) {
          result.memory = memory;
          getStorageInfo(function (storage) {
            result.storage = storage;
            result.operations = operationLog.slice(0); done(result);
          });
        });
      });
    });
  }

  return {
    isSamsung: function () { return samsung; },
    listApps: listApps,
    launchApp: launchApp,
    openLiveTv: openLiveTv,
    getSources: getSources,
    openSource: openSource,
    getMemoryInfo: getMemoryInfo,
    getStorageInfo: getStorageInfo,
    openSamsungSettings: openSamsungSettings,
    exitApp: exitApp,
    diagnostics: diagnostics
  };
}());
