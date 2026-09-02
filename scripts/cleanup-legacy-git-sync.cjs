const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, content) => fs.writeFileSync(path, content);

function replaceExact(path, before, after, label) {
  const source = read(path);
  if (!source.includes(before)) {
    throw new Error(`Bloc introuvable pour ${label} dans ${path}`);
  }
  write(path, source.replace(before, after));
}

function replaceRegex(path, regex, after, label) {
  const source = read(path);
  if (!regex.test(source)) {
    throw new Error(`Motif introuvable pour ${label} dans ${path}`);
  }
  write(path, source.replace(regex, after));
}

console.log('[cleanup] Synchronisation de la version 1.4.101...');
execFileSync(process.execPath, ['scripts/sync-app-version.cjs', '1.4.101'], { stdio: 'inherit' });

console.log('[cleanup] Retrait de la surface Git des Réglages...');
replaceExact(
  'src/screens/SettingsScreen.tsx',
  'DownloadCloud, GitBranch, GitPullRequest } from \'lucide-react\';',
  'DownloadCloud } from \'lucide-react\';',
  'icônes Git'
);
replaceExact(
  'src/screens/SettingsScreen.tsx',
  "import { authenticatedFetch } from '../lib/apiAuth';\n\ntype GitAccessState = 'checking' | 'allowed' | 'denied';\n\n",
  '',
  'transport Git UI'
);
replaceRegex(
  'src/screens/SettingsScreen.tsx',
  /\n  \/\/ Git Sync state[\s\S]*?\n  useEffect\(\(\) => \{\n    let interval: any;/,
  '\n  useEffect(() => {\n    let interval: any;',
  'état et handlers Git'
);
replaceRegex(
  'src/screens/SettingsScreen.tsx',
  /\n              \{\/\* GitHub Git Sync Card \*\/\}[\s\S]*?\n              \{\/\* Updater Progress \*\/\}/,
  '\n              {/* Updater Progress */}',
  'carte GitHub'
);

console.log('[cleanup] Retrait des routes et commandes Git serveur...');
replaceExact('server.ts', 'import { exec } from "node:child_process";\n', '', 'import exec');
replaceExact('server.ts', 'import { promisify } from "node:util";\n', '', 'import promisify');
replaceExact('server.ts', 'import { isSeenItGitAdmin } from "./src/features/admin/gitAdminPolicy.ts";\n', '', 'import policy Git');
replaceRegex(
  'server.ts',
  /\nexport const requireGitAdmin = \(req: AuthRequest, res: Response, next: NextFunction\) => \{[\s\S]*?\n\};\n\nconst WEBHOOK_SECRET_HEADER/,
  '\nconst WEBHOOK_SECRET_HEADER',
  'middleware admin Git'
);
replaceRegex(
  'server.ts',
  /\n  const execAsync = promisify\(exec\);[\s\S]*?\n  app\.get\('\/api\/update'/,
  "\n  app.get('/api/update'",
  'routes Git serveur'
);

console.log('[cleanup] Nettoyage de la configuration et du package...');
const packageJson = JSON.parse(read('package.json'));
delete packageJson.scripts['git:pull'];
write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
replaceRegex(
  '.env.example',
  /\n# Liste explicite des UID Firebase autorisés à administrer la synchronisation Git[^\n]*\nSEENIT_ADMIN_UIDS=\n?/,
  '\n',
  'SEENIT_ADMIN_UIDS'
);

console.log('[cleanup] Mise à jour de la SPEC et du catalogue...');
let spec = read('docs/specifications/seenit.md');
spec = spec.replace('Dernière mise à jour : 1er septembre 2026', 'Dernière mise à jour : 2 septembre 2026');
spec = spec.replace('Version applicative : **1.4.100**', 'Version applicative : **1.4.101**');
const oldSecurity = `- **SEENIT-SECURITY-002** — Les routes de diagnostic et de synchronisation Git exigent une session\n  Firebase SeenIt puis un UID présent exactement dans l'allowlist serveur \`SEENIT_ADMIN_UIDS\`. Une\n  allowlist absente ou vide refuse tout accès Git, notamment en production. Un UID non administrateur\n  reçoit uniquement un \`403\` générique, sans chemin, sortie de commande ou détail d'exploitation ;\n  les clients PWA/APK utilisent le transport authentifié commun et ne rendent la section Git qu'après\n  confirmation de l'autorisation par le serveur.\n`;
const newSecurity = `- **SEENIT-SECURITY-002** — SeenIt n'expose aucune route API, commande serveur ou action UI\n  permettant de lire, modifier ou synchroniser le dépôt Git depuis le runtime PWA/APK. La synchronisation\n  du code est une responsabilité externe à l'application et repose sur l'intégration native Google AI\n  Studio ↔ GitHub. Aucun PAT GitHub n'est utilisé pour exécuter des commandes Git ; \`GITHUB_PAT\` reste\n  réservé au fallback de lecture de la dernière release dans \`/api/update\`.\n`;
if (!spec.includes(oldSecurity)) throw new Error('Exigence SEENIT-SECURITY-002 historique introuvable');
spec = spec.replace(oldSecurity, newSecurity);
write('docs/specifications/seenit.md', spec);

const catalog = JSON.parse(read('docs/specifications/requirements.json'));
const requirement = catalog.requirements.find((item) => item.id === 'SEENIT-SECURITY-002');
if (!requirement) throw new Error('SEENIT-SECURITY-002 absent du catalogue');
requirement.title = 'Aucune synchronisation Git embarquée dans le runtime SeenIt';
requirement.implementedBy = ['server.ts', 'src/screens/SettingsScreen.tsx', '.env.example', 'package.json'];
requirement.verifiedBy = ['tests/apiSurface.test.ts'];
write('docs/specifications/requirements.json', `${JSON.stringify(catalog, null, 2)}\n`);

let registry = read('docs/requests/registry.md');
const registryRow = "| USR-2026-09-02-001 | 2026-09-02 | La synchronisation du code SeenIt est assurée uniquement par l’intégration native Google AI Studio ↔ GitHub ; l’application ne doit plus embarquer de commande, route ou interface de `git pull`. | `SEENIT-SECURITY-002`, [issue #33](https://github.com/julfou7/seenit-app/issues/33) | active |\n";
if (!registry.includes('USR-2026-09-02-001')) registry += registryRow;
write('docs/requests/registry.md', registry);

console.log('[cleanup] Renforcement du test de surface API...');
write('tests/apiSurface.test.ts', `import assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport test from 'node:test';\n\ntest('le backend enregistre les routes API avant le middleware frontend', () => {\n  const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');\n\n  const lastApiRoute = Math.max(\n    server.lastIndexOf("app.get('/api/"),\n    server.lastIndexOf("app.post('/api/")\n  );\n  const viteMiddleware = server.indexOf('app.use(vite.middlewares)');\n  const staticMiddleware = server.indexOf('app.use(express.static(distPath))');\n\n  assert.ok(lastApiRoute >= 0, 'au moins une route API doit être enregistrée');\n  assert.ok(viteMiddleware > lastApiRoute, 'le middleware Vite doit être enregistré après les routes API');\n  assert.ok(staticMiddleware > lastApiRoute, 'le middleware statique doit être enregistré après les routes API');\n});\n\ntest('SEENIT-SECURITY-002 retire toute synchronisation Git embarquée', () => {\n  const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');\n  const settings = fs.readFileSync(new URL('../src/screens/SettingsScreen.tsx', import.meta.url), 'utf8');\n  const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');\n  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));\n\n  assert.equal(server.includes('/api/git/status'), false);\n  assert.equal(server.includes('/api/git/pull'), false);\n  assert.equal(server.includes('requireGitAdmin'), false);\n  assert.equal(server.includes('gitAdminPolicy'), false);\n  assert.equal(settings.includes('/api/git/'), false);\n  assert.equal(settings.includes('Code GitHub (Git Pull)'), false);\n  assert.equal(envExample.includes('SEENIT_ADMIN_UIDS'), false);\n  assert.equal(packageJson.scripts['git:pull'], undefined);\n  assert.equal(fs.existsSync(new URL('../scripts/pull.sh', import.meta.url)), false);\n  assert.equal(fs.existsSync(new URL('../src/features/admin/gitAdminPolicy.ts', import.meta.url)), false);\n  assert.equal(fs.existsSync(new URL('./gitAdminPolicy.test.ts', import.meta.url)), false);\n\n  assert.match(server, /process\.env\.GITHUB_PAT/);\n  assert.match(server, /app\.get\('\/api\/update'/);\n});\n`);

console.log('[cleanup] Suppression des fichiers historiques...');
for (const path of [
  'scripts/pull.sh',
  'src/features/admin/gitAdminPolicy.ts',
  'tests/gitAdminPolicy.test.ts'
]) {
  if (fs.existsSync(path)) fs.rmSync(path);
}

console.log('[cleanup] Suppression des fichiers temporaires de migration...');
for (const path of [
  'scripts/cleanup-legacy-git-sync.cjs',
  '.github/workflows/one-shot-cleanup-legacy-git-sync.yml'
]) {
  if (fs.existsSync(path)) fs.rmSync(path);
}

console.log('[cleanup] Nettoyage terminé.');
