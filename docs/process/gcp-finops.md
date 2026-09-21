# Runbook FinOps GCP — objectif 0,00 €

## Contrat

SeenIt vise une dépense GCP récurrente de **0,00 €** sans changer l'identité Firebase, Firestore
`default`, l'APK ni les données utilisateur. Un budget GCP est uniquement un système d'alerte :
il ne constitue pas un plafond de dépense.

Le runtime canonique est `seenit-app`. Le déploiement GitHub force à chaque révision :

- `autoscaling.knative.dev/minScale = 0` ;
- `autoscaling.knative.dev/maxScale = 2` ;
- `run.googleapis.com/cpu-throttling = true` ;
- aucun `run.googleapis.com/vpc-access-connector`, `vpc-access-egress` ou `network-interfaces` hérité.

Ces bornes réduisent le risque de dérive de calcul mais ne rendent pas gratuit un trafic réseau facturable.

Après un déploiement confirmé en production, le workflow lance un **Cloud Build sans source** qui
supprime le package Artifact Registry `seenit-app` en une seule opération (toutes ses versions/tags) et les archives
`gs://gen-lang-client-0201895414_cloudbuild/source/**`. Ces objets sont régénérables : Cloud Run
importe l'image lors du déploiement et conserve sa propre copie pour les révisions déployées. Le build
de nettoyage utilise uniquement Cloud Logging afin de ne pas recréer un bucket de logs utilisateur.

## Cause réseau à traiter

Le runtime canonique est actuellement en `us-west1`. Le coût historique de #23 contient du
`Cloud Run Network Internet Data Transfer Out Intercontinental`. Tant que l'application sert un
utilisateur européen depuis Oregon, un coût réseau peut donc subsister même si CPU, mémoire et requêtes
restent sous les quotas gratuits.

**Ne jamais déplacer Cloud Run avant d'avoir confirmé la localisation de Firestore `default`.**
Un déplacement vers l'Europe avec une base Firestore aux États-Unis peut créer du trafic inter-région
et déplacer la facture au lieu de la supprimer.

## Inventaire GCP avant décision de région

Depuis une session `gcloud` autorisée sur `gen-lang-client-0201895414` :

```bash
gcloud firestore databases describe --project=gen-lang-client-0201895414 --database=default
gcloud firestore databases list --project=gen-lang-client-0201895414

gcloud storage buckets describe gs://gen-lang-client-0201895414.firebasestorage.app
gcloud storage du -s gs://gen-lang-client-0201895414.firebasestorage.app

gcloud sql instances list --project=gen-lang-client-0201895414

gcloud run services describe seenit-app --project=gen-lang-client-0201895414 --region=us-west1 --format=export
```

Le déploiement canonique exécute aussi `scripts/gcp-finops-inventory.sh` après le nettoyage. La sonde
est strictement en lecture seule et écrit les résultats accessibles dans les logs/summary GitHub Actions.
Une ligne `UNAVAILABLE (IAM/API)` signifie qu'une preuve console ou un rôle de lecture explicite reste
nécessaire ; elle n'autorise jamais à élargir silencieusement les droits du compte de déploiement.

État observé le 20/09/2026 sur le run #35529029612 :
- Storage : **US-EAST1**, **0 B** ;
- Artifact Registry : **0 package** après purge ;
- Cloud Run : **us-west1**, min 0 / max 2, CPU request-based, aucun VPC ;
- Cloud SQL : aucune instance ;
- Firestore `default` : **eur3**, Standard, `freeTier=false`, Delete Protection active, PITR désactivé ;
- Firestore `ai-studio-seenit-065aead8-cc5a-4b86-9f25-dd812194ffa4` : **us-west1**,
  Enterprise, `freeTier=true`, Delete Protection et PITR désactivés.

