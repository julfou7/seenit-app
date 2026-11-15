import { useEffect, useState } from 'react';
import { testServiceConnection } from '../../services/sonarrRadarrTransport';
import { testC411Connection } from '../../services/c411';
import { isDownloadFeatureEnabled } from '../downloads/downloadFeatureVisibility';
import type { ServiceState } from './serviceHealth';

/**
 * #403 — retour du propriétaire du 15/11 : « la météo, je voulais Plex, Sonarr, Radarr etc., toutes les
 * intégrations », pas le serveur SeenIt. Chaque intégration configurée est testée pour de vrai (même test que
 * « Tester » dans les réglages Téléchargements), au plus une fois toutes les 5 minutes pour une même
 * configuration ; une intégration non configurée n'a pas de ligne. Aucune clé n'est affichée.
 */
export type IntegrationKey = 'sonarr' | 'radarr' | 'qbittorrent' | 'c411';
export interface IntegrationConfig {
  isHydrated?: boolean; downloadsEnabled?: boolean;
  sonarrUrl?: string; sonarrApiKey?: string; radarrUrl?: string; radarrApiKey?: string;
  qbittorrentUrl?: string; qbittorrentUsername?: string; qbittorrentPassword?: string; c411ApiKey?: string;
}
export interface IntegrationResult { key: IntegrationKey; label: string; ok: boolean | null }
export interface IntegrationTests {
  service: (type: 'sonarr' | 'radarr' | 'qbittorrent', url: string, apiKey?: string, username?: string, password?: string) => Promise<{ success: boolean }>;
  c411: (apiKey: string) => Promise<{ success: boolean }>;
}

export const INTEGRATION_HEALTH_TTL_MS = 5 * 60 * 1000;
const LABELS: Record<IntegrationKey, string> = { sonarr: 'Sonarr', radarr: 'Radarr', qbittorrent: 'qBittorrent', c411: 'C411' };

export function configuredIntegrations(config: IntegrationConfig): IntegrationKey[] {
  if (!isDownloadFeatureEnabled(config as Parameters<typeof isDownloadFeatureEnabled>[0])) return [];
  const keys: IntegrationKey[] = [];
  if (config.sonarrUrl?.trim() && config.sonarrApiKey?.trim()) keys.push('sonarr');
  if (config.radarrUrl?.trim() && config.radarrApiKey?.trim()) keys.push('radarr');
  if (config.qbittorrentUrl?.trim()) keys.push('qbittorrent');
  if (config.c411ApiKey?.trim()) keys.push('c411');
  return keys;
}

export async function probeIntegrations(config: IntegrationConfig, tests: IntegrationTests = { service: testServiceConnection, c411: testC411Connection }): Promise<IntegrationResult[]> {
  return Promise.all(configuredIntegrations(config).map(async key => {
    const run = key === 'c411' ? tests.c411(config.c411ApiKey!.trim())
      : key === 'qbittorrent' ? tests.service('qbittorrent', config.qbittorrentUrl!, undefined, config.qbittorrentUsername, config.qbittorrentPassword)
        : tests.service(key, key === 'sonarr' ? config.sonarrUrl! : config.radarrUrl!, key === 'sonarr' ? config.sonarrApiKey : config.radarrApiKey);
    const ok = await run.then(result => result.success === true, () => false);
    return { key, label: LABELS[key], ok };
  }));
}

export function describeIntegration(result: IntegrationResult): ServiceState {
  if (result.ok === null) return { text: 'Vérification…', tone: 'busy' };
  return result.ok ? { text: 'Opérationnel', tone: 'ok' } : { text: 'Injoignable · vérifie sa configuration', tone: 'error' };
}

// Empreinte de la configuration testée (jamais conservée en clair) : un changement de serveur ou de clé relance le test.
const fingerprint = (config: IntegrationConfig) => {
  const text = JSON.stringify([config.sonarrUrl, config.sonarrApiKey, config.radarrUrl, config.radarrApiKey, config.qbittorrentUrl, config.qbittorrentUsername, config.qbittorrentPassword, config.c411ApiKey]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
};
let cached: { scope: string; at: number; results: IntegrationResult[] } | null = null;
let inFlight: { scope: string; promise: Promise<IntegrationResult[]> } | null = null;

/** Sonde partagée : un seul test en vol par configuration, résultat réutilisé pendant 5 minutes. */
export function readIntegrationHealth(config: IntegrationConfig, probe: (config: IntegrationConfig) => Promise<IntegrationResult[]> = probeIntegrations, now: () => number = Date.now): Promise<IntegrationResult[]> {
  const scope = fingerprint(config);
  if (cached?.scope === scope && now() - cached.at < INTEGRATION_HEALTH_TTL_MS) return Promise.resolve(cached.results);
  if (inFlight?.scope === scope) return inFlight.promise;
  const promise = probe(config).then(results => { cached = { scope, at: now(), results }; return results; }).finally(() => { if (inFlight?.promise === promise) inFlight = null; });
  inFlight = { scope, promise };
  return promise;
}

export function resetIntegrationHealthCache(): void { cached = null; inFlight = null; }

export function useIntegrationHealth(config: IntegrationConfig): IntegrationResult[] {
  const scope = fingerprint(config);
  const pending = configuredIntegrations(config).map(key => ({ key, label: LABELS[key], ok: null }));
  const [state, setState] = useState<{ scope: string; results: IntegrationResult[] } | null>(() => cached?.scope === scope ? { scope, results: cached.results } : null);
  useEffect(() => {
    let alive = true;
    void readIntegrationHealth(config).then(results => { if (alive) setState({ scope, results }); });
    return () => { alive = false; };
    // La configuration est relue par son empreinte : un nouvel objet identique ne relance rien.
  }, [scope]);
  return state?.scope === scope ? state.results : pending;
}
