# Migration Firestore `default` vers le quota gratuit

Ce runbook exécute la décision explicite de l’issue #23 sans changer l’identité applicative :
`default` reste la base canonique, en édition Standard et dans la multi-région `eur3`.

## Baseline vérifiée le 21 septembre 2026

- `default` : Standard, `eur3`, `freeTier=false`, Delete Protection activée, PITR désactivé ;
- `ai-studio-seenit-065aead8-cc5a-4b86-9f25-dd812194ffa4` : Enterprise, `us-west1`,
  `freeTier=true`, Delete Protection/PITR désactivés ;
- la base AI Studio n’a produit aucune série temporelle de lecture, mise à jour temps réel, écriture ou
  suppression gérée pendant les sept derniers jours, mais occupe entre **21,671 MiB et 26,116 MiB** ;
- `default` ne possède aucun index composite manuel dans la console ; toute exception d’index/TTL ou tout
  trigger Firestore découvert par le préflight bloque la bascule ;
- le code PWA/APK et Firebase Admin ciblent uniquement `default`.

La base AI Studio est donc inactive, mais pas vide. Elle est exportée et restaurée dans une base de
répétition Enterprise avant toute suppression. Son contenu n’est jamais journalisé : seuls le nombre de
documents, les noms de groupes de collections et un SHA-256 déterministe sont exposés. Le parcours du
digest utilise `showMissing=true` et suit récursivement les parents inexistants afin d’inclure aussi les
documents de sous-collections « orphelines » invisibles à une requête SDK ordinaire.

## Autorité et rôles temporaires

Le workflow utilise l’identité WIF sans clé
`seenit-github-deployer@gen-lang-client-0201895414.iam.gserviceaccount.com`. Pour la fenêtre de migration,
le propriétaire lui ajoute puis retire immédiatement après succès :

- `roles/datastore.owner` ;
- `roles/storage.admin` ;
- `roles/firebaserules.admin` ;
- `roles/run.admin` ;
- `roles/eventarc.viewer` ;
- `roles/cloudfunctions.viewer`.

Le rôle existant `SeenIt FinOps Inventory Viewer` reste inchangé. Aucune clé JSON n’est créée.

## Déclenchement borné

Le contrôleur n’accepte qu’un commentaire du propriétaire sur #23, avec le projet et le SHA `main` exacts :

```text
/migrate-firestore-default project=gen-lang-client-0201895414 sha=<SHA_MAIN>
```

La commande est idempotente côté orchestration : elle refuse une topologie déjà migrée, un SHA différent,
une base inattendue, un trigger Firestore, un index/TTL non capturé ou un export existant incohérent.

## Séquence de bascule

1. Inventorier les bases actives, les triggers Eventarc/Cloud Functions, les index, les TTL et la liaison
   publique Cloud Run. `gcloud firestore databases list` expose l’identifiant API `default` (sans
   parenthèses) et uniquement les bases actives ; toute entrée éventuellement marquée par `deleteTime` est
   aussi exclue par sécurité. Refuser toute autre divergence de la baseline.
2. Créer deux buckets privés dédiés : `EU` pour `default`, `us-west1` pour la base AI Studio. Ils restent en
   Standard, sans versioning, avec prévention d’accès public et suppression automatique après 30 jours.
3. Retirer temporairement `allUsers/roles/run.invoker` de `seenit-app`, puis déployer les règles
   `firestore.migration-lockdown.rules`. Les SDK serveur contournant les règles, les deux barrières sont
   nécessaires. Le service ne revient jamais en ligne avant preuve d’intégrité.
4. Attendre les requêtes en vol, calculer les digests sources, puis exporter intégralement les deux bases.
5. Créer deux bases de répétition à identifiant unique, réimporter chaque export et exiger l’égalité exacte
   des nombres de documents, groupes de collections et SHA-256. Supprimer uniquement ces bases temporaires.
6. Supprimer d’abord la base AI Studio qui porte le quota gratuit. Désactiver ensuite Delete Protection sur
   `default`, supprimer `default`, attendre que son identifiant soit réutilisable, puis la recréer en Standard
   `eur3` avec Delete Protection activée.
7. Refuser de poursuivre si la nouvelle `default` n’expose pas `freeTier=true`. Réimporter l’export, comparer
   le digest final à la source et vérifier à nouveau édition, région, quota, PITR et Delete Protection.
8. Redéployer les règles canoniques `firestore.rules`, rétablir l’accès public Cloud Run, puis vérifier
   `/api/health` et l’inventaire final.

## Rollback et état d’échec

Avant la première suppression, tout échec restaure automatiquement les règles et l’accès Cloud Run ; les
bases sources sont intactes. Après la première suppression, le gestionnaire d’erreur tente de recréer
`default`, réimporte son export et compare le digest. Il ne rouvre le trafic que si cette preuve est verte.
Sinon, Cloud Run et les règles restent verrouillés, les exports demeurent disponibles 30 jours et le run
publie l’opération exacte à reprendre. La base AI Studio supprimée reste récupérable depuis son export dédié.

## Coût et fin du chantier

Les exports facturent une lecture par document et les répétitions une écriture par document. Ce coût unique
et borné est accepté pour éliminer le coût récurrent ; les buckets expirent automatiquement. #23 reste
ouverte après la migration jusqu’aux preuves exigées de sept jours consécutifs puis d’une période de
facturation complète à 0,00 €.
