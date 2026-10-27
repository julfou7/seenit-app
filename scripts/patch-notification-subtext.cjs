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
