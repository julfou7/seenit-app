const fs = require('fs');
const path = require('path');

const pluginDir = path.join(__dirname, '..', 'node_modules', '@capacitor', 'local-notifications', 'android', 'src', 'main', 'kotlin', 'com', 'capacitorjs', 'plugins', 'localnotifications');

const localNotificationPath = path.join(pluginDir, 'LocalNotification.kt');
const localNotificationManagerPath = path.join(pluginDir, 'LocalNotificationManager.kt');

if (fs.existsSync(localNotificationPath)) {
  let content = fs.readFileSync(localNotificationPath, 'utf8');
  
  // Patch resolveLargeIcon and largeIcon setter
  if (!content.includes('android.util.Base64.decode')) {
    content = content.replace(
      /var largeIcon: String\? = null\s+set\(value\) \{\s+field = AssetUtil\.getResourceBaseName\(value\)\s+\}/,
      `var largeIcon: String? = null
        set(value) {
            field = if (value != null && (value.startsWith("data:") || value.startsWith("/") || value.startsWith("file://") || value.startsWith("http"))) value else AssetUtil.getResourceBaseName(value)
        }`
    );

    content = content.replace(
      /fun resolveLargeIcon\(context: Context\): Bitmap\? \{\s+largeIcon\?\.let \{\s+val resId = AssetUtil\.getResourceID\(context, it, "drawable"\)\s+return BitmapFactory\.decodeResource\(context\.resources, resId\)\s+\}\s+return null\s+\}/,
      `fun resolveLargeIcon(context: Context): Bitmap? {
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
    }`
    );

    fs.writeFileSync(localNotificationPath, content, 'utf8');
    console.log('✅ Patched LocalNotification.kt successfully.');
  }
}

if (fs.existsSync(localNotificationManagerPath)) {
  let content = fs.readFileSync(localNotificationManagerPath, 'utf8');

  // Add Bitmap imports if missing
  if (!content.includes('import android.graphics.Bitmap')) {
    content = content.replace(
      'import android.graphics.Color',
      'import android.graphics.Bitmap\nimport android.graphics.BitmapFactory\nimport android.graphics.Color'
    );
  }

  // Ensure fresh replacement for buildNotification logic
  const originalOrPatchedStyleRegex = /var bigPictureBitmap: Bitmap\? = null[\s\S]*?mBuilder\.setStyle\(bigPicStyle\)[\s\S]*?mBuilder\.setStyle\(inboxStyle\)\s*\}/m;
  const standardStyleRegex = /if \(localNotification\.largeBody != null\) \{\s*mBuilder\.setStyle\(\s*NotificationCompat\.BigTextStyle\(\)\s*\.bigText\(localNotification\.largeBody\)\s*\.setSummaryText\(localNotification\.summaryText\)\s*\)\s*\}\s*localNotification\.inboxList\?\.let \{\s*lines ->\s*val inboxStyle = NotificationCompat\.InboxStyle\(\)\s*for \(line in lines\) inboxStyle\.addLine\(line\)\s*inboxStyle\.setBigContentTitle\(localNotification\.title\)\s*inboxStyle\.setSummaryText\(localNotification\.summaryText\)\s*mBuilder\.setStyle\(inboxStyle\)\s*\}/m;

  const targetReplacement = `val largeIconBitmap = localNotification.resolveLargeIcon(context)
        var bigPictureBitmap: Bitmap? = null
        val attachments = localNotification.attachments
        if (!attachments.isNullOrEmpty()) {
            for (attachment in attachments) {
                val url = attachment.url ?: continue
                try {
                    if (url.startsWith("data:image/")) {
                        val base64Data = url.substringAfter("base64,")
                        val decodedBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                        bigPictureBitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                        if (bigPictureBitmap != null) break
                    } else if (url.startsWith("/") || url.startsWith("file://")) {
                        val filePath = url.removePrefix("file://")
                        bigPictureBitmap = BitmapFactory.decodeFile(filePath)
                        if (bigPictureBitmap != null) break
                    }
                } catch (e: Exception) {
                    android.util.Log.w("LocalNotification", "Failed to decode attachment image: " + e.message)
                }
            }
        }

        if (bigPictureBitmap != null) {
            val bigPicStyle = NotificationCompat.BigPictureStyle()
                .bigPicture(bigPictureBitmap)
                .setBigContentTitle(localNotification.title)
                .setSummaryText(localNotification.body)
            if (largeIconBitmap != null) {
                bigPicStyle.bigLargeIcon(null as Bitmap?)
            }
            mBuilder.setStyle(bigPicStyle)
        } else if (localNotification.largeBody != null) {
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

  if (originalOrPatchedStyleRegex.test(content)) {
    content = content.replace(originalOrPatchedStyleRegex, targetReplacement);
  } else if (standardStyleRegex.test(content)) {
    content = content.replace(standardStyleRegex, targetReplacement);
  }

  // Handle setLargeIcon call in builder
  content = content.replace(
    /mBuilder\.setLargeIcon\(localNotification\.resolveLargeIcon\(context\)\)/g,
    `if (largeIconBitmap != null) {\n            mBuilder.setLargeIcon(largeIconBitmap)\n        }`
  );

  // If there's duplicate 'val largeIconBitmap = localNotification.resolveLargeIcon(context)' later in the method, simplify it
  content = content.replace(
    /val largeIconBitmap = localNotification\.resolveLargeIcon\(context\)\s+if \(largeIconBitmap != null\) \{\s+mBuilder\.setLargeIcon\(largeIconBitmap\)\s+\}/g,
    `if (largeIconBitmap != null) {\n            mBuilder.setLargeIcon(largeIconBitmap)\n        }`
  );

  fs.writeFileSync(localNotificationManagerPath, content, 'utf8');
  console.log('✅ Patched LocalNotificationManager.kt successfully.');
}
