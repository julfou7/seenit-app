const { execFileSync } = require('node:child_process');
const {
  classifyDelivery,
  readAt,
  readGitChanges
} = require('./classify-delivery.cjs');

const VERSION_ONLY_PATTERNS = {
  'android/app/build.gradle': [
    /^versionCode\s+\d+$/,
    /^versionName\s+"\d+\.\d+\.\d+"$/
  ],
  'docs/specifications/android-contract.json': [
    /^"applicationVersion":\s*"\d+\.\d+\.\d+",?$/,
    /^"versionCode":\s*\d+,?$/
  ],
  'docs/specifications/requirements.json': [
    /^"applicationVersion":\s*"\d+\.\d+\.\d+",?$/
  ],
  'docs/specifications/seenit.md': [
    /^Version applicative\s*:\s*\*\*\d+\.\d+\.\d+\*\*$/
  ],
  'package-lock.json': [
    /^"version":\s*"\d+\.\d+\.\d+",?$/
  ],
  'package.json': [
    /^"version":\s*"\d+\.\d+\.\d+",?$/
  ],
  'server.ts': [
    /^'X-Plex-Version':\s*'\d+\.\d+\.\d+',?$/
  ],
  'src/store/updateStore.ts': [
    /^export const CURRENT_APP_VERSION\s*=\s*'\d+\.\d+\.\d+';$/
  ]
};

function normalizePath(file) {
  return String(file || '').trim().replace(/\\/g, '/');
}

function getChangedContentLines(patch) {
  return String(patch || '')
    .split(/\r?\n/)
    .filter(line => (line.startsWith('+') && !line.startsWith('+++'))
      || (line.startsWith('-') && !line.startsWith('---')))
    .map(line => line.slice(1).trim())
    .filter(Boolean);
}

function isVersionOnlyPatch(file, patch) {
  const patterns = VERSION_ONLY_PATTERNS[normalizePath(file)];
  if (!patterns) return false;
  const lines = getChangedContentLines(patch);
  return lines.length > 0 && lines.every(line => patterns.some(pattern => pattern.test(line)));
}

function isPureVersionAlignment(changedFiles, readPatch) {
  return changedFiles.length > 0 && changedFiles.every(file => {
    const normalized = normalizePath(file);
    if (!VERSION_ONLY_PATTERNS[normalized]) return false;
    return isVersionOnlyPatch(normalized, readPatch(normalized));
  });
}

function isBehavioralFile(file) {
  const normalized = normalizePath(file);
  return (normalized.startsWith('src/') && normalized !== 'src/store/updateStore.ts')
    || normalized === 'server.ts'
    || normalized.startsWith('android/app/src/')
    || normalized === 'public/firebase-messaging-sw.js'
    || normalized === 'capacitor.config.ts';
}

function requiresSpecification(file) {
  const normalized = normalizePath(file);
  return normalized.startsWith('android/app/src/')
    || normalized === 'capacitor.config.ts'
    || normalized === 'src/lib/firebase.ts'
    || normalized === 'src/lib/firebase-admin.ts'
    || normalized === 'src/lib/apiAuth.ts'
    || normalized === 'src/lib/seenitApi.ts'
    || normalized.startsWith('src/features/plex/')
    || normalized === 'src/features/downloads/downloadBackendSecurity.ts'
    || normalized === 'firebase-applet-config.json'
    || normalized === 'android/app/google-services.json';
}

function main() {
  const base = String(process.env.SPEC_BASE_SHA || '').trim();
  const head = String(process.env.GITHUB_SHA || 'HEAD').trim();

  if (!/^[a-f0-9]{40}$/i.test(base) || /^0{40}$/.test(base)) {
    console.log('[SPEC] Contrat de changement ignoré : aucune base Git fournie.');
    return 0;
  }

  let changedFiles;
  let deliveryClassification;
  try {
    const changes = readGitChanges(base, head);
    changedFiles = changes.map(change => normalizePath(change.path));
    deliveryClassification = classifyDelivery({
      changes,
      readBefore: file => readAt(base, file),
      readAfter: file => readAt(head, file)
    });
  } catch (error) {
    console.error('[SPEC] Impossible de calculer les fichiers modifiés :', error.message);
    return 1;
  }

  const declaredMode = String(process.env.DELIVERY_MODE || '').toLowerCase();
  if (declaredMode && declaredMode !== deliveryClassification.mode) {
    console.error(
      `[SPEC] La classe déclarée ${declaredMode} ne correspond pas au diff contrôlé (${deliveryClassification.mode}).`
    );
    return 1;
  }

  if (deliveryClassification.mode === 'light') {
    console.log('[SPEC] Changement light vérifié : aucun contrat comportemental supplémentaire.');
    return 0;
  }

  const readPatch = file => execFileSync(
    'git',
    ['diff', '--unified=0', `${base}..${head}`, '--', file],
    { encoding: 'utf8' }
  );

  try {
    if (isPureVersionAlignment(changedFiles, readPatch)) {
      console.log('[SPEC] Alignement de version pur : contrat comportemental non requis.');
      return 0;
    }
  } catch (error) {
    console.error('[SPEC] Impossible de vérifier l’alignement de version :', error.message);
    return 1;
  }

  const behavioralFiles = changedFiles.filter(isBehavioralFile);
  if (behavioralFiles.length === 0) {
    console.log('[SPEC] Aucun comportement applicatif modifié.');
    return 0;
  }

  const hasAutomatedTests = changedFiles.some(file => /^tests\/.+\.test\.ts$/.test(file));
  if (!hasAutomatedTests) {
    console.error('[SPEC] Changement comportemental sans test automatisé ciblé.');
    console.error(`[SPEC] Fichiers applicatifs : ${behavioralFiles.join(', ')}`);
    console.error('[SPEC] Ajoute ou adapte au moins un test dans tests/*.test.ts.');
    return 1;
  }

  const sensitiveFiles = behavioralFiles.filter(requiresSpecification);
  if (sensitiveFiles.length > 0) {
    const hasSpecification = changedFiles.includes('docs/specifications/seenit.md')
      && changedFiles.includes('docs/specifications/requirements.json');
    if (!hasSpecification) {
      console.error('[SPEC] Changement sensible sans mise à jour de la SPEC et du catalogue.');
      console.error(`[SPEC] Zones sensibles : ${sensitiveFiles.join(', ')}`);
      return 1;
    }
    console.log(`[SPEC] Contrat complet requis et présent pour ${sensitiveFiles.length} fichier(s) sensible(s).`);
    return 0;
  }

  console.log(
    `[SPEC] ${behavioralFiles.length} fichier(s) comportemental(aux) couvert(s) par des tests ; ` +
    'aucune nouvelle exigence durable n’est imposée artificiellement.'
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  VERSION_ONLY_PATTERNS,
  getChangedContentLines,
  isBehavioralFile,
  isVersionOnlyPatch,
  isPureVersionAlignment,
  main,
  requiresSpecification
};
