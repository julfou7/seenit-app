# Instructions pour l'Assistant de Codage AI (AGENTS)

Ces règles sont obligatoires pour toute intervention sur **SeenIt**.

## 0.0 Fast path prioritaire — publication APK seule

Une demande explicite **« Publie l'APK »**, **« release APK »**, **« publie l'APK suite au dernier travail »** ou équivalent, lorsqu'elle ne demande aucune nouvelle modification fonctionnelle, suit **ce fast path avant le préflight général de la section 0**.

Objectif : lancer la release en moins de 2 minutes de travail opérateur lorsqu'une candidate verte existe déjà, ou en moins de 5 minutes hors attente CI lorsqu'il faut préparer la candidate, sans retirer aucun garde-fou GitHub Actions.

1. Noter immédiatement l'heure de la demande dans `SEENIT_RELEASE_REQUEST_STARTED_AT` si l'environnement le permet ; cette valeur sert uniquement à mesurer « demande → lancement du workflow ».
2. Lire ce fichier, `docs/process/delivery.md` et `docs/specifications/release-control.md`. Lire l'état GitHub canonique. `release:status` reste disponible dans un environnement CLI, mais **son absence n'est pas un blocage** lorsqu'un connecteur GitHub peut lire `main`, les releases, la candidate et les checks.
3. **Réutiliser** toute branche/PR `release/vX.Y.Z` compatible. Ne jamais créer une seconde candidate pour la même version.
4. Si aucune candidate compatible n'existe, **depuis une conversation connector-only publier exactement `/prepare-release-apk` sur l'issue #102**. Le workflow `SeenIt Release Control` calcule la prochaine version, réutilise une candidate compatible ou exécute le préparateur atomique, crée un seul commit contenant exactement les huit surfaces et ouvre la PR. L'absence de workspace local, de `gh`, de token shell ou de navigateur authentifié **n'est pas un blocage** et ne justifie plus la reproduction manuelle des huit fichiers. Avec un workspace Node, `npm run release:prepare -- X.Y.Z` reste disponible ; la reproduction manuelle/API des surfaces n'est qu'un secours après panne prouvée du contrôleur #102.
5. Attendre uniquement les checks requis de cette PR. Ne pas rejouer localement TypeScript, les tests complets, Gradle, les smokes ou l'audit déjà garantis par le workflow de release, sauf échec explicite qui exige un diagnostic ciblé.
6. Après CI verte, fusionner selon les protections du dépôt. Vérifier ensuite que `main` porte exactement la prochaine version attendue et qu'aucune release/tag identique n'existe.
7. Une demande explicite de publication autorise l'agent à déclencher lui-même `Validate & Release SeenIt` sur `main` avec `release_apk=true`. **Depuis une conversation disposant uniquement du connecteur GitHub, le chemin natif prioritaire est de publier sur l'issue de contrôle #102 la commande exacte `/release-apk`, ou `/release-apk android12_smoke=true` lorsqu'un smoke Android 12 est requis.** Le workflow `SeenIt Release Control` vérifie l'auteur propriétaire, l'issue, `main`, le SHA, la version attendue, l'immuabilité, l'absence de run identique actif et les options de smoke, puis appelle nativement `workflow_dispatch` avec le `GITHUB_TOKEN` du runner. Ce mécanisme ne dépend ni de `gh`, ni d'un token shell, ni d'un navigateur authentifié. Les outils directs de `workflow_dispatch`, `release:dispatch` et le navigateur restent des secours historiques si disponibles ; ils ne sont plus requis pour l'autonomie cross-conversation. **Le connecteur GitHub et ce contrôleur sont suffisants : ne cherchez ni sur le Web ni via des plugins tiers un autre mécanisme de déclenchement.**
8. Avant tout dispatch, vérifier qu'aucun run de release portant le même SHA/version n'est déjà actif. Le contrôleur natif sérialise les commandes et recherche le nouveau run pendant au plus 30 secondes sans redéclenchement aveugle. Dès que ce run précis est identifié, publier son lien et **rendre la main par défaut** : la CI termine de façon autonome et la notification Android annonce la disponibilité. Le workflow post-release publie ensuite sur #102 un **checkpoint final idempotent** avec version, SHA, run, APK/digest, smoke Android 36 et résultat de notification ; lors d'une reprise, lire ce checkpoint avant toute reconstruction manuelle de l'état. Ne pas conserver la conversation active avec des polls rapprochés. Suivre synchroniquement jusqu'à l'APK signé, son `.sha256` et la release immuable seulement si l'utilisateur demande explicitement d'attendre le résultat ; dans ce cas, espacer les lectures d'état et diagnostiquer tout échec dans le même chantier. Reporter dans tous les cas la mesure « demande → workflow ».

