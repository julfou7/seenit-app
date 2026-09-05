const fs = require('node:fs');

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Motif introuvable: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Motif non unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const clientPath = 'src/features/release/releaseUpdatePushClient.ts';
let client = fs.readFileSync(clientPath, 'utf8');
client = replaceOnce(
  client,
  "const VERSION_RE = /^\\d+\\.\\d+\\.\\d+$/;\n",
  "const VERSION_RE = /^\\d+\\.\\d+\\.\\d+$/;\nlet pendingAppUpdateAvailablePush: AppUpdateAvailablePushData | null = null;\n",
  'pending update push state'
);
client = replaceOnce(
  client,
  "export async function handleAppUpdateAvailablePush(\n",
  [
    'export function queueAppUpdateAvailablePush(data: unknown): boolean {',
    '  if (!isAppUpdateAvailablePush(data)) return false;',
    '  pendingAppUpdateAvailablePush = {',
    '    type: APP_UPDATE_AVAILABLE_PUSH_TYPE,',
    '    version: data.version.trim()',
    '  };',
    '  return true;',
    '}',
    '',
    'export function consumeAppUpdateAvailablePush(): AppUpdateAvailablePushData | null {',
    '  const pending = pendingAppUpdateAvailablePush;',
    '  pendingAppUpdateAvailablePush = null;',
    '  return pending;',
    '}',
    '',
    'export async function handleAppUpdateAvailablePush('
  ].join('\n'),
  'queue/consume helpers'
);
fs.writeFileSync(clientPath, client);

const clientTestPath = 'tests/releaseUpdatePushClient.test.ts';
let clientTest = fs.readFileSync(clientTestPath, 'utf8');
clientTest = replaceOnce(
  clientTest,
  "import { handleAppUpdateAvailablePush } from '../src/features/release/releaseUpdatePushClient.ts';\n",
  [
    "import {",
    "  consumeAppUpdateAvailablePush,",
    "  handleAppUpdateAvailablePush,",
    "  queueAppUpdateAvailablePush",
    "} from '../src/features/release/releaseUpdatePushClient.ts';"
  ].join('\n') + '\n',
  'client test imports'
);
clientTest += `\n\ntest('SEENIT-UPDATE-003 conserve le clic Android reçu avant le montage de MainApp', () => {\n  consumeAppUpdateAvailablePush();\n  assert.equal(queueAppUpdateAvailablePush({ type: 'DOWNLOAD_EVENT', version: '1.4.115' }), false);\n  assert.equal(queueAppUpdateAvailablePush({ type: 'APP_UPDATE_AVAILABLE', version: ' 1.4.115 ' }), true);\n  assert.deepEqual(consumeAppUpdateAvailablePush(), {\n    type: 'APP_UPDATE_AVAILABLE',\n    version: '1.4.115'\n  });\n  assert.equal(consumeAppUpdateAvailablePush(), null);\n});\n`;
fs.writeFileSync(clientTestPath, clientTest);

const firebasePath = 'src/lib/firebase.ts';
let firebase = fs.readFileSync(firebasePath, 'utf8');
firebase = replaceOnce(
  firebase,
  "import { resolveSeenItApiUrl } from './seenitApi';\n",
  "import { resolveSeenItApiUrl } from './seenitApi';\nimport { queueAppUpdateAvailablePush } from '../features/release/releaseUpdatePushClient';\n",
  'firebase queue import'
);
firebase = replaceOnce(
  firebase,
  [
    "    PushNotifications.addListener('pushNotificationActionPerformed', action => {",
    "      const data = action.notification?.data || {};",
    "      window.dispatchEvent(new CustomEvent('capacitor-notification-action', {",
    "        detail: { ...data, type: data.type || 'DOWNLOAD_EVENT' }",
    "      }));",
    "    });"
  ].join('\n'),
  [
    "    PushNotifications.addListener('pushNotificationActionPerformed', action => {",
    "      const data = action.notification?.data || {};",
    "      const payload = { ...data, type: data.type || 'DOWNLOAD_EVENT' };",
    "      queueAppUpdateAvailablePush(payload);",
    "      window.dispatchEvent(new CustomEvent('capacitor-notification-action', {",
    "        detail: payload",
    "      }));",
    "    });"
  ].join('\n'),
  'native push cold-start queue'
);
fs.writeFileSync(firebasePath, firebase);

const appPath = 'src/App.tsx';
let app = fs.readFileSync(appPath, 'utf8');
app = replaceOnce(
  app,
  "import { handleAppUpdateAvailablePush, isAppUpdateAvailablePush } from './features/release/releaseUpdatePushClient';\n",
  "import { consumeAppUpdateAvailablePush, handleAppUpdateAvailablePush, isAppUpdateAvailablePush } from './features/release/releaseUpdatePushClient';\n",
  'App consume import'
);
app = replaceOnce(
  app,
  [
    "      if (isAppUpdateAvailablePush(data)) {",
    "        void handleAppUpdateAvailablePush(",
    "          data,",
    "          useUpdateStore.getState().checkForUpdates",
    "        );",
    "        return;",
    "      }"
  ].join('\n'),
  [
    "      if (isAppUpdateAvailablePush(data)) {",
    "        consumeAppUpdateAvailablePush();",
    "        void handleAppUpdateAvailablePush(",
    "          data,",
    "          useUpdateStore.getState().checkForUpdates",
    "        );",
    "        return;",
    "      }"
  ].join('\n'),
  'clear queued live update'
);
app = replaceOnce(
  app,
  "    window.addEventListener('capacitor-notification-action' as any, handleCapacitorAction);\n\n    let bc: BroadcastChannel | null = null;",
  [
    "    window.addEventListener('capacitor-notification-action' as any, handleCapacitorAction);",
    '',
    '    const pendingAppUpdatePush = consumeAppUpdateAvailablePush();',
    '    if (pendingAppUpdatePush) {',
    '      handleNotificationMessage(pendingAppUpdatePush);',
    '    }',
    '',
    '    let bc: BroadcastChannel | null = null;'
  ].join('\n'),
  'consume queued update after listener registration'
);
fs.writeFileSync(appPath, app);

const workflowTestPath = 'tests/releaseUpdatePushWorkflow.test.ts';
let workflowTest = fs.readFileSync(workflowTestPath, 'utf8');
workflowTest = replaceOnce(
  workflowTest,
  "const app = readFileSync('src/App.tsx', 'utf8');\n",
  "const app = readFileSync('src/App.tsx', 'utf8');\nconst firebase = readFileSync('src/lib/firebase.ts', 'utf8');\n",
  'workflow test firebase source'
);
workflowTest = replaceOnce(
  workflowTest,
  "  assert.match(app, /useUpdateStore\\.getState\\(\\)\\.checkForUpdates/);\n",
  "  assert.match(app, /useUpdateStore\\.getState\\(\\)\\.checkForUpdates/);\n  assert.match(firebase, /queueAppUpdateAvailablePush\\(payload\\)/);\n  assert.match(app, /consumeAppUpdateAvailablePush\\(\\)/);\n",
  'workflow test cold-start wiring'
);
fs.writeFileSync(workflowTestPath, workflowTest);
