import { readWatchProviderCache } from '../providers/watchProviderCache.ts';
import { providerIdForPreferenceId } from '../providers/platformIdentity.ts';
import type { Show } from '../../types.ts';

export function getNotificationProvider(show: Show, selected: readonly number[]): { id: number; name: string } | undefined {
  // Seulement une inclusion FR et un cache frais ; location/achat ou ancien cache ne prouvent rien.
  const payload = readWatchProviderCache(show.tmdbId, show.mediaType)?.data;
  const providers: unknown = payload?.results?.FR?.flatrate;
  if (!Array.isArray(providers)) return undefined;
  for (const preferenceId of selected) {
    const providerId = providerIdForPreferenceId(preferenceId);
    const provider = providers.find(item => Number(item?.provider_id) === providerId);
    if (provider && typeof provider.provider_name === 'string' && provider.provider_name.trim()) {
      return { id: providerId, name: provider.provider_name.trim().slice(0, 50) };
    }
  }
  return undefined;
}
