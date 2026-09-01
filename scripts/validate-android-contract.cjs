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
  const wrapperProperties = readText('android/gradle/wrapper/gradle-wrapper.properties');
  const firebaseClient = readText('src/lib/firebase.ts');
  const firebaseAdmin = readText('src/lib/firebase-admin.ts');
  const firebaseAppletConfig = JSON.parse(readText('firebase-applet-config.json'));
  const googleServices = JSON.parse(readText('android/app/google-services.json'));

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

  if (!contract.firebase || contract.firebase.firestoreDatabaseId !== 'default') {
    throw new Error('Le contrat Firebase doit verrouiller Firestore sur default.');
  }
  requireIncludes(firebaseClient, "export const FIRESTORE_DATABASE_ID = 'default';", 'databaseId Firestore client canonique');
  if (!/FIRESTORE_DATABASE_ID\s*\)/.test(firebaseClient)) {
    throw new Error('Sélection explicite de la base Firestore client absente.');
  }
  if (firebaseClient.includes('(default)') || firebaseClient.includes('firestoreDatabaseId')) {
    throw new Error('Le client Firestore ne doit utiliser ni (default) ni firestoreDatabaseId provenant d’AI Studio.');
  }
  requireIncludes(firebaseAdmin, "getFirestore('default')", 'databaseId Firestore Admin canonique');
  if (/getFirestore\(\s*\)/.test(firebaseAdmin)) {
    throw new Error('Firebase Admin doit sélectionner explicitement la base default.');
  }
  if (firebaseAppletConfig.projectId !== contract.firebase.projectId) {
    throw new Error(`Projet Firebase Web inattendu : ${firebaseAppletConfig.projectId}.`);
  }
  const androidFirebaseClient = (googleServices.client || []).find(client =>
    client?.client_info?.android_client_info?.package_name === contract.firebase.androidPackageName
  );
  if (googleServices.project_info?.project_id !== contract.firebase.projectId) {
    throw new Error(`Projet Firebase Android inattendu : ${googleServices.project_info?.project_id || '(absent)'}.`);
  }
  if (!androidFirebaseClient) {
    throw new Error(`Package Firebase Android ${contract.firebase.androidPackageName} absent de google-services.json.`);
  }
  if (androidFirebaseClient.client_info?.mobilesdk_app_id !== contract.firebase.androidMobileSdkAppId) {
    throw new Error('mobilesdk_app_id Firebase Android inattendu.');
  }

  const signingFile = read(contract.signing.path);
  if (sha256(signingFile) !== contract.signing.sha256) {
    throw new Error('La clé de signature APK a changé : une mise à jour sur place deviendrait impossible.');
  }

  const wrapperJar = read(contract.gradleWrapper.path);
  if (sha256(wrapperJar) !== contract.gradleWrapper.sha256) {
    throw new Error('Le JAR Gradle Wrapper ne correspond plus au binaire officiel approuvé.');
  }
  requireIncludes(
    wrapperProperties,
    `distributionUrl=${contract.gradleWrapper.distributionUrl.replace(':', '\\:')}`,
    'distribution Gradle'
  );
  requireIncludes(
    wrapperProperties,
    `distributionSha256Sum=${contract.gradleWrapper.distributionSha256Sum}`,
    'empreinte de la distribution Gradle'
  );

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

  requireIncludes(
    workflow,
    './gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest',
    'build APK et AndroidTest reproductible via wrapper sur le module app'
  );
  if (/\.\/gradlew\s+--no-daemon\s+assembleDebug\s+assembleDebugAndroidTest/.test(workflow)) {
    throw new Error('La CI ne doit pas compiler les AndroidTest des modules dépendants : cibler explicitement :app:.');
  }
  requireIncludes(workflow, 'SeenIt-v${VERSION}.apk', 'nom de l’APK versionné');
  if (/gradle-version:/.test(workflow)) {
    throw new Error('La CI doit utiliser exclusivement la version définie et vérifiée par le wrapper.');
  }
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
