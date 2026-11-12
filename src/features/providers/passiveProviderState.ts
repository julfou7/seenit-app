import { PLEX_LOGO_SVG, PROVIDER_BRAND_LOGOS } from '../../utils/providerLogos.ts';
import { SEENIT_PLATFORM_BY_KEY } from './platformIdentity.ts';

export interface PassiveProviderState {
  key: string;
  logo: string | null;
  name: string | null;
}

interface PublicProviderSnapshot {
  provider_id?: number;
  logo_path?: string | null;
  provider_name?: string | null;
}

interface PlexProviderSnapshot {
  available: boolean;
  serverName?: string;
}

export function resolvePassiveProviderState(
  key: string,
  publicProvider?: PublicProviderSnapshot | null,
  plexProvider?: PlexProviderSnapshot | null,
  publicResolutionSettled = true,
  preferredProviderIds: readonly number[] = [],
  originalBroadcaster?: unknown,
): PassiveProviderState {
  const hasPublicProvider = Boolean(publicProvider?.logo_path || publicProvider?.provider_name);
  const isPreferred = preferredProviderIds.includes(Number(publicProvider?.provider_id));
  if (hasPublicProvider && (isPreferred || !publicResolutionSettled || !plexProvider?.available)) {
    return {
      key,
      logo: publicProvider.logo_path || null,
      name: publicProvider.provider_name || null,
    };
  }

  // Plex est un fallback personnel, pas un état provisoire pendant que TMDB
  // est encore en cours de résolution. Une absence momentanée de provider
  // public ne constitue donc pas encore une preuve d'absence.
  if (publicResolutionSettled && plexProvider?.available) {
    return {
      key,
      logo: PLEX_LOGO_SVG,
      name: plexProvider.serverName ? `Plex (${plexProvider.serverName})` : 'Plex',
    };
  }

  if (publicResolutionSettled && originalBroadcaster === 'canal'
    && (preferredProviderIds.length === 0 || preferredProviderIds.includes(SEENIT_PLATFORM_BY_KEY.canal.preferenceId))) {
    return { key, logo: PROVIDER_BRAND_LOGOS.canal, name: 'Canal+ · diffuseur d’origine' };
  }

  return { key, logo: null, name: null };
}

export function isPassiveProviderResolutionComplete(
  hasKnownProvider: boolean,
  publicSnapshotFresh: boolean,
): boolean {
  return hasKnownProvider || publicSnapshotFresh;
}

export function arePassiveProviderStatesEqual(
  left: PassiveProviderState,
  right: PassiveProviderState,
): boolean {
  return left.key === right.key && left.logo === right.logo && left.name === right.name;
}
