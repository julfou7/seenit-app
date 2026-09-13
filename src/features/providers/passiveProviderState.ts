import { PLEX_LOGO_SVG } from '../../utils/providerLogos.ts';

export interface PassiveProviderState {
  key: string;
  logo: string | null;
  name: string | null;
}

interface PublicProviderSnapshot {
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
): PassiveProviderState {
  if (publicProvider?.logo_path || publicProvider?.provider_name) {
    return {
      key,
      logo: publicProvider.logo_path || null,
      name: publicProvider.provider_name || null,
    };
  }

  if (plexProvider?.available) {
    return {
      key,
      logo: PLEX_LOGO_SVG,
      name: plexProvider.serverName ? `Plex (${plexProvider.serverName})` : 'Plex',
    };
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
