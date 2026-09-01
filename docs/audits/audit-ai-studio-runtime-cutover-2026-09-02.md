# Audit incident — bascule AI Studio / Cloud Run / Firebase

- **Identifiant** : AUDIT-2026-09-02-AISTUDIO-RUNTIME-CUTOVER
- **Date** : 2 septembre 2026
- **Dernière vérification** : 2 septembre 2026
- **Statut** : ouvert — diagnostic consolidé, corrections volontairement différées
- **Baseline dépôt** : SeenIt 1.4.99
- **Commit observé** : `150b3a994a166bb0e72160b0597505aca05117ab`
- **Périmètre** : nouvel applet AI Studio, Cloud Run publié, mapping `seenit.ai.studio`, Firebase/Firestore, IAM runtime, coûts résiduels et sécurité des exports de journaux.
- **Preuves** : export Cloud Logging daté du 02/09/2026 fourni hors dépôt, état du dépôt `main`, `server.ts`, `package.json`, SPEC et issues #22/#23/#28.

> Le fichier brut Cloud Logging n'est pas committé : il contient des valeurs de configuration runtime sensibles. Les constats ci-dessous ne reproduisent aucune valeur de secret.

## Synthèse exécutive

L'incident contient **deux phénomènes distincts** qui avaient été mélangés pendant l'investigation initiale.

1. **Bascule publiée `seenit.ai.studio` — cause confirmée du OK → KO → OK.** L'ancien service Cloud Run `tv-track-offline` et son DomainMapping ont été supprimés avant que le nouveau service `seenit-app` et son nouveau mapping soient prêts. L'export prouve une fenêtre de coupure d'environ **3 min 52 s** entre la suppression de l'ancien service et le retour de l'état `DomainRoutable` du domaine. Cela explique directement les tests Sonarr/Plex intermittents observés au même moment.
2. **Preview AI Studio — défaut Firestore/IAM encore non résolu.** Le preview de développement produit séparément `7 PERMISSION_DENIED: Missing or insufficient permissions` dans `@google-cloud/firestore`, jusqu'à remonter en rejet non géré Node. Le principal IAM et l'opération Firestore exacts refusés ne sont pas présents dans l'export exploitable actuel. Ce problème ne doit pas être attribué à la bascule de domaine sans preuve supplémentaire.

L'audit invalide aussi l'ancienne hypothèse selon laquelle le runtime publié serait frontend-only : le nouveau Cloud Run `seenit-app` lance bien `node dist/server.cjs` et devient `RoutesReady`.

## Chronologie prouvée de la bascule publiée

Horodatages Cloud Logging en UTC ; heure de Paris = UTC+2 au moment de l'incident.

| UTC | Paris | Événement | Conclusion |
| --- | --- | --- | --- |
| ~21:31:49 | ~23:31:49 | `seenit.ai.studio/api/plex/history` est encore servi en HTTP 200 par `tv-track-offline` | l'ancien backend est opérationnel avant suppression |
| 21:49:01.086 | 23:49:01.086 | `Services.DeleteService` sur `tv-track-offline` | début de la coupure provoquée par la suppression |
| ~21:49:01 | ~23:49:01 | suppression réussie du DomainMapping `seenit.ai.studio` qui pointait vers `tv-track-offline` | le domaine perd sa cible publiée |
| 21:49:02.329 | 23:49:02.329 | SIGTERM du sidecar Cloud SQL de l'ancien service | extinction effective de l'ancien runtime |
| 21:49:18.336 | 23:49:18.336 | tentative de création du mapping `seenit.ai.studio` en échec : route Cloud Run inexistante | le remplacement n'était pas encore prêt |
| 21:50:31+ | 23:50:31+ | création du nouveau service/mapping `seenit-app` | reconstruction de la publication |
| 21:51:04+ | 23:51:04+ | `seenit-app@1.4.95 start`, puis `node dist/server.cjs` | le backend Node canonique est réellement lancé |
| ~21:51:08 | ~23:51:08 | `seenit-app` passe `RoutesReady` | service Cloud Run disponible |
| 21:52:52.704 | 23:52:52.704 | DomainMapping `seenit.ai.studio` passe `Ready` / `DomainRoutable` vers `seenit-app` | fin de la coupure publiée |

