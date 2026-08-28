const fs = require('fs');
const file = 'src/features/plex/plexAvailability.ts';
let content = fs.readFileSync(file, 'utf8');

const replacement = `
  const urlsToTry = isNative 
    ? [...PLEX_ENDPOINTS] 
    : ['/api/plex/availability', ...PLEX_ENDPOINTS];

  const payload = {
    token: plexToken,
    clientId,
    tmdbId: tmdbId ? Number(tmdbId) : undefined,
    imdbId,
    title,
    originalTitle,
    year: year ? Number(year) : undefined,
    mediaType
  };

  const tryUrl = async (url: string) => {
    if (isNative && url === '/api/plex/availability') throw new Error('Skip relative on native');
    let data: any = null;
    let isOk = false;

    if (isNative) {
      const nativeRes = await CapacitorHttp.post({
        url,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        data: payload,
        connectTimeout: 4000,
        readTimeout: 4000
      });
      isOk = nativeRes.status >= 200 && nativeRes.status < 300;
      if (isOk) {
        data = typeof nativeRes.data === 'string' ? JSON.parse(nativeRes.data) : nativeRes.data;
      }
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);
      isOk = res.ok;
      if (isOk) {
        data = await res.json();
      }
    }

    if (isOk && data) {
      if (data.available) {
        return {
          available: true,
          serverName: data.serverName,
          serverId: data.serverId,
          ratingKey: data.ratingKey,
          plexUrl: data.plexUrl,
          watchUrl: data.watchUrl || 'https://watch.plex.tv',
          title: data.title || title,
          year: data.year || year,
          lastChecked: now
        };
      }
      return { available: false, lastChecked: now };
    }
    throw new Error('Not found or error');
  };

  // Run cloud endpoints and direct client check in parallel for maximum speed
  try {
    const tasks = [
      checkPlexDirectFromDevice({
        token: plexToken,
        clientId,
        tmdbId,
        imdbId,
        title,
        originalTitle,
        year,
        mediaType
      }).then(res => {
         if (res && res.available) {
           return res;
         }
         throw new Error('Direct check failed or not available');
      }),
      ...urlsToTry.map(url => tryUrl(url).then(res => {
         if (res.available) return res;
         throw new Error('Cloud check failed or not available');
      }))
    ];

    const winner = await Promise.any(tasks);
    if (winner && winner.available) {
      store.setMediaAvailability(key, winner);
      return winner;
    }
  } catch (e) {
    // All checks threw (not available or errors)
  }

  const notAvailable: PlexMediaInfo = { available: false, lastChecked: now };
  store.setMediaAvailability(key, notAvailable);
  return notAvailable;
`;

const regex = /\/\/ 1\. Try via Cloud \/ Express API proxy[\s\S]*?store\.setMediaAvailability\(key, notAvailable\);\n  return notAvailable;/;
content = content.replace(regex, replacement.trim());
fs.writeFileSync(file, content);
