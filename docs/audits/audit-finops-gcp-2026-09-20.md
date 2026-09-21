# Audit FinOps GCP — objectif SeenIt à 0,00 €

- **Identifiant** : AUDIT-2026-09-20-GCP-FINOPS
- **Date** : 20 septembre 2026
- **Dernière vérification** : 21 septembre 2026
- **Statut** : ouvert — migration Firestore option 1 autorisée et contrôleur de bascule sécurisé préparé ; preuve temporelle 0 € encore requise
- **Baseline** : `main` `5a68cd2ddec7fa9176ad15e50fa4a0ccae5bdfb9`
- **Commit observé** : `5a68cd2ddec7fa9176ad15e50fa4a0ccae5bdfb9`
- **Périmètre** : Firestore, Firebase Storage, Cloud Run, Cloud SQL historique, coûts réseau et garde-fous
- **Suivi** : issue #23

## Synthèse

La cible 0,00 € n'est pas atteinte. Une nouvelle capture Cloud Billing fournie le 20/09/2026,
sur la période **Mois en cours** et regroupée par **SKU**, affiche un total courant de **0,99 €**. Cette
vue permet désormais d'attribuer précisément les lignes visibles du mois ; elle reste cumulative et ne
permet donc pas, à elle seule, de distinguer un coût historique déjà corrigé d'un coût encore reproductible
après les purges et correctifs du 20/09.

Les principaux SKU visibles sont : **0,34 €** de transfert Cloud Run intercontinental (3,27 GiB),
**0,33 €** d'Artifact Registry Storage (4,29 GiB-month), **0,11 €** de Standard Storage US Regional
(11,42 GiB-month), **0,08 €** de transfert Cloud Run North America → North America (1,84 GiB),
**0,07 €** de Firestore Read Ops sur bases nommées (133 979 lectures), **0,02 €** de Cloud Firestore
Enterprise Write Units London (97 716 unités), **0,01 €** de transfert Firestore Europe → Europe sur
bases nommées (0,08 GiB), ainsi que deux lignes Cloud Storage réseau à **0,01 €** chacune.

La cause réseau Cloud Run n'est donc plus un simple centime historique : le transfert intercontinental est
la première ligne de coût visible du mois. Le run #35529029612 prouve désormais que Firestore `default`
est en `eur3`, alors que Cloud Run et la base AI Studio sont en `us-west1`.

## Attribution historique

| Ligne facturée historique | Ressource / origine prouvée | État au 20/09 |
| --- | --- | --- |
| Firestore Read Ops `named databases` — 333 370 lectures, 0,18 € | anciennes bases Firestore `ai-studio-*`; une seule base par projet reçoit le quota gratuit, indépendamment de son ID | une base AI Studio est à nouveau présente ; code client/Admin toujours verrouillé sur `default` |
| Firestore Internet Data Transfer Out `named databases` — 0,17 Gio, 0,02 € | mêmes bases nommées historiques | cause applicative historique éliminée ; toute recréation infrastructure reste une dérive |
| Cloud Storage Standard US Regional — 11,01 Gio-mois, 0,11 € | bucket Firebase partagé avec ATHIA ; `exercise_images/` a été identifié puis supprimé après migration | bucket toujours configuré ; taille/région actuelles à relire côté GCP |
| Cloud Run Internet Data Transfer Out Intercontinental — 0,11 Gio, 0,01 € | runtime Cloud Run publié | **risque encore reproductible** : `seenit-app` reste en `us-west1` |
| Cloud SQL historique | ancien `tv-track-offline` utilisait un sidecar Cloud SQL Proxy | existence actuelle non prouvée ; inventaire GCP requis |

## État Firestore

Les garde-fous livrés par #21/#22 sont toujours présents : client `FIRESTORE_DATABASE_ID = 'default'`,
Firebase Admin `getFirestore('default')`, aucune métadonnée `firestoreDatabaseId` dans la configuration
canonique et Delete Protection de `default` comme invariant.

