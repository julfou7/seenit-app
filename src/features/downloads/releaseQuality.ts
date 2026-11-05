export type LightFilter = 'all' | 'light' | 'standard';

/** Le poids seul ne prouve pas qu'une release est Light. */
export function matchesLightFilter(title: string, filter: LightFilter): boolean {
  const explicitLight = /(?:^|[\W_])(?:F?HD|BD|BR|WEB)?[ ._-]*LIGHT(?:$|[\W_])/i.test(title);
  return filter === 'all' || (filter === 'light' ? explicitLight : !explicitLight);
}
