# Instructions pour l'Assistant de Codage AI (AGENTS)

Ces règles sont obligatoires pour toute intervention sur **SeenIt**.

## 0.0 Fast path prioritaire — publication APK seule

Une demande explicite **« Publie l'APK »**, **« release APK »**, **« publie l'APK suite au dernier travail »** ou équivalent, lorsqu'elle ne demande aucune nouvelle modification fonctionnelle, suit **ce fast path avant le préflight général de la section 0**.

Objectif : lancer la release en moins de 2 minutes de travail opérateur lorsqu'une candidate verte existe déjà, ou en moins de 5 minutes hors attente CI lorsqu'il faut préparer la candidate, sans retirer aucun garde-fou GitHub Actions.

1. Noter immédiatement l'heure de la demande dans `SEENIT_RELEASE_REQUEST_STARTED_AT` si l'environnement le permet ; cette valeur sert uniquement à mesurer « demande → lancement du workflow ».
2. Lire ce fichier, `docs/process/delivery.md` et `docs/specifications/release-control.md`. Lire l'état GitHub canonique. `release:status` reste disponible dans un environnement CLI, mais **son absence n'est pas un blocage** lorsqu'un connecteur GitHub peut lire `main`, les releases, la candidate et les checks.
3. **Réutiliser** toute branche/PR `release/vX.Y.Z` compatible. Ne jamais créer une seconde candidate pour la même version.
4. Si aucune candidate compatible n'existe, préparer exactement les huit surfaces via `npm run release:prepare:files -- X.Y.Z` lorsqu'un workspace Node est disponible, ou reproduire strictement cette transformation en **un seul commit GitHub** depuis le `main` canonique avec le connecteur. La génération des huit surfaces est indépendante de `gh`. `release:prepare` demeure l'orchestrateur CLI historique pour branche/PR lorsqu'il est disponible.
5. Attendre uniquement les checks requis de cette PR. Ne pas rejouer localement TypeScript, les tests complets, Gradle, les smokes ou l'audit déjà garantis par le workflow de release, sauf échec explicite qui exige un diagnostic ciblé.
6. Après CI verte, fusionner selon les protections du dépôt. Vérifier ensuite que `main` porte exactement la prochaine version attendue et qu'aucune release/tag identique n'existe.
7. Une demande explicite de publication autorise l'agent à déclencher lui-même `Validate & Release SeenIt` sur `main` avec `release_apk=true`. **Depuis une conversation disposant uniquement du connecteur GitHub, le chemin natif prioritaire est de publier sur l'issue de contrôle #102 la commande exacte `/release-apk`, ou `/release-apk android12_smoke=true` lorsqu'un smoke Android 12 est requis.** Le workflow `SeenIt Release Control` vérifie l'auteur propriétaire, l'issue, `main`, le SHA, la version attendue, l'immuabilité, l'absence de run identique actif et les options de smoke, puis appelle nativement `workflow_dispatch` avec le `GITHUB_TOKEN` du runner. Ce mécanisme ne dépend ni de `gh`, ni d'un token shell, ni d'un navigateur authentifié. Les outils directs de `workflow_dispatch`, `release:dispatch` et le navigateur restent des secours historiques si disponibles ; ils ne sont plus requis pour l'autonomie cross-conversation. **Le connecteur GitHub et ce contrôleur sont suffisants : ne cherchez ni sur le Web ni via des plugins tiers un autre mécanisme de déclenchement.**
8. Avant tout dispatch, vérifier qu'aucun run de release portant le même SHA/version n'est déjà actif. Le contrôleur natif sérialise les commandes et recherche le nouveau run pendant au plus 30 secondes sans redéclenchement aveugle. Dès que ce run précis est identifié, publier son lien et **rendre la main par défaut** : la CI termine de façon autonome et la notification Android annonce la disponibilité. Ne pas conserver la conversation active avec des polls rapprochés. Suivre synchroniquement jusqu'à l'APK signé, son `.sha256` et la release immuable seulement si l'utilisateur demande explicitement d'attendre le résultat ; dans ce cas, espacer les lectures d'état et diagnostiquer tout échec dans le même chantier. Reporter dans tous les cas la mesure « demande → workflow ».

