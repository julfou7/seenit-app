import { authenticatedFetch } from '../../lib/apiAuth';
import {
  cleanUrl,
  executeGet,
  executePost,
  executePut
} from '../../services/sonarrRadarrTransport';
import type { DownloadClientConfig } from './downloadConfigBoundary';
import {
  ensureArrManagedWebhook,
  type ArrProvisionTransport,
  type ArrService,
  type ArrWebhookProvisionResult
} from './downloadWebhookProvisioningPolicy';

export {
  buildSeenItManagedWebhook,
  ensureArrManagedWebhook,
  isSeenItManagedWebhookCurrent,
  SEENIT_MANAGED_WEBHOOK_NAME
} from './downloadWebhookProvisioningPolicy';
export type {
  ArrNotificationField,
  ArrNotificationResource,
  ArrProvisionTransport,
  ArrService,
  ArrWebhookProvisionResult
} from './downloadWebhookProvisioningPolicy';

export interface DownloadWebhookProvisionResult {
  service: ArrService;
  action: ArrWebhookProvisionResult['action'] | 'failed';
}

interface PersonalWebhookConfig {
  sonarrUrl: string;
  radarrUrl: string;
  headerName: string;
  secret: string;
}

const defaultTransport: ArrProvisionTransport = {
  get: executeGet,
  post: executePost,
  put: executePut
};

async function loadPersonalWebhookConfig(): Promise<PersonalWebhookConfig> {
  const response = await authenticatedFetch('/api/webhooks/config', { method: 'GET' });
  const data: unknown = await response.json();
  if (!response.ok || !data || typeof data !== 'object') {
    throw new Error('Configuration webhook SeenIt indisponible');
  }
  const record = data as Record<string, unknown>;
  const config: PersonalWebhookConfig = {
    sonarrUrl: typeof record.sonarrUrl === 'string' ? record.sonarrUrl : '',
    radarrUrl: typeof record.radarrUrl === 'string' ? record.radarrUrl : '',
    headerName: typeof record.headerName === 'string' ? record.headerName : '',
    secret: typeof record.secret === 'string' ? record.secret : ''
  };
  if (!config.sonarrUrl || !config.radarrUrl || !config.headerName || !config.secret) {
    throw new Error('Configuration webhook SeenIt incomplète');
  }
  return config;
}

export async function ensureDownloadNotificationWebhooks(
  config: DownloadClientConfig
): Promise<DownloadWebhookProvisionResult[]> {
  if (config.downloadsEnabled !== true) return [];

  const personal = await loadPersonalWebhookConfig();
  const targets = [
    {
      service: 'sonarr' as const,
      baseUrl: config.sonarrUrl || '',
      apiKey: config.sonarrApiKey || '',
      webhookUrl: personal.sonarrUrl
    },
    {
      service: 'radarr' as const,
      baseUrl: config.radarrUrl || '',
      apiKey: config.radarrApiKey || '',
      webhookUrl: personal.radarrUrl
    }
  ].filter(target => cleanUrl(target.baseUrl) && target.apiKey.trim());

  return Promise.all(targets.map(async target => {
    try {
      return await ensureArrManagedWebhook({
        ...target,
        headerName: personal.headerName,
        secret: personal.secret,
        transport: defaultTransport
      });
    } catch {
      return { service: target.service, action: 'failed' as const };
    }
  }));
}