Firestore offre un quota gratuit à une seule base par projet. Le run #35529029612 prouve la topologie :

- `default` : `eur3`, édition `STANDARD`, `freeTier=false`, Delete Protection active, PITR désactivé ;
- `ai-studio-seenit-065aead8-cc5a-4b86-9f25-dd812194ffa4` : `us-west1`, édition `ENTERPRISE`,
  `freeTier=true`, Delete Protection désactivée, PITR désactivé.

Cette preuve invalide l'hypothèse selon laquelle `default` bénéficierait déjà du quota gratuit. Le champ
`freeTier` est une métadonnée de sortie : supprimer la base AI Studio sans plan de migration ne promeut
pas de façon démontrée une base existante. La
[documentation Firestore](https://firebase.google.com/docs/firestore/pricing#free-quota-applies-only-to-one-database-per-project)
indique que, si la base éligible est supprimée, c'est la **prochaine base créée** qui reçoit le quota
gratuit. Toute solution exigeant de recréer ou remplacer `default` est donc une migration de données
explicite, et non un nettoyage automatique. L’utilisateur a retenu l’option 1 le 21/09/2026 : conserver
l’identité `default`, la recréer en `eur3` Standard après export/restauration de répétition et lui
transférer ainsi le quota gratuit.

La console Usage apporte une seconde preuve importante sur la base AI Studio : aucune série temporelle de
lecture, mise à jour temps réel, écriture ou suppression gérée sur les sept derniers jours, mais un stockage
compris entre **21,671 MiB et 26,116 MiB**. Elle est donc inactive mais non vide. Le runbook
`docs/process/firestore-default-free-tier-migration.md` exige en conséquence son propre export, une
restauration de répétition Enterprise et un digest documentaire identique avant suppression. Les deux
exports restent privés et expirent automatiquement après 30 jours.

## État Storage

Le dépôt déclare toujours le bucket Firebase `gen-lang-client-0201895414.firebasestorage.app`, mais
aucun import `firebase/storage`, client `getStorage` ou code d'upload n'est présent dans la source
canonique auditée. Le coût historique 11,01 Gio-mois est cohérent avec les données ATHIA qui partageaient
auparavant ce bucket.

Le déploiement #35522214354 a désormais prouvé côté GCP que le bucket canonique
`gen-lang-client-0201895414.firebasestorage.app` est en **US-EAST1** et contient **0 B**.
Le coût Storage visible sur le mois courant est donc historique sur la période déjà consommée ; il ne
correspond plus à un volume utile présent dans ce bucket. La preuve temporelle doit confirmer l'absence
de nouvelle croissance.

## État Cloud Run

Le premier agrégat automatisé après la PR #472 (run #35530238313, fenêtre bornée aux 10 000
requêtes disponibles du 1er au 8 septembre) mesure **167 665 682 octets**. La route
`/api/plex/history` concentre **126 978 937 octets sur 249 requêtes**, soit **75,7 %** du volume,
devant `/api/media/tmdb/*` (26 658 181 octets) et les assets (6 818 944 octets). Les réponses Plex
atteignent 5 809 285 octets : elles sont désormais compressées en `gzip` lorsque le client l'annonce,
sans modifier le JSON fonctionnel ni retirer le chemin `identity`. Le suivi toutes les six heures doit
confirmer le gain sur les nouvelles révisions ; l'agrégat historique reste antérieur au correctif.

Le workflow canonique déploie `seenit-app` en `us-west1`. Le correctif #23 rend les bornes de coût non
héritables depuis une ancienne configuration :

- zéro instance minimale ;
- deux instances maximales ;
- CPU facturé sur le modèle lié aux requêtes ;
- retrait de tout VPC connector ou Direct VPC hérité ;
- TNR sur configuration déjà bornée et configuration historique non bornée.

