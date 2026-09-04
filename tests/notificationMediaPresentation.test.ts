import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reminderSource = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
const notificationMediaSource = readFileSync('src/features/notifications/notificationMedia.ts', 'utf8');
const firebaseSource = readFileSync('src/lib/firebase.ts', 'utf8');
const nativePatchSource = readFileSync('scripts/patch-local-notifications.cjs', 'utf8');

test('SEENIT-NOTIFICATION-002 affiche un visuel média et un emoji par événement', () => {
  assert.match(reminderSource, /https:\/\/image\.tmdb\.org\/t\/p\/w154/,
    'l’APK doit utiliser un poster TMDB compact pour le largeIcon');
  assert.match(reminderSource, /resolveNotificationMediaVisual\(iconUrl, imageUrl\)/,
    'les films doivent préparer leur visuel avant la notification');
  assert.match(reminderSource, /resolveNotificationMediaVisual\(iconUrl, tvImageUrl\)/,
    'les séries doivent préparer leur visuel avant la notification');

  assert.match(reminderSource, /`🆕 \$\{title\}`/, 'un épisode disponible porte le marqueur 🆕');
  assert.match(reminderSource, /`📅 \$\{title\}`/, 'un rappel de saison porte le marqueur 📅');
  assert.match(reminderSource, /`🎬 \$\{title\}`/, 'une sortie cinéma porte le marqueur 🎬');
  assert.match(reminderSource, /`📺 \$\{title\}`/, 'une sortie VOD/DVD porte le marqueur 📺');
  assert.match(reminderSource, /title: '✓ Marquer comme vu'/,
    'l’action rapide épisode doit rester disponible');
});

test('SEENIT-NOTIFICATION-002 garde les images hors du pont Binder et conserve un fallback texte', () => {
  assert.match(notificationMediaSource, /Filesystem\.downloadFile\(/,
    'le téléchargement de l’image doit être effectué par la couche native Filesystem');
  assert.match(notificationMediaSource, /directory: Directory\.Data/,
    'le fichier doit survivre jusqu’au déclenchement d’un rappel programmé');
  assert.match(notificationMediaSource, /connectTimeout: NATIVE_IMAGE_CONNECT_TIMEOUT_MS/);
  assert.match(notificationMediaSource, /readTimeout: NATIVE_IMAGE_READ_TIMEOUT_MS/);
  assert.match(notificationMediaSource, /MAX_NATIVE_IMAGE_FILE_BYTES = 512 \* 1024/,
    'la taille du fichier image doit rester bornée');
  assert.match(notificationMediaSource, /image\.tmdb\.org/);
  assert.match(notificationMediaSource, /seenit\.app/);
  assert.match(notificationMediaSource, /using text-only notification/,
    'un échec de visuel doit retomber sur une notification texte');

  assert.doesNotMatch(notificationMediaSource, /FileReader|readAsDataURL|data:image/i,
    'le nouveau chemin natif ne doit jamais matérialiser l’image en Data URL');

  const safePatchStart = nativePatchSource.indexOf('const patchedSetter =');
  const safePatchEnd = nativePatchSource.indexOf('if (!localNotification.includes(stockSetter)', safePatchStart);
  assert.ok(safePatchStart >= 0 && safePatchEnd > safePatchStart,
    'le bloc du nouveau patch LocalNotifications doit rester identifiable');
  const safePatchBlock = nativePatchSource.slice(safePatchStart, safePatchEnd);

  assert.equal(safePatchBlock.includes('android.util.Base64.decode'), false,
    'le nouveau patch Android ne doit pas décoder de payload Base64');
  assert.equal(safePatchBlock.includes('data:image/'), false,
    'le nouveau patch Android ne doit pas accepter de Data URL image');
  assert.equal(safePatchBlock.includes('startsWith("http'), false,
    'le nouveau patch LocalNotifications ne télécharge pas lui-même une URL distante');
  assert.match(safePatchBlock, /BitmapFactory\.decodeFile/,
    'le nouveau patch natif ne résout que le petit fichier local préparé en amont');

  const localScheduleBlock = firebaseSource.slice(
    firebaseSource.indexOf('await LocalNotifications.schedule({'),
    firebaseSource.indexOf('// If not future schedule on web')
  );
  assert.doesNotMatch(localScheduleBlock, /fetchImageAsDataUrl|readAsDataURL|Base64/,
    'LocalNotifications.schedule ne doit recevoir aucun octet d’image encodé');
  assert.match(localScheduleBlock, /largeIcon: imageUrl \|\| undefined/,
    'la notification native reçoit uniquement la référence locale préparée');
});
