import { CANAL_WEB_URL } from '../../lib/canalExternalUrl.ts';

export type CanalProviderTargetKind = 'provider-app-home';

export interface CanalProviderTarget {
  url: string;
  kind: CanalProviderTargetKind;
}

/**
 * SeenIt ne possède pas de résolution publique fiable
 * mediaType + TMDB ID -> identifiant/lien de contenu CANAL exact.
 *
 * Le CTA reste néanmoins ouvrable : le transport Android ouvre explicitement
 * l'application CANAL+ par son package officiel, tandis que le Web utilise
 * le site CANAL+. Aucun lien de recherche n'est fabriqué.
 */
export function resolveCanalProviderTarget(): CanalProviderTarget {
  return {
    url: CANAL_WEB_URL,
    kind: 'provider-app-home',
  };
}
