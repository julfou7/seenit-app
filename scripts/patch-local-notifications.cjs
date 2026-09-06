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
const PATCH_MARKER = 'SEENIT_LOCAL_NOTIFICATION_FILE_ICON_PATCH';
const BIG_PICTURE_MARKER = 'SEENIT_LOCAL_NOTIFICATION_BOUNDED_BIG_PICTURE_PATCH';

if (!fs.existsSync(localNotificationPath)) {
  throw new Error(`LocalNotifications Android source not found: ${localNotificationPath}`);
}
if (!fs.existsSync(localNotificationManagerPath)) {
  throw new Error(`LocalNotifications Android manager source not found: ${localNotificationManagerPath}`);
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

const patchedSetter = `// ${PATCH_MARKER}: preserve only short local file paths.
    // Remote/base64 image bytes must never cross the Capacitor/Binder payload.
    var largeIcon: String? = null
        set(value) {
            field = if (value != null && (value.startsWith("/") || value.startsWith("file://"))) {
                value
            } else {
                AssetUtil.getResourceBaseName(value)
            }
        }`;

const patchedResolver = `private fun decodeSeenItLocalBitmap(value: String, maxWidth: Int, maxHeight: Int): Bitmap? {
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

// Migrate an already-installed node_modules tree from the historical SeenIt
// Base64 patch before applying the current file-only contract. Fresh npm ci
// installations never enter this branch, but local npm install remains deterministic.
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
} else if (!localNotification.includes(BIG_PICTURE_MARKER)) {
  const oldPatchedResolver = `fun resolveLargeIcon(context: Context): Bitmap? {
        val icon = largeIcon ?: return null
        return try {
            if (icon.startsWith("/") || icon.startsWith("file://")) {
                BitmapFactory.decodeFile(icon.removePrefix("file://"))
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
    }`;
  if (!localNotification.includes(oldPatchedResolver)) {
    throw new Error('Existing SeenIt local-file icon patch cannot be upgraded safely.');
  }
  localNotification = localNotification.replace(oldPatchedResolver, patchedResolver);
}

if (!localNotification.includes(PATCH_MARKER) || !localNotification.includes(BIG_PICTURE_MARKER)) {
  throw new Error('SeenIt LocalNotification image patch markers are incomplete after patching.');
}
fs.writeFileSync(localNotificationPath, localNotification, 'utf8');
console.log('✅ Patched LocalNotification.kt for bounded local-file media visuals.');

let manager = fs.readFileSync(localNotificationManagerPath, 'utf8');

// Remove only the obsolete historical SeenIt patch that decoded arbitrary
// Base64/attachment bitmaps. The current patch is file-only and dimension-bounded.
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

if (!manager.includes(BIG_PICTURE_MARKER)) {
  const stockStyleBlock = `if (localNotification.largeBody != null) {
            mBuilder.setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(localNotification.largeBody)
                    .setSummaryText(localNotification.summaryText)
            )
        }`;
  const boundedStyleBlock = `// ${BIG_PICTURE_MARKER}: render only the pre-cached, sampled local attachment.
        val seenItBigPicture = localNotification.resolveSeenItBigPicture()
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

if (manager.includes('android.util.Base64.decode') || manager.includes('data:image/')) {
  throw new Error('Unsafe Base64 notification image code remains in LocalNotificationManager.kt.');
}
if (!manager.includes(BIG_PICTURE_MARKER)) {
  throw new Error('SeenIt bounded BigPicture patch marker is missing after patching.');
}

fs.writeFileSync(localNotificationManagerPath, manager, 'utf8');
console.log('✅ Patched LocalNotificationManager.kt for bounded local-file BigPictureStyle.');
