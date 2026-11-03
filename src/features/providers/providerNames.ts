/**
 * Noms de plateformes affichés et dédoublonnage : « Netflix » et « Netflix Standard with Ads » sont une
 * seule plateforme pour l'utilisateur (SEENIT-UX-019). Le premier rencontré l'emporte (abonnement avant pub).
 */
export interface ProviderNameInput {
  provider_name?: string | null;
}

export const getCleanProviderName = (provider: ProviderNameInput) => {
  const providerName = provider.provider_name || '';
  const name = providerName.toLowerCase();
  if (name.includes('netflix')) return 'Netflix';
  if (name.includes('prime') || name.includes('amazon')) return 'Prime Video';
  if (name.includes('disney')) return 'Disney+';
  if (name.includes('canal') || name.includes('mycanal')) return 'Canal+';
  if (name.includes('apple tv') || name.includes('apple')) return 'Apple TV+';
  if (name.includes('paramount')) return 'Paramount+';
  if (name.includes('max') || name.includes('hbo')) return 'Max';
  if (name.includes('france') || name.includes('ftv')) return 'France TV';
  if (name.includes('arte')) return 'Arte';
  return providerName
    .replace(/ à la demande/gi, '')
    .replace(/ Plus/gi, '+')
    .replace(/ Channel/gi, '')
    .replace(/ (?:Standard|Basic|Premium)? ?with ads/gi, '')
    .trim();
};

export function dedupeProvidersByName<T extends ProviderNameInput>(providers: readonly T[]): Array<T & { provider_name: string }> {
  const unique = new Map<string, T & { provider_name: string }>();
  for (const provider of providers) {
    const clean = getCleanProviderName(provider);
    const key = clean.toLowerCase().trim();
    if (key && !unique.has(key)) unique.set(key, { ...provider, provider_name: clean });
  }
  return [...unique.values()];
}
