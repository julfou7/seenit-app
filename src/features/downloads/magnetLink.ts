const BTIH_PATTERN = /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i;

const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://9.rarbg.com:2810/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce'
];

export function normalizeBtih(value: unknown): string | null {
  const hash = String(value || '').trim();
  return BTIH_PATTERN.test(hash) ? hash.toLowerCase() : null;
}

export function buildMagnetLink(infoHash: unknown, name: unknown): string | null {
  const hash = normalizeBtih(infoHash);
  if (!hash) return null;

  const trackers = PUBLIC_TRACKERS
    .map(tracker => `&tr=${encodeURIComponent(tracker)}`)
    .join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(String(name || ''))}${trackers}`;
}

export function getMagnetInfoHash(value: unknown): string | null {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'magnet:') return null;

    for (const exactTopic of url.searchParams.getAll('xt')) {
      const match = exactTopic.match(/^urn:btih:(.+)$/i);
      const hash = match ? normalizeBtih(match[1]) : null;
      if (hash) return hash;
    }
  } catch {}
  return null;
}

export function isSafeMagnetLink(value: unknown): value is string {
  return getMagnetInfoHash(value) !== null;
}
