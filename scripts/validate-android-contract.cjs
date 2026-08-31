const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'docs/specifications/android-contract.json');

function read(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Chemin hors dépôt refusé : ${relativePath}`);
  }
  return fs.readFileSync(absolutePath);
}

function readText(relativePath) {
  return read(relativePath).toString('utf8');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readPngDimensions(buffer, label) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${label} n'est pas un PNG valide.`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function requireIncludes(source, expected, label) {
  if (!source.includes(expected)) throw new Error(`${label} absent : ${expected}`);
}

function validateAndroidContract() {
  const contract = JSON.parse(readText('docs/specifications/android-contract.json'));
  const gradle = readText('android/app/build.gradle');
  const manifest = readText('android/app/src/main/AndroidManifest.xml');
  const strings = readText('android/app/src/main/res/values/strings.xml');
  const capacitor = readText('capacitor.config.ts');
  const seenitApi = readText('src/lib/seenitApi.ts');
  const packageJson = JSON.parse(readText('package.json'));
  const workflow = readText('.github/workflows/build-apk.yml');

  if (contract.schemaVersion !== 1) throw new Error('schemaVersion Android invalide.');
  const versionName = gradle.match(/versionName\s+["']([^"']+)["']/)?.[1];
  const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
  const expectedCode = Number(contract.applicationVersion.split('.')[0]) * 100000
    + Number(contract.applicationVersion.split('.')[1]) * 1000
    + Number(contract.applicationVersion.split('.')[2]);
  if (versionName !== contract.applicationVersion || packageJson.version !== contract.applicationVersion) {
    throw new Error(`Version APK/package incohérente avec ${contract.applicationVersion}.`);
  }
  if (versionCode !== contract.versionCode || versionCode !== expectedCode) {
    throw new Error(`versionCode ${versionCode} invalide, attendu ${contract.versionCode}.`);
  }

  requireIncludes(gradle, `applicationId "${contract.applicationId}"`, 'applicationId Android');
  requireIncludes(capacitor, `appId: '${contract.applicationId}'`, 'appId Capacitor');
  requireIncludes(capacitor, `appName: '${contract.appName}'`, 'nom Capacitor');
  requireIncludes(capacitor, `backgroundColor: '#040406'`, 'fond natif anti-flash');
  requireIncludes(capacitor, `overlaysWebView: false`, 'safe area StatusBar');
  requireIncludes(seenitApi, `SEENIT_API_ORIGIN = '${contract.apiOrigin}'`, 'origine API native');
  requireIncludes(strings, `<string name="app_name">${contract.appName}</string>`, 'nom du lanceur');
  requireIncludes(strings, `<string name="custom_url_scheme">${contract.customUrlScheme}</string>`, 'deep link SeenIt');
  requireIncludes(manifest, 'android:icon="@mipmap/ic_launcher"', 'icône du lanceur');
  requireIncludes(manifest, 'android:roundIcon="@mipmap/ic_launcher_round"', 'icône ronde du lanceur');
  requireIncludes(manifest, 'android:name=".MainActivity"', 'activité principale');
  requireIncludes(manifest, '<category android:name="android.intent.category.LAUNCHER"', 'intent LAUNCHER');
  for (const permission of contract.requiredPermissions) {
    requireIncludes(manifest, `android:name="${permission}"`, `permission ${permission}`);
  }

  const signingFile = read(contract.signing.path);
  if (sha256(signingFile) !== contract.signing.sha256) {
    throw new Error('La clé de signature APK a changé : une mise à jour sur place deviendrait impossible.');
  }

  for (const asset of contract.brandAssets) {
    const content = read(asset.path);
    const dimensions = readPngDimensions(content, asset.path);
    if (dimensions.width !== asset.width || dimensions.height !== asset.height) {
      throw new Error(`${asset.path} mesure ${dimensions.width}x${dimensions.height}, attendu ${asset.width}x${asset.height}.`);
    }
    if (content.length < 1024) throw new Error(`${asset.path} semble vide ou corrompu.`);
    if (asset.sha256 && sha256(content) !== asset.sha256) {
      throw new Error(`${asset.path} ne correspond plus à l'icône SeenIt de référence.`);
    }
  }
  for (const requiredFile of contract.requiredFiles) read(requiredFile);

  requireIncludes(workflow, './gradlew --no-daemon assembleDebug', 'build APK reproductible via wrapper');
  requireIncludes(workflow, 'SeenIt-v${VERSION}.apk', 'nom de l’APK versionné');
  if (/git\s+(commit|push)/.test(workflow)) {
    throw new Error('La CI ne doit jamais modifier automatiquement la branche main.');
  }

  return { contract, assetCount: contract.brandAssets.length };
}

if (require.main === module) {
  try {
    const result = validateAndroidContract();
    console.log(`[APK] Contrat ${result.contract.applicationId} v${result.contract.applicationVersion} validé : ${result.assetCount} icônes contrôlées.`);
  } catch (error) {
    console.error(`[APK] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { validateAndroidContract };
