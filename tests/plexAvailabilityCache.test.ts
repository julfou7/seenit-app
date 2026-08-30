import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlexMediaUrl, replacePlexUserCache } from '../src/features/plex/plexAvailabilityCache.ts';

test('remplace atomiquement un gros cache Plex sans toucher aux autres utilisateurs', () => {
  const currentCache: Record<string, { available: boolean }> = {
    'v3:user-a:movie:1': { available: true },
    'v3:user-b:movie:2': { available: true }
  };
  const replacementCache: Record<string, { available: boolean }> = {};

  for (let index = 0; index < 7269; index++) {
    replacementCache[`v3:user-a:movie:${index + 100}`] = { available: true };
  }
  replacementCache['v3:user-b:movie:999'] = { available: false };

  const nextCache = replacePlexUserCache(currentCache, 'user-a', replacementCache);

  assert.equal(Object.keys(nextCache).length, 7270);
  assert.equal(nextCache['v3:user-a:movie:1'], undefined);
  assert.deepEqual(nextCache['v3:user-b:movie:2'], { available: true });
  assert.equal(nextCache['v3:user-b:movie:999'], undefined);
  assert.deepEqual(currentCache['v3:user-a:movie:1'], { available: true });
});

test('reconstruit à la demande le lien Plex depuis ses identifiants techniques', () => {
  assert.equal(
    buildPlexMediaUrl('server-123', '456/segment'),
    'https://app.plex.tv/desktop/#!/server/server-123/details?key=%2Flibrary%2Fmetadata%2F456%2Fsegment'
  );
});
