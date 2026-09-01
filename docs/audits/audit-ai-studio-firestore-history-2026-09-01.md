# Audit ciblé — dérives AI Studio / Firebase / Firestore

- **Identifiant** : AUDIT-2026-09-01-AISTUDIO-FIRESTORE
- **Date** : 1er septembre 2026
- **Dernière vérification** : 1er septembre 2026
- **Statut** : nettoyage des bases historiques terminé via #22 ; configuration canonique verrouillée en SeenIt 1.4.95
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