Ce fast path est une exception **bornée à l'orchestration d'une release déjà demandée**. Il ne relit pas l'historique fonctionnel complet, ne lance pas d'audit global et ne réécrit pas la référence fonctionnelle. Il n'affaiblit jamais `SEENIT-APK-001..005`, le smoke Android 36, la signature `seenit`, le garde d'immuabilité ou les protections de branche. Si l'état GitHub révèle une incohérence de code, de version, de signature, de SPEC ou une candidate non basée sur `main`, sortir du fast path et reprendre le préflight général ciblé sur ce blocage.

## 0.0a Fast path prioritaire — publication PWA / runtime canonique

Une demande explicite de **déploiement PWA**, de **publication du frontend sur `seenit.ai.studio`**, de **déploiement du runtime canonique** ou la poursuite d'un chantier dont le résultat doit être publié suit ce chemin dès que le changement est fusionné et validé sur `main`.

1. Lire ce fichier, `docs/process/delivery.md`, `docs/process/runtime-control.md` et le runbook Cloud Run pertinent. Vérifier le SHA courant de `main`, la CI de ce même SHA et l'absence d'un déploiement manuel déjà actif ou vert pour ce SHA.
2. Le chemin canonique reste `.github/workflows/deploy-backend.yml`. Si une action directe `workflow_dispatch` est disponible dans l'outil courant, elle peut être utilisée sur `main`.
3. **Depuis une conversation connector-only, publier exactement `/deploy-pwa` sur l'issue de contrôle #57.** Le workflow `SeenIt Runtime Control` vérifie OWNER + issue #57 + commande exacte, déduplique les runs et appelle nativement le `workflow_dispatch` de `Deploy Canonical Backend` avec le `GITHUB_TOKEN` du runner.
4. **L'absence d'une action directe `workflow_dispatch`, du binaire `gh`, d'un token shell ou d'un navigateur authentifié n'est pas un blocage utilisateur.** Ne jamais rendre la main pour cette seule raison et ne jamais demander à l'utilisateur de cliquer sur « Run workflow » tant que le contrôleur #57 est disponible.
5. Le connecteur GitHub et ce contrôleur constituent le fallback autonome officiel. Ne pas chercher sur le Web ni via des plugins tiers un mécanisme de dispatch lorsque ce chemin canonique existe.
6. Lorsque la demande utilisateur exige que le déploiement soit terminé, suivre le run précis jusqu'à la candidate, au health-check, à la promotion et au smoke production ; mettre l'issue fonctionnelle à jour avec les preuves. Si seule la mise en file du déploiement était demandée, le run peut ensuite terminer côté GitHub Actions selon la politique de suivi distant.
7. `/deploy-pwa` ne publie jamais d'APK et `/release-apk` ne remplace jamais un déploiement PWA. Les deux contrôleurs restent volontairement séparés.

Cette règle est durable : un futur changement de contrôleur doit conserver une **capacité connector-only autonome équivalente** avant de supprimer `/deploy-pwa`. Un retrait sans remplacement constitue une régression de processus.

## 0.1 Fast path prioritaire — correctif ciblé

Un correctif peut suivre ce chemin lorsque son issue existe, que sa cause racine est confirmée et son périmètre est borné. Un audit global, une migration, une refonte transverse ou une contradiction entre code, SPEC et décision produit sort immédiatement de ce fast path.

