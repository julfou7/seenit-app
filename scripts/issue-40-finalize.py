from pathlib import Path
import json


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Pattern missing in {path}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


# Kotlin support, identical toolchain to ATHIA.
replace_once(
    'android/build.gradle',
    "        classpath 'com.android.tools.build:gradle:8.13.0'\n",
    "        classpath 'com.android.tools.build:gradle:8.13.0'\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.21'\n",
)

replace_once(
    'android/app/build.gradle',
    "apply plugin: 'com.android.application'\n",
    "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'\n",
)
replace_once(
    'android/app/build.gradle',
    '        versionCode 104108\n        versionName "1.4.108"',
    '        versionCode 104109\n        versionName "1.4.109"',
)
replace_once(
    'android/app/build.gradle',
    "    signingConfigs {\n",
    "    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_21\n        targetCompatibility JavaVersion.VERSION_21\n    }\n    kotlinOptions {\n        jvmTarget = '21'\n    }\n    signingConfigs {\n",
)
replace_once(
    'android/app/build.gradle',
    '    implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"\n',
    '    implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"\n    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2"\n    implementation "androidx.credentials:credentials:1.3.0"\n    implementation "androidx.credentials:credentials-play-services-auth:1.3.0"\n    implementation "com.google.android.libraries.identity.googleid:googleid:1.1.1"\n',
)

# Register the native Capacitor plugin before BridgeActivity initialization.
replace_once(
    'android/app/src/main/java/com/seenit/app/MainActivity.java',
    "    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);",
    "    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(SeenItAuthPlugin.class);\n        super.onCreate(savedInstanceState);",
)

Path('android/app/src/main/java/com/seenit/app/SeenItAuthPlugin.kt').write_text(r'''package com.seenit.app

import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "SeenItAuth")
class SeenItAuthPlugin : Plugin() {

    @PluginMethod
    fun signInWithGoogle(call: PluginCall) {
        val currentActivity = activity
        if (currentActivity == null) {
            call.reject("AUTH_ACTIVITY_UNAVAILABLE")
            return
        }

        val clientIdResource = context.resources.getIdentifier(
            "default_web_client_id",
            "string",
            context.packageName,
        )

        if (clientIdResource == 0) {
            call.reject(
                "AUTH_FIREBASE_ANDROID_CONFIG_MISSING: ajoute google-services.json pour com.seenit.app",
            )
            return
        }

        val serverClientId = context.getString(clientIdResource).trim()
        if (serverClientId.isEmpty()) {
            call.reject("AUTH_GOOGLE_CLIENT_ID_MISSING")
            return
        }

        val googleIdOption = GetGoogleIdOption.Builder()
            .setServerClientId(serverClientId)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .build()

        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()

        val credentialManager = CredentialManager.create(context)

        CoroutineScope(Dispatchers.Main).launch {
            try {
                val response = credentialManager.getCredential(currentActivity, request)
                val credential = response.credential

                if (
                    credential is CustomCredential &&
                    credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                ) {
                    val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                    val result = JSObject()
                    result.put("idToken", googleCredential.idToken)
                    call.resolve(result)
                    return@launch
                }

                call.reject("AUTH_UNSUPPORTED_GOOGLE_CREDENTIAL")
            } catch (error: GetCredentialCancellationException) {
                call.reject("AUTH_GOOGLE_CANCELLED", error)
            } catch (error: GetCredentialException) {
                call.reject(
                    "AUTH_GOOGLE_CREDENTIAL_FAILED: ${error.message ?: error.javaClass.simpleName}",
                    error,
                )
            } catch (error: Exception) {
                call.reject(
                    "AUTH_GOOGLE_FAILED: ${error.message ?: error.javaClass.simpleName}",
                    error,
                )
            }
        }
    }
}
''')

Path('src/lib/auth').mkdir(parents=True, exist_ok=True)
Path('src/lib/auth/SeenItAuth.ts').write_text(r'''import { registerPlugin } from '@capacitor/core';

export interface SeenItAuthPlugin {
  signInWithGoogle(): Promise<{ idToken: string }>;
}

export const SeenItAuth = registerPlugin<SeenItAuthPlugin>('SeenItAuth');
''')

login = Path('src/screens/LoginScreen.tsx')
text = login.read_text()
text = text.replace(
    "import { Capacitor } from '@capacitor/core';\n",
    "import { Capacitor } from '@capacitor/core';\nimport { SeenItAuth } from '../lib/auth/SeenItAuth';\n",
    1,
)
marker = "export function LoginScreen() {"
helper = r'''const isGoogleAuthCancellation = (error: any): boolean => {
  const value = [error?.code, error?.message, typeof error === 'string' ? error : '']
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return value.includes('auth_google_cancelled')
    || value.includes('cancelled')
    || value.includes('canceled')
    || value.includes('12501');
};

'''
if marker not in text:
    raise SystemExit('LoginScreen component marker missing')
