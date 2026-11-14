# Rétention du stockage GitHub SeenIt

Statut : extension opérationnelle de `docs/process/delivery.md` et de `docs/specifications/release-control.md` pour la sobriété des releases et artefacts GitHub.

## Politique de rétention GitHub

Cette section clarifie et rend explicite l'invariant déjà appliqué par la maintenance de #668 : les gros binaires générés ne constituent jamais l'historique durable de SeenIt.

- **Règle active : GitHub conserve exactement une seule version distribuable, la dernière GitHub Release officielle.** Elle seule garde son APK et son `.sha256`.
- **Historique des notes (#312, `USR-2026-11-14-005`) :** les **10 dernières** GitHub Releases officielles, la release protégée comprise, sont conservées pour leurs notes, qui alimentent Réglages → Historique des versions. Les 9 précédentes perdent leurs binaires (`/releases/assets/{id}`) mais gardent leur objet Release ; au-delà de 10, la release entière est supprimée. Une release sans APK n'est jamais distribuable : l'application ne l'installe pas.
- Toute exemption qui conserverait un second binaire exige un besoin opérationnel documenté et un TNR dans le même changement ; elle ne doit jamais devenir une accumulation historique.
- Le flux APK canonique actuel télécharge sa baseline N avant de publier N+1 : il ne nécessite donc **pas** de conserver deux APK après publication. La cible actuelle reste exactement **1 APK**.
- Les tags Git et commits restent conservés : ils portent l'historique et la traçabilité sans dupliquer les APK.
- Les artefacts Actions suivent les durées bornées définies ci-dessous ; aucun nouveau producteur ne doit introduire une conservation longue de binaires sans justification documentée dans ce fichier.

## Objectif

SeenIt conserve la traçabilité Git sans conserver indéfiniment les gros binaires générés. Le dépôt Git, ses commits et ses tags SemVer restent l'historique durable. Les objets GitHub Release et les artefacts Actions sont des surfaces de distribution ou de preuve à durée bornée.

## Releases officielles

- En régime normal, la release protégée est la dernière release stable retournée par GitHub, ou la release exacte du SHA publié pendant le post-traitement d'une nouvelle release. Elle garde ses binaires ; les 9 releases antérieures les plus récentes gardent seulement leurs notes.
- La purge ne commence jamais tant qu'une release à préserver n'est pas prouvée.
- Lors du post-traitement d'une nouvelle APK, le SHA `main` publié protège la release correspondante avant toute suppression. Cela évite qu'un éventuel délai de mise à jour de `releases/latest` protège encore N au lieu de N+1.
- Une fois N+1 effectivement publiée, les binaires de N sont supprimés et la release la plus ancienne au-delà des 10 conservées est supprimée avec ses notes. Les binaires sont purgés avant les releases ; le tout reste borné par `MAX_DELETIONS_PER_RUN`.
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

## État opérationnel au 17 octobre 2026

La purge historique de #668 est achevée. GitHub ne conserve plus qu'une seule release officielle, `v1.4.210`, et le dernier passage de maintenance a ramené à **0** le reliquat d'anciennes releases et d'artefacts reconnus dépassant leur durée de rétention. Les tags et commits Git historiques ont été conservés.

Mise à jour du 14 novembre 2026 (#312) : la cible passe à 10 releases de notes pour une seule APK. Les notes supprimées avant cette date (jusqu'à `v1.4.308`) ne sont pas reconstruites ; l'historique se remplit à chaque nouvelle release.

La maintenance quotidienne et le post-traitement des nouvelles releases continuent d'appliquer automatiquement cette politique. Le volume de stockage n'est pas traité comme une preuve de la cause du précédent flag anti-abus : ce lien ne peut être confirmé que par GitHub Support.