Ces garde-fous traitent les dérives de compute/VPC. Le même chantier purge aussi, après smoke production, les images Artifact Registry `seenit-app` et les archives source Cloud Build, qui sont régénérables. Ils **ne traitent pas à eux seuls** le coût intercontinental ni les lectures Firestore.

## Cause racine réseau

Le coût historique intercontinental et la région `us-west1` forment une cause racine confirmée du trafic
facturable. La [documentation Cloud Run](https://cloud.google.com/run/pricing#internet-data-transfer)
limite le quota gratuit de transfert Internet à 1 Gio au sein de l'Amérique du Nord. Servir la PWA et ses
API à l'Europe depuis Oregon produit donc une ligne facturable alors que CPU/RAM/requêtes restent gratuits.

Déplacer Cloud Run vers l'Europe rapprocherait le backend de `default`, mais ne garantit pas 0 € : la
gratuité Cloud Run documentée pour le transfert Internet ne couvre que 1 Gio depuis l'Amérique du Nord.
Comme le même service sert aujourd'hui le shell PWA et les API, une migration de région isolée déplacerait
la catégorie de coût sans supprimer nécessairement l'egress public. La cible à évaluer est donc un frontal
statique sous quota gratuit qui relaie les API vers un Cloud Run colocalisé avec Firestore, pas un simple
changement de constante `GCP_REGION`.

## Garde-fous durables

`SEENIT-COST-001` formalise Firestore sur `default`, Cloud Run `minScale=0`, `maxScale=2`, CPU request-based,
absence de VPC connector sans décision explicite, budget comme alerte et preuve de facturation réelle avant clôture.

## Limites / preuves encore nécessaires

1. exécution verte de la migration autorisée, avec deux répétitions et digest final identique ;
2. configuration budget/alertes ;
3. mesure post-correctifs permettant de distinguer les coûts historiques du mois des nouveaux coûts incrémentaux ;
4. preuve de 7 jours puis d'une période complète à 0,00 €.

La mesure par endpoint est désormais automatisée par l'auditeur lecture seule : toutes les six heures,
il transforme les request logs Cloud Run en un agrégat borné (famille de route, requêtes, octets servis,
classes HTTP) conservé 40 jours. Aucun log brut, URL, paramètre ou identifiant n'est archivé. Cette série
permettra de distinguer le poids du shell PWA de celui des API et de vérifier l'effet d'une optimisation
sans élargir les droits du compte de déploiement.

## Matrice exhaustive

| Constat | Priorité | Statut | Sortie |
| --- | --- | --- | --- |
| coût courant non nul | P1 | confirmé | identifier le SKU courant puis supprimer sa cause |
| Cloud Run `us-west1` → Europe | P1 | topologie confirmée, migration simple insuffisante | séparer le frontal statique de l'API et colocaliser l'API avec `default` après validation d'architecture |
| Cloud Run non borné par contrat | P1 | corrigé dans le chantier #23 | CI + déploiement canonique verts |
| Artifact Registry / archives Cloud Build s'accumulent | P1 | corrigé et prouvé | purge post-smoke active ; inventaire après purge : aucun package `seenit-app`, source Cloud Build vide/absente |
| base Firestore nommée dans le code | P1 | protégée | maintenir `SEENIT-DATA-005` |
| Storage historique ATHIA | P1 | corrigé et prouvé | bucket canonique US-EAST1, taille actuelle 0 B ; surveiller l'absence de nouvelle croissance |
| Cloud SQL historique | P1 | corrigé et prouvé | inventaire runtime vide |
| budget seul comme hard cap | P1 | explicitement interdit | budget + garde-fous + kill switch |
| preuve 0 € dans le temps | P1 | non acquise | 7 jours + période complète à 0,00 € |

## Validation runtime du 20/09/2026

La première exécution du nettoyage post-déploiement a laissé le Cloud Build en état `WORKING` au-delà de 5 minutes, car les versions Docker étaient supprimées une par une. La production avait déjà été promue et validée ; seul le nettoyage a rendu le workflow rouge. Le correctif remplace cette boucle par la suppression native du package Artifact Registry `seenit-app`, qui supprime toutes ses versions et tags en une opération, et porte la fenêtre de suivi à 15 minutes.

## Inventaire automatisé GCP

Le workflow canonique capture désormais, après promotion et purge, un inventaire **lecture seule** :
bases Firestore et localisation, métadonnées/taille du bucket Firebase, instances Cloud SQL, packages
Artifact Registry restants et bornes réseau/compute Cloud Run. Une lecture refusée par IAM/API est
journalisée `UNAVAILABLE` sans modifier la ressource ni casser la production. Cette sonde permet
d'épuiser le canal GitHub→GCP avant de demander une preuve manuelle dans la console.

## Résultat de l'inventaire runtime — déploiement #35522214354

Le premier inventaire exécuté depuis GitHub Actions après la purge a produit les preuves suivantes :

- Firestore databases : **UNAVAILABLE (IAM/API)** ;
- Firebase Storage : bucket `gen-lang-client-0201895414.firebasestorage.app`, région **US-EAST1**, taille **0 B** ;
- Cloud SQL instances : **UNAVAILABLE (IAM/API)** ;
- Artifact Registry `cloud-run-source-deploy` : **aucun package restant** après purge ;
- Cloud Run `seenit-app` : région **us-west1**, `minScale=0`, `maxScale=2`,
  CPU request-based, aucun VPC connector et aucun Direct VPC ;
- archives source Cloud Build : absentes/vides après purge.

La production et la validation du même SHA sont vertes. Une exécution ultérieure, #35529029612, a levé
les deux limites de lecture : Cloud SQL est vide et les deux bases Firestore sont inventoriées avec leur
région, édition et éligibilité au quota gratuit. Elle révèle en contrepartie que `default` n'est pas la
base éligible au free tier.

Les coûts Artifact Registry et Storage déjà affichés dans le mois courant ne peuvent pas être annulés
rétroactivement. La preuve pertinente est maintenant l'absence de **nouveau coût incrémental** après cette
purge, puis la période complète exigée par #23.


## Preuve Cloud Billing par SKU — 20/09/2026

La capture utilisateur de **Facturation > Rapports**, période **Mois en cours**, groupée par **SKU**,
affiche les lignes visibles suivantes :

| SKU | Usage visible | Coût visible |
| --- | ---: | ---: |
| Cloud Run Network Internet Data Transfer Out Intercontinental (Excl Oceania, Africa and China) | 3,27 GiB | 0,34 € |
| Artifact Registry Storage | 4,29 GiB-month | 0,33 € |
| Standard Storage US Regional | 11,42 GiB-month | 0,11 € |
| Cloud Run Network Internet Data Transfer Out North America to North America | 1,84 GiB | 0,08 € |
| Cloud Firestore Read Ops (named databases) | 133 979 | 0,07 € |
| Cloud Firestore Enterprise Write Units London | 97 716 | 0,02 € |
| Cloud Firestore Internet Data Transfer Out from Europe to Europe (named databases) | 0,08 GiB | 0,01 € |
| Network Data Transfer GCP Multi-region within Northern America | 0,47 GiB | 0,01 € |
| Network Data Transfer GCP Replication within Northern America | 0,47 GiB | 0,01 € |

Cette preuve ferme le manque « attribution par SKU ». Elle ne ferme pas encore la cause racine :
les coûts du mois sont cumulatifs, alors que Storage et Artifact Registry ont été purgés seulement le
20/09. L'inventaire #35529029612 confirme désormais Firestore et Cloud SQL ; la preuve restante porte sur
les données/dépendances de la base AI Studio, la décision de migration et l'évolution incrémentale du coût.
