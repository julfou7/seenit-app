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

## 0.2 Culture obligatoire — cause racine avant correctif

Pour tout bug, incident ou exemple utilisateur, l'agent distingue explicitement avant de coder :

1. le **symptôme observé** et son exemple reproductible ;
2. la **cause racine prouvée** ;
3. la **classe complète affectée** au-delà de l'exemple ;
4. le correctif global recherché et les risques résiduels.

Le correctif attendu traite la cause pour toute la classe affectée. Le cas signalé devient un TNR,
complété par au moins un invariant générique et, lorsque pertinent, un cas voisin ou négatif. Un ajout
de ligne dans un manifeste, une exception de données ou un traitement nominatif est qualifié honnêtement
de **correction locale** : il ne devient jamais une preuve de correction globale et ne ferme pas l'issue
systémique qui l'a rendu nécessaire.

Si aucun correctif global sûr n'est possible avec les sources ou l'autorité disponibles, l'agent ne le
remplace pas par une heuristique fragile. Il documente la limite, conserve l'issue racine ouverte et
propose une architecture ou un backlog borné. L'issue et la PR indiquent systématiquement « cause racine »,
« portée globale ou locale » et « risque résiduel ». Une pure copie d'interface, documentation ou tâche
sans anomalie peut indiquer « sans objet » afin de conserver le chemin light.

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
version déjà publiée est immuable : tout correctif ultérieur exige un nouveau patch et un `versionCode` supérieur.

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

- `applicationId` et `namespace` doivent rester `com.seenit.app`.
- Capacitor doit rester `appId = com.seenit.app` et `appName = SeenIt`.
- Firebase Android attendu : `project_id = studio-6309767709-8a75a`,
  `project_number = 799043440232`, `mobilesdk_app_id = 1:799043440232:android:201a0369cb7e1c5c230ebd`.
- `google-services.json` est un artefact Android généré par `scripts/materialize-android-config.cjs` à
  partir de `config/firebase-android.canonical.json` et n'est plus une source canonique éditable. Toute
  copie absente ou dérivée est rematérialisée avant Gradle ; elle ne doit jamais être reprise depuis un
  import AI Studio.
- Les fingerprints du certificat de signature **actif** sont déclarés dans
  `config/android-signing.canonical.json`. Après chaque rotation explicitement approuvée, ce fichier et
  les clients OAuth associés doivent être mis à jour ensemble ; `npm run verify:android` et la CI les
  vérifient.
- La clé privée de signature release n'est jamais versionnée. Elle est reconstruite depuis les GitHub
  Secrets au moment de la release et supprimée du runner après usage.
- Tant qu'une décision produit explicite ne l'a pas demandé, un changement de clé est **bloqué**.
- Après la bascule validée en `1.4.112`, l'APK active utilise uniquement la nouvelle clé PKCS12 `seenit`.
  Les secrets de l'ancienne clé et son ancien client OAuth Android ont été supprimés : aucun rollback de
  signature historique n'est autorisé et toutes les versions `1.4.113+` doivent conserver les
  fingerprints actifs pour permettre les mises à jour sur place.
- Une release doit échouer si la clé de signature active est absente ou si son certificat ne correspond pas
  aux fingerprints canoniques.

## 5. Invariants d'identité média, Plex et téléchargements

### 5.1 Identité média

- L'identité d'une œuvre est `mediaType + tmdbId`. Un même identifiant numérique TMDB n'est jamais
  fusionné entre `movie` et `tv`.