Ce fast path est une exception **bornée à l'orchestration d'une release déjà demandée**. Il ne relit pas l'historique fonctionnel complet, ne lance pas d'audit global et ne réécrit pas la référence fonctionnelle. Il n'affaiblit jamais `SEENIT-APK-001..005`, le smoke Android 36, la signature `seenit`, le garde d'immuabilité ou les protections de branche. Si l'état GitHub révèle une incohérence de code, de version, de signature, de SPEC ou une candidate non basée sur `main`, sortir du fast path et reprendre le préflight général ciblé sur ce blocage.

## 0.1 Fast path prioritaire — correctif ciblé

Un correctif peut suivre ce chemin lorsque son issue existe, que sa cause racine est confirmée et que
son périmètre est borné. Un audit global, une migration, une refonte transverse ou une contradiction
entre code, SPEC et décision produit sort immédiatement de ce fast path.

1. Lire intégralement ce fichier, vérifier le `main` GitHub canonique, puis lire l'issue et ses
   commentaires, la carte fonctionnelle et les sections de SPEC directement concernées, les fichiers
   touchés et leurs tests. La connaissance complète reste disponible via les index canoniques ; ne pas
   reconstruire l'historique global si aucune ambiguïté ne l'exige.
2. En zone sensible, mettre la SPEC et le catalogue à jour **avant le code dans le même workspace**.
   « SPEC avant code » décrit l'ordre de travail, pas une obligation de commit, push ou commentaire
   distinct pour chaque phase.
3. Utiliser une branche unique depuis `main`. Modifier SPEC, tests et code comme un seul changement
   cohérent. Ne pas reformater mécaniquement un fichier hors des lignes nécessaires, notamment
   `docs/specifications/requirements.json`.
4. Pendant le développement, exécuter les tests ciblés jusqu'à ce qu'ils soient verts. Exécuter ensuite
   une seule fois la validation complète applicable avant le premier push. GitHub Actions confirme un
   état local vert ; elle ne sert pas de debugger pour une erreur reproductible localement.
5. Viser un commit cohérent et une PR. Un second commit est réservé à une correction réelle révélée
   par la revue ou la CI, puis la PR est fusionnée selon les protections du dépôt.
6. Après dix minutes sans fichier modifié, test ciblé exécuté, commit, PR ou blocage précis, publier un
   jalon concret et réorienter le diagnostic ; ne pas enchaîner une seconde longue passe silencieuse.
7. Après merge d'un correctif qui doit être publié, basculer directement vers le fast path release-only
   de la section 0.0 sans relire une seconde fois tout le contexte produit.

Ce chemin ne réduit aucun contrôle de sécurité, d'identité média/Plex, de données, d'APK, de signature,
de test terrain ou de release. Il réduit uniquement la lecture et les validations redondantes.

## 0. Avant toute analyse, proposition ou modification

**Hors fast paths des sections 0.0 et 0.1 :**

1. Lire intégralement ce fichier.
2. Récupérer l'état courant de la branche GitHub `main` et son commit de tête. **GitHub `main` est la source de vérité** : ne jamais analyser ou modifier SeenIt à partir d'un workspace supposé à jour sans l'avoir confronté au `main` courant.
3. Lire intégralement `docs/specifications/seenit.md`, `docs/specifications/functional-reference.md`,
   `docs/specifications/README.md` et toute documentation pertinente pour le sujet ; pour toute
   livraison, lire aussi `docs/process/delivery.md`. La référence fonctionnelle est obligatoire :
   elle décrit les écrans, parcours, responsabilités des sources, différences PWA/APK et écarts connus.
4. Rechercher systématiquement les issues GitHub **ouvertes et fermées liées au sujet**, ainsi que les PR, commits, audits et documents pertinents, afin de reprendre l'historique existant. Réutiliser ou rouvrir l'issue pertinente lorsqu'elle existe et éviter les doublons.
5. Dès qu'une issue est concernée, la maintenir à jour aux jalons significatifs de l'intervention : diagnostic, décisions, modifications, validations, merge/release ou blocage.
6. Vérifier la branche GitHub de référence avant d'accepter un diff provenant d'AI Studio.

GitHub est canonique. AI Studio est un mécanisme de transport : une modification apparue uniquement
à l'import/sync n'est jamais une migration implicite et ne doit pas être commitée sans demande claire.

## 1. Langue et commits

- Réponses, commits, changelog et release notes : **français**.
- Commits : Conventional Commits (`fix:`, `feat:`, `perf:`, `ci:`, `docs:`…), avec un corps court en
  puces lorsque plusieurs changements sont inclus.
