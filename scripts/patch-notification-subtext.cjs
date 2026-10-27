#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const localNotificationPath = path.join(
  root,
  'node_modules/@capacitor/local-notifications/android/src/main/java/com/capacitorjs/plugins/localnotifications/LocalNotification.java',
);
const managerPath = path.join(
  root,
  'node_modules/@capacitor/local-notifications/android/src/main/java/com/capacitorjs/plugins/localnotifications/LocalNotificationManager.java',
);

const patchOnce = (filePath, marker, replacements) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[notification-subtext] fichier introuvable: ${filePath}`);
  }

  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(marker)) return;

  for (const [needle, replacement] of replacements) {
    if (!content.includes(needle)) {
      throw new Error(`[notification-subtext] ancre introuvable dans ${path.basename(filePath)}: ${needle}`);
    }
    content = content.replace(needle, replacement);
  }

  content += `\n// ${marker}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
};

patchOnce(localNotificationPath, 'SEENIT_NOTIFICATION_SUBTEXT_PATCH', [
  [
    'public String summaryText;\n',
    'public String summaryText;\n    public String subText;\n',
  ],
  [
    'n.summaryText = jsonObject.getString("summaryText");\n',
    'n.summaryText = jsonObject.getString("summaryText");\n        n.subText = jsonObject.getString("subText");\n',
  ],
]);

patchOnce(managerPath, 'SEENIT_NOTIFICATION_SUBTEXT_PATCH', [
  [
    '.setGroupSummary(localNotification.groupSummary)\n',
    '.setGroupSummary(localNotification.groupSummary)\n                .setSubText(localNotification.subText)\n',
  ],
]);

console.log('[notification-subtext] patch appliqué');
