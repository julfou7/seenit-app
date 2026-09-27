import { authenticatedFetch } from '../../lib/apiAuth';
import {
  cleanUrl,
  executeGet,
  executePost,
  executePut
} from '../../services/sonarrRadarrTransport';
import type { DownloadClientConfig } from './downloadConfigBoundary';

export type ArrService = 'sonarr' | 'radarr';

export const SEENIT_MANAGED_WEBHOOK_NAME = 'SeenIt notifications (managed)';

interface ArrNotificationField extends Record<string, unknown> {
  name?: string;
  value?: unknown;
}

interface ArrNotificationResource extends Record<string, unknown> {
  id?: number;
  name?: string;
  implementation?: string;
  configContract?: string;
  fields?: ArrNotificationField[];
  tags?: number[];
  onDownload?: boolean;
  onUpgrade?: boolean;
}

interface ArrProvisionTransport {
  get: (url: string, headers: Record<string, string>) => Promise<unknown>;
  post: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;
  put: (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;
}

export interface ArrWebhookProvisionResult {
  service: ArrService;
  action: 'created' | 'updated' | 'unchanged' | 'skipped';
}

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

function toNotificationArray(value: unknown): ArrNotificationResource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item !== null && typeof item === 'object') as ArrNotificationResource[];
}

function findField(fields: ArrNotificationField[] | undefined, name: string): ArrNotificationField | undefined {
  return fields?.find(field => String(field.name || '').toLowerCase() === name.toLowerCase());
}

function patchField(
  fields: ArrNotificationField[] | undefined,
  name: string,
  value: unknown
): ArrNotificationField[] {
  const source = Array.isArray(fields) ? fields : [];
  let found = false;
  const next = source.map(field => {
    if (String(field.name || '').toLowerCase() !== name.toLowerCase()) return { ...field };
    found = true;
    return { ...field, value };
  });
  if (!found) next.push({ name, value });
  return next;
}

function normalizeHeaderPairs(value: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(value)) return [];
  const pairs: Array<{ key: string; value: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    const headerValue = typeof record.value === 'string' ? record.value : '';
    if (key) pairs.push({ key, value: headerValue });
  }
  return pairs;
}

export function buildSeenItManagedWebhook(params: {
  schema: ArrNotificationResource;
  existing?: ArrNotificationResource;
  webhookUrl: string;
  headerName: string;
  secret: string;
}): ArrNotificationResource {
  const { schema, existing, webhookUrl, headerName, secret } = params;
  let fields = patchField(schema.fields, 'url', webhookUrl);
  fields = patchField(fields, 'method', 1);
  fields = patchField(fields, 'username', '');
  fields = patchField(fields, 'password', '');
  fields = patchField(fields, 'headers', [{ key: headerName, value: secret }]);

  return {
    ...schema,
    ...(existing?.id ? { id: existing.id } : { id: 0 }),
    name: SEENIT_MANAGED_WEBHOOK_NAME,
    implementation: 'Webhook',
    configContract: schema.configContract || existing?.configContract || 'WebhookSettings',
    fields,
    tags: existing?.tags || schema.tags || [],
    onGrab: false,
    onDownload: true,
    onUpgrade: true,
    onImportComplete: false,
    onRename: false,
    onSeriesAdd: false,
    onSeriesDelete: false,
    onEpisodeFileDelete: false,
    onEpisodeFileDeleteForUpgrade: false,
    onMovieAdded: false,
    onMovieDelete: false,
    onMovieFileDelete: false,
    onMovieFileDeleteForUpgrade: false,
    onHealthIssue: false,
    includeHealthWarnings: false,
    onHealthRestored: false,
    onApplicationUpdate: false,
    onManualInteractionRequired: false,
    presets: []
  };
}

export function isSeenItManagedWebhookCurrent(params: {
  notification: ArrNotificationResource;
  webhookUrl: string;
  headerName: string;
  secret: string;
}): boolean {
  const { notification, webhookUrl, headerName, secret } = params;
  if (notification.name !== SEENIT_MANAGED_WEBHOOK_NAME || notification.implementation !== 'Webhook') {
    return false;
  }
  if (notification.onDownload !== true || notification.onUpgrade !== true) return false;

  const url = String(findField(notification.fields, 'url')?.value || '').trim();
  const method = Number(findField(notification.fields, 'method')?.value);
  const headers = normalizeHeaderPairs(findField(notification.fields, 'headers')?.value);
  const hasSecretHeader = headers.some(
    pair => pair.key.toLowerCase() === headerName.toLowerCase() && pair.value === secret
  );
  return url === webhookUrl && method === 1 && hasSecretHeader;
}

function findManagedWebhook(items: ArrNotificationResource[]): ArrNotificationResource | undefined {
  return items.find(
    item => item.name === SEENIT_MANAGED_WEBHOOK_NAME && item.implementation === 'Webhook'
  );
}

function findWebhookSchema(items: ArrNotificationResource[]): ArrNotificationResource | undefined {
  return items.find(item => item.implementation === 'Webhook');
}

export async function ensureArrManagedWebhook(params: {
  service: ArrService;
  baseUrl: string;
  apiKey: string;
  webhookUrl: string;
  headerName: string;
  secret: string;
  transport?: ArrProvisionTransport;
}): Promise<ArrWebhookProvisionResult> {
  const { service, apiKey, webhookUrl, headerName, secret } = params;
  const baseUrl = cleanUrl(params.baseUrl);
  if (!baseUrl || !apiKey.trim()) return { service, action: 'skipped' };

  const transport = params.transport || defaultTransport;
  const headers = {
    'X-Api-Key': apiKey.trim(),
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };
  const notificationsUrl = `${baseUrl}/api/v3/notification`;
  const schemaUrl = `${notificationsUrl}/schema`;

  const [rawNotifications, rawSchemas] = await Promise.all([
    transport.get(notificationsUrl, headers),
    transport.get(schemaUrl, headers)
  ]);
  const notifications = toNotificationArray(rawNotifications);
  const schemas = toNotificationArray(rawSchemas);
  const schema = findWebhookSchema(schemas);
  if (!schema) throw new Error(`Schéma Webhook ${service} indisponible`);

  const existing = findManagedWebhook(notifications);
  if (existing && isSeenItManagedWebhookCurrent({ notification: existing, webhookUrl, headerName, secret })) {
    return { service, action: 'unchanged' };
  }

  const payload = buildSeenItManagedWebhook({ schema, existing, webhookUrl, headerName, secret });

  if (existing?.id && Number.isInteger(existing.id)) {
    await transport.put(`${notificationsUrl}/${existing.id}`, payload, headers);
    return { service, action: 'updated' };
  }

  try {
    await transport.post(notificationsUrl, payload, headers);
    return { service, action: 'created' };
  } catch (createError) {
    const retryNotifications = toNotificationArray(await transport.get(notificationsUrl, headers));
    const concurrentlyCreated = findManagedWebhook(retryNotifications);
    if (!concurrentlyCreated?.id) throw createError;
    if (isSeenItManagedWebhookCurrent({
      notification: concurrentlyCreated,
      webhookUrl,
      headerName,
      secret
    })) {
      return { service, action: 'unchanged' };
    }
    const repairPayload = buildSeenItManagedWebhook({
      schema,
      existing: concurrentlyCreated,
      webhookUrl,
      headerName,
      secret
    });
    await transport.put(`${notificationsUrl}/${concurrentlyCreated.id}`, repairPayload, headers);
    return { service, action: 'updated' };
  }
}

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
        secret: personal.secret
      });
    } catch {
      return { service: target.service, action: 'failed' as const };
    }
  }));
}