text = text.replace(marker, helper + marker, 1)

old_native = r'''      if (Capacitor.isNativePlatform()) {
        // 1. FLUX NATIF MOBILE (APK Android)
        await GoogleAuth.initialize({
          clientId: '799043440232-i9s1l0jaerljg58v3oooleuemnhnim4o.apps.googleusercontent.com',
          scopes: ['profile', 'email'],
          grantOfflineAccess: true,
        });
        const googleUser = await GoogleAuth.signIn();
        const idToken = googleUser.authentication?.idToken || (googleUser as any)?.idToken;
        if (!idToken) {
          throw new Error("Jeton d'authentification Google manquant.");
        }
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } else {
        // 2. FLUX WEB STANDARD (Navigateur)
        await signInWithPopup(auth, googleAuthProvider);
      }
'''
new_native = r'''      if (Capacitor.isNativePlatform()) {
        // UX Android primaire : même Credential Manager natif qu'ATHIA.
        let idToken: string | undefined;

        try {
          const nativeCredential = await SeenItAuth.signInWithGoogle();
          idToken = nativeCredential.idToken;
        } catch (credentialError: any) {
          if (isGoogleAuthCancellation(credentialError)) return;

          // Compatibilité : l'ancien flux natif reste disponible uniquement en fallback.
          console.warn('Credential Manager indisponible, fallback Google Auth :', credentialError);
          try {
            await GoogleAuth.initialize({
              clientId: '799043440232-i9s1l0jaerljg58v3oooleuemnhnim4o.apps.googleusercontent.com',
              scopes: ['profile', 'email'],
              grantOfflineAccess: true,
            });
            const googleUser = await GoogleAuth.signIn();
            idToken = googleUser.authentication?.idToken || (googleUser as any)?.idToken;
          } catch (fallbackError: any) {
            if (isGoogleAuthCancellation(fallbackError)) return;
            throw fallbackError;
          }
        }

        if (!idToken) {
          throw new Error("Jeton d'authentification Google manquant.");
        }

        // Le token natif est échangé dans le Firebase Web SDK existant : même UID / même compte SeenIt.
        const credential = GoogleAuthProvider.credential(idToken);
        await signInWithCredential(auth, credential);
      } else {
        // PWA : flux Firebase Web standard inchangé.
        await signInWithPopup(auth, googleAuthProvider);
      }
'''
if old_native not in text:
    raise SystemExit('Current native login block missing')
login.write_text(text.replace(old_native, new_native, 1))

Path('tests/nativeGoogleAuth.test.ts').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plugin = readFileSync('android/app/src/main/java/com/seenit/app/SeenItAuthPlugin.kt', 'utf8');
const mainActivity = readFileSync('android/app/src/main/java/com/seenit/app/MainActivity.java', 'utf8');
const appGradle = readFileSync('android/app/build.gradle', 'utf8');
const rootGradle = readFileSync('android/build.gradle', 'utf8');
const login = readFileSync('src/screens/LoginScreen.tsx', 'utf8');
const bridge = readFileSync('src/lib/auth/SeenItAuth.ts', 'utf8');

test('SEENIT-AUTH-001 ouvre le sélecteur Google natif Credential Manager comme ATHIA', () => {
  assert.match(plugin, /@CapacitorPlugin\(name = "SeenItAuth"\)/);
  assert.match(plugin, /CredentialManager\.create\(context\)/);
  assert.match(plugin, /GetGoogleIdOption\.Builder\(\)/);
  assert.match(plugin, /setFilterByAuthorizedAccounts\(false\)/);
  assert.match(plugin, /setAutoSelectEnabled\(false\)/);
  assert.match(plugin, /"default_web_client_id"/);
  assert.match(plugin, /GoogleIdTokenCredential\.createFrom/);
  assert.match(mainActivity, /registerPlugin\(SeenItAuthPlugin\.class\);[\s\S]*super\.onCreate/);
  assert.match(bridge, /registerPlugin<SeenItAuthPlugin>\('SeenItAuth'\)/);
  assert.match(rootGradle, /kotlin-gradle-plugin:2\.1\.21/);
  assert.match(appGradle, /androidx\.credentials:credentials:1\.3\.0/);
  assert.match(appGradle, /credentials-play-services-auth:1\.3\.0/);
  assert.match(appGradle, /identity\.googleid:googleid:1\.1\.1/);
});

