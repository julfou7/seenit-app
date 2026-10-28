#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

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
  'localnotifications',
);
const localNotificationPath = path.join(pluginDir, 'LocalNotification.kt');
const managerPath = path.join(pluginDir, 'LocalNotificationManager.kt');
const MARKER = 'SEENIT_NOTIFICATION_SUBTEXT_PATCH';

const patchOnce = (filePath, replacements) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[notification-subtext] fichier introuvable: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(MARKER)) return;

  for (const [needle, replacement] of replacements) {
    if (!content.includes(needle)) {
      throw new Error(`[notification-subtext] ancre introuvable dans ${path.basename(filePath)}: ${needle}`);
    }
    content = content.replace(needle, replacement);
  }

  content += `\n// ${MARKER}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
};

patchOnce(localNotificationPath, [
  [
    'var summaryText: String? = null\n',
    'var summaryText: String? = null\n    var subText: String? = null\n',
  ],
  [
    'n.summaryText = jsonObject.getString("summaryText")\n',
    'n.summaryText = jsonObject.getString("summaryText")\n            n.subText = jsonObject.getString("subText")\n',
  ],
]);

patchOnce(managerPath, [
  [
    '.setGroupSummary(localNotification.groupSummary)\n',
    '.setGroupSummary(localNotification.groupSummary)\n            .setSubText(localNotification.subText)\n',
  ],
]);

console.log('[notification-subtext] patch appliqué');

const publisherPath = path.join(pluginDir, 'TimedNotificationPublisher.kt');
const LIFE_MARKER = 'SEENIT_NOTIFICATION_LIFECYCLE_V1';
const extrasCode = `
        // ${LIFE_MARKER}: short identity only; never media bytes or credentials.
        val seenItExtra = com.getcapacitor.JSObject(localNotification.source ?: "{}").optJSONObject("extra")
        if (seenItExtra?.optString("notificationScope") == "media") {
            mBuilder.addExtras(android.os.Bundle().apply {
                putString("seenitScope", "media")
                putString("seenitOwner", seenItExtra.optString("ownerUid"))
                putString("seenitShow", seenItExtra.optString("showId"))
                putString("seenitMediaType", seenItExtra.optString("mediaType"))
            })
            if (seenItExtra.optBoolean("silent", false)) mBuilder.setSilent(true)
        }
`;
const dedupCode = (item, id) => `
        // ${LIFE_MARKER}: remove delivered alerts only, not pending future alarms.
        try {
            val candidate = ${item}
            val extra = candidate.extras
            if (extra.getString("seenitScope") == "media" && !extra.getString("seenitOwner").isNullOrEmpty()) {
                val manager = context.getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                for (active in manager.activeNotifications.take(100)) {
                    val previous = active.notification.extras
                    if (active.id != ${id} && previous.getString("seenitScope") == "media"
                        && previous.getString("seenitOwner") == extra.getString("seenitOwner")
                        && previous.getString("seenitShow") == extra.getString("seenitShow")
                        && previous.getString("seenitMediaType") == extra.getString("seenitMediaType")) {
                        manager.cancel(active.tag, active.id)
                    }
                }
            }
        } catch (_: Exception) { /* Text delivery remains available. */ }
`;
let lifetimeManager = fs.readFileSync(managerPath, 'utf8');
if (!lifetimeManager.includes(LIFE_MARKER)) {
  const extraAnchor = '        createActionIntents(localNotification, mBuilder)';
  const deliverAnchor = '            localNotification.id?.let { notificationManager.notify(it, buildNotification) }';
  const cancelAnchor = '            dismissVisibleNotification(id)';
  for (const anchor of [extraAnchor, deliverAnchor, cancelAnchor]) {
    if (!lifetimeManager.includes(anchor)) throw new Error('[notification-lifecycle] incompatible manager anchor');
  }
  lifetimeManager = lifetimeManager
    .replace(extraAnchor, extrasCode + extraAnchor)
    .replace(deliverAnchor, dedupCode('buildNotification', 'localNotification.id') + deliverAnchor)
    .replace(cancelAnchor, `            if (com.getcapacitor.JSObject(localNotification.source ?: "{}").optJSONObject("extra")?.optString("notificationScope") != "media") {
                dismissVisibleNotification(id)
            }`);
  fs.writeFileSync(managerPath, lifetimeManager, 'utf8');
}
let publisher = fs.readFileSync(publisherPath, 'utf8');
if (!publisher.includes(LIFE_MARKER)) {
  const anchor = '        notificationManager.notify(id, deliveredNotification)';
  if (!publisher.includes(anchor)) throw new Error('[notification-lifecycle] incompatible publisher anchor');
  publisher = publisher.replace(anchor, dedupCode('deliveredNotification', 'id') + anchor);
  fs.writeFileSync(publisherPath, publisher, 'utf8');
}

// If a cached picture disappeared, BigText must not reuse its caption as header.
for (const [file, owner] of [[managerPath, 'localNotification'], [publisherPath, 'storedRequest']]) {
  let content = fs.readFileSync(file, 'utf8');
  const marker = 'SEENIT_NOTIFICATION_TEXT_FALLBACK_V1';
  if (content.includes(marker)) continue;
  const pattern = new RegExp('\\.bigText\\(' + owner + '\\.largeBody\\)(\\s*)\\.setSummaryText\\(' + owner + '\\.summaryText\\)', 'g');
  let replacements = 0;
  content = content.replace(pattern, (_, whitespace) => {
    replacements += 1;
    return '.bigText(' + owner + '.largeBody)' + whitespace
      + '.setSummaryText(if (' + owner + '.subText.isNullOrEmpty()) ' + owner + '.summaryText else null)';
  });
  if (replacements !== 1) throw new Error('[notification-subtext] incompatible text fallback');
  fs.writeFileSync(file, content + '\n// ' + marker + '\n', 'utf8');
}
