export type CanalProviderTargetKind = 'provider-unavailable';

export interface CanalProviderTarget {
  url: null;
  kind: CanalProviderTargetKind;
}

/**
 * CANAL ne fournit pas à SeenIt de résolution publique fiable
 * mediaType + TMDB ID -> identifiant/lien de contenu CANAL exact.
 *
 * Un lien de recherche ou la page TMDB watch/providers peut être intercepté
 * par l'app CANAL et retomber sur une surface générique. Tant qu'une identité
 * fournisseur exacte n'est pas disponible, le diffuseur reste informatif.
 */
export function resolveCanalProviderTarget(): CanalProviderTarget {
  return {
    url: null,
    kind: 'provider-unavailable',
  };
}
