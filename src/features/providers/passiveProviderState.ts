import { CANAL_ORIGINAL_BROADCASTER_NAME, PLEX_LOGO_SVG, PROVIDER_BRAND_LOGOS } from '../../utils/providerLogos.ts';
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
    return { key, logo: PROVIDER_BRAND_LOGOS.canal, name: CANAL_ORIGINAL_BROADCASTER_NAME };
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

/**
 * SEENIT-PROVIDER-002 (#965, retour v1.4.303) : point unique de lecture du diffuseur d'origine porté par le lot de
 * diffuseurs. Cartes, fiche série, fiche épisode, profil acteur et filtre de recherche passent tous par ici : la
 * détection est la même partout, seul l'affichage change.
 */
export function originalBroadcasterOf(payload: unknown): 'canal' | null {
  return (payload as { originalBroadcaster?: unknown } | null | undefined)?.originalBroadcaster === 'canal' ? 'canal' : null;
}

/** Identifiants de plateforme « Mes plateformes » que vaut le diffuseur d'origine (filtre de recherche). */
export function originalBroadcasterPlatformIds(payload: unknown): number[] {
  return originalBroadcasterOf(payload) === 'canal' ? [SEENIT_PLATFORM_BY_KEY.canal.preferenceId] : [];
}

/** Ligne « Où regarder » du diffuseur d'origine ; le lien ne s'ouvre que vers une page canalplus.com. */
export function originalBroadcasterRow(payload: unknown, homepage?: string | null): { name: string; logo: string; link?: string } | null {
  if (originalBroadcasterOf(payload) !== 'canal') return null;
  const link = typeof homepage === 'string' && /^https:\/\/(?:www\.)?canalplus\.com\//.test(homepage) ? homepage : undefined;
  return { name: 'Canal+', logo: PROVIDER_BRAND_LOGOS.canal, ...(link ? { link } : {}) };
}
