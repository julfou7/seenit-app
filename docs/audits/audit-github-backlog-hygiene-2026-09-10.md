# AUDIT-2026-09-10-GITHUB-HYGIENE — issues et PR ouvertes

- **Date** : 2026-09-10
- **Version observée** : SeenIt 1.4.135
- **Baseline `main`** : `158f27bc34f0a7fe85b0fe7500eb1be5ed7cf18b`
- **Statut** : terminé
- **Dernière vérification** : 2026-09-10

## Périmètre

Audit d'hygiène du backlog GitHub demandé pour détecter les issues et pull requests ouvertes potentiellement oubliées. La photographie initiale contenait **30 issues ouvertes et 1 PR ouverte**. La revue croise `main`, l'historique des issues ouvertes et fermées, les PR fusionnées, les releases et les commentaires de suivi.

## Limites

Cet audit vérifie la cohérence administrative et la traçabilité du backlog. Il ne remplace pas une validation fonctionnelle sur appareil réel, une mesure de performance physique, un test Plex réel ni une nouvelle exécution exhaustive de la CI. Les tickets explicitement conservés pour une preuve terrain ou métrique restent donc ouverts tant que leur propre critère de sortie n'est pas satisfait.

## Preuves reproductibles

1. Rechercher `repo:julfou7/seenit-app is:issue is:open` puis `repo:julfou7/seenit-app is:pr is:open`.
2. Vérifier la baseline via la branche `main` : `158f27bc34f0a7fe85b0fe7500eb1be5ed7cf18b`, version 1.4.135.
3. Pour #210, vérifier PR #211 fusionnée au merge commit `c7721c743f8cd0a725974c3a2dac15d08d1388b0` puis la release `v1.4.123` ciblant ce commit avec APK et SHA-256.
4. Pour PR #209, comparer `main...fix/102-release-pr-policy-handoff` : branche divergée, **4 commits en avance / 55 en retard**, merge-base `f4611ace2d51ac0231ca1ad7c376f842908036b4`.
5. Vérifier sur `main` que `scripts/prepare-release-control.cjs` crée encore directement la PR GitHub sans sortie dédiée au refus de cette création ; le besoin porté par #209 n'est donc pas absorbé ailleurs.
6. Pour #42, vérifier PR #46 et release `v1.4.108` : mono-splash/status bar automatisés et APK publiée.
7. Pour #146, #206 et #229, vérifier leurs historiques : implémentation/CI/release terminées, dernière preuve terrain encore attendue.

## Points solides à préserver

- Le backlog PR est réduit : une seule PR était ouverte au début de l'audit.
- Les tickets `WAITING` distinguent déjà plusieurs validations terrain/métriques des chantiers techniques actifs.
- #102 joue correctement le rôle de ticket de contrôle durable des releases APK et ne doit pas être fermé comme une issue fonctionnelle ordinaire.
- Les releases récentes conservent une traçabilité merge → CI → APK → empreinte.

## Constats et actions

### F1 — P1 — #210 terminée mais restée ouverte

**Impact** : faux chantier P1 dans le backlog et perte de confiance dans l'état des tickets.

**Preuve** : PR #211 fusionnée ; `v1.4.123` publiée depuis le merge commit avec APK et SHA-256.

**Action appliquée** : checklist mise à jour puis issue #210 fermée `completed` le 10/09/2026.

**Critère de sortie** : satisfait.

### F2 — P1 — PR #209 réellement orpheline

**Impact** : unique PR ouverte, besoin release-control encore pertinent, mais branche ancienne susceptible de réintroduire des règles de gouvernance obsolètes.

**Preuve** : 4 commits en avance / 55 en retard sur `main` ; comportement cible toujours absent du script canonique.

**Action appliquée** : diagnostic ajouté à la PR #209 et à l'issue de contrôle #102.

**Critère de sortie** : rebaser ou réimplémenter minimalement le traitement du refus de création de PR sur le `main` courant, exécuter les TNR release-control + CI, puis fusionner ; sinon fermer explicitement comme obsolète avec justification.

