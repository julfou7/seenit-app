import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reminderSource = readFileSync('src/hooks/useRemindersNotifier.ts', 'utf8');
const notificationMediaSource = readFileSync('src/features/notifications/notificationMedia.ts', 'utf8');
const mediaReminderSource = readFileSync('src/features/notifications/mediaReminderNotification.ts', 'utf8');
const nativePatchSource = readFileSync('scripts/patch-local-notifications.cjs', 'utf8');

test('SEENIT-NOTIFICATION-002 affiche un visuel média et un emoji par événement', () => {
  assert.match(reminderSource, /https:\/\/image\.tmdb\.org\/t\/p\/w154/,
    'l’APK doit utiliser un poster TMDB compact pour le largeIcon');
  assert.match(reminderSource, /https:\/\/image\.tmdb\.org\/t\/p\/w500/,
    'le visuel riche TMDB doit rester compact avant son cache natif');
  assert.match(reminderSource, /resolveNotificationMediaVisual\(iconUrl, imageUrl\)/,
    'les films doivent préparer affiche et visuel riche avant la notification');
  assert.match(reminderSource, /resolveNotificationMediaVisual\(iconUrl, tvImageUrl\)/,
    'les séries doivent préparer affiche et visuel épisode avant la notification');

  assert.match(reminderSource, /`🆕 \$\{title\}`/);
  assert.match(reminderSource, /'🆕 Nouvel épisode'/);
  assert.match(reminderSource, /`📅 \$\{title\}`/);
  assert.match(reminderSource, /'📅 Nouvelle saison'/);
  assert.match(reminderSource, /`🎬 \$\{title\}`/);
  assert.match(reminderSource, /'🎬 Sortie cinéma'/);
  assert.match(reminderSource, /`📺 \$\{title\}`/);
  assert.match(reminderSource, /'📺 Sortie DVD \/ VOD'/);
  assert.match(mediaReminderSource, /title: '✓ Marquer comme vu'/,
    'l’action rapide épisode doit rester disponible');
  assert.match(reminderSource, /allowMarkWatched: addActions/,
    'l’action rapide ne doit être attachée qu’au rappel épisode prévu');
});

test('SEENIT-NOTIFICATION-002 sépare affiche et image riche sans bloquer le fallback', () => {
  assert.match(notificationMediaSource, /Promise\.all\(/,
    'affiche et image riche sont préparées indépendamment');
  assert.match(notificationMediaSource, /cacheNativeNotificationImageSafely\(nativePosterUrl\)/);
  assert.match(notificationMediaSource, /cacheNativeNotificationImageSafely\(richCandidate\)/);
  assert.match(notificationMediaSource, /icon: localPoster \|\| localRichImage/);
  assert.match(notificationMediaSource, /image: localRichImage \|\| localPoster/);
  assert.match(notificationMediaSource, /using text-only notification/,
    'un échec total de visuel doit conserver le fallback texte');

  assert.match(mediaReminderSource, /largeIcon: iconUrl \|\| undefined/,
    'le largeIcon utilise l’affiche locale compacte');
  assert.match(mediaReminderSource, /imageUrl && imageUrl !== iconUrl/,
    'BigPicture n’est demandé que pour une image locale distincte');
  assert.match(mediaReminderSource, /\{ id: 'seenit-media', url: imageUrl \}/,
    'le visuel riche traverse uniquement sous forme d’URI locale courte');
  assert.match(mediaReminderSource, /summaryText: options\.summaryText/,
    'le libellé secondaire Android doit être spécifique à l’événement');
});

test('SEENIT-NOTIFICATION-002 garde les images hors du pont Binder et borne le bitmap Android', () => {
  assert.match(notificationMediaSource, /Filesystem\.downloadFile\(/,
    'le téléchargement de l’image doit être effectué par la couche native Filesystem');
  assert.match(notificationMediaSource, /directory: Directory\.Data/);
  assert.match(notificationMediaSource, /connectTimeout: NATIVE_IMAGE_CONNECT_TIMEOUT_MS/);
  assert.match(notificationMediaSource, /readTimeout: NATIVE_IMAGE_READ_TIMEOUT_MS/);
  assert.match(notificationMediaSource, /MAX_NATIVE_IMAGE_FILE_BYTES = 512 \* 1024/,
    'la taille de chaque fichier image doit rester bornée');
  assert.match(notificationMediaSource, /image\.tmdb\.org/);
  assert.match(notificationMediaSource, /seenit\.app/);
  assert.doesNotMatch(notificationMediaSource, /FileReader|readAsDataURL|data:image/i,
    'le chemin natif ne doit jamais matérialiser l’image en Data URL');
  assert.doesNotMatch(mediaReminderSource, /FileReader|readAsDataURL|Base64|data:image/i,
    'LocalNotifications.schedule ne doit recevoir aucun octet encodé');

  assert.match(nativePatchSource, /SEENIT_LOCAL_NOTIFICATION_BOUNDED_BIG_PICTURE_PATCH/);
  assert.match(nativePatchSource, /decodeSeenItLocalBitmap\(value, 512, 288\)/,
    'le BigPicture doit être décodé avec une dimension maximale explicite');
  assert.match(nativePatchSource, /inPreferredConfig = Bitmap\.Config\.RGB_565/,
    'le bitmap de notification utilise une représentation mémoire bornée');
  assert.match(nativePatchSource, /NotificationCompat\.BigPictureStyle\(\)/,
    'le visuel épisode/backdrop doit utiliser BigPictureStyle lorsqu’il existe');
  assert.match(nativePatchSource, /attachments\?\.firstOrNull \{ it\.id == "seenit-media" \}/,
    'le patch ne lit que l’attachment local dédié');

  const currentPatchStart = nativePatchSource.indexOf('const patchedResolver =');
  const currentPatchEnd = nativePatchSource.indexOf('// Migrate an already-installed', currentPatchStart);
  assert.ok(currentPatchStart >= 0 && currentPatchEnd > currentPatchStart);
  const currentPatchBlock = nativePatchSource.slice(currentPatchStart, currentPatchEnd);
  assert.equal(currentPatchBlock.includes('android.util.Base64.decode'), false);
  assert.equal(currentPatchBlock.includes('data:image/'), false);
  assert.equal(currentPatchBlock.includes('startsWith("http'), false,
    'le patch Android courant ne télécharge jamais une URL distante');
});
