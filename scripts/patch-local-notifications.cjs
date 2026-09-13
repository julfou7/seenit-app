const fs = require('fs');
const path = require('path');

const pluginDir = path.join(
  __dirname,
  '..',
  'node_modules',
  '@capacitor',
  'local-notifications',
  'android',
  'src',
  'main',
  'kotlin',
  'com',
  'capacitorjs',
  'plugins',
  'localnotifications'
);

const localNotificationPath = path.join(pluginDir, 'LocalNotification.kt');
const localNotificationManagerPath = path.join(pluginDir, 'LocalNotificationManager.kt');
const timedNotificationPublisherPath = path.join(pluginDir, 'TimedNotificationPublisher.kt');
const LEGACY_FILE_PATCH_MARKER = 'SEENIT_LOCAL_NOTIFICATION_FILE_ICON_PATCH';
const PATCH_MARKER = 'SEENIT_LOCAL_NOTIFICATION_PRIVATE_DATA_V2_PATCH';
const BIG_PICTURE_MARKER = 'SEENIT_LOCAL_NOTIFICATION_BOUNDED_BIG_PICTURE_PATCH';
const DELIVERY_MEDIA_MARKER = 'SEENIT_LOCAL_NOTIFICATION_DELIVERY_MEDIA_V3_PATCH';

if (!fs.existsSync(localNotificationPath)) {
  throw new Error(`LocalNotifications Android source not found: ${localNotificationPath}`);
}
if (!fs.existsSync(localNotificationManagerPath)) {
  throw new Error(`LocalNotifications Android manager source not found: ${localNotificationManagerPath}`);
}
if (!fs.existsSync(timedNotificationPublisherPath)) {
  throw new Error(`LocalNotifications Android publisher source not found: ${timedNotificationPublisherPath}`);
}

let localNotification = fs.readFileSync(localNotificationPath, 'utf8');

const stockSetter = `var largeIcon: String? = null
        set(value) {
            field = AssetUtil.getResourceBaseName(value)
        }`;

const stockResolver = `fun resolveLargeIcon(context: Context): Bitmap? {
        largeIcon?.let {
            val resId = AssetUtil.getResourceID(context, it, "drawable")
            return BitmapFactory.decodeResource(context.resources, resId)
        }
        return null
    }`;

const legacyFileSetter = `// ${LEGACY_FILE_PATCH_MARKER}: preserve only short local file paths.
    // Remote/base64 image bytes must never cross the Capacitor/Binder payload.
    var largeIcon: String? = null
        set(value) {
            field = if (value != null && (value.startsWith("/") || value.startsWith("file://"))) {
                value
            } else {
                AssetUtil.getResourceBaseName(value)
            }
        }`;

const legacyFileResolver = `private fun decodeSeenItLocalBitmap(value: String, maxWidth: Int, maxHeight: Int): Bitmap? {
        if (!(value.startsWith("/") || value.startsWith("file://"))) return null
        val filePath = value.removePrefix("file://")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(filePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sampleSize = 1
        while (bounds.outWidth / sampleSize > maxWidth || bounds.outHeight / sampleSize > maxHeight) {
            sampleSize *= 2
        }

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.RGB_565
        }
        return BitmapFactory.decodeFile(filePath, options)
    }

    fun resolveLargeIcon(context: Context): Bitmap? {
        val icon = largeIcon ?: return null
        return try {
            if (icon.startsWith("/") || icon.startsWith("file://")) {
                decodeSeenItLocalBitmap(icon, 192, 288)
            } else {
                val resId = AssetUtil.getResourceID(context, icon, "drawable")
                if (resId != AssetUtil.RESOURCE_ID_ZERO_VALUE) {
                    BitmapFactory.decodeResource(context.resources, resId)
                } else {
                    null
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("LocalNotification", "Failed to resolve SeenIt local large icon: " + e.message)
            null
        }
    }

    // ${BIG_PICTURE_MARKER}: only the dedicated local attachment is accepted.
    // It is sampled before NotificationCompat sees it so the scheduled Notification
    // stays comfortably below the historical Binder transaction limit.
    fun resolveSeenItBigPicture(): Bitmap? {
        val value = attachments?.firstOrNull { it.id == "seenit-media" }?.url ?: return null
        return try {
            decodeSeenItLocalBitmap(value, 512, 288)
        } catch (e: Exception) {
            android.util.Log.w("LocalNotification", "Failed to resolve SeenIt local big picture: " + e.message)
            null
        }
    }`;

const patchedSetter = `// ${PATCH_MARKER}: preserve only SeenIt's stable private-data references.
    // Remote/base64/file URIs must never cross the Capacitor/Binder payload.
    var largeIcon: String? = null
        set(value) {
            field = if (value != null && value.startsWith("seenit-data://")) {
                value
            } else {
                AssetUtil.getResourceBaseName(value)
            }
        }`;

