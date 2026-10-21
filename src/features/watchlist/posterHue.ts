export const POSTER_HUE_FALLBACK = 260;
export const POSTER_HUE_CACHE_LIMIT = 128;
const STORAGE_KEY = 'seenit.poster-hues.v1';
const cache = new Map<string, number>();
let hydrated = false;

export function dominantPosterHue(pixels: ArrayLike<number>): number {
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, hues: 0 }));
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
    const high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
    if (high < 0.12 || delta < 0.12 || delta / high < 0.18) continue;
    let hue = high === r ? ((g - b) / delta) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    const weight = delta * high;
    const bin = bins[Math.floor(hue / 30)];
    bin.weight += weight;
    bin.hues += hue * weight;
  }
  const winner = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best);
  return winner.weight > 0 ? Math.round(winner.hues / winner.weight) : POSTER_HUE_FALLBACK;
}

export function readPosterHue(url: string | null): number | undefined {
  if (!hydrated) {
    hydrated = true;
    try {
      const entries: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(entries)) {
        for (const entry of entries.slice(-POSTER_HUE_CACHE_LIMIT)) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' && entry[1] >= 0 && entry[1] <= 360) cache.set(entry[0], entry[1]);
        }
      }
    } catch { /* Une indisponibilité du stockage conserve la teinte de secours. */ }
  }
  return url ? cache.get(url) : undefined;
}

export function rememberPosterHue(url: string, hue: number) {
  cache.delete(url);
  cache.set(url, hue);
  while (cache.size > POSTER_HUE_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache])); } catch { /* Cache mémoire suffisant. */ }
}
