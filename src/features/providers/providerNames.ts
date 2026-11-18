/**
 * Noms de plateformes affichés et dédoublonnage : « Netflix » et « Netflix Standard with Ads » sont une
 * seule plateforme pour l'utilisateur (SEENIT-UX-019). Le premier rencontré l'emporte (abonnement avant pub).
 */
export interface ProviderNameInput {
  provider_name?: string | null;
}

/**
 * Retour terrain du 18/11 (Dexter: Resurrection) : « Paramount+ Amazon Channel » et « Paramount Plus Apple TV Channel »
 * s'affichaient « Prime Video » et « Apple TV+ », qui ne diffusent pas la série (Prime n'y vend que l'épisode et
 * l'abonnement Paramount+). Une chaîne vendue par une boutique (Amazon, Apple TV, Roku, YouTube) est le service
 * qu'elle vend : elle en prend le nom, et le dédoublonnage la range sous ce service.
 */
const STORE_CHANNEL = /\s+(?:amazon|apple\s*tv|roku(?:\s+premium)?|youtube|prime\s+video)\s+channels?$/i;
export const storeChannelService = (providerName: string): string | null => {
  const name = providerName.trim();
  const service = name.replace(STORE_CHANNEL, '').trim();
  return service && service !== name ? service : null;
};

export const getCleanProviderName = (provider: ProviderNameInput): string => {
  const providerName = (provider.provider_name || '').trim();
  const service = storeChannelService(providerName);
  if (service) return getCleanProviderName({ provider_name: service });
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
  const unique = new Map<string, { entry: T & { provider_name: string }; channel: boolean }>();
  for (const provider of providers) {
    const clean = getCleanProviderName(provider);
    const key = clean.toLowerCase().trim();
    if (!key) continue;
    const channel = storeChannelService(provider.provider_name || '') !== null;
    const current = unique.get(key);
    // Le service direct l'emporte sur sa chaîne vendue en boutique (logo, identifiant, abonnement), à la même place.
    if (!current || (current.channel && !channel)) unique.set(key, { entry: { ...provider, provider_name: clean }, channel });
  }
  return [...unique.values()].map(value => value.entry);
}
