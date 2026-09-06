import type { Application } from 'express';
import { registerMediaProviderRoutes } from '../providers/mediaProviderBackend.ts';
import { installAsyncRouteForwarding as installCoreAsyncRouteForwarding } from './backendRuntimeCore.ts';

export * from './backendRuntimeCore.ts';

/**
 * Point d'installation unique du runtime HTTP SeenIt. Le runtime historique reste
 * inchangé dans backendRuntimeCore ; la façade fournisseurs est ajoutée ici avant
 * les routes applicatives afin de partager le même serveur PWA/APK.
 */
export function installAsyncRouteForwarding(app: Application): void {
  installCoreAsyncRouteForwarding(app);
  registerMediaProviderRoutes(app);
}
