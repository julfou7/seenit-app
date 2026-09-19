import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationMediaPrivateRef,
  normalizeNativeNotificationImageUrl,
  resolveNotificationMediaVisual,
  type NotificationMediaDependencies,
} from '../src/features/notifications/notificationMedia.ts';

function createFakeDependencies(options: {
  failuresBeforeSuccess?: number;
  directoryExists?: boolean;
  directoryAppearsDuringMkdir?: boolean;
} = {}) {
  const files = new Map<string, number>();
  let directoryExists = options.directoryExists ?? false;
  let downloads = 0;
  let mkdirs = 0;
  const downloadedUrls: string[] = [];
  let failures = options.failuresBeforeSuccess ?? 0;

  const filesystem: NotificationMediaDependencies['filesystem'] = {
    async mkdir() {
      mkdirs += 1;
      if (options.directoryAppearsDuringMkdir) {
        directoryExists = true;
        throw new Error('DIRECTORY_ALREADY_EXISTS');
      }
      if (directoryExists) throw new Error('DIRECTORY_ALREADY_EXISTS');
      directoryExists = true;
    },
    async stat({ path }: any) {
      if (path === 'notification-media') {
        if (!directoryExists) throw new Error('ENOENT');
        return { type: 'directory', size: 0 };
      }
      const size = files.get(path);
      if (!size) throw new Error('ENOENT');
      return { type: 'file', size };
    },
    async deleteFile({ path }: any) {
      files.delete(path);
    },
    async downloadFile({ path, url }: any) {
      downloads += 1;
      downloadedUrls.push(url);
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
    getMkdirs: () => mkdirs,
    getDownloadedUrls: () => [...downloadedUrls],
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


test('issue #106 borne les URL TMDB absolues persistées par Plex avant le cache natif', async () => {
  const poster = 'https://image.tmdb.org/t/p/w500/poster.jpg';
  const backdrop = 'https://image.tmdb.org/t/p/w1280/backdrop.jpg';
  const boundedPoster = 'https://image.tmdb.org/t/p/w342/poster.jpg';
  const boundedBackdrop = 'https://image.tmdb.org/t/p/w500/backdrop.jpg';
  const fake = createFakeDependencies();

  const result = await resolveNotificationMediaVisual(poster, backdrop, fake.dependencies);

  assert.deepEqual(new Set(fake.getDownloadedUrls()), new Set([boundedPoster, boundedBackdrop]));
  assert.deepEqual(result, {
    icon: notificationMediaPrivateRef(boundedPoster),
    image: notificationMediaPrivateRef(boundedBackdrop),
  });
});

test('issue #106 ne retélécharge pas une seconde taille quand le poster sert aussi de BigPicture fallback', async () => {
  const persistedPoster = 'https://image.tmdb.org/t/p/w500/poster-only.jpg';
  const boundedPoster = 'https://image.tmdb.org/t/p/w342/poster-only.jpg';
  const fake = createFakeDependencies();

  const result = await resolveNotificationMediaVisual(persistedPoster, persistedPoster, fake.dependencies);

  assert.deepEqual(fake.getDownloadedUrls(), [boundedPoster]);
  assert.deepEqual(result, {
    icon: notificationMediaPrivateRef(boundedPoster),
    image: notificationMediaPrivateRef(boundedPoster),
  });
});

test('issue #106 durcit les anciennes URL TMDB HTTP sans modifier les hôtes non TMDB', () => {
  assert.equal(
    normalizeNativeNotificationImageUrl('http://image.tmdb.org/t/p/original/legacy.jpg', 'w342'),
    'https://image.tmdb.org/t/p/w342/legacy.jpg',
  );
  assert.equal(
    normalizeNativeNotificationImageUrl('https://seenit.app/icon-192.png', 'w342'),
    'https://seenit.app/icon-192.png',
  );
});


test('issue #106 réutilise un répertoire notification-media déjà présent après redémarrage', async () => {
  const poster = 'https://image.tmdb.org/t/p/w342/mobland.jpg';
  const fake = createFakeDependencies({ directoryExists: true });

  const result = await resolveNotificationMediaVisual(poster, undefined, fake.dependencies);

  assert.deepEqual(result, {
    icon: notificationMediaPrivateRef(poster),
    image: notificationMediaPrivateRef(poster),
  });
  assert.equal(fake.getMkdirs(), 0, 'un dossier privé persistant existant ne doit pas être recréé');
  assert.equal(fake.getDownloads(), 1, 'un nouveau cache miss doit encore télécharger son image');
});

test('issue #106 accepte une course mkdir AlreadyExists seulement si le dossier existe réellement', async () => {
  const poster = 'https://image.tmdb.org/t/p/w342/race.jpg';
  const fake = createFakeDependencies({ directoryAppearsDuringMkdir: true });

  const result = await resolveNotificationMediaVisual(poster, undefined, fake.dependencies);

  assert.deepEqual(result, {
    icon: notificationMediaPrivateRef(poster),
    image: notificationMediaPrivateRef(poster),
  });
  assert.equal(fake.getMkdirs(), 1);
  assert.equal(fake.getDownloads(), 1, 'AlreadyExists confirmé par stat ne doit pas bloquer le téléchargement');
});
