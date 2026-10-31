export type SeenItPlatformKey = 'netflix' | 'hbo' | 'disney' | 'apple' | 'prime' | 'canal' | 'max' | 'paramount' | 'france' | 'arte';

export interface SeenItPlatformIdentity {
  key: SeenItPlatformKey;
  label: string;
  /** ID historique stocké dans users/<uid>/settings/preferences.platforms et le miroir local. */
  preferenceId: number;
  /** ID courant utilisé dans les requêtes et réponses watch-provider TMDB pour la France. */
  providerId: number;
}

export const SEENIT_PLATFORM_IDENTITIES: readonly SeenItPlatformIdentity[] = [
  { key: 'netflix', label: 'Netflix', preferenceId: 8, providerId: 8 },
  { key: 'hbo', label: 'HBO', preferenceId: 118, providerId: 118 },
  { key: 'disney', label: 'Disney+', preferenceId: 337, providerId: 337 },
  { key: 'apple', label: 'Apple TV+', preferenceId: 350, providerId: 350 },
  { key: 'prime', label: 'Prime Video', preferenceId: 119, providerId: 119 },
  { key: 'canal', label: 'Canal+', preferenceId: 381, providerId: 381 },
  { key: 'max', label: 'Max', preferenceId: 1899, providerId: 1899 },
  { key: 'paramount', label: 'Paramount+', preferenceId: 531, providerId: 531 },
  // Ces deux IDs historiques restent ceux des préférences SeenIt. Le fournisseur TMDB a divergé.
  { key: 'france', label: 'France TV', preferenceId: 234, providerId: 236 },
  { key: 'arte', label: 'Arte', preferenceId: 239, providerId: 234 },
] as const;

export const SEENIT_PLATFORM_BY_KEY = Object.fromEntries(
  SEENIT_PLATFORM_IDENTITIES.map(platform => [platform.key, platform]),
) as Record<SeenItPlatformKey, SeenItPlatformIdentity>;

export function providerIdForPreferenceId(preferenceId: number): number {
  return SEENIT_PLATFORM_IDENTITIES.find(platform => platform.preferenceId === preferenceId)?.providerId ?? preferenceId;
}

export function providerIdsForPreferences(preferenceIds: readonly number[]): number[] {
  return [...new Set(preferenceIds.map(providerIdForPreferenceId))];
}
