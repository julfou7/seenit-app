import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const reminderSource = readSource('src/hooks/useRemindersNotifier.ts');
const notificationMediaSource = readSource('src/features/notifications/notificationMedia.ts');
const mediaReminderSource = readSource('src/features/notifications/mediaReminderNotification.ts');
const nativePatchSource = readSource('scripts/patch-local-notifications.cjs');
const androidVariablesSource = readSource('android/variables.gradle');

test('SEENIT-NOTIFICATION-002 affiche un visuel média et un seul emoji par événement', () => {
  assert.match(reminderSource, /https:\/\/image\.tmdb\.org\/t\/p\/w154/,
    'l’APK doit utiliser un poster TMDB compact pour le largeIcon');
  assert.match(reminderSource, /https:\/\/image\.tmdb\.org\/t\/p\/w500/,
    'le visuel riche TMDB doit rester compact avant son cache natif');
  assert.match(reminderSource, /resolveNotificationMediaVisual\(iconUrl, imageUrl\)/,
    'les films doivent préparer affiche et visuel riche avant la notification');
  assert.match(reminderSource, /resolveNotificationMediaVisual\(iconUrl, tvImageUrl\)/,
    'les séries doivent préparer affiche et visuel épisode avant la notification');

  assert.match(reminderSource, /title,\n\s+'🆕 Nouvel épisode'/,
    'le titre média reste sans emoji et le contexte porte l’emoji épisode');
  assert.match(reminderSource, /title,\n\s+'📅 Nouvelle saison'/,
    'le titre média reste sans emoji et le contexte porte l’emoji saison');
  assert.match(reminderSource, /title,\n\s+'🎬 Sortie cinéma'/,
    'le titre média reste sans emoji et le contexte porte l’emoji cinéma');
  assert.match(reminderSource, /title,\n\s+'📺 Sortie DVD \/ VOD'/,
    'le titre média reste sans emoji et le contexte porte l’emoji VOD');
  assert.doesNotMatch(reminderSource, /`(?:🆕|📅|🎬|📺) \$\{title\}`/,
    'aucun rappel ne doit dupliquer l’emoji de contexte dans le titre média');
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
  assert.match(mediaReminderSource, /const attachments = imageUrl\s*\? \[\{ id: 'seenit-media', url: imageUrl \}\]/,
    'tout visuel local disponible, y compris le poster fallback, doit alimenter BigPicture');
  assert.doesNotMatch(mediaReminderSource, /imageUrl !== iconUrl/,
    'un poster partagé avec largeIcon ne doit plus supprimer le BigPicture');
  assert.match(mediaReminderSource, /summaryText: options\.summaryText/,
    'le libellé secondaire Android doit être spécifique à l’événement');
});