const patchedResolver = `private fun resolveSeenItPrivateFile(context: Context, value: String): java.io.File? {
        if (!value.startsWith("seenit-data://")) return null
        val relativePath = value.removePrefix("seenit-data://")
        if (!relativePath.matches(Regex("^notification-media/[0-9a-f]+\\\\.img$"))) return null

        val root = context.filesDir.canonicalFile
        val candidate = java.io.File(root, relativePath).canonicalFile
        val rootPrefix = root.path + java.io.File.separator
        if (!candidate.path.startsWith(rootPrefix)) return null
        if (!candidate.isFile || candidate.length() <= 0L || candidate.length() > 512L * 1024L) return null
        return candidate
    }

    private fun decodeSeenItLocalBitmap(context: Context, value: String, maxWidth: Int, maxHeight: Int): Bitmap? {
        val file = resolveSeenItPrivateFile(context, value) ?: return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sampleSize = 1
        while (bounds.outWidth / sampleSize > maxWidth || bounds.outHeight / sampleSize > maxHeight) {
            sampleSize *= 2
        }

        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.RGB_565
        }
        return BitmapFactory.decodeFile(file.path, options)
    }

    fun resolveLargeIcon(context: Context): Bitmap? {
        val icon = largeIcon ?: return null
        return try {
            if (icon.startsWith("seenit-data://")) {
                decodeSeenItLocalBitmap(context, icon, 192, 288)
            } else {
                val resId = AssetUtil.getResourceID(context, icon, "drawable")
                if (resId != AssetUtil.RESOURCE_ID_ZERO_VALUE) {
                    BitmapFactory.decodeResource(context.resources, resId)
                } else {
                    null
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("LocalNotification", "Failed to resolve SeenIt private large icon: " + e.message)
            null
        }
    }

    // ${BIG_PICTURE_MARKER}: only the dedicated app-private attachment is accepted.
    // The file is size-checked and sampled only when the notification is rendered.
    fun resolveSeenItBigPicture(context: Context): Bitmap? {
        val value = attachments?.firstOrNull { it.id == "seenit-media" }?.url ?: return null
        return try {
            decodeSeenItLocalBitmap(context, value, 512, 288)
        } catch (e: Exception) {
            android.util.Log.w("LocalNotification", "Failed to resolve SeenIt private big picture: " + e.message)
            null
        }
    }`;

// Migrate an already-installed node_modules tree from the historical SeenIt
// Base64 patch. Fresh npm ci installations never enter this branch, but local
// npm install must remain deterministic and safe.
if (!localNotification.includes(PATCH_MARKER) && localNotification.includes('android.util.Base64.decode')) {
  const legacySetter = `var largeIcon: String? = null
        set(value) {
            field = if (value != null && (value.startsWith("data:") || value.startsWith("/") || value.startsWith("file://") || value.startsWith("http"))) value else AssetUtil.getResourceBaseName(value)
        }`;
  const legacyResolver = `fun resolveLargeIcon(context: Context): Bitmap? {
        val icon = largeIcon ?: return null
        try {
            if (icon.startsWith("data:image/")) {
                val base64Data = icon.substringAfter("base64,")
                val decodedBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                return BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
            } else if (icon.startsWith("/") || icon.startsWith("file://")) {
                val filePath = icon.removePrefix("file://")
                return BitmapFactory.decodeFile(filePath)
            } else {
                val resId = AssetUtil.getResourceID(context, AssetUtil.getResourceBaseName(icon), "drawable")
                if (resId != AssetUtil.RESOURCE_ID_ZERO_VALUE) {
                    return BitmapFactory.decodeResource(context.resources, resId)
                }
            }
        } catch (e: Exception) {
            android.util.Log.w("LocalNotification", "Failed to resolve large icon: " + e.message)
        }
        return null
    }`;

  if (!localNotification.includes(legacySetter) || !localNotification.includes(legacyResolver)) {
    throw new Error('Legacy SeenIt LocalNotification patch detected but cannot be migrated safely.');
  }
  localNotification = localNotification
    .replace(legacySetter, stockSetter)
    .replace(legacyResolver, stockResolver);
}

// V1 stored runtime-specific absolute/file:// URIs. Replace that patch entirely
// before installing V2 so an npm install over an existing workspace is safe.
if (!localNotification.includes(PATCH_MARKER) && localNotification.includes(LEGACY_FILE_PATCH_MARKER)) {
  if (!localNotification.includes(legacyFileSetter) || !localNotification.includes(legacyFileResolver)) {
    throw new Error('Existing SeenIt V1 local-file patch cannot be migrated safely.');
  }
  localNotification = localNotification
    .replace(legacyFileSetter, stockSetter)
    .replace(legacyFileResolver, stockResolver);
}