1. Lire intégralement ce fichier, vérifier le `main` GitHub canonique, puis lire l'issue et ses commentaires, la carte fonctionnelle et les sections de SPEC directement concernées, les fichiers touchés et leurs tests. La connaissance complète reste disponible via les index canoniques ; ne pas reconstruire l'historique global si aucune ambiguïté ne l'exige.
2. En zone sensible, mettre la SPEC et le catalogue à jour **avant le code dans le même workspace**. « SPEC avant code » décrit l'ordre de travail, pas une obligation de commit, push ou commentaire distinct pour chaque phase.
3. Utiliser une branche unique depuis `main`. Modifier SPEC, tests et code comme un seul changement cohérent. Ne pas reformater mécaniquement un fichier hors des lignes nécessaires, notamment `docs/specifications/requirements.json`.
4. Pendant le développement, exécuter les tests ciblés jusqu'à ce qu'ils soient verts. Exécuter ensuite une seule fois la validation complète applicable avant le premier push. GitHub Actions confirme un état local vert ; elle ne sert pas de debugger pour une erreur reproductible localement.
5. Viser un commit cohérent et une PR. Un second commit est réservé à une correction réelle révélée par la revue ou la CI, puis la PR est fusionnée selon les protections du dépôt.
6. Après dix minutes sans fichier modifié, test ciblé exécuté, commit, PR ou blocage précis, publier un jalon concret et réorienter le diagnostic ; ne pas enchaîner une seconde longue passe silencieuse.
7. Après merge d'un correctif qui doit être publié, basculer directement vers le fast path release-only de la section 0.0 ou le fast path PWA/runtime 0.0a selon la surface demandée, sans relire une seconde fois tout le contexte produit.

Ce chemin ne réduit aucun contrôle de sécurité, d'identité média/Plex, de données, d'APK, de signature, de test terrain ou de release. Il réduit uniquement la lecture et les validations redondantes.

## 0.2 Culture obligatoire — cause racine avant correctif

Pour tout bug, incident ou exemple utilisateur, l'agent distingue explicitement avant de coder :

1. le **symptôme observé** et son exemple reproductible ;
2. la **cause racine prouvée** ;
3. la **classe complète affectée** au-delà de l'exemple ;
4. le correctif global recherché et les risques résiduels.

Le correctif attendu traite la cause pour toute la classe affectée. Le cas signalé devient un TNR, complété par au moins un invariant générique et, lorsque pertinent, un cas voisin ou négatif. Un ajout de ligne dans un manifeste, une exception de données ou un traitement nominatif est qualifié honnêtement de **correction locale** : il ne devient jamais une preuve de correction globale et ne ferme pas l'issue systémique qui l'a rendu nécessaire.

Si aucun correctif global sûr n'est possible avec les sources ou l'autorité disponibles, l'agent ne le remplace pas par une heuristique fragile. Il documente la limite, conserve l'issue racine ouverte et propose une architecture ou un backlog borné. L'issue et la PR indiquent systématiquement « cause racine », « portée globale ou locale » et « risque résiduel ». Une pure copie d'interface, documentation ou tâche sans anomalie peut indiquer « sans objet » afin de conserver le chemin light.

## 0.3 Politique obligatoire — API-first, workspace unique et reprise

La vérification du `main` GitHub canonique est une **lecture d'état distante**. Elle n'impose à elle seule ni clone, ni checkout, ni installation de dépendances.

