# Rétention du stockage GitHub SeenIt

Statut : extension opérationnelle de `docs/process/delivery.md` et de `docs/specifications/release-control.md` pour la sobriété des releases et artefacts GitHub.

## Objectif

SeenIt conserve la traçabilité Git sans conserver indéfiniment les gros binaires générés. Le dépôt Git, ses commits et ses tags SemVer restent l'historique durable. Les objets GitHub Release et les artefacts Actions sont des surfaces de distribution ou de preuve à durée bornée.

## Releases officielles

- Une seule GitHub Release officielle est conservée : la dernière release stable retournée par GitHub, ou la release exacte du SHA publié pendant le post-traitement d'une nouvelle release.
- La purge ne commence jamais tant qu'une release à préserver n'est pas prouvée.
- Lors du post-traitement d'une nouvelle APK, le SHA `main` publié protège la release correspondante avant toute suppression. Cela évite qu'un éventuel délai de mise à jour de `releases/latest` protège encore N au lieu de N+1.
- Une fois N+1 effectivement publiée, les objets GitHub Release plus anciens et leurs assets sont supprimés.
- **Les tags Git ne sont jamais supprimés par cette maintenance.** Ils restent disponibles pour l'historique, les comparaisons, les notes de version et les diagnostics.
- Le smoke N → N+1 télécharge sa baseline **avant** la publication de N+1 ; la purge post-release n'affaiblit donc pas `SEENIT-APK-003`.

## Artefacts GitHub Actions

Le script `scripts/prune-github-storage.cjs` applique une rétention logique même si un workflow producteur possède une valeur `retention-days` historique plus longue :

| Famille | Rétention |
|---|---:|
| APK intermédiaire `SeenIt-Android-APK-*` / ancien `seenit-apk-*` | 1 jour |
| Harness Android `SeenIt-Android-Upgrade-Test-*` / ancien `seenit-test-harness-*` | 1 jour |
| Quality gates PWA / agent et rapports de smoke upgrade Android | 7 jours |
| Artefacts non reconnus | jamais supprimés automatiquement |

Un artefact reconnu déjà marqué `expired` est supprimable immédiatement. La maintenance ne supprime pas un artefact inconnu simplement parce qu'il est ancien.

## Déclenchement

La maintenance vit dans le workflow post-release existant `release-update-push.yml` afin de ne pas multiplier les workflows :

1. après une publication APK, la notification/checkpoint conserve son comportement ;
2. la maintenance s'exécute ensuite avec le SHA publié comme garde de la release à conserver ;
3. une exécution quotidienne couvre aussi les artefacts produits par des validations sans nouvelle release ; elle protège alors `releases/latest` ;
4. un mode manuel reste possible via le workflow existant lorsque ses paramètres de release sont fournis.

Les suppressions exigent explicitement `SEENIT_STORAGE_APPLY=true`. Une exécution locale du script sans cette variable reste en **dry-run**.

## Sécurité et idempotence

- Dépôt autorisé : exactement `julfou7/seenit-app`.
- La collection de releases doit contenir la release protégée avant toute suppression. Si GitHub renvoie une vue partielle/incohérente, la purge des releases échoue fermée.
- Si aucune release officielle n'est prouvée, aucune release n'est supprimée.
- Le script ne possède aucun chemin de suppression de tag/ref Git.
- Les suppressions sont idempotentes par ID GitHub ; une nouvelle exécution recalcule le plan depuis l'état distant.
- La maintenance protège toujours `latest`, même si le déclencheur de notification concerne une version
  antérieure ; les brouillons, préreleases et publications postérieures à la version protégée sont exclus.
- Les mutations sont séquentielles, espacées de 1,5 seconde et bornées à 100 suppressions par passage.
  Le reliquat du stock historique reste annoncé pour le passage suivant ; la notification et la purge
  partagent une concurrence globale. Une limitation GitHub arrête le passage sans rejeu aveugle.
  Cette cadence reste prudente après la réactivation, conformément aux
  [limites et bonnes pratiques GitHub](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- Les permissions `contents: write` et `actions: write` sont bornées au workflow post-release/maintenance par `scripts/validate-workflow-policy.cjs`.

## Restriction de compte en cours au 13 octobre 2026

La restriction GitHub du compte empêche actuellement GitHub Actions et dégrade certaines collections API. Tant que cette restriction n'est pas levée :

- le code de maintenance peut être préparé/validé en quarantaine mais aucun run Actions ne peut exécuter la purge ;
- la collection `/releases` peut apparaître vide alors que `/releases/latest` reste accessible ; dans cet état, aucune suppression automatique ne doit être tentée ;
- la purge réelle de l'historique existant reprend après restauration du compte, puis une mesure avant/après est consignée dans l'issue #668.

Le volume de stockage n'est pas traité comme une preuve de la cause du flag anti-abus : ce lien ne peut être confirmé que par GitHub Support.