test('SEENIT-NOTIFICATION-002 utilise une référence privée stable et jamais getUri', () => {
  assert.match(notificationMediaSource, /SEENIT_DATA_SCHEME = 'seenit-data:\/\/'/);
  assert.match(notificationMediaSource, /return `\$\{SEENIT_DATA_SCHEME\}\$\{notificationMediaCachePath\(url\)\}`/);
  assert.doesNotMatch(notificationMediaSource, /Filesystem\.getUri\(/,
    'un rappel planifié ne doit pas dépendre d’une URI Capacitor variable');
  assert.match(nativePatchSource, /SEENIT_LOCAL_NOTIFICATION_PRIVATE_DATA_V2_PATCH/);
  assert.match(nativePatchSource, /context\.filesDir\.canonicalFile/,
    'Android doit repartir exclusivement de son stockage privé');
  assert.match(nativePatchSource, /candidate\.path\.startsWith\(rootPrefix\)/,
    'le chemin canonique doit rester confiné sous filesDir');
});

test('SEENIT-NOTIFICATION-002 garde les images hors du pont Binder et borne le bitmap Android', () => {
  assert.match(notificationMediaSource, /Filesystem\.downloadFile\(/,
    'le téléchargement de l’image doit être effectué par la couche native Filesystem');
  assert.match(notificationMediaSource, /directory: Directory\.Data/);
  assert.match(notificationMediaSource, /connectTimeout: NATIVE_IMAGE_CONNECT_TIMEOUT_MS/);
  assert.match(notificationMediaSource, /readTimeout: NATIVE_IMAGE_READ_TIMEOUT_MS/);
  assert.match(notificationMediaSource, /MAX_NATIVE_IMAGE_FILE_BYTES = 512 \* 1024/,
    'la taille de chaque fichier image doit rester bornée côté JS');
  assert.doesNotMatch(notificationMediaSource, /FileReader|readAsDataURL|data:image/i,
    'le chemin natif ne doit jamais matérialiser l’image en Data URL');
  assert.doesNotMatch(mediaReminderSource, /FileReader|readAsDataURL|Base64|data:image/i,
    'LocalNotifications.schedule ne doit recevoir aucun octet encodé');

  assert.match(nativePatchSource, /candidate\.length\(\) > 512L \* 1024L/,
    'Android doit refaire la borne de taille avant décodage');
  assert.match(nativePatchSource, /decodeSeenItLocalBitmap\(context, value, 512, 288\)/,
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

test('SEENIT-NOTIFICATION-002 hydrate le bitmap seulement à la livraison Android', () => {
  assert.match(nativePatchSource, /SEENIT_LOCAL_NOTIFICATION_DELIVERY_MEDIA_V3_PATCH/);
  assert.match(nativePatchSource, /shouldResolveSeenItMediaNow/);
  assert.match(nativePatchSource, /if \(shouldResolveSeenItMediaNow\) localNotification\.resolveLargeIcon\(context\) else null/);
  assert.match(androidVariablesSource, /minSdkVersion\s*=\s*24/,
    'Notification.Builder.recoverBuilder exige API 24 et le contrat Android SeenIt doit le garantir');

  const hydratedBlockStart = nativePatchSource.indexOf('const hydratedDeliveryBlock =');
  const hydratedBlockEnd = nativePatchSource.indexOf('if (!publisher.includes(stockDeliveryBlock))', hydratedBlockStart);
  assert.ok(hydratedBlockStart >= 0 && hydratedBlockEnd > hydratedBlockStart,
    'le bloc de livraison hydratée doit rester identifiable dans le patch natif');
  const hydratedDeliveryBlock = nativePatchSource.slice(hydratedBlockStart, hydratedBlockEnd);
  assert.match(hydratedDeliveryBlock, /android\.app\.Notification\.Builder\.recoverBuilder\(context, notification\)/,
    'la reconstruction générée doit utiliser l’API framework disponible à partir du minSdk SeenIt');
  assert.doesNotMatch(hydratedDeliveryBlock, /NotificationCompat\.Builder\.recoverBuilder\(context, notification\)/,
    'le code Kotlin généré ne doit jamais utiliser le recoverBuilder inexistant d’AndroidX');
  assert.match(hydratedDeliveryBlock, /android\.app\.Notification\.BigPictureStyle\(\)/,
    'le builder framework doit recevoir un style framework compatible');
  assert.match(hydratedDeliveryBlock, /android\.app\.Notification\.BigTextStyle\(\)/,
    'le fallback texte doit rester compatible avec le builder framework');
  assert.match(nativePatchSource, /publisher\.includes\('NotificationCompat\.Builder\.recoverBuilder\(context, notification\)'\)/,
    'le patch doit refuser explicitement toute réintroduction du recoverBuilder AndroidX');
  assert.match(hydratedDeliveryBlock, /notificationJson\?\.let \{ LocalNotification\.buildNotificationFromJSObject\(it\) \}/);
  assert.match(hydratedDeliveryBlock, /notificationManager\.notify\(id, deliveredNotification\)/);
  assert.match(reminderSource, /REMINDER_SCHEDULE_SCHEMA = 'v5'/,
    'les alarmes existantes doivent être recréées sans bitmap dans leur PendingIntent');
});