1. Commencer **API-first** : lire `main`, l'issue, la PR, les commits et les fichiers canoniques via le connecteur/API GitHub tant qu'aucune commande locale n'est réellement nécessaire. Une demande read-only se traite sans clone et sans matérialiser de workspace.
2. Avant toute acquisition locale, rechercher un workspace SeenIt déjà présent dans l'environnement. S'il existe, vérifier son état, confronter son HEAD/sa branche au `main` ou à la branche du chantier, puis le réutiliser. **Un nouveau prompt n'est jamais une raison de recloner.**
3. Si aucun workspace n'existe et qu'une exécution locale est nécessaire, acquérir le dépôt **une seule fois par environnement** depuis le SHA/branche canonique, avec le mode minimal compatible (`--depth`, clone partiel ou checkout partiel) plutôt qu'un historique complet par défaut.
4. Ne lancer `npm ci` que si les dépendances sont absentes ou incompatibles avec la version Node et le `package-lock.json` du chantier. Un `node_modules` ou cache exact compatible est réutilisé.
5. Lors d'une reprise, repartir d'abord de l'issue, de la PR ou de la branche existante et du dernier jalon contenant la **prochaine action exacte**. Ne pas reconstruire l'historique complet si ce jalon et les index canoniques bornent déjà le travail restant. **Reprise identifiée : pas de recherche globale.** Si l'issue, la PR ou la branche du chantier et un checkpoint exploitable sont déjà connus, vérifier `main`, lire ces références et exécuter la prochaine action exacte sans relancer la recherche générale des issues ouvertes/fermées, PR, commits ou audits. Relancer cette recherche seulement si le périmètre change, si le checkpoint est absent ou ambigu, si `main` révèle une contradiction pertinente ou si une nouvelle anomalie hors périmètre apparaît.
6. **Avant chaque fin de session SeenIt**, quelle qu'en soit la cause (chantier terminé, blocage réel, limite de session, handoff volontaire ou involontaire), enregistrer un checkpoint persistant dans l'issue fonctionnelle concernée ; à défaut d'issue fonctionnelle, utiliser l'issue de contrôle appropriée. Le checkpoint contient au minimum : état exact du chantier, SHA/branche/PR ou `main` courant, fichiers ou surfaces modifiés, validations déjà vertes/rouges avec les numéros de runs/jobs utiles, blocage éventuel, prochaine action exacte et critère de fin. Si le chantier est terminé, écrire explicitement **`Prochaine action : aucune — chantier terminé`** avec les preuves de merge/release/déploiement. La réponse finale à l'utilisateur résume ce même checkpoint ; ne jamais terminer une session SeenIt sur un statut vague ou uniquement sur un message d'erreur.
7. **Avant de déclarer un blocage GitHub ou un manque d'accès**, distinguer les permissions du token de la surface exposée par le connecteur. Un refus d'un endpoint générique ou une allowlist du connecteur n'est pas une preuve d'insuffisance des droits. Rechercher/inventorier puis tenter les actions GitHub dédiées adaptées à la ressource (par exemple jobs, logs, checks, artifacts, workflows, issues/PR) avant de conclure qu'une information ou une action est inaccessible. Un blocage utilisateur ne peut être déclaré qu'après échec ou absence prouvée de l'action dédiée **et** épuisement du chemin connector-only documenté dans le dépôt.
8. Laisser les opérations distantes longues — CI, release et déploiement — à GitHub Actions. Ne pas consommer une fenêtre d'exécution en polling rapproché, sauf demande explicite de suivi synchrone.

Cette politique ne suppose jamais qu'un sandbox soit persistant : si la plateforme fournit réellement un environnement neuf, l'acquisition minimale peut être répétée. Elle interdit seulement de confondre cette contrainte de runtime avec une obligation SeenIt de recloner ou de reconstruire le contexte.

Lorsqu'un chantier est entièrement réalisable via le connecteur/API GitHub, l'absence de clone local, de `gh` ou de token shell n'est **ni un blocage ni une difficulté notable à remonter**. Le rapport final ne la mentionne comme difficulté que si elle a réellement empêché une action requise après épuisement du chemin connector-only prévu.

## 0. Avant toute analyse, proposition ou modification

**Hors fast paths des sections 0.0, 0.0a et 0.1 :**

1. Lire intégralement ce fichier.
2. Récupérer l'état courant de la branche GitHub `main` et son commit de tête. **GitHub `main` est la source de vérité** : ne jamais analyser ou modifier SeenIt à partir d'un workspace supposé à jour sans l'avoir confronté au `main` courant. Cette vérification n'impose aucun clone local ; appliquer la politique de la section 0.3.
3. Lire intégralement `docs/specifications/seenit.md`, `docs/specifications/functional-reference.md`, `docs/specifications/README.md` et toute documentation pertinente pour le sujet ; pour toute livraison, lire aussi `docs/process/delivery.md`. La référence fonctionnelle est obligatoire : elle décrit les écrans, parcours, responsabilités des sources, différences PWA/APK et écarts connus.
4. Pour un nouveau chantier, ou lorsqu'aucune issue/PR/branche n'est déjà identifiée, rechercher systématiquement les issues GitHub **ouvertes et fermées liées au sujet**, ainsi que les PR, commits, audits et documents pertinents, afin de reprendre l'historique existant. Réutiliser ou rouvrir l'issue pertinente lorsqu'elle existe et éviter les doublons. Pour une reprise identifiée, appliquer la section 0.3 et ne pas rejouer cette recherche globale sauf si le périmètre change, si le checkpoint est absent ou ambigu, si `main` révèle une contradiction pertinente ou si une nouvelle anomalie hors périmètre apparaît.
5. Dès qu'une issue est concernée, la maintenir à jour aux jalons significatifs de l'intervention : diagnostic, décisions, modifications, validations, merge/release ou blocage.
6. Vérifier la branche GitHub de référence avant d'accepter un diff provenant d'AI Studio.