if (!localNotification.includes(PATCH_MARKER)) {
  if (!localNotification.includes(stockSetter) || !localNotification.includes(stockResolver)) {
    throw new Error(
      'Unsupported @capacitor/local-notifications source: expected largeIcon blocks were not found. ' +
      'Refusing to apply a partial notification patch.'
    );
  }
  localNotification = localNotification
    .replace(stockSetter, patchedSetter)
    .replace(stockResolver, patchedResolver);
}

if (!localNotification.includes(PATCH_MARKER) || !localNotification.includes(BIG_PICTURE_MARKER)) {
  throw new Error('SeenIt LocalNotification V2 image patch markers are incomplete after patching.');
}
if (localNotification.includes('android.util.Base64.decode') || localNotification.includes('data:image/')) {
  throw new Error('Unsafe Base64 notification image code remains in LocalNotification.kt.');
}
fs.writeFileSync(localNotificationPath, localNotification, 'utf8');
console.log('✅ Patched LocalNotification.kt for bounded app-private media visuals.');

let manager = fs.readFileSync(localNotificationManagerPath, 'utf8');

// Remove only the obsolete historical SeenIt patch that decoded arbitrary
// Base64/attachment bitmaps. V2 accepts only the app-private seenit-data scheme.
if (manager.includes('var bigPictureBitmap: Bitmap? = null')) {
  const legacyStyleBlock = /\s*val largeIconBitmap = localNotification\.resolveLargeIcon\(context\)[\s\S]*?localNotification\.inboxList\?\.let \{ lines ->[\s\S]*?mBuilder\.setStyle\(inboxStyle\)\s*\}/m;
  const stockStyleBlock = `

        if (localNotification.largeBody != null) {
            mBuilder.setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(localNotification.largeBody)
                    .setSummaryText(localNotification.summaryText)
            )
        }

        localNotification.inboxList?.let { lines ->
            val inboxStyle = NotificationCompat.InboxStyle()
            for (line in lines) inboxStyle.addLine(line)
            inboxStyle.setBigContentTitle(localNotification.title)
            inboxStyle.setSummaryText(localNotification.summaryText)
            mBuilder.setStyle(inboxStyle)
        }`;

  if (!legacyStyleBlock.test(manager)) {
    throw new Error('Legacy SeenIt BigPicture patch detected but its style block could not be safely removed.');
  }
  manager = manager.replace(legacyStyleBlock, stockStyleBlock);
  manager = manager.replace(
    /if \(largeIconBitmap != null\) \{\s*mBuilder\.setLargeIcon\(largeIconBitmap\)\s*\}/g,
    'mBuilder.setLargeIcon(localNotification.resolveLargeIcon(context))'
  );
  manager = manager.replace('import android.graphics.Bitmap\n', '');
  manager = manager.replace('import android.graphics.BitmapFactory\n', '');
}

// Upgrade manager calls left by V1 before testing/inserting the V2 style block.
manager = manager.replace(
  'val seenItBigPicture = localNotification.resolveSeenItBigPicture()',
  'val seenItBigPicture = localNotification.resolveSeenItBigPicture(context)'
);

if (!manager.includes(BIG_PICTURE_MARKER)) {
  const stockStyleBlock = `if (localNotification.largeBody != null) {
            mBuilder.setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(localNotification.largeBody)
                    .setSummaryText(localNotification.summaryText)
            )
        }`;
  const boundedStyleBlock = `// ${BIG_PICTURE_MARKER}: render only the pre-cached, sampled app-private attachment.
        val seenItBigPicture = localNotification.resolveSeenItBigPicture(context)
        if (seenItBigPicture != null) {
            mBuilder.setStyle(
                NotificationCompat.BigPictureStyle()
                    .bigPicture(seenItBigPicture)
                    .setSummaryText(localNotification.summaryText)
            )
        } else if (localNotification.largeBody != null) {
            mBuilder.setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(localNotification.largeBody)
                    .setSummaryText(localNotification.summaryText)
            )
        }`;

  if (!manager.includes(stockStyleBlock)) {
    throw new Error('Unsupported LocalNotificationManager style block; refusing partial BigPicture patch.');
  }
  manager = manager.replace(stockStyleBlock, boundedStyleBlock);
}

