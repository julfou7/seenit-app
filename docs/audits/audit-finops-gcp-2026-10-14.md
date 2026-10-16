# Audit FinOps GCP — reprise après rétablissement GitHub

- **Date** : 14 octobre 2026
- **Suivi** : #23 et #506
- **Baseline GitHub** : `main` `7c6ba27cd27edaa6766ba36110ae3fe3933ef232`
- **Statut** : en validation — mesure Cloud Run fiabilisée, preuve réseau 0 € encore à obtenir

## Preuve Billing post-correctifs

La vue Cloud Billing d'octobre fournie par le propriétaire attribue le coût résiduel courant au SKU
**Cloud Run Network Internet Data Transfer Out Intercontinental (Excl Oceania, Africa and China)**
(`DBAA-7594-B9FA`) : **0,09 GiB / 0,01 €**. Sur la même fenêtre, la mémoire Cloud Run en
facturation liée aux requêtes est à 0,00 €, et Firestore / Storage sont à 0,00 €.

Le coût restant de #23 est donc un coût d'egress public Cloud Run, pas une dérive de compute, Firestore
ou Storage.

## Défaut de preuve route-par-route

Le dernier agrégat disponible avant cette reprise prétendait couvrir six heures mais contenait encore
les requêtes du 2 au 8 septembre et atteignait exactement 10 000 entrées. Il ne peut pas servir à
attribuer le coût d'octobre, notamment après le correctif gzip de `/api/plex/history`.

Le correctif #506 remplace cette preuve invalide par un contrat plus strict :

- bornes UTC début/fin injectées directement dans les filtres Cloud Logging ;
- ordre descendant conservé ;
- fenêtre demandée transmise au résumeur ;
- toute donnée hors fenêtre produit `quality.status=stale` et `quality.complete=false` ;
- une collecte atteignant 10 000 entrées produit `quality.status=saturated` et n'est jamais présentée
  comme complète ;
- une fenêtre récente vide reste une preuve valide (`empty`, complète) ;
- les états incomplets remontent jusqu'au watchdog tout en conservant l'artefact redigé.

## Reprise GitHub

Le propriétaire a confirmé le rétablissement des accès le 16 octobre. GitHub Actions déclenche de
nouveau et le workspace local est opérationnel. Le changement préparé est repris dans la PR
d'intégration des chantiers d'octobre, avec validation locale puis CI canonique du SHA livré.

## Prochaine preuve

Après merge, le workflow `Audit Structured SeenIt Logs` doit produire un agrégat récent et complet.
La répartition réelle des octets de cette fenêtre déterminera le correctif réseau de #23 : payload API
encore dominant, frontend statique servi par Cloud Run, ou autre route mesurée. Aucune migration de
région ne doit être décidée sur l'ancienne baseline de septembre.
