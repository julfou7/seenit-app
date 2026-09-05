# Audit de l’orchestration des releases APK — 5 septembre 2026

Identifiant : **AUDIT-2026-09-05-RELEASE-ORCHESTRATION**
Baseline : SeenIt **1.4.115**
Commit audité : `main` `ffdb17d9e064e5d3eeec766de8893fa643503b3f`
Issue de suivi : [#135](https://github.com/julfou7/seenit-app/issues/135)

## Périmètre

- demande utilisateur « Publie l’APK » depuis une nouvelle conversation ;
- préparation de candidate et déclencheur connector-only de #102 ;
- workflows `Validate & Release SeenIt`, `SeenIt Release Control` et notification Android ;
- durées réelles des releases 1.4.113 à 1.4.115 ;
- bruit produit dans l’onglet GitHub Actions ;
- garde-fous de version, signature, immuabilité et smoke N → N+1.

## Preuves

| Release | Run | Durée totale | Build actif | Smoke Android 36 | Publication | Attente notable |
|---|---:|---:|---:|---:|---:|---:|
| 1.4.113 | [#589](https://github.com/julfou7/seenit-app/actions/runs/33914447515) | 6 min 21 | 2 min 10 | 3 min 13 | 47 s | normale |
| 1.4.114 | [#603](https://github.com/julfou7/seenit-app/actions/runs/33953496536) | 6 min 11 | 2 min 32 | 3 min 06 | 21 s | normale |
| 1.4.115 | [#619](https://github.com/julfou7/seenit-app/actions/runs/33964581606) | 11 min 59 | 1 min 55 | 2 min 48 | 19 s | environ 6 min 50 entre build et smoke |

Pour 1.4.115, la commande `/release-apk` a créé le workflow en **17,9 secondes**. La préparation de
candidate #132, une fois lancée, a été créée puis fusionnée en environ 1 min 44. La lenteur visible
n’était donc pas le déclencheur : elle provenait surtout de l’attente d’un second runner et de la
conversation maintenue active par des lectures d’état répétées.

Au relevé, `SeenIt Release Control` comptait 19 runs : 2 utiles et 17 ignorés. Ce résultat est inhérent
au déclencheur GitHub `issue_comment`, qui ne filtre pas l’issue ou le corps du commentaire dans `on:`.
Le job ignoré ne lance ni test ni build. `Notify Android APK Update` comptait parallèlement 9 runs
ignorés, car son ancien `workflow_run` observait toutes les validations du workflow partagé.

## Matrice exhaustive des constats et décisions

| Constat | Priorité | Décision | Preuve attendue |
|---|---|---|---|
| L’agent reste actif après le dispatch et interroge régulièrement l’état du run. | P1 | Retour asynchrone dès que le run exact est identifié ; suivi complet seulement sur demande explicite. | TNR `releaseFastPath` + consignes racine/bootstrap. |
| Le passage build → smoke Android 36 demande un second runner et peut rester en file. | P1 | Exécuter build et smoke Android 36 dans le même job à droits `contents: read`. | TNR Android/workflow + prochaine release réelle. |
| Le workflow de notification s’abonne à toutes les validations. | P1 | Le job de publication émet un `repository_dispatch` dédié ; le workflow notification n’est créé que pour une release ou un rejeu manuel. | TNR `releaseUpdatePushWorkflow`. |
| Le dispatch de notification précède de quelques secondes la fin du run source. | P1 | Attendre de façon bornée le statut `completed/success` et vérifier chemin, événement, branche et SHA avant le backend. | Test pur du run source + revalidation backend existante. |
| Une panne de notification ne doit pas transformer une release déjà publiée en échec. | P1 | Le dispatch est non bloquant, journalisé et rejouable avec `run_id` + SHA exacts. | Étape `continue-on-error` + workflow manuel idempotent. |
| Tous les commentaires créent une ligne `SeenIt Release Control` ignorée. | P2 | Risque accepté tant que le connecteur ne fournit pas `workflow_dispatch` ; ne pas ajouter d’infrastructure externe uniquement pour masquer ce bruit. | Contrat `release-control.md`. |
| Le bouton GitHub manuel échoue si la version n’a pas été préparée. | conforme | Conserver ce fail-fast : le workflow ne modifie pas `main`. Le « un clic » est assuré par l’orchestration agent, pas par un bump silencieux dans la CI. | Garde d’immuabilité inchangé. |

## Résultat cible

- une seule intervention utilisateur pour demander la publication ;
- retour de la conversation immédiatement après identification du run ;
- aucune transition de runner entre build APK et smoke Android 36 ;
- un run de notification uniquement par release, plus les rejeux explicitement demandés ;
- aucune réduction des tests, de la signature, du smoke Android cible ou de l’immuabilité ;
- mesure séparée du temps opérateur, du chemin critique actif et des files GitHub restantes.

La validation définitive de performance exige une release réelle postérieure à ce changement. L’issue
#135 reste ouverte jusqu’à cette preuve terrain ; les assertions locales ne simulent pas le scheduler
GitHub Actions.