GitHub est canonique. AI Studio est un mécanisme de transport : une modification apparue uniquement à l'import/sync n'est jamais une migration implicite et ne doit pas être commitée sans demande claire.

## 1. Langue et commits

- Réponses, commits, changelog et release notes : **français**.
- Commits : Conventional Commits (`fix:`, `feat:`, `perf:`, `style:`, `chore:`, `refactor:`, `docs:`, `build:`, `ci:`, `test:`…), avec un corps court en puces lorsque plusieurs changements sont inclus.
- Lorsqu'un commit apporte un changement visible, son corps contient une section `Changelog:` avec **une à deux phrases destinées à l'utilisateur**, puis, si nécessaire, une section séparée `Détails techniques:`. Un commit sans effet visible porte `Changelog: aucun`. Le générateur ne doit jamais confondre ces détails internes avec les notes publiques.
- Le changelog public conserve exactement le titre `### 🛠️ Ce qui a été fait` et vise **deux à cinq puces courtes** pour l'ensemble d'une version. Chaque puce commence par une majuscule, se termine par une ponctuation et décrit un résultat concret avec les mots de l'interface. Regroupez les changements liés au lieu d'énumérer leur implémentation. Sauf nécessité pour comprendre l'usage, n'y exposez ni nom de fichier, fonction, variable, `ratingKey`, UID, cache/baseline, test, CI, commit, PR ou issue.
- Évitez les formulations vagues (« améliorations générales », « diverses corrections ») lorsqu'un bénéfice précis peut être nommé. Les preuves techniques restent dans le commit, la PR ou l'issue.
- Une release agrège les commits du lot ; ne créez pas un commit artificiel par garde-fou administratif.

## 2. Processus de livraison proportionné

`docs/process/delivery.md` est la source de vérité opérationnelle de la CI/CD.

Avant une livraison, `npm run delivery:classify` distingue :

- **light** : documentation, tests, CI, scripts/outillage et pure copie d'interface ;
- **backend** : runtime serveur explicitement non embarqué dans Capacitor, notamment `server.ts`, `src/lib/firebase-admin.ts` et `src/features/runtime/**` ;
- **apk** : frontend embarqué, Android, Capacitor, dépendances et configuration applicative.

Il est **interdit de forcer le mode light**. Le doute reste `apk`.

### Validation continue

Chaque push/PR lance uniquement les validations rapides : classification, contrat de changement, SPEC, TypeScript, tests unitaires, build Web/serveur et contrat Android si la classe est `apk`. Un push sur `main` ne publie jamais automatiquement une APK.

`npm audit` est limité aux changements de dépendances, au contrôle périodique et à la release manuelle. Le cache npm doit rester activé dans la CI.

### Release APK groupée

Les commits `apk` peuvent s'accumuler sur `main`. La **version est incrémentée une seule fois** quand le lot est prêt à publier : modifier `android/app/build.gradle`, puis lancer `npm run version:sync`. La release est ensuite déclenchée explicitement depuis `main` avec `release_apk=true`, directement ou via le contrôleur natif de `SEENIT-RELEASE-005`.

Une candidate non publiée peut recevoir plusieurs commits sans consommer un nouveau numéro. Une version déjà publiée est immuable : tout correctif ultérieur exige un nouveau patch et un `versionCode` supérieur.

Le job Android cible (API courante) reste bloquant à chaque release. Android 12 est un TNR optionnel manuel/périodique, à activer notamment lors d'un changement natif à risque.

La CI vérifie et publie ; elle ne commit et ne pousse jamais automatiquement `main`. Le job de publication possède seul `contents: write`. Le garde d'immuabilité s'exécute avant le build et avant la publication : **ne le contournez jamais** et **n'autorisez jamais l'écrasement** d'une release.

