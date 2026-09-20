export const SEENIT_SERVICE_WORKER_URL = '/firebase-messaging-sw.js';
export const SEENIT_SERVICE_WORKER_SCOPE = '/';

type SeenItServiceWorkerContainer = Pick<ServiceWorkerContainer, 'register'>;

export interface EnsureSeenItServiceWorkerOptions {
  isNativePlatform: boolean;
  serviceWorker?: SeenItServiceWorkerContainer;
}

let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | null = null;
let registrationContainer: SeenItServiceWorkerContainer | undefined;

function getBrowserServiceWorker(): SeenItServiceWorkerContainer | undefined {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  return navigator.serviceWorker;
}

export function resetSeenItServiceWorkerRegistrationForTests(): void {
  registrationPromise = null;
  registrationContainer = undefined;
}

export function ensureSeenItServiceWorkerRegistration({
  isNativePlatform,
  serviceWorker = getBrowserServiceWorker()
}: EnsureSeenItServiceWorkerOptions): Promise<ServiceWorkerRegistration | undefined> {
  if (isNativePlatform || !serviceWorker) return Promise.resolve(undefined);

  if (!registrationPromise || registrationContainer !== serviceWorker) {
    registrationContainer = serviceWorker;
    registrationPromise = serviceWorker
      .register(SEENIT_SERVICE_WORKER_URL, {
        scope: SEENIT_SERVICE_WORKER_SCOPE,
        updateViaCache: 'none'
      })
      .then(async registration => {
        try {
          await registration.update();
        } catch {
          // L'enregistrement reste valide même si le contrôle de mise à jour échoue momentanément.
        }
        return registration;
      })
      .catch(error => {
        registrationPromise = null;
        registrationContainer = undefined;
        throw error;
      });
  }

  return registrationPromise;
}
