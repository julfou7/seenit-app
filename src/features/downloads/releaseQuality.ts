export type LightFilter = 'all' | 'light' | 'standard';

/** Le poids seul ne prouve pas qu'une release est Light. */
export function matchesLightFilter(title: string, filter: LightFilter): boolean {
  const explicitLight = /(?:^|[\W_])(?:F?HD|BD|BR|WEB)?[ ._-]*LIGHT(?:$|[\W_])/i.test(title);
  return filter === 'all' || (filter === 'light' ? explicitLight : !explicitLight);
}

/**
 * #293 : variante affichée dans la file, déduite uniquement de la mention explicite de la release (jamais du
 * poids). `null` quand la release n'est pas connue : rien n'est affiché plutôt qu'une variante supposée.
 */
export function releaseVariantLabel(releaseTitle: string | null | undefined): 'HD Light' | 'Standard' | null {
  const title = String(releaseTitle || '').trim();
  if (!title) return null;
  return matchesLightFilter(title, 'light') ? 'HD Light' : 'Standard';
}
