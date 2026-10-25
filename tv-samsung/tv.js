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

  var sampleApps = [
    { id: 'sample.plex', title: 'Plex' },
    { id: 'sample.netflix', title: 'Netflix' },
    { id: 'sample.youtube', title: 'YouTube' },
    { id: 'sample.prime', title: 'Prime Video' },
    { id: 'sample.dazn', title: 'DAZN' },
    { id: 'sample.spotify', title: 'Spotify' }
  ];

  function safeTitle(app) {
    return String((app && (app.name || app.title)) || '').replace(/^\s+|\s+$/g, '');
  }

  function isSystemApp(app) {
    var id = String((app && app.id) || '');
    if (!id) return true;
    if (id === viewerId || id === settingsMenuId) return true;
    if (/^(ise-|ug-|org\.volt\.)/.test(id)) return true;
    if (/Service$|Daemon|Keyboard|syspopup|Helper$/.test(id)) return true;
    if (/^com\.samsung\.tv\.(cobalt-|airplay-app|built-in-app-info-viewer|commonsearch|preview-|notification-app)/.test(id)) return true;
    return false;
  }

  function listApps(done) {
    if (!samsung) {
      setTimeout(function () { done(sampleApps.slice(0)); }, 0);
      return;
    }
    try {
      window.tizen.application.getAppsInfo(function (apps) {
        var out = [];
        var i;
        for (i = 0; i < apps.length; i++) {
          if (!apps[i] || !apps[i].id || apps[i].show === false || isSystemApp(apps[i])) continue;
          var title = safeTitle(apps[i]);
          if (!title) continue;
          out.push({ id: apps[i].id, title: title });
        }
        out.sort(function (a, b) {
          var aa = a.title.toLowerCase();
          var bb = b.title.toLowerCase();
          return aa < bb ? -1 : aa > bb ? 1 : 0;
        });
        done(out);
      }, function () { done([]); });
    } catch (e) {
      done([]);
    }
  }

  function launchApp(id, done) {
    if (!samsung) {
      if (done) setTimeout(function () { done(true); }, 0);
      return;
    }
    try {
      window.tizen.application.launch(id, function () { if (done) done(true); }, function () { if (done) done(false); });
    } catch (e) {
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
    launchViewer(done);
  }

  function getSources(done) {
    if (!samsung || !window.tizen.systeminfo || !window.tizen.tvwindow) {
      setTimeout(function () { done([]); }, 0);
      return;
    }
    try {
      window.tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (value) {
        var out = [];
        var connected = value && value.connected ? value.connected : [];
        var disconnected = value && value.disconnected ? value.disconnected : [];
        var all = connected.concat(disconnected);
        var i;
        for (i = 0; i < all.length; i++) {
          if (all[i] && all[i].type && all[i].number !== undefined) out.push(all[i]);
        }
        done(out);
      }, function () { done([]); });
    } catch (e) {
      done([]);
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
      for (i = 0; i < sources.length; i++) {
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
        window.tizen.tvwindow.setSource(wanted, function () { launchViewer(done); }, function () { if (done) done(false); });
      } catch (e) {
        if (done) done(false);
      }
    });
  }

  function openSamsungSettings(done) {
    if (!samsung) {
      if (done) setTimeout(function () { done(true); }, 0);
      return;
    }
    try {
      var control = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/setting', null, null, null, []);
      window.tizen.application.launchAppControl(control, null, function () { if (done) done(true); }, function () {
        launchApp(settingsMenuId, done);
      });
    } catch (e) {
      launchApp(settingsMenuId, done);
    }
  }

  function diagnostics(done) {
    var result = { samsung: samsung, platform: navigator.userAgent || '', apps: 0, sources: [] };
    listApps(function (apps) {
      result.apps = apps.length;
      getSources(function (sources) {
        result.sources = sources;
        done(result);
      });
    });
  }

  return {
    isSamsung: function () { return samsung; },
    listApps: listApps,
    launchApp: launchApp,
    openLiveTv: openLiveTv,
    openSource: openSource,
    openSamsungSettings: openSamsungSettings,
    diagnostics: diagnostics
  };
}());
