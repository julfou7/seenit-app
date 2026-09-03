const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { materializeAndroidConfig } = require('./materialize-android-config.cjs');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'docs/specifications/android-contract.json');

function resolveWithinRoot(relativePath) {
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Chemin hors dépôt refusé : ${relativePath}`);
  }
  return absolutePath;
}

function read(relativePath) {
  return fs.readFileSync(resolveWithinRoot(relativePath));
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
  materializeAndroidConfig();
  const contract = JSON.parse(readText('docs/specifications/android-contract.json'));
  const gradle = readText('android/app/build.gradle');
  const manifest = readText('android/app/src/main/AndroidManifest.xml');
  const strings = readText('android/app/src/main/res/values/strings.xml');
  const styles = readText('android/app/src/main/res/values/styles.xml');
  const capacitor = readText('capacitor.config.ts');
  const app = readText('src/App.tsx');
  const login = readText('src/screens/LoginScreen.tsx');
  const indexCss = readText('src/index.css');
  const indexHtml = readText('index.html');
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

  if (!contract.systemBars
      || contract.systemBars.statusBarOverlay !== true
      || contract.systemBars.statusBarTransparent !== true
      || contract.systemBars.statusBarIconStyle !== 'light'
      || contract.systemBars.topSafeAreaRequired !== true) {
    throw new Error('Le contrat Android doit verrouiller la status bar transparente edge-to-edge et la safe area haute.');
  }
  requireIncludes(capacitor, `overlaysWebView: true`, 'overlay StatusBar edge-to-edge');
  requireIncludes(capacitor, `backgroundColor: '#00000000'`, 'fond StatusBar transparent');
  requireIncludes(capacitor, `style: 'DARK'`, 'icônes StatusBar claires sur fond sombre');
  requireIncludes(app, `StatusBar.setStyle({ style: Style.Dark })`, 'style runtime StatusBar clair sur fond sombre');
  if (capacitor.includes(`style: 'LIGHT'`) || app.includes(`StatusBar.setStyle({ style: Style.Light })`)) {
    throw new Error('Style.Light/LIGHT produit des icônes sombres et est interdit sur le fond sombre SeenIt.');
  }
  requireIncludes(app, `StatusBar.setOverlaysWebView({ overlay: true })`, 'overlay StatusBar runtime');
  requireIncludes(app, `StatusBar.setBackgroundColor({ color: '#00000000' })`, 'StatusBar runtime transparente');
  requireIncludes(styles, `<item name="android:statusBarColor">@android:color/transparent</item>`, 'statusBarColor thème Android');
  requireIncludes(indexCss, `padding-top: env(safe-area-inset-top, 0px);`, 'safe area CSS haute');
  requireIncludes(indexHtml, `viewport-fit=cover`, 'viewport edge-to-edge');
  requireIncludes(app, `overflow-hidden pt-safe`, 'safe area écran principal');
  requireIncludes(login, `overflow-hidden pt-safe`, 'safe area écran de connexion');

  if (!contract.launchSurface
      || contract.launchSurface.nativeSplashBranding !== 'transparent'
      || contract.launchSurface.webSplashComponent !== 'src/components/SplashScreen.tsx'
      || contract.launchSurface.background !== '#040406'
      || contract.launchSurface.hideAfterWebPaint !== true) {
    throw new Error('Le contrat Android doit verrouiller un splash système neutre et un unique splash Web SeenIt.');
  }
  requireIncludes(styles, `<item name="windowSplashScreenAnimatedIcon">@android:color/transparent</item>`, 'splash système Android neutre');
  if (styles.includes('@drawable/seenit_splash_icon')) {
    throw new Error('Le branding natif SeenIt recréerait un double splash et est interdit.');
  }
  if (fs.existsSync(path.resolve(root, 'android/app/src/main/res/drawable/seenit_splash_icon.xml'))) {
    throw new Error('L’ancien pictogramme de splash natif ne doit pas être réintroduit.');
  }
  const webSplash = readText(contract.launchSurface.webSplashComponent);
  requireIncludes(webSplash, `id="seenit-splash-screen"`, 'splash Web SeenIt');
  requireIncludes(app, `CapSplashScreen.hide()`, 'handoff du splash système vers le splash Web');
  if (!/requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?CapSplashScreen\.hide\(\)/.test(app)) {
    throw new Error('Le splash système doit rester masqué seulement après le premier rendu du splash Web.');
  }

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
  if (!Array.isArray(contract.firebase.androidOauthClients) || contract.firebase.androidOauthClients.length !== 1) {
    throw new Error('Le contrat Firebase doit conserver un unique client OAuth Android actif.');
  }
  const [activeAndroidOauth] = contract.firebase.androidOauthClients;
  if (!activeAndroidOauth
      || activeAndroidOauth.clientId !== contract.firebase.activeAndroidOauthClientId
      || activeAndroidOauth.certificateHash !== contract.firebase.activeAndroidCertificateHash
      || activeAndroidOauth.role !== 'active') {
    throw new Error('Le client OAuth Android actif ne correspond pas à la signature active.');
  }
  const materializedOauthClients = androidFirebaseClient.oauth_client || [];
  const materializedAndroidOauth = materializedOauthClients.filter(client => client?.client_type === 1);
  if (materializedAndroidOauth.length !== 1) {
    throw new Error('google-services.json doit contenir un unique client OAuth Android actif.');
  }
  const materializedActive = materializedAndroidOauth[0];
  if (materializedActive?.client_id !== activeAndroidOauth.clientId
      || materializedActive?.android_info?.package_name !== contract.firebase.androidPackageName
      || materializedActive?.android_info?.certificate_hash !== activeAndroidOauth.certificateHash) {
    throw new Error('Client OAuth Android matérialisé incohérent avec le contrat actif.');
  }
  const webOauth = materializedOauthClients.find(client =>
    client?.client_type === 3 && client?.client_id === contract.firebase.webOauthClientId
  );
  if (!webOauth) {
    throw new Error('Client OAuth Web Firebase attendu pour Credential Manager absent.');
  }

  const signing = contract.signing || {};
  if (signing.source !== 'github-secret'
      || signing.path !== 'android/app/seenit-release.p12'
      || signing.secretName !== 'SEENIT_ANDROID_RELEASE_KEYSTORE_B64'
      || signing.storePasswordSecretName !== 'SEENIT_ANDROID_RELEASE_STORE_PASSWORD'
      || signing.keyPasswordSecretName !== 'SEENIT_ANDROID_RELEASE_KEY_PASSWORD'
      || signing.storeType !== 'PKCS12'
      || signing.keyAlias !== 'seenit'
      || !/^[a-f0-9]{64}$/i.test(signing.sha256 || '')
      || !/^[a-f0-9]{40}$/i.test(signing.certificateSha1 || '')
      || !/^[a-f0-9]{64}$/i.test(signing.certificateSha256 || '')) {
    throw new Error('Le contrat de signature doit verrouiller la clé release PKCS12 SeenIt matérialisée depuis GitHub Secrets.');
  }
  if ('migration' in signing) {
    throw new Error('Le contrat Android stable ne doit plus contenir de branche de migration de signature.');
  }
  if (!Array.isArray(contract.generatedFiles) || !contract.generatedFiles.includes(signing.path)) {
    throw new Error('Le keystore release doit être déclaré comme artefact Android généré.');
  }
  if (Array.isArray(contract.requiredFiles) && contract.requiredFiles.includes(signing.path)) {
    throw new Error('Le keystore release ne doit pas être un fichier Git requis.');
  }
  requireIncludes(gradle, `file('seenit-release.p12')`, 'chemin du keystore release Gradle');
  requireIncludes(gradle, `System.getenv('SEENIT_ANDROID_RELEASE_STORE_PASSWORD')`, 'mot de passe store par environnement');
  requireIncludes(gradle, `System.getenv('SEENIT_ANDROID_RELEASE_KEY_PASSWORD')`, 'mot de passe clé par environnement');
  requireIncludes(gradle, `keyAlias 'seenit'`, 'alias de signature SeenIt');
  requireIncludes(gradle, `storeType 'PKCS12'`, 'type PKCS12 du keystore');
  requireIncludes(gradle, `signingConfig signingConfigs.seenitRelease`, 'signature SeenIt du build');

  const signingPath = resolveWithinRoot(signing.path);
  const signingMaterialized = fs.existsSync(signingPath);
  if (signingMaterialized) {
    const signingFile = fs.readFileSync(signingPath);
    if (sha256(signingFile) !== signing.sha256) {
      throw new Error('La clé de signature release APK ne correspond pas au contrat approuvé.');
    }
  }
  if (process.env.SEENIT_REQUIRE_ANDROID_KEYSTORE === 'true') {
    if (!signingMaterialized) {
      throw new Error('La clé de signature APK matérialisée est obligatoire pour une release.');
    }
    if (!process.env[signing.storePasswordSecretName] || !process.env[signing.keyPasswordSecretName]) {
      throw new Error('Les mots de passe de la clé de signature APK sont obligatoires pour une release.');
    }
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

  return { contract, assetCount: contract.brandAssets.length, signingMaterialized };
}

if (require.main === module) {
  try {
    const result = validateAndroidContract();
    const signingStatus = result.signingMaterialized
      ? 'clé release vérifiée'
      : 'clé release externe non requise pour cette validation';
    console.log(`[APK] Contrat ${result.contract.applicationId} v${result.contract.applicationVersion} validé : ${result.assetCount} icônes contrôlées, ${signingStatus}.`);
  } catch (error) {
    console.error(`[APK] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { validateAndroidContract };