- Le format de clé canonique d'une relation média est `movie:<tmdbId>` ou `tv:<tmdbId>`.
- Un groupe de saga/univers est défini par une source autoritative (TMDB collection, TVDB liste officielle déjà rattachée à l'identité exacte, ou override SeenIt explicitement validé), jamais par le titre, l'année, la popularité ou le premier résultat d'une recherche.
- Un changement Film/Série ou une collision d'identifiants doit être traité comme une identité distincte.

### 5.2 Identité Plex

- La résolution Plex repose exclusivement sur ses GUIDs techniques (`tmdb://`, `imdb://`, `tvdb://`) et
  les identifiants vérifiés auprès des fournisseurs.
- Le titre et l'année ne sont pas des clés de matching.
- En cas de collision ou de metadata insuffisante, le système doit conserver l'identité courante et ne
  jamais fusionner silencieusement deux œuvres.

### 5.3 Synchronisation Plex

- Une entrée `watchlist` ou une activité ambiguë ne doit jamais créer un état « vu ».
- Le `Watch History` de compte n'est pas une preuve suffisante sans `userState.viewCount` courant.
- La présence seule d'un GUID dans une source Plex n'implique aucun état de visionnage.
- Les baselines DELTA persistées doivent mémoriser au minimum `serverId + ratingKey` pour chaque entrée
  techniquement vue, indépendamment de la résolution TMDB, avec provenance et horodatage nécessaires pour
  réconcilier ensuite les suppressions/non-vus sans titre ni année.
- La preuve d'un état `non vu` DELTA est bornée au `ratingKey` exact du même serveur : après disparition
  d'un locator précédemment vu d'un snapshot watched complet, une réponse metadata exacte de ce même
  `ratingKey` confirme le zéro si elle expose `viewCount = 0`, ou si Plex omet `viewCount` tout en
  retournant bien l'objet exact sans compteur positif. Un `404`, timeout, serveur ignoré ou simple
  silence ne confirme jamais le zéro.
- Full et Delta doivent converger vers le même état lorsque les mêmes preuves complètes sont disponibles ;
  aucune suppression n'est inférée depuis une collecte incomplète.
- La synchronisation Plex ne retire jamais un état manuel ou une provenance non Plex ; elle ne peut
  révoquer que ses propres progressions `plexImported` dont la preuve contraire est techniquement exacte.

### 5.4 Téléchargements : identité et déduplication

- Une identité média de téléchargement utilise uniquement le TMDB ID et le type Film/Série ; si le type
  n'est pas disponible, l'action doit rester bloquée plutôt que deviner.
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

Toute modification fonctionnelle doit être évaluée sur les deux plateformes.

### 6.1 PWA

- Firebase Auth doit rester compatible navigateur.
- Les accès distants doivent passer par HTTPS/CORS compatibles navigateur.
- Les fonctionnalités natives doivent avoir un fallback web clair.

### 6.2 APK

- Les plugins Capacitor ne doivent être appelés qu'après `Capacitor.isNativePlatform()` ou garde équivalente.
- Les intents Android, notifications, partages et accès fichiers doivent conserver un fallback ou une erreur utilisateur propre.
- Les plugins natifs non disponibles ne doivent jamais casser le chargement de l'application.

### 6.3 Parité fonctionnelle

- Une feature partagée doit utiliser la même source de données et le même contrat d'identité sur PWA et APK.
- Une différence de comportement volontaire doit être documentée dans la SPEC.

## 7. Changements de données, migrations et suppression

- Une migration Firestore destructive exige validation explicite et sauvegarde ou stratégie de rollback.
- Une suppression de collection, document, champ ou base ne doit jamais être implicite.
- Les imports AI Studio ne sont jamais une autorité de migration.
- Toute migration de schéma doit être réentrante ou protégée contre une double exécution.

## 8. Sécurité et secrets

- Aucun secret de production ne doit être commité.
- Les secrets GitHub sont injectés uniquement dans les jobs qui en ont besoin.
- Aucun log ne doit imprimer un token, une URL contenant un token ou un secret complet.
- Toute variable `VITE_*` est considérée comme **publique** et doit être absente pour les clés serveur TMDB, OMDb et TVDB.
- `TMDB_API_KEY`, `OMDB_API_KEY` et `TVDB_API_KEY` sont des secrets **serveur uniquement** ; la PWA/APK n'appelle que la façade SeenIt authentifiée.
- Le backend fournisseur utilise des hôtes HTTPS en allowlist, refuse les redirections et limite les corps/réponses ; un token Firebase ne doit jamais être transmis à un fournisseur tiers.
- Les routes fournisseur sont protégées par Firebase Auth, quotas par UID et cache borné. Le backend ne devient jamais un proxy ouvert.
- Cloud Run doit référencer les trois secrets fournisseur depuis **Secret Manager** (`secretKeyRef`, version explicite ou `latest`) et le compte de service runtime doit disposer de `roles/secretmanager.secretAccessor` ; aucune valeur fournisseur n'est copiée dans GitHub ou l'export Cloud Run.
- L'injection de secret doit rester fail-closed : une nouvelle révision sans les trois clés ou sans accès Secret Manager ne doit jamais recevoir le trafic de production.
- Les logs de synchronisation visibles côté app doivent masquer les secrets et limiter les identifiants sensibles.
- La configuration locale de développement doit utiliser `.env.local` ou variables de shell ignorées par Git.

## 9. Notifications

- Une notification liée à un média utilise le `tmdbId` et le type du média comme référence canonique.
- L'image du média utilise la chaîne de fallback documentée ; une absence d'image ne doit jamais provoquer de crash.
- Les worklets/tasks natives de notification ne doivent pas accéder à un état React volatile.
- Toute API native pouvant lever une exception doit être contenue et journalisée sans crash du processus.

## 10. Tests et TNR

- Les cas ayant déjà causé une régression ou un crash deviennent des TNR permanents.
- Les tests nommés ne doivent pas introduire de branche spéciale en production.
- Les tests de relation vérifient systématiquement `movie:<id>` vs `tv:<id>` et l'absence de fallback par titre.
- Les tests d'identité ne doivent jamais passer uniquement parce qu'une fixture possède un titre unique.
- Un correctif de notification vérifie au minimum notification sans image, image distante valide et image locale invalide.
- Les tests de sécurité scannent les artefacts client pour interdire clés, hôtes fournisseur et variantes `VITE_*` côté bundle.

## 11. Processus d'exécution

- Le repo doit rester compilable après chaque commit significatif.
- Ne pas pousser un changement qui n'a pas de test ciblé lorsqu'un comportement est modifié.
- Une issue n'est fermée qu'après validation CI ou preuve terrain adaptée.
- Pour tout bug, les sections cause racine / portée / risque résiduel de l'issue ou de la PR sont obligatoires avant fermeture.
- Une correction locale de données ne ferme pas une issue systémique tant que la cause globale subsiste.
- Après un merge, vérifier le `main` distant et l'état de déploiement/release concerné.
- Une issue fermée par une PR n'est pas considérée terminée tant que l'état observé en production ou dans l'artefact demandé n'est pas cohérent avec le résultat attendu.
- Un workflow temporaire auto-modifiant est interdit. Si un besoin de migration nécessite un outil ponctuel, utilisez un script local non versionné ou un workflow existant borné ; ne commitez pas un workflow qui pousse sa propre branche ou supprime ses propres fichiers.
- Lorsque la demande utilisateur inclut explicitement une **publication**, ne rendez jamais la main avant d'avoir déclenché la release prévue ou identifié un blocage extérieur concret.
- Lorsque la demande n'inclut pas de publication, ne déclenchez pas de release APK automatiquement.

## 12. Format de retour après modification

Le dernier message de l'agent après modification doit se terminer par les trois sections ci-dessous :

### 🛠️ Ce qui a été fait
- Résumé des changements et validations.

### 📌 Impact & Mode de déploiement
- Classe `light`, `backend` ou `apk`, et préciser si l'APK attend la prochaine release groupée.

### 🚀 Action requise de ton côté
- Action concrète attendue, ou « Aucune » si rien n'est nécessaire.
