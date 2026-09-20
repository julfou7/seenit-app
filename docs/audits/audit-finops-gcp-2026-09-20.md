# Audit FinOps GCP — objectif SeenIt à 0,00 €

- **Identifiant** : AUDIT-2026-09-20-GCP-FINOPS
- **Date** : 20 septembre 2026
- **Dernière vérification** : 20 septembre 2026
- **Statut** : ouvert — garde-fous techniques en cours, coût courant encore non nul
- **Baseline** : SeenIt 1.4.174, `main` `6f33296d59bfde7ca8e6e8ef16f80d13bcfdac0d`
- **Commit observé** : `6f33296d59bfde7ca8e6e8ef16f80d13bcfdac0d`
- **Périmètre** : Firestore, Firebase Storage, Cloud Run, Cloud SQL historique, coûts réseau et garde-fous
- **Suivi** : issue #23

## Synthèse

La cible 0,00 € n'est pas atteinte. Une capture Cloud Billing fournie le 20/09/2026 montre encore un
coût total courant non nul de **0,96 €**. La vue est regroupée par produit et montre environ **0,41 € Cloud Run** après remises, **0,31 € Artifact Registry**, **0,13 € Cloud Storage** et **0,11 € Firestore**. Elle ne donne pas encore l'attribution par SKU nécessaire pour expliquer chaque ligne.

L'historique de #23 contient déjà une ligne `Cloud Run Network Internet Data Transfer Out Intercontinental` : 0,11 Gio pour 0,01 €. Le runtime canonique GitHub est déployé en `us-west1`, ce qui maintient ce mécanisme possible pour un utilisateur européen. Cependant la capture actuelle prouve désormais que le coût actif est plus large : Artifact Registry, Cloud Storage et Firestore contribuent aussi au total.

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

Il reste à prouver côté GCP : emplacement, taille actuelle, inventaire des objets utiles et absence de
croissance résiduelle. Aucune suppression de données ne doit être faite depuis cette seule preuve de code.

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

1. export Cloud Billing courant par SKU pour attribuer précisément les **0,96 €** ;
2. localisation de Firestore `default` ;
3. liste actuelle des bases Firestore ;
4. taille/région du bucket Firebase ;
5. liste des instances Cloud SQL ;
6. configuration budget/alertes ;
7. preuve de 7 jours puis d'une période complète à 0,00 €.

## Matrice exhaustive

| Constat | Priorité | Statut | Sortie |
| --- | --- | --- | --- |
| coût courant non nul | P1 | confirmé | identifier le SKU courant puis supprimer sa cause |
| Cloud Run `us-west1` → Europe | P1 | cause candidate forte | confirmer région Firestore puis choisir l'architecture sans transfert facturable |
| Cloud Run non borné par contrat | P1 | corrigé dans le chantier #23 | CI + déploiement canonique verts |
| Artifact Registry / archives Cloud Build s'accumulent | P1 | correctif préparé | purge post-smoke des images `seenit-app` et sources Cloud Build, puis vérifier la facture |
| base Firestore nommée dans le code | P1 | protégée | maintenir `SEENIT-DATA-005` |
| Storage historique ATHIA | P1 | données historiques supprimées | inventorier le bucket actuel |
| Cloud SQL historique | P1 | non prouvé | inventorier et supprimer uniquement si orphelin |
| budget seul comme hard cap | P1 | explicitement interdit | budget + garde-fous + kill switch |
| preuve 0 € dans le temps | P1 | non acquise | 7 jours + période complète à 0,00 € |
