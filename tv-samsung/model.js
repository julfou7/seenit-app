/* ES5. Titles select artwork only; launching always uses the detected ID. */
var TVModel = (function () {
  'use strict';
  var brands = [
    { match: /^netflix$/i, file: 'netflix' }, { match: /^plex(?:\s*[-–].*)?$/i, file: 'plex' },
    { match: /^youtube$/i, file: 'youtube' }, { match: /^prime\s*video$/i, file: 'amazonprime' },
    { match: /^spotify(?:\s*[-–].*)?$/i, file: 'spotify' }, { match: /^dazn$/i, file: 'dazn' },
    { match: /^(?:my)?canal\s*(?:\+|plus)?$/i, file: 'canalplus' },
    { match: /^apple\s*tv$/i, file: 'appletv', native: true },
    { match: /^paramount\s*\+$/i, file: 'paramount', native: true }
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
  function teamArtwork(value) {
    var url = String(value || '');
    if (url.length > 1024 || /[\s<>"'\\\x00-\x1f]/.test(url)) return '';
    if (/^assets\/sport\/[a-z0-9_-]+\.(?:png|svg)$/i.test(url)) return url;
    return /^https:\/\/[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?::443)?\/[^@]*$/i.test(url) ? url : '';
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
    var state = { pins: [], recent: [], hidden: [], theme: 'dusk', motion: true, sportSources: profile === 'Julian' ? ['monaco', 'france-men'] : [] }, parsed;
    var persistent = !!profile && profile !== 'Invité';
    if (persistent) try {
      parsed = JSON.parse(storage.getItem(key) || '{}');
      state.pins = ids(parsed && parsed.pins, 32);
      state.recent = ids(parsed && parsed.recent, 8);
      state.hidden = ids(parsed && parsed.hidden, 64);
      if (parsed && Object.prototype.toString.call(parsed.sportSources) === '[object Array]') state.sportSources = ids(parsed.sportSources, 16);
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
      sportSources: function () { return state.sportSources.slice(0); },
      toggleSport: function (id) {
        if (!/^[a-z0-9-]{1,64}$/.test(id)) return;
        var index = state.sportSources.indexOf(id);
        if (index >= 0) state.sportSources.splice(index, 1); else if (state.sportSources.length < 16) state.sportSources.push(id);
        save();
      },
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
        // Keep legacy saved pins intact, but additions follow the V4 shelf limit.
        else if (state.pins.length < 8) { state.pins.push(id); index = state.hidden.indexOf(id); if (index >= 0) state.hidden.splice(index, 1); }
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
  function titleKey(app) { return String(app.title || '').replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ').toLowerCase(); }
  function iconRank(app) {
    var path = localIcon(app.iconPath).replace(/^file:\/\//i, '');
    return /^\/opt\/usr\/apps\//.test(path) ? 2 : /^\/usr\/apps\//.test(path) ? 1 : 0;
  }
  function userApps(apps) {
    var out = [], keys = [], i, key, index, previous;
    for (i = 0; i < apps.length; i++) if (apps[i].classification === 'USER' && apps[i].launchable) {
      key = titleKey(apps[i]); index = keys.indexOf(key);
      if (index < 0) { keys.push(key); out.push(apps[i]); }
      else {
        previous = out[index];
        if (iconRank(apps[i]) > iconRank(previous) || (iconRank(apps[i]) === iconRank(previous) && apps[i].id < previous.id)) out[index] = apps[i];
      }
    }
    return out;
  }
  function advancedApps(apps) {
    var users = userApps(apps), preferred = [], out = [], i;
    for (i = 0; i < users.length; i++) preferred.push(users[i].id);
    for (i = 0; i < apps.length; i++) if (preferred.indexOf(apps[i].id) < 0) out.push(apps[i]);
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
    var users = userApps(apps), pinned = byIds(apps, pins), out = [], i;
    var used = [], blocked = [], key, hiddenApps;
    hidden = hidden || [];
    hiddenApps = byIds(apps, hidden);
    for (i = 0; i < hiddenApps.length; i++) blocked.push(titleKey(hiddenApps[i]));
    for (i = 0; i < pinned.length; i++) {
      key = titleKey(pinned[i]);
      if (used.indexOf(key) < 0 && hidden.indexOf(pinned[i].id) < 0) { out.push(pinned[i]); used.push(key); }
    }
    /* Initial artwork ranking only. Any installed app can be pinned ahead of it. */
    for (i = 0; i < users.length && out.length < limit; i++) if (brand(users[i].title) && used.indexOf(titleKey(users[i])) < 0 && blocked.indexOf(titleKey(users[i])) < 0) { out.push(users[i]); used.push(titleKey(users[i])); }
    /* Unknown apps remain in All Apps and may be pinned; never auto-fill with platform utilities. */
    return out.slice(0, limit);
  }
  function mediaImage(path, size) {
    return typeof path === 'string' && /^\/[a-zA-Z0-9._/-]+$/.test(path) && path.indexOf('..') < 0 && path.indexOf('//') !== 0 ? 'https://image.tmdb.org/t/p/' + (size === 'w1280' ? 'w1280' : 'w500') + path : '';
  }
  function launchRoutes(storage) {
    try {
      var raw = storage.getItem('seenit.tv.launchTargets.v1') || '[]', routes;
      if (raw.length > 65536) return [];
      routes = JSON.parse(raw);
      return Object.prototype.toString.call(routes) === '[object Array]' ? routes.slice(0, 64) : [];
    } catch (e) { return []; }
  }
  function launchTarget(apps, id, storage) {
    var source = byIds(apps, [id])[0], routes = launchRoutes(storage), i, target;
    if (!source) return null;
    for (i = 0; i < routes.length; i++) if (routes[i] && routes[i].source === source.id) {
      target = byIds(apps, [routes[i].target])[0];
      if (target && titleKey(target) === titleKey(source)) return target;
    }
    return source;
  }
  function selectLaunchTarget(apps, id, storage) {
    var chosen = byIds(apps, [id])[0], old = launchRoutes(storage), routes = [], i, source, target;
    if (!chosen) return false;
    for (i = 0; i < apps.length && routes.length < 64; i++) {
      source = byIds(apps, [apps[i].id])[0];
      if (source && source.id !== chosen.id && titleKey(source) === titleKey(chosen)) routes.push({ source: source.id, target: chosen.id });
    }
    for (i = 0; i < old.length && routes.length < 64; i++) if (old[i]) {
      source = byIds(apps, [old[i].source])[0];
      target = byIds(apps, [old[i].target])[0];
      if (source && target && titleKey(source) !== titleKey(chosen) && titleKey(source) === titleKey(target) && source.id !== target.id) routes.push({ source: source.id, target: target.id });
    }
    try { storage.setItem('seenit.tv.launchTargets.v1', JSON.stringify(routes)); return true; } catch (e) { return false; }
  }
  function hasLaunchVariants(apps, id) {
    var chosen = byIds(apps, [id])[0], i;
    if (!chosen) return false;
    for (i = 0; i < apps.length; i++) if (apps[i].id !== id && apps[i].classification === 'USER' && apps[i].launchable && titleKey(apps[i]) === titleKey(chosen)) return true;
    return false;
  }
  function mediaItems(items, filter) {
    var watching = [], planned = [], seen = [], i, item, key;
    for (i = 0; i < items.length && i < 18; i++) {
      item = items[i];
      if (!item || !item.title || !Number(item.tmdbId) || ['tv', 'movie'].indexOf(item.mediaType) < 0 || (filter !== 'all' && item.mediaType !== filter)) continue;
      key = item.mediaType + ':' + item.tmdbId;
      if (seen.indexOf(key) >= 0) continue; seen.push(key);
      if (item.status === 'watching') watching.push(item); else planned.push(item);
    }
    return watching.concat(planned);
  }
  return { brand: brand, localIcon: localIcon, teamArtwork: teamArtwork, initials: initials, preferences: preferences, userApps: userApps, advancedApps: advancedApps, byIds: byIds, favorites: favorites, mediaImage: mediaImage, mediaItems: mediaItems, launchTarget: launchTarget, selectLaunchTarget: selectLaunchTarget, hasLaunchVariants: hasLaunchVariants };
}());
