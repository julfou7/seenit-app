const fs = require('node:fs');

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Motif introuvable: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Motif non unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
};

const serverPath = 'server.ts';
let server = fs.readFileSync(serverPath, 'utf8');
server = replaceOnce(
  server,
  'import { adminAuth, adminDb } from "./src/lib/firebase-admin.ts";\n',
  'import { adminAuth, adminDb } from "./src/lib/firebase-admin.ts";\nimport { processReleaseUpdateNotificationRequest } from "./src/features/release/releaseUpdatePushBackend.ts";\n',
  'import backend release update push'
);
server = replaceOnce(
  server,
  "  app.get('/api/update', async (req, res) => {",
  [
    "  app.post('/api/releases/notify', rateLimit('release-notification', 30, 60_000), async (req, res) => {",
    '    const result = await processReleaseUpdateNotificationRequest(req.body, {',
    "      githubToken: process.env.GITHUB_PAT || ''",
    '    });',
    '    if (result.status === 204) return res.status(204).end();',
    '',
    "    const body = result.body || { success: false, error: 'release_notification_failed' };",
    "    if (result.status < 400 && typeof body.version === 'string') {",
    '      console.log(',
    '        `[ReleaseUpdatePush] v${body.version}: ${Number(body.sent || 0)} envoyée(s), ` +',
    '        `${Number(body.alreadySent || 0)} déjà traitée(s), ${Number(body.invalid || 0)} token(s) invalide(s).`',
    '      );',
    '    } else if (result.status >= 400) {',
    "      console.warn(`[ReleaseUpdatePush] Échec borné (${result.status}, ${String(body.error || 'retryable')}).`);",
    '    }',
    '    return res.status(result.status).json(body);',
    '  });',
    '',
    "  app.get('/api/update', async (req, res) => {"
  ].join('\n'),
  'route post-release'
);
fs.writeFileSync(serverPath, server);

const appPath = 'src/App.tsx';
let app = fs.readFileSync(appPath, 'utf8');
app = replaceOnce(
  app,
  "import { useToastStore } from './store/toastStore';\n",
  "import { useToastStore } from './store/toastStore';\nimport { useUpdateStore } from './store/updateStore';\nimport { handleAppUpdateAvailablePush, isAppUpdateAvailablePush } from './features/release/releaseUpdatePushClient';\n",
  'imports update push client'
);
app = replaceOnce(
  app,
  "    const handleNotificationMessage = (data: any) => {\n      if (!data) return;\n\n      if (data.type === 'NAVIGATE_SHOW') {",
  [
    '    const handleNotificationMessage = (data: any) => {',
    '      if (!data) return;',
    '',
    '      if (isAppUpdateAvailablePush(data)) {',
    '        void handleAppUpdateAvailablePush(',
    '          data,',
    '          useUpdateStore.getState().checkForUpdates',
    '        );',
    '        return;',
    '      }',
    '',
    "      if (data.type === 'NAVIGATE_SHOW') {"
  ].join('\n'),
  'handler APP_UPDATE_AVAILABLE'
);
fs.writeFileSync(appPath, app);

const specPath = 'docs/specifications/seenit.md';
let spec = fs.readFileSync(specPath, 'utf8');
spec = replaceOnce(
  spec,
  "- La diffusion est idempotente : une installation reçoit au plus une notification par version, même\n  en cas de reprise ou de concurrence. Les tokens restent isolés par UID et appareil ; un token invalide\n  est retiré sans bloquer les autres destinataires.\n",
  "- Le déclencheur post-release ne fait confiance à aucune preuve fournie par son appelant : le backend\n  revalide auprès de GitHub le run `Validate & Release SeenIt` terminé avec succès sur `main`, son SHA,\n  le tag correspondant, la release officielle et la paire APK/SHA-256 avant toute diffusion FCM.\n- La diffusion est idempotente : une installation reçoit au plus une notification par version, même\n  en cas de reprise ou de concurrence. Une transaction persistante réserve chaque couple version/installation ;\n  une livraison réussie n'est jamais rejouée, les échecs explicites sont repris au plus trois fois et un\n  token invalide devient terminal puis est retiré sans bloquer les autres destinataires. Les tokens restent\n  isolés par UID et appareil.\n",
  'précision UPDATE-003 backend/idempotence'
);
fs.writeFileSync(specPath, spec);

