# Registre des audits SeenIt

Ce dossier conserve les constats historiques. La SPEC reste la source de vérité du comportement
courant et GitHub Issues la source de vérité des actions à réaliser.

## Contrat d'un audit terminé

Chaque audit doit contenir :

- un identifiant stable, une date, la version et le commit observés ;
- le périmètre, les limites et les preuves reproductibles ;
- les points solides afin de ne pas les casser ;
- chaque constat avec priorité, impact et critère de sortie ;
- une matrice exhaustive vers une issue GitHub priorisée, une correction déjà livrée ou un risque
  explicitement accepté et justifié ;
- la date de dernière vérification et le statut du rapport.

Avant de créer une issue, l'agent recherche les issues ouvertes et fermées pour éviter les doublons.
Une réévaluation complète crée un nouvel audit ; une précision sur les mêmes preuves met à jour le
rapport existant et son historique.

## Index

| ID | Date | Baseline | Périmètre | Rapport | Backlog |
|---|---|---|---|---|---|
| AUDIT-2026-08-31-GLOBAL | 2026-08-31 | 1.4.80 (`75ec2f1` après durcissement 1.4.81) | application, PWA, APK, backend, sécurité, structure, tests et CI/CD | [Audit global](./audit-global-2026-08-31.md) | [Issues #9 à #19](../backlog/README.md) |
| AUDIT-2026-09-01-AISTUDIO-FIRESTORE | 2026-09-01 | 1.4.92 (`4e644a4`) | AI Studio, Firebase, Firestore, identité Android | [Audit ciblé](./audit-ai-studio-firestore-history-2026-09-01.md) | [Issue #21](https://github.com/julfou7/seenit-app/issues/21) |
| AUDIT-2026-09-02-AISTUDIO-RUNTIME-CUTOVER | 2026-09-02 | 1.4.99 (`150b3a9`) | AI Studio, Cloud Run, domaine, Firebase/Firestore, IAM, FinOps, sécurité | [Audit incident](./audit-ai-studio-runtime-cutover-2026-09-02.md) | [#22](https://github.com/julfou7/seenit-app/issues/22), [#23](https://github.com/julfou7/seenit-app/issues/23), [#28](https://github.com/julfou7/seenit-app/issues/28), [#30](https://github.com/julfou7/seenit-app/issues/30) |
| AUDIT-2026-09-02-DELIVERY-PROCESS | 2026-09-02 | 1.4.107 (`f18c5ad`) | GitHub Actions, classification, versionnement, SPEC/processus, Gradle, smokes Android, releases | [Audit livraison](./audit-delivery-process-2026-09-02.md) | [Issue #45](https://github.com/julfou7/seenit-app/issues/45) |
| AUDIT-2026-09-04-CI-RECENT-BUILDS | 2026-09-04 | 1.4.112 (`3e46bc2`) | 100 runs GitHub Actions, validations, échecs, temps npm, doublons PR/main et releases APK | [Audit CI/CD](./audit-ci-builds-2026-09-04.md) | [#83](https://github.com/julfou7/seenit-app/issues/83), [#84](https://github.com/julfou7/seenit-app/issues/84), [#85](https://github.com/julfou7/seenit-app/issues/85) |
| AUDIT-2026-09-05-RELEASE-ORCHESTRATION | 2026-09-05 | 1.4.115 (`ffdb17d`) | Publication connector-only, attente de runners, suivi agent et bruit des workflows de notification/commentaire | [Audit releases APK](./audit-release-orchestration-2026-09-05.md) | [#135](https://github.com/julfou7/seenit-app/issues/135) |
| AUDIT-2026-09-04-FONCTIONNEL | 2026-09-04 | 1.4.112 (`30f90ce`) | produit complet, écrans, parcours, états, sources, multi-appareils, PWA/APK et écarts code/SPEC | [Audit fonctionnel](./audit-fonctionnel-2026-09-04.md) | [#15](https://github.com/julfou7/seenit-app/issues/15), [#68](https://github.com/julfou7/seenit-app/issues/68), [#93](https://github.com/julfou7/seenit-app/issues/93), [#94](https://github.com/julfou7/seenit-app/issues/94), [#95](https://github.com/julfou7/seenit-app/issues/95), [#96](https://github.com/julfou7/seenit-app/issues/96) |
| AUDIT-2026-09-05-MEDIA-RELATIONS | 2026-09-05 | 1.4.114 (`afae1ae`) | sagas, univers cross-media, médias similaires, identité, navigation, performance et sources TMDB/TVDB/Wikidata | [Audit relations médias](./audit-media-relations-2026-09-05.md) | [Issue #130](https://github.com/julfou7/seenit-app/issues/130) |

L'audit historique des téléchargements antérieur à ce protocole reste disponible dans
[`../audit-telechargements-2026-08-30.md`](../audit-telechargements-2026-08-30.md). Ses corrections
déjà livrées sont couvertes par les exigences `SEENIT-DOWNLOAD-*` et leurs tests.