### F3 — P2 — tickets livrés encore présentés comme travaux actifs

**Impact** : #146, #206 et #229 apparaissaient comme P1 actifs alors que seule une validation terrain demeurait.

**Action appliquée** : titres normalisés en `[WAITING][Terrain]` sans fermeture prématurée.

**Critère de sortie** : preuve terrain exigée par chaque ticket, puis clôture.

### F4 — P2 — #42 avait une checklist administrative obsolète

**Impact** : plusieurs cases faisaient croire que le mono-splash, les TNR, la SPEC et l'APK n'avaient pas été livrés.

**Preuve** : PR #46 fusionnée et release `v1.4.108` publiée ; le process actuel rend Android 36 bloquant et Android 12 optionnel.

**Action appliquée** : corps de #42 remis en cohérence avec les preuves livrées ; seules les trois validations visuelles terrain restent ouvertes.

**Critère de sortie** : valider sur appareil réel absence de branding natif, splash React unique et absence de flash parasite.

## Matrice exhaustive de la photographie initiale

| Élément | État après revue | Décision / issue de sortie |
|---|---|---|
| #14 | actif | conserver ; architecture à réaliser |
| #15 | actif | conserver ; qualité/E2E/performance à réaliser |
| #18 | actif | conserver ; durcissement TypeScript/lint/format à réaliser |
| #19 | actif | conserver ; sécurité PWA à réaliser |
| #23 | actif | conserver ; FinOps GCP à traiter |
| #26 | WAITING terrain | conserver jusqu'au full scan Plex réel sans faux vu |
| #30 | actif | conserver ; rotation des secrets à terminer |
| #42 | WAITING terrain | corps corrigé ; preuve visuelle réelle restante |
| #58 | WAITING terrain | conserver jusqu'aux tests Plex réels de dé-vu |
| #78 | actif/backlog produit | conserver ; fonctionnalité Reddit non livrée |
| #83 | actif | conserver ; gouvernance validation locale/CI à terminer |
| #84 | WAITING métriques | conserver jusqu'à la fenêtre de mesures exigée |
| #85 | actif | conserver ; optimisation double validation non terminée |
| #91 | actif, réouvert | conserver ; critères correctifs après régression cinéma non satisfaits |
| #95 | actif | conserver ; synchronisation favoris personnes non terminée |
| #96 | actif | conserver ; partages réouvrables non terminés |
| #102 | CONTROL | conserver comme contrôle durable de release APK |
| #106 | WAITING terrain | conserver jusqu'à validation notifications réelle |
| #111 | actif | conserver ; ouverture de la copie PMS exacte non terminée |
| #134 | WAITING terrain | conserver jusqu'à validation réassociation Plex PWA/APK |
| #146 | WAITING terrain | titre normalisé ; validation finale appareil réel |
| #164 | WAITING terrain | conserver jusqu'à validation update/installateur réelle |
| #167 | backlog accepté | conserver ; réduction Play Protect hors Store |
| #178 | actif | conserver ; navigation double appui/reset |
| #179 | actif | conserver ; swipe épisodes/précédent/suivant |
| #180 | actif | conserver ; harmonisation boutons/cartes |
| #181 | actif | conserver ; en-têtes/dialogues/focus |
| #206 | WAITING terrain | titre normalisé ; validation Plex réelle restante |
| #210 | oublié puis corrigé | checklist synchronisée et issue fermée `completed` |
| #229 | WAITING terrain | titre normalisé ; validation 120 Hz réelle restante |
| PR #209 | **à reprendre** | tracée dans #102 ; rebase/réimplémentation + CI ou fermeture explicite |

## Bilan

Après correction administrative, la photographie passe à **29 issues ouvertes** et **1 PR ouverte**. Aucun autre ticket n'est fermé par inférence : les éléments encore ouverts ont soit un travail explicite restant, soit une dépendance terrain/métrique, soit un rôle de contrôle/backlog assumé. La seule PR ouverte, #209, est désormais explicitement identifiée comme action de reprise dans #102.