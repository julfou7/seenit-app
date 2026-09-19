import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationMediaPrivateRef,
  resolveNotificationMediaVisual,
  type NotificationMediaDependencies,
} from '../src/features/notifications/notificationMedia.ts';

function createFakeDependencies(options: { failuresBeforeSuccess?: number } = {}) {
  const files = new Map<string, number>();
  let downloads = 0;
  let failures = options.failuresBeforeSuccess ?? 0;

  const filesystem: NotificationMediaDependencies['filesystem'] = {
    async mkdir() {},
    async stat({ path }: any) {
      const size = files.get(path);
      if (!size) throw new Error('ENOENT');
      return { type: 'file', size };
    },
    async deleteFile({ path }: any) {
      files.delete(path);
    },
    async downloadFile({ path }: any) {
      downloads += 1;
      if (failures > 0) {
        failures -= 1;
        throw new Error('TRANSIENT_NETWORK');
      }
      files.set(path, 64 * 1024);
    },
  };

  const dependencies: Partial<NotificationMediaDependencies> = {
    isNativePlatform: () => true,
    filesystem,
    sleep: async () => undefined,
  };

  return {
    dependencies,
    getDownloads: () => downloads,
  };
}

test('issue #106 retente un cache miss puis réutilise durablement le fichier sans nouveau téléchargement', async () => {
  const poster = 'https://image.tmdb.org/t/p/w342/poster.jpg';
  const fake = createFakeDependencies({ failuresBeforeSuccess: 1 });

  const first = await resolveNotificationMediaVisual(poster, undefined, fake.dependencies);
  assert.deepEqual(first, {
    icon: notificationMediaPrivateRef(poster),
    image: notificationMediaPrivateRef(poster),
  });
  assert.equal(fake.getDownloads(), 2, 'la première erreur transitoire doit être retentée');

  const second = await resolveNotificationMediaVisual(poster, undefined, fake.dependencies);
  assert.deepEqual(second, first);
  assert.equal(fake.getDownloads(), 2, 'un hit du cache privé ne doit jamais re-télécharger TMDB');
});

test('issue #106 coalesce deux demandes simultanées vers une seule matérialisation', async () => {
  const poster = 'https://image.tmdb.org/t/p/w342/shared.jpg';
  const fake = createFakeDependencies();

  const [first, second] = await Promise.all([
    resolveNotificationMediaVisual(poster, undefined, fake.dependencies),
    resolveNotificationMediaVisual(poster, undefined, fake.dependencies),
  ]);

  assert.deepEqual(first, second);
  assert.equal(fake.getDownloads(), 1);
});

test('issue #106 conserve le fallback texte après épuisement des retries', async () => {
  const poster = 'https://image.tmdb.org/t/p/w342/offline.jpg';
  const fake = createFakeDependencies({ failuresBeforeSuccess: 99 });

  const result = await resolveNotificationMediaVisual(poster, undefined, fake.dependencies);
  assert.deepEqual(result, {});
  assert.equal(fake.getDownloads(), 3, 'les retries doivent rester strictement bornés');
});
