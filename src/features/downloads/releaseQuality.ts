export type LightFilter = 'all' | 'light' | 'standard';

/** Le poids seul ne prouve pas qu'une release est Light. */
export function matchesLightFilter(title: string, filter: LightFilter): boolean {
  const explicitLight = /(?:^|[\W_])(?:F?HD|BD|BR|WEB)?[ ._-]*LIGHT(?:$|[\W_])/i.test(title);
  return filter === 'all' || (filter === 'light' ? explicitLight : !explicitLight);
}

const RELEASE_NAME_TOKEN = /(?:^|[\W_])(?:\d{3,4}p|4K|UHD|x26[45]|[hH]\.?26[45]|HEVC|AVC|AV1|WEB(?:-?DL|Rip)?|BluRay|BDRip|BRRip|REMUX|HDTV|DVDRip|(?:F?HD|BD|BR|WEB)?[ ._-]*LIGHT)(?:$|[\W_])/i;

/**
 * #293 : variante affichée dans la file, déduite uniquement de la mention explicite de la release (jamais du
 * poids). `null` quand la release n'est pas connue : rien n'est affiché plutôt qu'une variante supposée.
 */
export function releaseVariantLabel(releaseTitle: string | null | undefined): 'HD Light' | 'Standard' | null {
  const title = String(releaseTitle || '').trim();
  // Revue Codex #1003 : avant toute sélection, la demande porte un titre provisoire « Titre • 1080p » ; seul un
  // nom de release réel (sans « • », avec une marque technique) prouve la variante.
  if (!title || title.includes('•') || !RELEASE_NAME_TOKEN.test(title)) return null;
  return matchesLightFilter(title, 'light') ? 'HD Light' : 'Standard';
}
