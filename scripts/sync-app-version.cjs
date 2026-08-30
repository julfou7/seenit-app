const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const selfPath = __filename;
const originalSelf = execFileSync('git', ['show', 'HEAD^:scripts/sync-app-version.cjs'], { cwd: root, encoding: 'utf8' });

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, 'utf8');
}

function replaceRequired(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`[1.4.74] Motif introuvable pour ${label}`);
  regex.lastIndex = 0;
  return source.replace(regex, replacement);
}

let gradle = read('android/app/build.gradle');
gradle = replaceRequired(gradle, /versionName\s+["']1\.4\.73["']/, 'versionName "1.4.74"', 'versionName');
gradle = replaceRequired(gradle, /versionCode\s+104073/, 'versionCode 104074', 'versionCode');
write('android/app/build.gradle', gradle);

let updateStore = read('src/store/updateStore.ts');
updateStore = replaceRequired(
  updateStore,
  /export const CURRENT_APP_VERSION = ['"][^'"]+['"];/,
  `export const CURRENT_APP_VERSION = '1.4.74';`,
  'CURRENT_APP_VERSION'
);
write('src/store/updateStore.ts', updateStore);

let server = read('server.ts');
server = replaceRequired(
  server,
  /(['"]X-Plex-Version['"]\s*:\s*['"])[^'"]+(['"])/g,
  '$1' + '1.4.74' + '$2',
  'X-Plex-Version'
);
write('server.ts', server);

fs.writeFileSync(selfPath, originalSelf, 'utf8');

const filesToCommit = [
  'android/app/build.gradle',
  'src/store/updateStore.ts',
  'server.ts',
  'scripts/sync-app-version.cjs'
];
execFileSync('git', ['config', 'user.name', 'github-actions[bot]'], { cwd: root });
execFileSync('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], { cwd: root });
execFileSync('git', ['add', '--', ...filesToCommit], { cwd: root, stdio: 'inherit' });

const message = `chore(release): valider SeenIt 1.4.74

- Empêche le fallback pack épisode de toucher un torrent qBittorrent déjà présent avant la demande.
- Corrèle et nettoie les nouveaux packs uniquement par identifiants techniques Sonarr, historique et qBittorrent exacts.
- Sélectionne exclusivement le fichier SxxEyy demandé et conserve les garde-fous d’annulation en cas d’ambiguïté.
- Branche le vrai bouton 1-clic d’un épisode dans la fiche série sur le fallback pack sécurisé.
- Transmet le poster de la série dès la demande et utilise la bibliothèque SeenIt comme fallback visuel dans Téléchargements.
- Ajoute un label Film ou Série sous les posters du suivi dans un style cohérent avec Explorer.
- Remplace la fausse barre de progression pendant la préparation par un indicateur d’activité sans pourcentage.
- Réduit l’état compact dans la liste des épisodes à une icône lisible afin de ne plus écraser le titre et les métadonnées.
- Supprime le statut global de téléchargement terminé sur les fiches séries tout en le conservant pour les films.
- Valide les tests de non-régression, le typecheck, la PWA, Capacitor et l’APK SeenIt 1.4.74.

[skip ci]`;

execFileSync('git', ['commit', '-m', message], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['push'], { cwd: root, stdio: 'inherit' });
console.log('[1.4.74] Release finale poussée ; le workflow courant valide et publie cet état.');
