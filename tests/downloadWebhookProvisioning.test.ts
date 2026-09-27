import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEENIT_MANAGED_WEBHOOK_NAME,
  ensureArrManagedWebhook
} from '../src/features/downloads/downloadWebhookProvisioning.ts';

function webhookSchema() {
  return {
    id: 0,
    name: 'Webhook',
    implementation: 'Webhook',
    implementationName: 'Webhook',
    configContract: 'WebhookSettings',
    fields: [
      { name: 'url', value: '' },
      { name: 'method', value: 1 },
      { name: 'username', value: '' },
      { name: 'password', value: '' },
      { name: 'headers', value: [] }
    ],
    tags: [],
    onDownload: false,
    onUpgrade: false
  };
}

test('SEENIT-NOTIFICATION-003 installe automatiquement le webhook Arr manquant', async () => {
  const posts: Array<Record<string, unknown>> = [];
  const result = await ensureArrManagedWebhook({
    service: 'radarr',
    baseUrl: 'http://192.168.1.50:7878/',
    apiKey: 'radarr-key',
    webhookUrl: 'https://seenit.ai.studio/api/webhook/radarr/endpoint-a',
    headerName: 'x-seenit-webhook-secret',
    secret: 'secret-a',
    transport: {
      get: async url => url.endsWith('/schema') ? [webhookSchema()] : [],
      post: async (_url, body) => {
        posts.push(body as Record<string, unknown>);
        return { id: 42 };
      },
      put: async () => {
        throw new Error('PUT inattendu');
      }
    }
  });

  assert.equal(result.action, 'created');
  assert.equal(posts.length, 1);
  const created = posts[0];
  assert.equal(created.name, SEENIT_MANAGED_WEBHOOK_NAME);
  assert.equal(created.onDownload, true);
  assert.equal(created.onUpgrade, true);
  const fields = created.fields as Array<{ name: string; value: unknown }>;
  assert.equal(fields.find(field => field.name === 'url')?.value, 'https://seenit.ai.studio/api/webhook/radarr/endpoint-a');
  assert.equal(fields.find(field => field.name === 'method')?.value, 1);
  assert.deepEqual(fields.find(field => field.name === 'headers')?.value, [
    { key: 'x-seenit-webhook-secret', value: 'secret-a' }
  ]);
});

test('SEENIT-NOTIFICATION-003 répare le webhook géré sans dupliquer ni toucher les autres Connect', async () => {
  const unrelated = {
    id: 7,
    name: 'Discord perso',
    implementation: 'Discord',
    fields: []
  };
  const staleManaged = {
    id: 9,
    name: SEENIT_MANAGED_WEBHOOK_NAME,
    implementation: 'Webhook',
    configContract: 'WebhookSettings',
    fields: [
      { name: 'url', value: 'https://seenit.ai.studio/api/webhook/radarr/old' },
      { name: 'method', value: 1 },
      { name: 'headers', value: [{ key: 'x-seenit-webhook-secret', value: 'old-secret' }] }
    ],
    onDownload: true,
    onUpgrade: true,
    tags: []
  };
  const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
  let posts = 0;

  const result = await ensureArrManagedWebhook({
    service: 'radarr',
    baseUrl: 'http://192.168.1.50:7878',
    apiKey: 'radarr-key',
    webhookUrl: 'https://seenit.ai.studio/api/webhook/radarr/current',
    headerName: 'x-seenit-webhook-secret',
    secret: 'current-secret',
    transport: {
      get: async url => url.endsWith('/schema') ? [webhookSchema()] : [unrelated, staleManaged],
      post: async () => {
        posts += 1;
        return {};
      },
      put: async (url, body) => {
        puts.push({ url, body: body as Record<string, unknown> });
        return {};
      }
    }
  });

  assert.equal(result.action, 'updated');
  assert.equal(posts, 0);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].url.endsWith('/api/v3/notification/9'), true);
  assert.equal(puts[0].body.id, 9);
  assert.equal(unrelated.name, 'Discord perso');
});

test('le provisioning Arr est idempotent quand le webhook SeenIt est déjà courant', async () => {
  const current = {
    id: 11,
    name: SEENIT_MANAGED_WEBHOOK_NAME,
    implementation: 'Webhook',
    configContract: 'WebhookSettings',
    fields: [
      { name: 'url', value: 'https://seenit.ai.studio/api/webhook/sonarr/endpoint-a' },
      { name: 'method', value: 1 },
      { name: 'headers', value: [{ key: 'x-seenit-webhook-secret', value: 'secret-a' }] }
    ],
    onDownload: true,
    onUpgrade: true,
    tags: []
  };
  let mutations = 0;

  const result = await ensureArrManagedWebhook({
    service: 'sonarr',
    baseUrl: 'http://192.168.1.50:8989',
    apiKey: 'sonarr-key',
    webhookUrl: 'https://seenit.ai.studio/api/webhook/sonarr/endpoint-a',
    headerName: 'x-seenit-webhook-secret',
    secret: 'secret-a',
    transport: {
      get: async url => url.endsWith('/schema') ? [webhookSchema()] : [current],
      post: async () => {
        mutations += 1;
        return {};
      },
      put: async () => {
        mutations += 1;
        return {};
      }
    }
  });

  assert.equal(result.action, 'unchanged');
  assert.equal(mutations, 0);
});