**Durée de coupure de domaine estimée : ~3 min 52 s.**

## Constat 1 — suppression destructive avant remplacement prêt

- **Priorité : P1**
- **Statut : confirmé**
- **Suivi : #28**

La séquence de déploiement a supprimé le service et le mapping actifs avant la disponibilité du remplaçant. Le comportement OK → KO → OK est donc attendu pendant cette fenêtre et ne constitue pas une preuve d'instabilité Sonarr.

### Critère de sortie

La prochaine bascule doit suivre un ordre non destructif : créer/déployer le nouveau service, valider un smoke backend, rendre la nouvelle route disponible, basculer le domaine, valider les parcours, puis seulement supprimer l'ancien service si aucune dépendance ne subsiste.

## Constat 2 — le nouveau Cloud Run publié exécute bien le backend SeenIt

- **Priorité : information corrective**
- **Statut : confirmé**
- **Suivi : #28**

Les logs du nouveau service prouvent l'exécution de `node dist/server.cjs`, puis le passage `RoutesReady`. L'hypothèse précédente « AI Studio publie seulement Vite / le frontend » est donc fausse pour la surface **publiée Cloud Run**.

Le preview AI Studio reste une surface distincte et ne doit pas être confondu avec `seenit.ai.studio` publié.

## Constat 3 — crash Firestore/IAM du preview toujours ouvert

- **Priorité : P1**
- **Statut : non résolu**
- **Suivi : #28**

Le preview a produit :

```text
Error: 7 PERMISSION_DENIED: Missing or insufficient permissions.
... @google-cloud/firestore ...
node:internal/process/promises ... triggerUncaughtException
```

Le dépôt initialise Firebase Admin sur le projet SeenIt canonique et sélectionne explicitement `default`. Le runtime publié Cloud Run utilise un compte de service Compute explicite ; les rôles ajoutés au principal `ais-sandbox` ne prouvent donc rien pour cette surface publiée. Le principal réellement utilisé par le **preview** lors du refus n'est pas encore identifié.

Le backend utilise Express 4.21.2. Plusieurs handlers `async` effectuent des opérations Firebase Admin sans enveloppe d'erreur globale ; avec Express 4, un rejet de Promise non capturé peut remonter jusqu'au process Node. C'est un **facteur aggravant plausible** du `triggerUncaughtException`, mais l'opération précise qui déclenche le refus n'est pas encore prouvée.

### Critère de sortie

Capturer le principal IAM, la permission refusée et la ressource Firestore de l'appel fautif ; corriger uniquement le droit ou l'identité nécessaire ; ajouter ensuite une protection contre les rejets async non gérés et un smoke de démarrage/API.

## Constat 4 — AI Studio a recréé une base Firestore nommée

- **Priorité : P1**
- **Statut : confirmé**
- **Suivi : #22 et #23**

À 21:50:37 UTC, pendant le provisioning du nouvel applet, le service Firebase a créé :

`ai-studio-seenitapp-065aead8-cc5a-4b86-9f25-dd812194ffa4`

avec un ruleset et une release dédiés, en `us-west1`.

Cela invalide le dernier critère terrain de #22 : « aucune base `ai-studio-*` recréée ». Le dépôt SeenIt continue cependant à sélectionner explicitement `default`; aucune preuve de l'export actuel ne montre que la nouvelle base nommée contient ou sert les données applicatives SeenIt.

### Critère de sortie

Prouver que la base nommée n'est utilisée par aucun runtime/client avant toute suppression, puis empêcher ou détecter durablement sa recréation par un provisioning AI Studio.

## Constat 5 — risque FinOps Cloud SQL historique

- **Priorité : P1**
- **Statut : à vérifier**
- **Suivi : #23**

L'ancien `tv-track-offline` utilisait un sidecar Cloud SQL Proxy relié à une instance AI Studio historique. La suppression du service arrête le proxy, mais l'export ne prouve pas la suppression de l'instance Cloud SQL elle-même.

### Critère de sortie

Inventorier l'instance Cloud SQL et ses dépendances. Si elle est orpheline, la supprimer seulement après preuve de non-utilisation et sauvegarde si nécessaire. Si elle reste nécessaire, documenter son coût et son rôle, ce qui doit être concilié avec l'objectif 0 € de #23.