if (!manager.includes(DELIVERY_MEDIA_MARKER)) {
  const eagerBigPicture = 'val seenItBigPicture = localNotification.resolveSeenItBigPicture(context)';
  const deferredBigPicture = `// ${DELIVERY_MEDIA_MARKER}: a future alarm transports no bitmap.
        val shouldResolveSeenItMediaNow = !localNotification.isScheduled() || localNotification.isTriggered()
        val seenItBigPicture = if (shouldResolveSeenItMediaNow) {
            localNotification.resolveSeenItBigPicture(context)
        } else {
            null
        }`;
  const eagerLargeIcon = 'mBuilder.setLargeIcon(localNotification.resolveLargeIcon(context))';
  const deferredLargeIcon = `mBuilder.setLargeIcon(
            if (shouldResolveSeenItMediaNow) localNotification.resolveLargeIcon(context) else null
        )`;

  if (!manager.includes(eagerBigPicture) || !manager.includes(eagerLargeIcon)) {
    throw new Error('Unsupported LocalNotificationManager media calls; refusing partial delivery-time patch.');
  }
  manager = manager
    .replace(eagerBigPicture, deferredBigPicture)
    .replace(eagerLargeIcon, deferredLargeIcon);
}

if (manager.includes('android.util.Base64.decode') || manager.includes('data:image/')) {
  throw new Error('Unsafe Base64 notification image code remains in LocalNotificationManager.kt.');
}
if (!manager.includes(BIG_PICTURE_MARKER) || !manager.includes(DELIVERY_MEDIA_MARKER)) {
  throw new Error('SeenIt bounded delivery-time media patch is incomplete after patching.');
}

fs.writeFileSync(localNotificationManagerPath, manager, 'utf8');
console.log('✅ Patched LocalNotificationManager.kt to keep future alarms bitmap-free.');

let publisher = fs.readFileSync(timedNotificationPublisherPath, 'utf8');

if (!publisher.includes(DELIVERY_MEDIA_MARKER)) {
  const loggerImport = 'import com.getcapacitor.Logger';
  const hydratedImport = `import androidx.core.app.NotificationCompat
import com.getcapacitor.Logger`;
  const stockDeliveryBlock = `notification.\`when\` = System.currentTimeMillis()

        val id = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        if (id == Int.MIN_VALUE) {
            Logger.error(Logger.tags("LN"), "No valid id supplied", null)
        }
        val storage = NotificationStorage(context)
        val notificationJson = storage.getSavedNotificationAsJSObject(id.toString())
        LocalNotificationsPlugin.fireReceived(notificationJson)
        notificationManager.notify(id, notification)`;
  const hydratedDeliveryBlock = `val id = intent.getIntExtra(LocalNotificationManager.NOTIFICATION_INTENT_KEY, Int.MIN_VALUE)
        if (id == Int.MIN_VALUE) {
            Logger.error(Logger.tags("LN"), "No valid id supplied", null)
        }
        val storage = NotificationStorage(context)
        val notificationJson = storage.getSavedNotificationAsJSObject(id.toString())

        // ${DELIVERY_MEDIA_MARKER}: resolve app-private images only after AlarmManager
        // delivered its bitmap-free PendingIntent.
        val deliveredNotification = try {
            val storedRequest = notificationJson?.let { LocalNotification.buildNotificationFromJSObject(it) }
            if (storedRequest == null) {
                notification
            } else {
                val builder = NotificationCompat.Builder.recoverBuilder(context, notification)
                builder.setLargeIcon(storedRequest.resolveLargeIcon(context))
                val bigPicture = storedRequest.resolveSeenItBigPicture(context)
                if (bigPicture != null) {
                    builder.setStyle(
                        NotificationCompat.BigPictureStyle()
                            .bigPicture(bigPicture)
                            .setSummaryText(storedRequest.summaryText)
                    )
                } else if (storedRequest.largeBody != null) {
                    builder.setStyle(
                        NotificationCompat.BigTextStyle()
                            .bigText(storedRequest.largeBody)
                            .setSummaryText(storedRequest.summaryText)
                    )
                }
                builder.build()
            }
        } catch (error: Exception) {
            Logger.warn(Logger.tags("LN"), "Unable to hydrate SeenIt notification media at delivery: " + error.message)
            notification
        }

        deliveredNotification.\`when\` = System.currentTimeMillis()
        LocalNotificationsPlugin.fireReceived(notificationJson)
        notificationManager.notify(id, deliveredNotification)`;

  if (!publisher.includes(loggerImport) || !publisher.includes(stockDeliveryBlock)) {
    throw new Error('Unsupported TimedNotificationPublisher delivery block; refusing partial media patch.');
  }
  publisher = publisher
    .replace(loggerImport, hydratedImport)
    .replace(stockDeliveryBlock, hydratedDeliveryBlock);
}

if (!publisher.includes(DELIVERY_MEDIA_MARKER)
  || !publisher.includes('NotificationCompat.Builder.recoverBuilder(context, notification)')
  || !publisher.includes('notificationManager.notify(id, deliveredNotification)')) {
  throw new Error('SeenIt delivery-time notification media patch is incomplete after patching.');
}

fs.writeFileSync(timedNotificationPublisherPath, publisher, 'utf8');
console.log('✅ Patched TimedNotificationPublisher.kt to hydrate SeenIt media at delivery.');