## 3. Spécification et tests sans bureaucratie artificielle

### Demande durable

Une **Demande durable** qui modifie une règle produit, UX structurante, sécurité, données, identité, plateforme ou invariant de développement doit être tracée dans `docs/requests/registry.md`.

### SPEC avant code

La règle **SPEC avant code** reste obligatoire pour :

- toute nouvelle règle durable ;
- les **zones sensibles** : sécurité/authentification, Firestore/données, identité média/Plex, identité APK/Firebase Android, configuration native critique ;
- toute migration ou modification d'un invariant existant.

Dans ces cas : mettre à jour `docs/specifications/seenit.md`, `requirements.json` et le test référencé.

Pour une correction locale ordinaire (petit bug d'affichage, mise en page, détail visuel, backend non sensible) qui n'introduit aucune nouvelle règle durable, ne créez pas artificiellement une nouvelle exigence. Un **test automatisé** ciblé suffit pour tout changement comportemental.

`npm run test:spec:changes` applique cette règle : tests pour le comportement ; SPEC + catalogue en plus pour les zones sensibles. Une pure copie d'interface reconnue `light` peut rester sans nouveau test.

### Imports ESM des TNR Node

Les TNR `tests/**/*.test.ts` sont exécutés directement par `node --test`. Tout import relatif local qui cible un module TypeScript doit donc être explicitement résolvable par Node ESM : écrire l'extension `.ts` / `.tsx` (ou l'extension réelle du module) au lieu d'un chemin relatif sans extension. Les imports de packages ne sont pas concernés et cette règle ne s'applique pas artificiellement au code applicatif bundlé par Vite.

Le préflight sans dépendances bloque cette classe d'erreur avant le cache `node_modules`, l'installation npm, TypeScript et les tests unitaires. Un agent qui ajoute un TNR vérifie cette résolution avant le premier push ; la CI confirme la règle mais ne sert pas à découvrir un `ERR_MODULE_NOT_FOUND` déterministe.

`docs/specifications/functional-reference.md` est la carte produit vivante. Toute fonction ajoutée, retirée, déplacée ou dont le résultat observable change doit y être répercutée dans la même livraison. Un comportement du code qui contredit la SPEC n'est pas une nouvelle règle implicite : ouvrir ou mettre à jour une issue priorisée, puis corriger le code ou obtenir une décision produit explicite.

## 4. Contrat APK immuable

### Contrat APK immuable

Ne modifiez jamais silencieusement :

- `applicationId=com.seenit.app` ;
- nom SeenIt, deep link et launcher ;
- certificat et empreinte de la clé de signature release active ;
- icônes Android ;
- identité Firebase Android.

La rotation de signature validée avec la release 1.4.112 a définitivement remplacé la clé historique par la clé release PKCS12 privée, alias `seenit`. `android/app/seenit-release.p12` est git-ignoré et ne doit jamais être (re)généré par AI Studio, Android Studio ou un agent. Pour une release, la CI matérialise exactement ses octets depuis `SEENIT_ANDROID_RELEASE_KEYSTORE_B64`, puis vérifie leur SHA-256 contre `docs/specifications/android-contract.json`. Les mots de passe proviennent exclusivement de `SEENIT_ANDROID_RELEASE_STORE_PASSWORD` et `SEENIT_ANDROID_RELEASE_KEY_PASSWORD`. Un secret absent, un Base64 invalide, une empreinte différente, un alias/type inattendu ou des identifiants de signature manquants bloquent la release. Remplacer cette clé est une nouvelle rotation et reste interdit sans migration explicite.

Une modification Android intentionnelle doit être couverte par un test et, si elle touche un invariant, par la SPEC/contrat Android. Lors d'une release APK, matérialiser d'abord la clé release, exécuter `npm run test:android`, puis `npx cap sync android`, puis de nouveau `npm run test:android` avant Gradle.

Depuis la baseline officielle 1.4.112, le smoke Android exige la **même signature release active** sur N et N+1, installe N+1 par-dessus N avec `adb install -r` et conserve package, données/session, launcher, permission notification et deep link. Toute divergence de signature ou toute branche de désinstallation est bloquante. L'APK publiée reste `assembleDebug`, signée par la clé release `seenit`, tant qu'un changement de canal de build n'a pas été explicitement conçu et validé.

