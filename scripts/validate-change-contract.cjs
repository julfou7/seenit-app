const { execFileSync } = require('node:child_process');

const base = String(process.env.SPEC_BASE_SHA || '').trim();
const head = String(process.env.GITHUB_SHA || 'HEAD').trim();

if (!/^[a-f0-9]{40}$/i.test(base) || /^0{40}$/.test(base)) {
  console.log('[SPEC] Contrat de changement ignoré : aucune base Git fournie.');
  process.exit(0);
}

let changedFiles;
try {
  changedFiles = execFileSync(
    'git',
    ['diff', '--name-only', `${base}..${head}`],
    { encoding: 'utf8' }
  )
    .split(/\r?\n/)
    .map(file => file.trim().replace(/\\/g, '/'))
    .filter(Boolean);
} catch (error) {
  console.error('[SPEC] Impossible de calculer les fichiers modifiés :', error.message);
  process.exit(1);
}

const versionOnlyFiles = new Set([
  'android/app/build.gradle',
  'src/store/updateStore.ts',
  'server.ts'
]);
if (changedFiles.length > 0 && changedFiles.every(file => versionOnlyFiles.has(file))) {
  console.log('[SPEC] Alignement de version pur : contrat comportemental non requis.');
  process.exit(0);
}

const behavioralFiles = changedFiles.filter(file =>
  (file.startsWith('src/') && file !== 'src/store/updateStore.ts')
  || file === 'server.ts'
  || file.startsWith('android/app/src/')
  || file === 'public/firebase-messaging-sw.js'
  || file === 'capacitor.config.ts'
);

if (behavioralFiles.length === 0) {
  console.log('[SPEC] Aucun comportement applicatif modifié.');
  process.exit(0);
}

const hasSpecification = changedFiles.includes('docs/specifications/seenit.md')
  && changedFiles.includes('docs/specifications/requirements.json');
const hasAutomatedTests = changedFiles.some(file => /^tests\/.+\.test\.ts$/.test(file));

if (!hasSpecification || !hasAutomatedTests) {
  console.error('[SPEC] Livraison comportementale incomplète.');
  console.error(`[SPEC] Fichiers applicatifs : ${behavioralFiles.join(', ')}`);
  if (!hasSpecification) {
    console.error('[SPEC] Mets à jour seenit.md ET requirements.json dans la même livraison.');
  }
  if (!hasAutomatedTests) {
    console.error('[SPEC] Ajoute ou adapte au moins un test automatisé dans tests/*.test.ts.');
  }
  process.exit(1);
}

console.log(`[SPEC] Contrat respecté pour ${behavioralFiles.length} fichier(s) applicatif(s).`);
