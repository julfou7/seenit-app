# Instructions pour l'Assistant de Codage AI (AGENTS)

Ces règles sont obligatoires pour toute intervention sur **SeenIt**.

## 0. Avant toute analyse, proposition ou modification

1. Lire intégralement ce fichier.
2. Récupérer l'état courant de la branche GitHub `main` et son commit de tête. **GitHub `main` est la source de vérité** : ne jamais analyser ou modifier SeenIt à partir d'un workspace supposé à jour sans l'avoir confronté au `main` courant.
3. Lire intégralement `docs/specifications/seenit.md`, `docs/specifications/README.md` et toute documentation pertinente pour le sujet ; pour toute livraison, lire aussi `docs/process/delivery.md`.
4. Rechercher systématiquement les issues GitHub **ouvertes et fermées liées au sujet**, ainsi que les PR, commits, audits et documents pertinents, afin de reprendre l'historique existant. Réutiliser ou rouvrir l'issue pertinente lorsqu'elle existe et éviter les doublons.
5. Dès qu'une issue est concernée, la maintenir à jour aux jalons significatifs de l'intervention : diagnostic, décisions, modifications, validations, merge/release ou blocage.
6. Vérifier la branche GitHub de référence avant d'accepter un diff provenant d'AI Studio.

GitHub est canonique. AI Studio est un mécanisme de transport : une modification apparue uniquement
à l'import/sync n'est jamais une migration implicite et ne doit pas être commitée sans demande claire.

## 1. Langue et commits

- Réponses, commits, changelog et release notes : **français**.
- Commits : Conventional Commits (`fix:`, `feat:`, `perf:`, `ci:`, `docs:`…), avec un corps court en
  puces lorsque plusieurs changements sont inclus.
- Une release agrège les commits du lot ; ne créez pas un commit artificiel par garde-fou administratif.

## 2. Processus de livraison proportionné

`docs/process/delivery.md` est la source de vérité opérationnelle de la CI/CD.

Avant une livraison, `npm run delivery:classify` distingue :

- **light** : documentation, tests, CI, scripts/outillage et pure copie d'interface ;
- **backend** : runtime serveur explicitement non embarqué dans Capacitor, notamment `server.ts`,
  `src/lib/firebase-admin.ts` et `src/features/runtime/**` ;
- **apk** : frontend embarqué, Android, Capacitor, dépendances et configuration applicative.

Il est **interdit de forcer le mode light**. Le doute reste `apk`.

### Validation continue

Chaque push/PR lance uniquement les validations rapides : classification, contrat de changement,
SPEC, TypeScript, tests unitaires, build Web/serveur et contrat Android si la classe est `apk`.
Un push sur `main` ne publie jamais automatiquement une APK.

`npm audit` est limité aux changements de dépendances, au contrôle périodique et à la release manuelle.
Le cache npm doit rester activé dans la CI.

### Release APK groupée

Les commits `apk` peuvent s'accumuler sur `main`. La **version est incrémentée une seule fois** quand
le lot est prêt à publier : modifier `android/app/build.gradle`, puis lancer `npm run version:sync`.
La release est ensuite déclenchée manuellement depuis `main` avec `release_apk=true`.

Une candidate non publiée peut recevoir plusieurs commits sans consommer un nouveau numéro. Une
version déjà publiée est immuable : tout correctif ultérieur exige un nouveau patch et un
`versionCode` supérieur.

Le job Android cible (API courante) reste bloquant à chaque release. Android 12 est un TNR optionnel
manuel/périodique, à activer notamment lors d'un changement natif à risque.

La CI vérifie et publie ; elle ne commit et ne pousse jamais automatiquement `main`. Le job de
publication possède seul `contents: write`. Le garde d'immuabilité s'exécute avant le build et avant
la publication : **ne le contournez jamais** et **n'autorisez jamais l'écrasement** d'une release.

## 3. Spécification et tests sans bureaucratie artificielle

### Demande durable

Une **Demande durable** qui modifie une règle produit, UX structurante, sécurité, données, identité,
plateforme ou invariant de développement doit être tracée dans `docs/requests/registry.md`.

### SPEC avant code

La règle **SPEC avant code** reste obligatoire pour :

- toute nouvelle règle durable ;
- les **zones sensibles** : sécurité/authentification, Firestore/données, identité média/Plex,
  identité APK/Firebase Android, configuration native critique ;
- toute migration ou modification d'un invariant existant.

Dans ces cas : mettre à jour `docs/specifications/seenit.md`, `requirements.json` et le test référencé.

Pour une correction locale ordinaire (petit bug d'affichage, mise en page, détail visuel, backend
non sensible) qui n'introduit aucune nouvelle règle durable, ne créez pas artificiellement une nouvelle
exigence. Un **test automatisé** ciblé suffit pour tout changement comportemental.

`npm run test:spec:changes` applique cette règle : tests pour le comportement ; SPEC + catalogue en
plus pour les zones sensibles. Une pure copie d'interface reconnue `light` peut rester sans nouveau test.

## 4. Contrat APK immuable

### Contrat APK immuable

Ne modifiez jamais silencieusement :