## Constat 6 — secrets visibles dans les exports de configuration Cloud Run

- **Priorité : P1**
- **Statut : confirmé**
- **Suivi : #30**

Des événements d'audit de révisions Cloud Run présents dans l'export contiennent des valeurs de variables d'environnement sensibles en clair. Aucune valeur n'est reproduite dans ce rapport et aucune preuve d'utilisation malveillante n'a été observée.

### Critère de sortie

Inventorier les identifiants concernés par nom/type, renouveler les secrets sensibles encore actifs, vérifier les usages anormaux et rendre la procédure d'export/redaction sûre par défaut.

## Points solides à préserver

- GitHub `main` reste la source canonique ; l'état AI Studio ne doit jamais remplacer silencieusement les invariants du dépôt.
- Le projet Firebase SeenIt reste `gen-lang-client-0201895414`.
- La base applicative canonique reste `default`, explicitement sélectionnée côté client et Firebase Admin.
- Delete Protection de `default` reste activée.
- L'identité Android canonique et `android/app/google-services.json` ne doivent pas être modifiés par ce chantier.
- Le proxy `/api/service-proxy` conserve authentification, rate limit, validation SSRF et allowlist.
- Ne jamais accepter une page HTML 200 comme réponse API valide.
- Aucun secret brut ne doit être ajouté aux issues, audits ou commits.

## Matrice exhaustive des constats

| Constat | Priorité | État | Suivi |
| --- | --- | --- | --- |
| Coupure `seenit.ai.studio` pendant suppression/recréation | P1 | confirmé | #28 |
| Hypothèse « Cloud Run publié frontend-only » | — | invalidée | #28 à mettre à jour |
| Preview Firestore `PERMISSION_DENIED` / crash Node | P1 | ouvert | #28 |
| Nouvelle base Firestore `ai-studio-seenitapp-*` | P1 | confirmé | #22, #23 |
| Instance Cloud SQL historique potentiellement orpheline | P1 | à vérifier | #23 |
| Secrets runtime présents dans export Cloud Run | P1 | confirmé | #30 |
| Absence de procédure de cutover non destructif / health gate | P1 | confirmé | #28 |

## Plan de correction pour la prochaine session

1. **Geler les suppressions manuelles** et capturer l'inventaire actuel : Cloud Run, DomainMappings, Firestore, Cloud SQL, IAM, secrets/runtime.
2. **Isoler les deux surfaces** : preview AI Studio d'un côté, `seenit.ai.studio` publié de l'autre.
3. Sur le preview, reproduire une seule fois le `PERMISSION_DENIED` avec audit Data Access actif et capturer `principalEmail`, permission refusée et ressource.
4. Corriger le droit/compte minimal exact, puis vérifier que le preview ne plante plus.
5. Ajouter au backend un traitement sûr des handlers async/rejets et un smoke `/api/*` avant de déclarer un environnement sain.
6. Valider Sonarr, Radarr, qBittorrent et Plex sur le nouveau service, plusieurs fois, après stabilisation du domaine.
7. Vérifier que la base nommée recréée n'est pas utilisée ; décider ensuite de son nettoyage et du garde-fou anti-recréation sans toucher à `default`.
8. Inventorier l'ancienne instance Cloud SQL et la supprimer uniquement si elle est prouvée orpheline.
9. Renouveler les secrets exposés dans l'export selon #30.
10. Formaliser un runbook de cutover : **deploy → health-check → map → smoke → retire old**, jamais l'inverse.
11. Revalider PWA canonique, preview AI Studio et APK applicable avant clôture de #28/#22.

## Limites de cet audit

- L'export ne contient pas l'événement Data Access permettant d'identifier avec certitude le principal du `PERMISSION_DENIED` du preview.
- Il ne prouve pas que la nouvelle base Firestore nommée contient des données ou est utilisée par SeenIt.
- Il ne prouve pas que l'instance Cloud SQL historique existe encore après la suppression du service.
- Il ne prouve aucune compromission des secrets ; il prouve seulement leur présence dans des données d'audit/export accessibles aux personnes autorisées.
- Aucun changement de runtime, IAM, base, secret ou service n'est effectué dans le cadre de cet audit.
