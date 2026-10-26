/* ES5. Titles select artwork only; launching always uses the detected ID. */
var TVModel = (function () {
  'use strict';
  var brands = [
    { match: /netflix/i, file: 'netflix' }, { match: /plex/i, file: 'plex' },
    { match: /youtube/i, file: 'youtube' }, { match: /prime\s*video|amazon.*prime/i, file: 'amazonprime' },
    { match: /spotify/i, file: 'spotify' }, { match: /dazn/i, file: 'dazn' }
  ];
  function brand(title) {
    var i;
    for (i = 0; i < brands.length; i++) if (brands[i].match.test(title || '')) return brands[i];
    return null;
  }
  function localIcon(value) {
    var path = String(value || '');
    return /^(?:\/(?!\/)|file:\/\/\/|wgt-package:\/\/)/i.test(path) && !/[<>\x00-\x1f]/.test(path) ? path : '';
  }
  function initials(title) {
    var words = String(title || '?').replace(/^\s+|\s+$/g, '').split(/\s+/);
    return (words[0] ? words[0].charAt(0) : '?') + (words.length > 1 ? words[1].charAt(0) : '');
  }
  function ids(value, limit) {
    var out = [], i, item;
    if (Object.prototype.toString.call(value) !== '[object Array]') return out;
    for (i = 0; i < value.length && out.length < limit; i++) {
      item = value[i];
      if (typeof item === 'string' && item.length > 0 && item.length <= 256 && out.indexOf(item) < 0) out.push(item);
    }
    return out;
  }
  function preferences(storage, profile) {
    var key = 'seenit.tv.preferences.v1.' + encodeURIComponent(profile || '');
    var state = { pins: [], recent: [], hidden: [], theme: 'dusk', motion: true }, parsed;
    var persistent = !!profile && profile !== 'Invité';
    if (persistent) try {
      parsed = JSON.parse(storage.getItem(key) || '{}');
      state.pins = ids(parsed && parsed.pins, 32);
      state.recent = ids(parsed && parsed.recent, 8);
      state.hidden = ids(parsed && parsed.hidden, 64);
      if (parsed && ['dusk', 'mist', 'auto'].indexOf(parsed.theme) >= 0) state.theme = parsed.theme;
      if (parsed && parsed.motion === false) state.motion = false;
    } catch (e) {}
    function save() { if (persistent) try { storage.setItem(key, JSON.stringify(state)); } catch (e) {} }
    return {
      pins: function () { return state.pins.slice(0); },
      recent: function () { return state.recent.slice(0); },
      hidden: function () { return state.hidden.slice(0); },
      theme: function () { return state.theme; },
      motion: function () { return state.motion; },
      setTheme: function (theme) { if (['dusk', 'mist', 'auto'].indexOf(theme) >= 0) { state.theme = theme; save(); } },
      toggleMotion: function () { state.motion = !state.motion; save(); },
      order: function (ordered) { state.pins = ids(ordered, 32); save(); },
      hideApp: function (id) {
        if (!ids([id], 1).length) return;
        var index = state.pins.indexOf(id);
        if (index >= 0) state.pins.splice(index, 1);
        if (state.hidden.indexOf(id) < 0 && state.hidden.length < 64) state.hidden.push(id);
        save();
      },
      toggle: function (id) {
        if (ids([id], 1).length !== 1) return false;
        var index = state.pins.indexOf(id);
        if (index >= 0) state.pins.splice(index, 1);
        else if (state.pins.length < 32) { state.pins.push(id); index = state.hidden.indexOf(id); if (index >= 0) state.hidden.splice(index, 1); }
        else return false;
        save(); return true;
      },
      opened: function (id) {
        if (ids([id], 1).length !== 1) return;
        var index = state.recent.indexOf(id);
        if (index >= 0) state.recent.splice(index, 1);
        state.recent.unshift(id); state.recent = state.recent.slice(0, 8); save();
      }
    };
  }
  function userApps(apps) {
    var out = [], i;
    for (i = 0; i < apps.length; i++) if (apps[i].classification === 'USER' && apps[i].launchable) out.push(apps[i]);
    return out;
  }
  function byIds(apps, wanted) {
    var out = [], i, j;
    for (i = 0; i < wanted.length; i++) for (j = 0; j < apps.length; j++) {
      if (apps[j].id === wanted[i] && apps[j].classification === 'USER' && apps[j].launchable) { out.push(apps[j]); break; }
    }
    return out;
  }
  function favorites(apps, pins, limit, hidden) {
    var users = userApps(apps), out = byIds(users, pins), i;
    var used = [];
    hidden = hidden || [];
    for (i = 0; i < out.length; i++) used.push(out[i].id);
    /* Initial artwork ranking only. Any installed app can be pinned ahead of it. */
    for (i = 0; i < users.length && out.length < limit; i++) if (brand(users[i].title) && used.indexOf(users[i].id) < 0 && hidden.indexOf(users[i].id) < 0) { out.push(users[i]); used.push(users[i].id); }
    for (i = 0; i < users.length && out.length < limit; i++) if (used.indexOf(users[i].id) < 0 && hidden.indexOf(users[i].id) < 0) { out.push(users[i]); used.push(users[i].id); }
    return out.slice(0, limit);
  }
  return { brand: brand, localIcon: localIcon, initials: initials, preferences: preferences, userApps: userApps, byIds: byIds, favorites: favorites };
}());