- `applicationId=com.seenit.app` ;
- nom SeenIt, deep link et launcher ;
- certificat et empreinte de la clé de signature release active ;
- icônes Android ;
- identité Firebase Android.

La rotation de signature validée avec la release 1.4.112 a définitivement remplacé la clé historique
par la clé release PKCS12 privée, alias `seenit`. `android/app/seenit-release.p12` est git-ignoré et ne
doit jamais être (re)généré par AI Studio, Android Studio ou un agent. Pour une release, la CI
matérialise exactement ses octets depuis `SEENIT_ANDROID_RELEASE_KEYSTORE_B64`, puis vérifie leur
SHA-256 contre `docs/specifications/android-contract.json`. Les mots de passe proviennent exclusivement
de `SEENIT_ANDROID_RELEASE_STORE_PASSWORD` et `SEENIT_ANDROID_RELEASE_KEY_PASSWORD`. Un secret absent,
un Base64 invalide, une empreinte différente, un alias/type inattendu ou des identifiants de signature
manquants bloquent la release. Remplacer cette clé est une nouvelle rotation et reste interdit sans
migration explicite.

Une modification Android intentionnelle doit être couverte par un test et, si elle touche un invariant,
par la SPEC/contrat Android. Lors d'une release APK, matérialiser d'abord la clé release, exécuter
`npm run test:android`, puis `npx cap sync android`, puis de nouveau `npm run test:android` avant Gradle.

Depuis la baseline officielle 1.4.112, le smoke Android exige la **même signature release active** sur
N et N+1, installe N+1 par-dessus N avec `adb install -r` et conserve package, données/session, launcher,
permission notification et deep link. Toute divergence de signature ou toute branche de désinstallation
est bloquante. L'APK publiée reste `assembleDebug`, signée par la clé release `seenit`, tant qu'un
changement de canal de build n'a pas été explicitement conçu et validé.

## 5. Firebase / Firestore immuables

- Base Firestore canonique : **`default`**, exactement.
- Client et Firebase Admin la sélectionnent explicitement ; pas de `getFirestore()` implicite.
- `firebase-applet-config.json` ne contient aucun `firestoreDatabaseId` pilotant le runtime.
- Firestore Delete Protection reste activée.
- Projet Firebase canonique : `gen-lang-client-0201895414`.
- `android/app/google-services.json` est un artefact généré et git-ignoré, matérialisé depuis
  `docs/specifications/android-contract.json` ; AI Studio ne doit jamais en être la source.
- Le contrat Firebase contient **un unique client OAuth Android actif**, lié au certificat release
  `seenit` ; le client OAuth Web utilisé par Credential Manager reste inchangé.
- `android/gradlew` est normalisé exécutable par le matérialiseur Android avant les contrôles/builds.

Toute modification de projet Firebase, databaseId, signature ou identité Android est une migration :
validation utilisateur explicite, sauvegarde/inventaire, plan de migration, rollback et tests PWA+APK.
Aucun agent ne décide seul de cette migration.

## 5.1 Identité média des téléchargements

- **TMDB ID est l’unique identité canonique** pour rattacher une fiche SeenIt à un téléchargement.
- TVDB/IMDb peuvent être transportés comme métadonnées, mais doivent être résolus vers TMDB avant toute association média.
- Titre, titre original, année, nom de fichier et nom de release ne sont **jamais** des clés de matching.
- Un même transfert physique se reconnaît uniquement par `requestId`, infohash/downloadId/alias exact ou chemin de transfert exact ; en cas d'ambiguïté, ne pas fusionner.

## 6. PWA et APK

SeenIt doit rester fonctionnel en PWA et APK Android. Un comportement natif différent doit être
explicite (`Capacitor.isNativePlatform()` ou API Capacitor). Les liens externes gardent un fallback Web ;
Plex privilégie l'application Android dans l'APK.

Le rapport final précise ce qui a été validé en PWA et/ou APK et ce qui attend volontairement la
prochaine release groupée.

## 7. Audits, issues et traçabilité

**Tout audit doit être enregistré** dans `docs/audits/`, indexé dans `docs/audits/README.md` et contenir
baseline, périmètre, preuves, décisions et matrice exhaustive. Un constat ouvert pointe vers une
**issue GitHub priorisée** ou un risque accepté explicitement.

Une issue active est mise à jour aux jalons utiles : implémentation prête, validation/CI, merge,
release ou blocage. Ne mettez pas à jour le corps après chaque micro-commit. Cochez un critère seulement
quand il est réellement prouvé.

Une issue de code peut être fermée avec commit + tests + validation applicable. Une release n'est
requise pour la fermeture que si le critère de l'issue exige explicitement un binaire publié ; les
changements `light/backend` ne doivent plus attendre artificiellement une APK.

## 8. Rapport de fin d'intervention

Après chaque modification, conclure exactement avec :

### 🛠️ Ce qui a été fait
- Résumé des changements et validations.

### 📌 Impact & Mode de déploiement
- Classe `light`, `backend` ou `apk`, et préciser si l'APK attend la prochaine release groupée.

### 🚀 Action requise de ton côté
- Action concrète attendue, ou « Aucune » si rien n'est nécessaire.
