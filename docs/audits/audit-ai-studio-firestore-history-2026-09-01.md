# Audit ciblé — dérives AI Studio / Firebase / Firestore

- **Identifiant** : AUDIT-2026-09-01-AISTUDIO-FIRESTORE
- **Date** : 1er septembre 2026
- **Dernière vérification** : 1er septembre 2026
- **Statut** : incident d'import AI Studio `71b7bd6` bloqué par la CI ; restauration et diagnostic renforcé dans la candidate SeenIt 1.4.96 suivie par l'issue #21
- **Version de référence avant intégration** : SeenIt 1.4.92
- **Commit de référence** : `4e644a4ca05994061eaf90fa8f5f38735943a4c3`
- **Périmètre** : historique Git des changements de configuration Firebase/Firestore et comportement des imports/synchronisations AI Studio.
- **Preuves** : commits historiques cités, configuration Firebase/Firestore courante, contrat Android et tests automatisés de l'issue #21.

## Synthèse

L'historique montre une régression récurrente : l'identifiant Firestore a été modifié plusieurs fois entre `default`, `(default)`, l'absence d'identifiant et un identifiant personnalisé provenant de `firebase-applet-config.json`. Ces bascules ont provoqué des écrans vides, des erreurs « client is offline », des lectures/écritures bloquées et plusieurs versions correctives successives.

Le comportement canonique est désormais figé et testé :

- base Firestore applicative exacte : `default` ;
- client Web/PWA/APK : initialisation explicite sur `default` ;
- Firebase Admin : `getFirestore('default')` ;
- le dépôt canonique ne déclare plus de champ `firestoreDatabaseId` dans `firebase-applet-config.json` ; toute réinjection AI Studio est rejetée ;
- `android/app/google-services.json`, le projet Firebase, le package Android et le mobile SDK app ID sont contrôlés par le contrat Android ;
- un import AI Studio est un transport non autoritatif et tout diff automatique non demandé est comparé à GitHub puis rejeté.

## Chronologie des dérives observées

| Version / commit | Changement | Conséquence / décision suivante |
| --- | --- | --- |
| 1.2.120 — `10152cb7` | passage de `(default)` à `default` et lecture de `firebaseConfig.firestoreDatabaseId` | tentative d'adaptation automatique à la configuration AI Studio |
| 1.2.123 — `39f56054` | retour de `default` vers `(default)` | nouvelle tentative de corriger un écran vide ; ensuite invalidée |
| 1.2.125 — `d1d41bf2` | retour explicite à `default` | corrige `Database '(default)' not found` |
| 1.3.82 — `b302b31b` | réintroduction d'un `customDbId` provenant de `firebase-applet-config.json`, et Admin sans ID explicite | la synchro reste instable / pointe vers une base non canonique |
| 1.3.83 — `a9eb23ce` | suppression du `customDbId`, client et Admin figés sur `default` | tests directs : la base réelle utilisée par SeenIt est `default` |
| 1.4.83–1.4.84 — `3e8d2d8a` / `ad024f99` | récupération IndexedDB ciblée sur projet + base réellement configurés | confirme l'importance de ne jamais changer implicitement l'identité de base |
| 1.4.95 — `29f396ca` | suppression de la métadonnée AI Studio orpheline et protection de `default` documentée | release valide conservée comme base du correctif |
| Import AI Studio — `71b7bd6f` | suppression automatique de `android/app/google-services.json` sous motif générique de credentials | CI `33555130076` en échec ; commit refusé comme source canonique |
| Candidate 1.4.96 | restauration du fichier Android canonique et contrat exécuté avant le garde de release | doit produire un diagnostic Firebase immédiat et une mise à jour APK vérifiée |

## Cause racine organisationnelle

Un import ou une synchronisation AI Studio peut produire des modifications automatiques de fichiers de configuration. Si ces changements sont acceptés comme des « mises à niveau » sans comparaison avec GitHub, des métadonnées propres au workspace peuvent être prises à tort pour la configuration canonique de SeenIt. La protection ne doit donc jamais dépendre uniquement de la lecture d'une consigne : les invariants critiques sont aussi exécutables dans les tests.

## Décisions non négociables

1. Un import/sync AI Studio est un mécanisme de transport, pas une migration de configuration.
2. Toute modification générée automatiquement lors d'un import est comparée à la branche GitHub source et rejetée si elle n'a pas été explicitement demandée.
3. `default` est le seul `databaseId` Firestore autorisé tant qu'une migration distincte n'a pas été explicitement approuvée et testée.
4. Le code ne dérive pas le `databaseId` depuis `firebase-applet-config.json`.
5. `android/app/google-services.json`, le projet Firebase et l'identité Android sont des invariants.
6. `.agents/AGENTS.md` force la découverte des règles racine et les tests empêchent qu'une omission de lecture suffise à réintroduire la régression.

## Matrice exhaustive des constats

| Constat | Priorité | Décision |
| --- | --- | --- |
| Identifiant Firestore réécrit à répétition | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — verrouillage `default` + tests |
| Métadonnée `firestoreDatabaseId` AI Studio prise comme source de vérité | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — interdiction explicite AGENTS/SPEC + test de non-utilisation |
| Import AI Studio générant des diffs non demandés | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — import/sync non autoritatif, comparaison Git obligatoire |
| Suppression possible de `google-services.json` | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — identité Firebase intégrée au contrat Android |
| `AGENTS.md` racine potentiellement non préchargé par le harnais | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — bootstrap `.agents/AGENTS.md` vers la source racine |

## Clôture du nettoyage Firebase #22

Le 1er septembre 2026, après migration d’ATHIA vers `athia-prod`, les bases historiques `ai-studio-181cc...`, `ai-studio-tvtrackoffline...` et `ai-studio-seenit...` ont été contrôlées puis supprimées. L’ancien dossier Storage ATHIA `exercise_images/` du projet SeenIt a également été supprimé. La base SeenIt `default` reste la seule base applicative canonique et sa Delete Protection a été activée. SeenIt 1.4.95 retire enfin la métadonnée AI Studio devenue orpheline et ajoute un test empêchant sa réintroduction.

## Incident d'import après la release 1.4.95

Après un nouvel import/sync AI Studio, le commit `71b7bd6f46cc551cb0b83649f5ea6bacb2c33984` a supprimé le fichier suivi `android/app/google-services.json`, alors que `SEENIT-APK-004` exige sa présence et vérifie son projet, son package et son app ID. La CI [33555130076](https://github.com/julfou7/seenit-app/actions/runs/33555130076) a classé ce diff en APK complet puis l'a bloqué sur l'immuabilité de la version 1.4.95 déjà publiée. La correction 1.4.96 restaure le blob canonique sans changer d'identité Firebase et déplace le contrat Android avant le garde de release : une récidive sera ainsi bloquée avec le diagnostic natif précis avant toute compilation ou publication.

Le même commit a également normalisé silencieusement les modes Unix de `android/gradlew` et `scripts/pull.sh` de `100755` vers `100644`. Le premier run 1.4.96 a ainsi passé les 175 tests, le contrat APK, l'audit et le build Web, puis échoué sur `./gradlew: Permission denied`. La correction restaure les modes exécutables et ajoute un `chmod +x android/gradlew` défensif, testé et exécuté avant Gradle.

Le run correctif suivant a confirmé que le garde d'immuabilité interdit aussi la réutilisation d'un numéro après un commit de candidate échoué. Cette politique stricte est conservée : la restauration des droits Gradle et son filet de sécurité sont donc publiés sous SeenIt 1.4.97, tandis que 1.4.96 reste une candidate Git non publiée.
