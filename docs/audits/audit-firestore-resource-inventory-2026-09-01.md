# Audit ciblé — inventaire et isolation Firebase / Firestore

- **Identifiant** : AUDIT-2026-09-01-FIRESTORE-INVENTORY
- **Date** : 1er septembre 2026
- **Dernière vérification** : 1er septembre 2026
- **Statut** : en cours — cartographie Git terminée, preuves console/données/activité encore requises avant toute suppression
- **Version observée** : SeenIt 1.4.93 candidate intégrée sur `main`
- **Commit observé** : `499eb0094bcbca47cd1bd2c142dc5f6c1b4c0809`
- **Périmètre** : bases Firestore du projet Firebase SeenIt, partage involontaire avec ATHIA, métadonnées AI Studio, règles et historique Git.
- **Preuves** : code courant SeenIt/ATHIA, configurations Firebase des deux dépôts, historique Git ciblé, capture Firebase fournie et issue #22.

## Synthèse

Le projet Firebase `gen-lang-client-0201895414` héberge quatre bases Firestore visibles dans la console. L'audit du code prouve que SeenIt utilise exclusivement `default`, tandis qu'ATHIA utilise actuellement la base nommée `ai-studio-181cc7e6-7ccf-4256-9461-fecccda528aa` au sein du même projet Firebase.

Le partage entre SeenIt et ATHIA dépasse Firestore : les configurations courantes utilisent le même projet Firebase, donc le même périmètre Authentication, Storage et identité de projet. La migration ATHIA doit par conséquent isoler l'ensemble du projet Firebase, pas seulement changer de `databaseId`.

Deux autres bases AI Studio restent candidates au nettoyage : `ai-studio-seenit-05204624-d504-4df8-a680-ef24c8c05fcd` et `ai-studio-tvtrackoffline-05204624-d504-4df8-a680-ef24c8c05fcd`. Aucune suppression n'est autorisée avant contrôle de leur contenu, activité, workspaces associés et sauvegarde éventuelle.

## Matrice des bases

| Base | Usage prouvé | Décision actuelle | Critère de sortie |
| --- | --- | --- | --- |
| `default` | SeenIt PWA/APK et Firebase Admin | KEEP définitif | aucun : invariant canonique |
| `ai-studio-181cc7e6-7ccf-4256-9461-fecccda528aa` | ATHIA runtime actuel | KEEP temporaire | ATHIA migré vers un projet Firebase indépendant et validé |
| `ai-studio-seenit-05204624-d504-4df8-a680-ef24c8c05fcd` | aucune utilisation runtime SeenIt ; référence résiduelle AI Studio | candidate au nettoyage | contenu/activité/workspace audités + sauvegarde si nécessaire |
| `ai-studio-tvtrackoffline-05204624-d504-4df8-a680-ef24c8c05fcd` | aucune référence dans les dépôts Git audités | candidate probablement orpheline | contenu/activité/workspace audités + sauvegarde si nécessaire |

## Preuves reproductibles

### SeenIt

- `src/lib/firebase.ts` fixe `FIRESTORE_DATABASE_ID = 'default'` et le passe explicitement à `initializeFirestore`.
- `src/lib/firebase-admin.ts` utilise `getFirestore('default')`.
- `firebase-applet-config.json` contient encore `firestoreDatabaseId = ai-studio-seenit-...`, mais ce champ ne pilote plus le runtime.
- `android/app/google-services.json` appartient au projet Firebase `gen-lang-client-0201895414` et au package `com.seenit.app`.
- `firestore.rules` refuse tout par défaut puis autorise uniquement les documents du compte authentifié sous `/users/{uid}/...`.

### ATHIA

- `firebase-applet-config.json` utilise encore `projectId = gen-lang-client-0201895414` et `firestoreDatabaseId = ai-studio-181cc...`.
- `src/firebase.ts` fait explicitement `getFirestore(app, firebaseConfig.firestoreDatabaseId)` : la base `ai-studio-181cc...` est donc active.
- La même configuration réutilise le projet Authentication et le Storage bucket du projet Firebase SeenIt.
- Le backend ATHIA actuel ne contient pas d'initialisation Firebase Admin ; l'accès Firebase audité est côté client.
- `firestore.rules` ATHIA définit un schéma fitness distinct sous `/users/{uid}/...`.