Ces lectures sont désormais accessibles au compte de déploiement via des permissions de métadonnées
bornées. Aucun rôle d'écriture ni lecture d'entités Firestore n'est nécessaire pour cet inventaire. Toute
évolution IAM reste une action d'infrastructure explicite ; le workflow ne tente jamais de s'auto-accorder
de permission.

Preuves attendues :

1. `default` est l'unique base Firestore utile à SeenIt et sa localisation est connue ;
2. aucune base `ai-studio-*` n'est active ; une base présente ne peut être supprimée qu'après preuve
   d'absence de données et de dépendances ;
3. le bucket utile est inventorié avec taille et emplacement ;
4. aucune instance Cloud SQL historique orpheline ne subsiste ;
5. Cloud Run porte bien les bornes `SEENIT-COST-001` et aucun VPC connector.

Le quota Firestore gratuit n'est pas transféré par simple suppression vers une base existante : la
[documentation Firestore](https://firebase.google.com/docs/firestore/pricing#free-quota-applies-only-to-one-database-per-project)
indique que la prochaine base créée devient éligible après suppression de la base free tier. Avec
`default` existante en `freeTier=false`, toute remédiation qui la recrée ou la remplace est une migration
de données et requiert une décision explicite ; elle ne fait pas partie d'un nettoyage sûr. Cette décision
a été donnée pour #23 le 21/09/2026. L’unique procédure autorisée est
[`firestore-default-free-tier-migration.md`](firestore-default-free-tier-migration.md) : elle fige les
écritures, exporte les deux bases, vérifie deux restaurations de répétition, recrée `default` avec Delete
Protection, exige `freeTier=true`, compare le digest final et conserve les exports privés 30 jours.

## Attribution du coût

Dans Cloud Billing, filtrer le projet SeenIt puis exporter le détail **par SKU** pour la période
courante. Conserver pour chaque ligne : service, SKU, coût brut, crédits, coût net, usage, unité et
période. Une capture montrant seulement le total prouve qu'il reste un coût, mais ne suffit pas à
attribuer le centime à une ressource précise.

L'audit FinOps dans `docs/audits/audit-finops-gcp-2026-09-20.md` est la preuve durable ; aucune
valeur de secret ni identifiant de facturation privé n'y est enregistrée.

## Kill switch sans suppression de données

Pour stopper immédiatement les requêtes publiques Cloud Run sans supprimer le service ni les données,
retirer temporairement l'invocation publique :

```bash
gcloud run services remove-iam-policy-binding seenit-app --project=gen-lang-client-0201895414 --region=us-west1 --member=allUsers --role=roles/run.invoker
```

Le rétablissement doit être une action opérateur explicite après diagnostic. Ce mécanisme est uniquement
un arrêt d'urgence.

## Clôture de #23

La clôture exige simultanément :

- coût net SeenIt à 0,00 € ;
- au moins 7 jours consécutifs d'usage réel sans nouvelle dépense ;
- une période de facturation complète à 0,00 € ;
- inventaire final Firestore / Storage / Cloud Run / Cloud SQL ;
- garde-fous de configuration toujours verts.

Tant que l'un de ces points manque, #23 reste ouverte ou en état d'attente mesurée.

## Mesure du trafic par endpoint

Le workflow `Audit Structured SeenIt Logs` lit toutes les six heures les request logs Cloud Run via le
compte séparé `seenit-log-auditor`. `scripts/summarize-cloud-run-traffic.cjs` regroupe les réponses par
famille de route, compte les requêtes et additionne les octets servis. L'artefact
`seenit-cloud-run-traffic-<run>` conserve uniquement cet agrégat pendant 40 jours : les URL complètes,
query strings, identifiants et logs sources sont supprimés dans le job et ne sont jamais archivés.

La somme de ces agrégats permet d'identifier les routes responsables du volume et de comparer sept jours
d'usage réel puis une période de facturation. Elle ne remplace pas le rapport Cloud Billing par SKU : les
octets Cloud Run observés expliquent le trafic, tandis que Billing reste la preuve du coût net.
