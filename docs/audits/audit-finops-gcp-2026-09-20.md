# Audit FinOps GCP — objectif SeenIt à 0,00 €

- **Identifiant** : AUDIT-2026-09-20-GCP-FINOPS
- **Date** : 20 septembre 2026
- **Dernière vérification** : 20 septembre 2026
- **Statut** : ouvert — garde-fous déployés, Billing par SKU acquis ; preuves runtime Firestore/Cloud SQL et temporelles encore manquantes
- **Baseline** : `main` `92e2fc274832bd7109810d1c4021df1ff331b034`
- **Commit observé** : `92e2fc274832bd7109810d1c4021df1ff331b034`
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
la première ligne de coût visible du mois. Toutefois la région de Firestore `default` doit être prouvée
avant toute migration de Cloud Run afin d'éviter de remplacer un coût Internet par un coût inter-région.

## Attribution historique

| Ligne facturée historique | Ressource / origine prouvée | État au 20/09 |
| --- | --- | --- |
| Firestore Read Ops `named databases` — 333 370 lectures, 0,18 € | anciennes bases Firestore `ai-studio-*`; une base nommée n'a pas de quota gratuit | bases historiques supprimées ; code client/Admin toujours verrouillé sur `default` |
| Firestore Internet Data Transfer Out `named databases` — 0,17 Gio, 0,02 € | mêmes bases nommées historiques | cause applicative historique éliminée ; toute recréation infrastructure reste une dérive |
| Cloud Storage Standard US Regional — 11,01 Gio-mois, 0,11 € | bucket Firebase partagé avec ATHIA ; `exercise_images/` a été identifié puis supprimé après migration | bucket toujours configuré ; taille/région actuelles à relire côté GCP |
| Cloud Run Internet Data Transfer Out Intercontinental — 0,11 Gio, 0,01 € | runtime Cloud Run publié | **risque encore reproductible** : `seenit-app` reste en `us-west1` |
| Cloud SQL historique | ancien `tv-track-offline` utilisait un sidecar Cloud SQL Proxy | existence actuelle non prouvée ; inventaire GCP requis |

## État Firestore

Les garde-fous livrés par #21/#22 sont toujours présents : client `FIRESTORE_DATABASE_ID = 'default'`,
Firebase Admin `getFirestore('default')`, aucune métadonnée `firestoreDatabaseId` dans la configuration
canonique et Delete Protection de `default` comme invariant.

Firestore offre un quota gratuit à une seule base par projet ; les bases nommées n'y sont pas éligibles.
La localisation actuelle de `default` n'est pas prouvable depuis le dépôt et doit être capturée avant
toute décision de déplacement Cloud Run.

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

Le workflow canonique déploie `seenit-app` en `us-west1`. Le correctif #23 rend les bornes de coût non
héritables depuis une ancienne configuration :

- zéro instance minimale ;
- deux instances maximales ;
- CPU facturé sur le modèle lié aux requêtes ;
- retrait de tout VPC connector ou Direct VPC hérité ;
- TNR sur configuration déjà bornée et configuration historique non bornée.

Ces garde-fous traitent les dérives de compute/VPC. Le même chantier purge aussi, après smoke production, les images Artifact Registry `seenit-app` et les archives source Cloud Build, qui sont régénérables. Ils **ne traitent pas à eux seuls** le coût intercontinental ni les lectures Firestore.

## Cause racine réseau

Le coût historique intercontinental et la région `us-west1` forment une cause racine candidate forte
pour le centime récurrent. La documentation Cloud Run actuelle limite le quota gratuit de transfert
Internet à 1 Gio au sein de l'Amérique du Nord. Servir l'Europe depuis Oregon peut donc produire une
ligne facturable alors que CPU/RAM/requêtes restent gratuits.

Une migration de région n'est pas autorisée tant que la localisation de Firestore `default` n'est pas
confirmée. Si `default` est US, déplacer seulement Cloud Run en Europe peut introduire du trafic Firestore
inter-région ; si `default` est Europe, conserver Cloud Run en Oregon est au contraire une anomalie.

## Garde-fous durables

`SEENIT-COST-001` formalise Firestore sur `default`, Cloud Run `minScale=0`, `maxScale=2`, CPU request-based,
absence de VPC connector sans décision explicite, budget comme alerte et preuve de facturation réelle avant clôture.

## Limites / preuves encore nécessaires

1. localisation de Firestore `default` et liste actuelle des bases Firestore ;
2. liste des instances Cloud SQL ;
3. configuration budget/alertes ;
4. mesure post-correctifs permettant de distinguer les coûts historiques du mois des nouveaux coûts incrémentaux ;
5. preuve de 7 jours puis d'une période complète à 0,00 €.

## Matrice exhaustive

| Constat | Priorité | Statut | Sortie |
| --- | --- | --- | --- |
| coût courant non nul | P1 | confirmé | identifier le SKU courant puis supprimer sa cause |
| Cloud Run `us-west1` → Europe | P1 | cause candidate forte | confirmer région Firestore puis choisir l'architecture sans transfert facturable |
| Cloud Run non borné par contrat | P1 | corrigé dans le chantier #23 | CI + déploiement canonique verts |
| Artifact Registry / archives Cloud Build s'accumulent | P1 | corrigé et prouvé | purge post-smoke active ; inventaire après purge : aucun package `seenit-app`, source Cloud Build vide/absente |
| base Firestore nommée dans le code | P1 | protégée | maintenir `SEENIT-DATA-005` |
| Storage historique ATHIA | P1 | corrigé et prouvé | bucket canonique US-EAST1, taille actuelle 0 B ; surveiller l'absence de nouvelle croissance |
| Cloud SQL historique | P1 | non prouvé | inventorier et supprimer uniquement si orphelin |
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

La production et la validation du même SHA sont vertes. Les deux seules lectures d'infrastructure encore
bloquées par le compte WIF sont Firestore et Cloud SQL. La décision de région Cloud Run reste donc gelée
tant que la localisation de Firestore `default` n'est pas connue.

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
20/09. La prochaine lecture structurelle doit confirmer Firestore et Cloud SQL avec les permissions IAM
least-privilege ajoutées au compte WIF de déploiement.