## 5. Firebase / Firestore immuables

- Base Firestore canonique : **`default`**, exactement.
- Client et Firebase Admin la sélectionnent explicitement ; pas de `getFirestore()` implicite.
- `firebase-applet-config.json` ne contient aucun `firestoreDatabaseId` pilotant le runtime.
- Firestore Delete Protection reste activée.
- Projet Firebase canonique : `gen-lang-client-0201895414`.
- `android/app/google-services.json` est un artefact généré et git-ignoré, matérialisé depuis `docs/specifications/android-contract.json` ; AI Studio ne doit jamais en être la source.
- Le contrat Firebase contient **un unique client OAuth Android actif**, lié au certificat release `seenit` ; le client OAuth Web utilisé par Credential Manager reste inchangé.
- `android/gradlew` est normalisé exécutable par le matérialiseur Android avant les contrôles/builds.

Toute modification de projet Firebase, databaseId, signature ou identité Android est une migration : validation utilisateur explicite, sauvegarde/inventaire, plan de migration, rollback et tests PWA+APK. Aucun agent ne décide seul de cette migration.

## 5.1 Identité média des téléchargements

- **TMDB ID est l’unique identité canonique** pour rattacher une fiche SeenIt à un téléchargement.
- TVDB/IMDb peuvent être transportés comme métadonnées, mais doivent être résolus vers TMDB avant toute association média.
- Titre, titre original, année, nom de fichier et nom de release ne sont **jamais** des clés de matching.
- Un même transfert physique se reconnaît uniquement par `requestId`, infohash/downloadId/alias exact ou chemin de transfert exact ; en cas d'ambiguïté, ne pas fusionner.

## 5.2 Relations médias : TMDB pour les sagas, TVDB pour les franchises

La décision produit canonique est détaillée dans `docs/decisions/media-relations-2026-09-06.md` et suivie dans #130.

- Sur une fiche **Film**, l'**Ordre de visionnage** provient exclusivement d'une collection TMDB explicite. Ne jamais compléter une collection absente avec TVDB, un catalogue SeenIt, Wikidata ou une heuristique.
- Sur les fiches **Film et Série**, la relation **franchise / univers** provient normalement de TVDB à partir d'une identité externe exacte résolue depuis TMDB. Aucune recherche du média par titre et aucune recherche globale de listes n'est admise.
- Examiner uniquement les listes TVDB réellement rattachées à l'œuvre exacte, retenir au maximum une liste officielle admissible et **ne jamais fusionner plusieurs listes** pour élargir artificiellement une franchise.
- Le libellé d'une liste TVDB déjà atteinte depuis l'identité exacte peut seulement qualifier la liste pour l'interface (`franchise` ou `univers`). Il ne constitue jamais une clé de matching d'œuvre ou de membre.
- Chaque membre TVDB doit être résolu vers `movie:<tmdbId>` ou `tv:<tmdbId>` avant affichage. Titre, titre original, année, popularité, casting, studio, marque, mot-clé ou premier résultat ne servent jamais à rattacher un membre.
- Pour un film, la section TVDB est dédupliquée après l'Ordre de visionnage par `mediaType + tmdbId`. Une section sans autre média affichable est masquée.
- Les sections **Films similaires** et **Séries similaires** n'appartiennent plus aux fiches média. La découverte approximative reste dans Explorer et ne devient jamais un fallback d'une relation TVDB manquante.
- Wikidata, Kometa, MDBList et autres sources niche ne font plus partie de la stratégie normale de relations de fiche. Le catalogue SeenIt historique est hors du chemin runtime normal ; un éventuel override futur reste exceptionnel, versionné, exact et tracé, jamais une encyclopédie entretenue au cas par cas.
- Un exemple utilisateur nommé (Punisher, Harry Potter, House of the Dragon, etc.) peut devenir une fixture/TNR, **jamais** une condition, branche, regex ou exception de production fondée sur son titre.
- En cas d'ambiguïté ou de panne fournisseur, masquer la relation plutôt que rechercher par titre. Le reste de la fiche reste utilisable.

## 6. PWA et APK

