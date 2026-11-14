# Audit FinOps GCP — attribution de novembre 2026

- **Identifiant** : AUDIT-2026-11-14-GCP-FINOPS
- **Baseline** : `main` 1.4.309, commit `fc2b5bcd`, facturation consultée le 14/11/2026 dans Cloud Billing.
- **Périmètre** : compte de facturation Firebase partagé (projets SeenIt et ATHIA Prod), période 1–14 novembre 2026.
- **Issue** : [#23](https://github.com/julfou7/seenit-app/issues/23).

Aucun identifiant de compte de facturation, jeton ou secret n'est consigné ici.

## Preuves Cloud Billing (1–14 novembre 2026)

Total net du compte : **0,06 €** (coût brut 0,34 €, économies free tier −0,28 €), prévision 0,12 € pour
le mois. Projet ATHIA Prod : **0,00 €**. Tout le coût net provient du projet SeenIt.

| SKU | Service | Usage | Net | Ressource |
|---|---|---:|---:|---|
| Cloud Run Network Internet Data Transfer Out Intercontinental (Excl Oceania, Africa and China) | Cloud Run | 0,34 GiB | 0,04 € | `seenit-app` (us-west1) servant un utilisateur européen |
| Network Data Transfer GCP Multi-region within Northern America | Cloud Storage | 0,51 GiB | 0,01 € | lecture des archives source par Cloud Build us-west1 depuis `_cloudbuild` (multi-région US) |
| Network Data Transfer GCP Replication within Northern America | Cloud Storage | 0,50 GiB | 0,01 € | réplication des mêmes archives dans `_cloudbuild` |
| Standard Storage US / Europe / London, opérations A/B | Cloud Storage | < 0,1 GiB-mois | 0,00 € | buckets Firestore/AI Studio/ATHIA, sous quota |
| Cloud Firestore (stockage, transfert Europe → Europe) | Firestore | ~0 | 0,00 € | `default` eur3, free tier |

Le calcul Cloud Run (CPU, mémoire, requêtes) est entièrement couvert par le free tier.

## Décisions

1. **Cloud Storage → 0 €** : le déploiement stage désormais l'archive source dans
   `gs://gen-lang-client-0201895414_cloudbuild_us-west1/source` (même région que le build, quota gratuit,
   cycle de vie 1 jour, suppression réversible désactivée). La réplication multi-région et la lecture
   inter-région disparaissent. Repli explicite sur le bucket par défaut si le bucket régional est refusé.
2. **Cloud Run egress** : coût structurel tant que le runtime us-west1 sert l'Europe. Aucune migration de
   région sans preuve préalable (Firestore `default` est en eur3 : un runtime européen supprimerait aussi
   un aller-retour transatlantique, mais c'est une migration de runtime à valider explicitement).
3. **ATHIA** : hors périmètre SeenIt et à 0,00 €. Aucune suppression sans décision du propriétaire.

## Matrice exhaustive des constats

| Constat | Priorité | Suivi et critère de sortie |
|---|---|---|
| Archives source Cloud Build en multi-région US (≈ 0,02 €/quinzaine) | P2 | Corrigé par la PR de ce lot ; preuve : SKU Storage « Northern America » à 0 sur la période suivante. |
| Egress Cloud Run intercontinental (≈ 0,04 €/quinzaine) | P2 | [#23](https://github.com/julfou7/seenit-app/issues/23) : réduire les octets servis (agrégat par route) ou décider une région européenne. |
| Budget d'alerte bas absent | P3 | [#23](https://github.com/julfou7/seenit-app/issues/23) : création après validation du propriétaire (alerte seulement, pas un plafond). |

Limites : le rapport Billing agrège à l'échelle du SKU ; l'attribution Storage → archives Cloud Build
repose sur le seul bucket multi-région US du projet (`_cloudbuild`) et sur la cadence des déploiements.