### Historique SeenIt / AI Studio

L'historique montre plusieurs changements contradictoires de l'identité Firestore :

| Version / commit | Constat |
| --- | --- |
| 1.2.120 — `10152cb7` | `(default)` est remplacé par un fallback `default` tout en autorisant `firebaseConfig.firestoreDatabaseId`. |
| 1.2.123 — `39f56054` | retour à `(default)`. |
| 1.2.125 — `d1d41bf2` | retour explicite à `default` après erreur `Database '(default)' not found`. |
| 1.3.82 — `b302b31b` | réintroduction d'un `customDbId` provenant des métadonnées Firebase/AI Studio. |
| 1.3.83 — `a9eb23ce` | suppression de ce comportement et retour explicite à `default` après tests directs. |
| 1.4.02 — `1b1f3494` | un commit consacré à Plex ajoute pourtant `firestoreDatabaseId = ai-studio-seenit-...` dans la configuration Firebase. |
| commit suivant — `4ce1968f` | le même champ est retiré pendant un autre changement Plex. |
| 1.4.53 — `ee44f37a` | un commit consacré au Git Pull réinjecte une nouvelle fois le champ `firestoreDatabaseId` AI Studio. |

Cette alternance, souvent dans des commits dont le sujet fonctionnel n'est pas Firebase, confirme que les métadonnées du workspace ont été normalisées/réinjectées sans constituer une décision d'architecture SeenIt.

## Règles et limites de l'audit

Les fichiers `firestore.rules` présents dans les dépôts décrivent l'intention source, mais ne prouvent pas quelles règles sont effectivement déployées sur chacune des bases nommées. Aucun `firebase.json` n'a été trouvé dans SeenIt ni ATHIA, et aucun `firestore.indexes.json` n'a été trouvé dans SeenIt.

L'accès GitHub audité expose deux dépôts détenus : `julfou7/seenit-app` et `julfou7/ATHIA`. Cela ne couvre pas les workspaces AI Studio non représentés par Git, les ressources Cloud configurées directement dans Firebase/GCP, ni l'activité réelle de chaque base.

L'agent n'a pas accès ici au contenu privé de la console Firestore. Les collections, volumes, dernières lectures/écritures et règles réellement déployées des bases candidates doivent donc être vérifiés dans Firebase avant suppression.

## Constats et décisions

| Constat | Priorité | Impact | Décision / issue |
| --- | --- | --- | --- |
| SeenIt dépend de `default` | P0 invariant | perte de données si suppression/changement | KEEP ; #21 verrouille l'identité, #22 interdit la suppression |
| ATHIA partage encore le projet Firebase SeenIt | P1 | Auth/Storage/projet communs et dépendance à une base nommée | #22 ; terminer migration ATHIA avant nettoyage |
| `ai-studio-181cc...` est active pour ATHIA | P1 | suppression casserait ATHIA | KEEP temporaire ; #22 |
| `ai-studio-seenit...` reste dans les métadonnées mais pas le runtime SeenIt | P1 | AI Studio peut la réintroduire comme source de vérité | #21 pour le garde-fou ; #22 pour l'inventaire/suppression éventuelle |
| `ai-studio-tvtrackoffline...` sans référence Git actuelle | P2 | coût/confusion et risque de mauvaise réutilisation | #22 ; contrôler console puis supprimer seulement avec preuve |
| injections répétées du `databaseId` dans des commits sans rapport | P1 | régressions de synchronisation et temps perdu | #21 livré sur `main` 1.4.93 candidate |

## Ordre de sortie

1. Publier et valider les garde-fous #21.
2. Terminer la migration ATHIA vers un projet Firebase totalement distinct.
3. Confirmer dans la console Firebase le contenu, l'activité et les règles réellement déployées de chaque base candidate.
4. Exporter les données à conserver.
5. Supprimer une seule base candidate à la fois avec validation après chaque suppression.
6. Vérifier qu'AI Studio ne recrée ni base ni `firestoreDatabaseId` non canonique.

## Backlog

- [Issue #21](https://github.com/julfou7/seenit-app/issues/21) — garde-fous AI Studio/Firebase et base `default` canonique.
- [Issue #22](https://github.com/julfou7/seenit-app/issues/22) — inventaire, isolation ATHIA et nettoyage des bases historiques.
