import { authenticatedFetch } from '../../lib/apiAuth';
import { SEENIT_PLATFORM_IDENTITIES } from './platformIdentity.ts';

/** Logos stables disponibles sans réseau, indexés par ID de préférence SeenIt. */
const KNOWN_PLATFORM_LOGOS: Record<number, string> = {
  8: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg',
  119: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg',
  337: '/97yvRBw1GzX7fXprcF80er19ot.jpg',
  350: '/2E03IAZsX4ZaUqM7tXlctEPMGWS.jpg',
  381: '/brand/providers/canalplus.svg',
  1899: '/fksCUZ9QDWZMUwL2LgMtLckROUN.jpg',
};

// v2 : le cache est désormais indexé par ID de préférence SeenIt, pas par ID fournisseur brut TMDB.
const CATALOG_KEY = 'seenit_platform_logos_v2';
const CATALOG_TTL_MS = 30 * 24 * 60 * 60_000;

export function platformLogoUrl(path: string | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('/brand/') || path.startsWith('http') || path.startsWith('data:')) return path;
  return `https://image.tmdb.org/t/p/w92${path}`;
}

function readCatalog(): Record<number, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null') as { fetchedAt?: number; logos?: Record<number, string> } | null;
    return stored?.logos && typeof stored.logos === 'object' ? stored.logos : {};
  } catch {
    return {};
  }
}

function indexCatalogByPreference(rawLogos: Record<number, string>): Record<number, string> {
  const logos: Record<number, string> = {};
  for (const platform of SEENIT_PLATFORM_IDENTITIES) {
    const logo = rawLogos[platform.providerId];
    if (logo) logos[platform.preferenceId] = logo;
  }
  return logos;
}

/** Logos connus puis, s'ils ont déjà été lus, ceux du catalogue TMDB France (données publiques). */
export function readPlatformLogos(): Record<number, string> {
  return { ...readCatalog(), ...KNOWN_PLATFORM_LOGOS };
}

/** Catalogue TMDB des plateformes en France, gardé 30 jours sur l'appareil ; un échec garde les logos connus. */
export async function loadPlatformLogos(ids: readonly number[]): Promise<Record<number, string>> {
  const current = readPlatformLogos();
  let fresh = false;
  try {
    const stored = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null') as { fetchedAt?: number } | null;
    fresh = Boolean(stored?.fetchedAt && Date.now() - stored.fetchedAt < CATALOG_TTL_MS);
  } catch {}
  if (fresh || ids.every(id => current[id])) return current;
  try {
    const response = await authenticatedFetch('/api/media/tmdb/watch/providers/tv?language=fr-FR&watch_region=FR');
    if (!response.ok) return current;
    const data = await response.json() as { results?: Array<{ provider_id?: number; logo_path?: string }> };
    const rawLogos: Record<number, string> = {};
    for (const provider of data.results || []) {
      if (Number.isInteger(provider.provider_id) && typeof provider.logo_path === 'string' && provider.logo_path.startsWith('/')) rawLogos[provider.provider_id!] = provider.logo_path;
    }
    const logos = indexCatalogByPreference(rawLogos);
    try { localStorage.setItem(CATALOG_KEY, JSON.stringify({ fetchedAt: Date.now(), logos })); } catch {}
    return { ...logos, ...KNOWN_PLATFORM_LOGOS };
  } catch {
    return current;
  }
}
