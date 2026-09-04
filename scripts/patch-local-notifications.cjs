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

if (!fs.existsSync(localNotificationPath)) {
  throw new Error(`LocalNotifications Android source not found: ${localNotificationPath}`);
}

let localNotification = fs.readFileSync(localNotificationPath, 'utf8');

if (!localNotification.includes(PATCH_MARKER)) {
  const stockSetter = `var largeIcon: String? = null
        set(value) {
            field = AssetUtil.getResourceBaseName(value)
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

  const stockResolver = `fun resolveLargeIcon(context: Context): Bitmap? {
        largeIcon?.let {
            val resId = AssetUtil.getResourceID(context, it, "drawable")
            return BitmapFactory.decodeResource(context.resources, resId)
        }
        return null
    }`;

  const patchedResolver = `fun resolveLargeIcon(context: Context): Bitmap? {
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

  if (!localNotification.includes(stockSetter) || !localNotification.includes(stockResolver)) {
    throw new Error(
      'Unsupported @capacitor/local-notifications source: expected largeIcon blocks were not found. ' +
      'Refusing to apply a partial notification patch.'
    );
  }

  localNotification = localNotification
    .replace(stockSetter, patchedSetter)
    .replace(stockResolver, patchedResolver);

  fs.writeFileSync(localNotificationPath, localNotification, 'utf8');
  console.log('✅ Patched LocalNotification.kt for safe local-file large icons.');
} else {
  console.log('ℹ️ LocalNotification.kt already contains the SeenIt local-file icon patch.');
}

// Older SeenIt builds patched LocalNotificationManager.kt to decode Base64 and
// attachments as BigPictureStyle. Besides being brittle across plugin updates,
// that path was involved in the historical TransactionTooLargeException / Kotlin
// regressions. A clean npm ci already restores the stock manager; this cleanup
// also makes repeated local installs converge to the same safe state.
if (fs.existsSync(localNotificationManagerPath)) {
  let manager = fs.readFileSync(localNotificationManagerPath, 'utf8');
  const hasLegacyBigPicturePatch = manager.includes('var bigPictureBitmap: Bitmap? = null');

  if (hasLegacyBigPicturePatch) {
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

    if (manager.includes('largeIconBitmap') || manager.includes('bigPictureBitmap')) {
      throw new Error('Legacy notification bitmap patch cleanup left unexpected bitmap variables behind.');
    }

    fs.writeFileSync(localNotificationManagerPath, manager, 'utf8');
    console.log('✅ Removed legacy SeenIt BigPicture/Base64 patch from LocalNotificationManager.kt.');
  }
}