- Lorsqu'un commit apporte un changement visible, son corps contient une section `Changelog:` avec
  **une à deux phrases destinées à l'utilisateur**, puis, si nécessaire, une section séparée
  `Détails techniques:`. Un commit sans effet visible porte `Changelog: aucun`. Le générateur ne doit
  jamais confondre ces détails internes avec les notes publiques.
- Le changelog public conserve exactement le titre `### 🛠️ Ce qui a été fait` et vise **deux à cinq
  puces courtes** pour l'ensemble d'une version. Chaque puce commence par une majuscule, se termine par
  une ponctuation et décrit un résultat concret avec les mots de l'interface. Regroupez les changements
  liés au lieu d'énumérer leur implémentation. Sauf nécessité pour comprendre l'usage, n'y exposez ni
  nom de fichier, fonction, variable, `ratingKey`, UID, cache/baseline, test, CI, commit, PR ou issue.
- Évitez les formulations vagues (« améliorations générales », « diverses corrections ») lorsqu'un
  bénéfice précis peut être nommé. Les preuves techniques restent dans le commit, la PR ou l'issue.
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
La release est ensuite déclenchée explicitement depuis `main` avec `release_apk=true`, directement ou via le contrôleur natif de `SEENIT-RELEASE-005`.

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

`docs/specifications/functional-reference.md` est la carte produit vivante. Toute fonction ajoutée,
retirée, déplacée ou dont le résultat observable change doit y être répercutée dans la même livraison.
Un comportement du code qui contredit la SPEC n'est pas une nouvelle règle implicite : ouvrir ou
mettre à jour une issue priorisée, puis corriger le code ou obtenir une décision produit explicite.

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

## 5.2 Relations médias : aucune rustine nominative

- Une saga ou un univers est résolu uniquement par le mécanisme commun et des identités typées exactes
  `movie:<tmdbId>` / `tv:<tmdbId>`. Un exemple utilisateur nommé (Punisher, Harry Potter, House of
  Guinness, etc.) peut devenir une fixture/TNR, **jamais** une condition, branche, regex ou exception de
  production fondée sur son titre.
- Il est interdit de corriger un univers par comparaison de titre, titre original, année, popularité,
  casting, studio, marque, mot-clé, nom de liste ou premier résultat d'une recherche, même si cela résout
  le cas signalé. Sans preuve exacte, masquer la relation.
- Une correction de données ciblée n'est admissible que dans un groupe versionné à provenance validée,
  avec des `mediaKey` exactes et un TNR générique prouvant la réciprocité depuis **tous** ses membres. Le
  résolveur reste identique pour toutes les œuvres ; aucun code spécial ne porte le nom du cas corrigé.
- Tout correctif qui ferait réussir uniquement l'exemple signalé sans renforcer l'invariant global est
  refusé en revue, même si son résultat visuel semble correct.

## 6. PWA et APK

SeenIt doit rester fonctionnel en PWA et APK Android. Un comportement natif différent doit être
explicite (`Capacitor.isNativePlatform()` ou API Capacitor). Les liens externes gardent un fallback Web ;
Plex privilégie l'application Android dans l'APK.

### AI Studio n'est pas une voie de production

- **Aucun pull/sync AI Studio n'est requis pour déployer SeenIt.** La synchronisation native depuis
  GitHub reste facultative et sert uniquement à charger le code dans l'éditeur ou la preview AI Studio.
  Toute modification voulue repart ensuite vers une branche/PR GitHub ; ne jamais réintroduire un pull,
  refresh ou publish « maison » dans l'application ou le backend.
- **Ne jamais présenter `Publish` dans AI Studio comme une étape normale ou nécessaire.** Le backend
  canonique est construit et déployé sur Cloud Run depuis `main` par GitHub Actions ; l'APK est construite,
  signée et publiée exclusivement par le workflow de release GitHub.
- L'image Cloud Run canonique contient aussi le frontend PWA. Un changement exclusivement frontend peut
  être différé par la détection d'impact backend : pour le publier immédiatement, attendre/déclencher une
  reconstruction canonique via `.github/workflows/deploy-backend.yml`, qui force l'image complète, plutôt
  que d'utiliser `Publish` dans AI Studio comme raccourci.
- Un agent ne déclenche jamais seul une publication AI Studio vers la production. Une utilisation
  exceptionnelle n'est admissible qu'après demande explicite du propriétaire, indisponibilité prouvée du
  chemin GitHub canonique, analyse du risque et plan de réconciliation/rollback. Elle reste une intervention
  non canonique à retracer ; la preview AI Studio, elle, peut être utilisée librement sans publication.

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