### Référence UX pour toute modification d'interface

Lire `docs/specifications/ux-reference.md` pour les boutons, cartes, en-têtes, dialogues ou gestes. Distinguer comportements observés, invariants existants et cibles encore ouvertes. Préserver les gestes documentés et leurs effets métier ; décrire pour chaque changement le déclenchement, le résultat, l'annulation et l'alternative accessible. Un audit de code ne vaut pas validation visuelle PWA/APK.

SeenIt doit rester fonctionnel en PWA et APK Android. Un comportement natif différent doit être explicite (`Capacitor.isNativePlatform()` ou API Capacitor). Les liens externes gardent un fallback Web ; Plex privilégie l'application Android dans l'APK.

### AI Studio n'est pas une voie de production

- **Aucun pull/sync AI Studio n'est requis pour déployer SeenIt.** La synchronisation native depuis GitHub reste facultative et sert uniquement à charger le code dans l'éditeur ou la preview AI Studio. Toute modification voulue repart ensuite vers une branche/PR GitHub ; ne jamais réintroduire un pull, refresh ou publish « maison » dans l'application ou le backend.
- **Ne jamais présenter `Publish` dans AI Studio comme une étape normale ou nécessaire.** Le backend canonique est construit et déployé sur Cloud Run depuis `main` par GitHub Actions ; l'APK est construite, signée et publiée exclusivement par le workflow de release GitHub.
- L'image Cloud Run canonique contient aussi le frontend PWA. Un changement exclusivement frontend peut être différé par la détection d'impact backend : pour le publier immédiatement, utiliser le fast path 0.0a et le contrôleur connector-only `/deploy-pwa` de `docs/process/runtime-control.md`, plutôt que demander un clic manuel ou utiliser `Publish` dans AI Studio comme raccourci.
- Un agent ne déclenche jamais seul une publication AI Studio vers la production. Une utilisation exceptionnelle n'est admissible qu'après demande explicite du propriétaire, indisponibilité prouvée du chemin GitHub canonique, analyse du risque et plan de réconciliation/rollback. Elle reste une intervention non canonique à retracer ; la preview AI Studio, elle, peut être utilisée librement sans publication.

Le rapport final précise ce qui a été validé en PWA et/ou APK et ce qui attend volontairement la prochaine release groupée.

## 7. Audits, issues et traçabilité

**Tout audit doit être enregistré** dans `docs/audits/`, indexé dans `docs/audits/README.md` et contenir baseline, périmètre, preuves, décisions et matrice exhaustive. Un constat ouvert pointe vers une **issue GitHub priorisée** ou un risque accepté explicitement.

Une issue active est mise à jour aux jalons utiles : implémentation prête, validation/CI, merge, release ou blocage. Ne mettez pas à jour le corps après chaque micro-commit. Cochez un critère seulement quand il est réellement prouvé.

Une issue de code peut être fermée avec commit + tests + validation applicable. Une release n'est requise pour la fermeture que si le critère de l'issue exige explicitement un binaire publié ; les changements `light/backend` ne doivent plus attendre artificiellement une APK.

## 8. Rapport de fin d'intervention

Après chaque modification, conclure exactement avec :

### 🛠️ Ce qui a été fait
- Résumé des changements et validations.
- Ajouter dans cette section un sous-bloc **Difficultés rencontrées / amélioration continue** : y consigner uniquement les blocages, détours, limites d'outillage, échecs de CI/TNR ou hypothèses invalidées réellement rencontrés pendant le chantier, avec l'enseignement concret ou l'amélioration durable associée. Ne jamais inventer de difficulté ; écrire « Aucune difficulté notable » lorsqu'il n'y en a pas.

### 📌 Impact & Mode de déploiement
- Classe `light`, `backend` ou `apk`, et préciser si l'APK attend la prochaine release groupée.

### 💾 Checkpoint de fin
- Résumer le checkpoint persistant enregistré dans l'issue : état exact, branche/PR/SHA, validations utiles, blocage éventuel, prochaine action exacte et critère de fin.
- Si le chantier est terminé, écrire exactement : **`Prochaine action : aucune — chantier terminé`**.

### 🚀 Action requise de ton côté
- Action concrète attendue, ou « Aucune » si rien n'est nécessaire.
