# Audit ciblé — dérives AI Studio / Firebase / Firestore

- **Identifiant** : AUDIT-2026-09-01-AISTUDIO-FIRESTORE
- **Date** : 1er septembre 2026
- **Dernière vérification** : 1er septembre 2026
- **Statut** : protections en cours d'implémentation via [issue #21](https://github.com/julfou7/seenit-app/issues/21)
- **Version auditée** : SeenIt 1.4.90
- **Commit de référence** : `f9626da59af96d5209431366d56d811656f98291`
- **Périmètre** : historique Git des changements de configuration Firebase/Firestore et comportement des imports/synchronisations AI Studio.
- **Preuves** : commits GitHub cités ci-dessous, configuration courante `src/lib/firebase.ts`, `src/lib/firebase-admin.ts`, `firebase-applet-config.json`, `android/app/google-services.json`.

## Synthèse

L'historique montre une régression récurrente : l'identifiant Firestore a été modifié plusieurs fois entre `default`, `(default)`, l'absence d'identifiant et un identifiant personnalisé provenant de `firebase-applet-config.json`. Ces bascules ont provoqué des écrans vides, des erreurs « client is offline », des lectures/écritures bloquées et plusieurs versions correctives successives.

Le comportement stable confirmé par les correctifs les plus récents est :

- base Firestore applicative exacte : `default` ;
- client Web/PWA/APK : initialisation explicite sur `default` ;
- Firebase Admin : `getFirestore('default')` ;
- le champ `firestoreDatabaseId` de `firebase-applet-config.json` est une métadonnée de workspace AI Studio et ne constitue pas la source de vérité de la base utilisée par SeenIt ;
- `android/app/google-services.json` est requis pour l'intégration Firebase Android/FCM et ne doit pas être supprimé lors d'un import ou d'une synchronisation AI Studio.

## Points solides à conserver

- le projet Firebase actuel reste `gen-lang-client-0201895414` ;
- le package Android reste `com.seenit.app` ;
- Firestore est explicitement ouvert sur `default` côté client et Admin ;
- `google-services.json` est déjà listé parmi les fichiers obligatoires du contrat Android ;
- le contrat `SEENIT-DATA-004` cible précisément projet + base pour la récupération IndexedDB ; changer le databaseId implicitement invaliderait cette garantie.

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

Le problème n'est pas seulement technique : un import ou une synchronisation AI Studio peut produire des modifications automatiques de fichiers de configuration. Si ces changements sont acceptés comme des « mises à niveau » sans comparaison avec GitHub, des métadonnées propres au workspace AI Studio peuvent être prises à tort pour la configuration canonique de SeenIt.

La protection ne peut donc pas dépendre uniquement du fait qu'un agent ait lu une consigne : les invariants doivent aussi être exécutables et faire échouer la validation si un outil les réécrit.

## Décisions non négociables

1. Un import/sync AI Studio est un mécanisme de transport, pas une migration de configuration.
2. Toute modification générée automatiquement lors d'un import doit être comparée à la branche GitHub source et rejetée si elle n'a pas été explicitement demandée.
3. `default` est le seul `databaseId` Firestore autorisé pour SeenIt tant qu'une migration de données distincte n'a pas été explicitement approuvée et testée.
4. Le code ne doit pas dériver le `databaseId` depuis `firebase-applet-config.json`.
5. `android/app/google-services.json`, le projet Firebase et l'identité Android sont des invariants ; ils ne peuvent pas être supprimés/remplacés par une synchronisation d'outil.
6. Les règles doivent être protégées par des tests afin qu'une omission de lecture de `AGENTS.md` ne suffise pas à réintroduire la régression.

## Matrice exhaustive des constats

| Constat | Priorité | Décision |
| --- | --- | --- |
| Identifiant Firestore réécrit à répétition | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — verrouillage `default` + tests |
| Métadonnée `firestoreDatabaseId` AI Studio prise comme source de vérité | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — interdiction explicite AGENTS/SPEC + test de non-utilisation |
| Import AI Studio générant des diffs non demandés | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — import/sync non autoritatif, comparaison Git obligatoire |
| Suppression possible de `google-services.json` | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — identité Firebase ajoutée au contrat Android |
| `AGENTS.md` racine potentiellement non préchargé par le harnais | P1 | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — bootstrap `.agents/AGENTS.md` vers la source racine |
