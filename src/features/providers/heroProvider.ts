/**
 * SEENIT-PROVIDER-003 — Retour terrain du 08/11 : un seul diffuseur à côté du bouton principal de la fiche.
 * D'abord une plateforme choisie dans les réglages et disponible pour ce titre, sinon Plex quand le titre y
 * est. Un diffuseur public non choisi n'y apparaît jamais : il reste listé dans « Où regarder ».
 */
export function pickHeroProvider<T extends { provider_id: number; isPlex?: boolean }>(providers: readonly T[], userPlatforms: readonly number[]): T | undefined {
  return providers.find(provider => !provider.isPlex && userPlatforms.includes(provider.provider_id))
    || providers.find(provider => provider.isPlex);
}