test('SEENIT-AUTH-001 conserve le même compte Firebase et un fallback natif propre', () => {
  const primary = login.indexOf('SeenItAuth.signInWithGoogle()');
  const fallback = login.indexOf('GoogleAuth.initialize');
  assert.ok(primary >= 0 && fallback > primary, 'Credential Manager doit être tenté avant l’ancien fallback');
  assert.match(login, /GoogleAuthProvider\.credential\(idToken\)/);
  assert.match(login, /signInWithCredential\(auth, credential\)/);
  assert.match(login, /signInWithPopup\(auth, googleAuthProvider\)/);
});

test('SEENIT-AUTH-001 traite l’annulation Google comme une sortie non bloquante', () => {
  assert.match(plugin, /GetCredentialCancellationException/);
  assert.match(plugin, /AUTH_GOOGLE_CANCELLED/);
  assert.match(login, /if \(isGoogleAuthCancellation\(credentialError\)\) return;/);
  assert.match(login, /if \(isGoogleAuthCancellation\(fallbackError\)\) return;/);
});
''')

spec = Path('docs/specifications/seenit.md')
spec_text = spec.read_text()
if 'SEENIT-AUTH-001' not in spec_text:
    spec_text += r'''

### SEENIT-AUTH-001 — Connexion Google native Android via Credential Manager

- Dans l'APK Android, le bouton **Continuer avec Google** utilise en priorité Android Credential Manager / Sign in with Google afin d'afficher le sélecteur de comptes Google natif, selon le même parcours que l'application ATHIA.
- Le client OAuth est lu depuis `default_web_client_id` généré par le `google-services.json` canonique de `com.seenit.app`; aucun nouvel identifiant utilisateur SeenIt n'est créé par la couche native.
- Le Google ID token obtenu n'est qu'un transport : il est échangé via `GoogleAuthProvider.credential(...)` puis `signInWithCredential(...)` dans le Firebase Web SDK déjà utilisé par SeenIt, afin de conserver le même Firebase UID et les mêmes données Firestore pour les comptes existants.
- `setFilterByAuthorizedAccounts(false)` permet une reconnexion / un nouveau consentement lorsque nécessaire et `setAutoSelectEnabled(false)` conserve un choix explicite du compte.
- Une annulation utilisateur du sélecteur est une sortie normale et ne doit afficher aucune erreur bloquante.
- Si Credential Manager est indisponible ou échoue pour une raison de compatibilité, l'ancien flux natif Google Auth reste un fallback; la PWA conserve `signInWithPopup`.
- TNR : toute régression vers le flux legacy comme parcours Android primaire, ou toute rupture de l'échange vers le Firebase UID existant, est interdite.
'''
    spec.write_text(spec_text)

req_path = Path('docs/specifications/requirements.json')
req = json.loads(req_path.read_text())
if not any(item.get('id') == 'SEENIT-AUTH-001' for item in req['requirements']):
    req['requirements'].append({
        'id': 'SEENIT-AUTH-001',
        'title': 'Connexion Google Android native via Credential Manager sans changer le Firebase UID',
        'targets': ['apk', 'pwa', 'ci'],
        'tests': [
            {'file': 'tests/nativeGoogleAuth.test.ts', 'contains': 'SEENIT-AUTH-001 ouvre le sélecteur Google natif Credential Manager comme ATHIA'},
            {'file': 'tests/nativeGoogleAuth.test.ts', 'contains': 'SEENIT-AUTH-001 conserve le même compte Firebase et un fallback natif propre'},
            {'file': 'tests/nativeGoogleAuth.test.ts', 'contains': 'SEENIT-AUTH-001 traite l’annulation Google comme une sortie non bloquante'},
        ],
    })
req_path.write_text(json.dumps(req, ensure_ascii=False, indent=2) + '\n')

registry = Path('docs/requests/registry.md')
registry_text = registry.read_text()
if 'USR-2026-09-02-008' not in registry_text:
    registry_text += "\n| USR-2026-09-02-008 | 2026-09-02 | La connexion Google Android SeenIt doit reprendre l’UX native ATHIA via Credential Manager : comptes du téléphone proposés directement, annulation non bloquante, fallback legacy uniquement si nécessaire et conservation stricte du Firebase UID existant. | `SEENIT-AUTH-001`, [issue #40](https://github.com/julfou7/seenit-app/issues/40) | active |\n"
    registry.write_text(registry_text)