const functionalPath = 'docs/specifications/functional-reference.md';
let functional = fs.readFileSync(functionalPath, 'utf8');
functional = replaceOnce(
  functional,
  "- `POST /api/devices/register` et `DELETE /api/devices/:installationId` : appareil de notification ;\n",
  "- `POST /api/devices/register` et `DELETE /api/devices/:installationId` : appareil de notification ;\n- `POST /api/releases/notify` : signal post-release public borné, dont le run, le SHA, le tag, l'APK et\n  son SHA-256 sont revalidés auprès du dépôt officiel avant toute notification Android ;\n",
  'route release notify référence fonctionnelle'
);
functional = replaceOnce(
  functional,
  "Toutes les routes métier privées exigent un jeton Firebase du compte. Le health-check et les\nmétadonnées publiques de mise à jour sont les exceptions prévues.\n",
  "Toutes les routes métier privées exigent un jeton Firebase du compte. Le health-check, les\nmétadonnées publiques de mise à jour et le signal post-release sans donnée utilisateur sont les exceptions\nprévues ; ce dernier n'accorde aucune confiance à l'appelant et exige les preuves GitHub officielles.\n",
  'exception publique post-release'
);
fs.writeFileSync(functionalPath, functional);

const deliveryPath = 'docs/process/delivery.md';
let delivery = fs.readFileSync(deliveryPath, 'utf8');
delivery = replaceOnce(
  delivery,
  "7. publication immuable GitHub de l'APK et du SHA-256 ;\n8. validation terrain de la nouvelle APK.\n",
  "7. publication immuable GitHub de l'APK et du SHA-256 ;\n8. après terminaison réussie du workflow de release, `Notify Android APK Update` transmet uniquement\n   l'identité publique du run au backend canonique ; celui-ci revalide GitHub puis diffuse l'alerte FCM\n   Android de manière idempotente, sans rendre l'état de la release dépendant de FCM ;\n9. validation terrain de la nouvelle APK.\n",
  'étape notification post-release'
);
fs.writeFileSync(deliveryPath, delivery);

const requirementsPath = 'docs/specifications/requirements.json';
const requirements = JSON.parse(fs.readFileSync(requirementsPath, 'utf8'));
const update = requirements.requirements.find(item => item.id === 'SEENIT-UPDATE-003');
if (!update) throw new Error('SEENIT-UPDATE-003 introuvable dans requirements.json');
const additions = [
  ['tests/releaseUpdatePushBackend.test.ts', 'SEENIT-UPDATE-003 valide la release officielle avant toute diffusion Android'],
  ['tests/releaseUpdatePushBackend.test.ts', 'SEENIT-UPDATE-003 rend la diffusion Android idempotente face aux replays et à la concurrence'],
  ['tests/releaseUpdatePushBackend.test.ts', 'SEENIT-UPDATE-003 reprend seulement les échecs FCM explicites et supprime les tokens invalides'],
  ['tests/releaseUpdatePushClient.test.ts', 'SEENIT-UPDATE-003 force le contrôle canonique au toucher du push Android'],
  ['tests/releaseUpdatePushWorkflow.test.ts', 'SEENIT-UPDATE-003 déclenche l’alerte seulement après un workflow de release réussi']
];
for (const [file, contains] of additions) {
  if (!update.tests.some(test => test.file === file && test.contains === contains)) {
    update.tests.push({ file, contains });
  }
}
fs.writeFileSync(requirementsPath, `${JSON.stringify(requirements, null, 2)}\n`);
