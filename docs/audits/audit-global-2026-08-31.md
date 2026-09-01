# Audit global SeenIt — 31 août 2026

- Identifiant : `AUDIT-2026-08-31-GLOBAL`
- Baseline fonctionnelle : 1.4.80
- Vérification après durcissement : 1.4.81, commit `75ec2f1`
- Statut : enregistré, constats ouverts transférés dans GitHub Issues
- Dernière consolidation : 1er septembre 2026

Périmètre : 111 fichiers TypeScript/React (38 643 lignes), backend Express (2 524 lignes),
Firebase, Firestore, PWA, Capacitor Android, GitHub Actions, 31 fichiers de tests initiaux et
historique Git.

Ce document est un constat daté. La source de vérité comportementale reste
[`../specifications/seenit.md`](../specifications/seenit.md) et le backlog actif reste GitHub Issues.

## Synthèse exécutive

SeenIt possède une base fonctionnelle riche et des invariants métier solides sur Plex et les
téléchargements. Les risques de régression viennent moins des algorithmes récents que des frontières
de plateforme et de livraison : actifs Android, signature, chemins API natifs, versionnement,
composants très volumineux et absence de tests instrumentés.

L'historique contient plusieurs restaurations de `debug.keystore`, logos et icônes. Il s'agit donc
d'un risque observé, pas hypothétique. La priorité de la 1.4.81 est de rendre impossible une nouvelle
publication qui aurait perdu ces actifs ou cassé la mise à jour sur place.

Pour un projet personnel utilisé par son propriétaire, le socle est solide et exploitable. Le niveau
global est estimé à **7,5/10** : les contrats média/téléchargement sont plus robustes que la moyenne,
mais la taille de certains modules, l'absence de tests Android réels et quelques faiblesses de chaîne
de livraison empêchent encore de qualifier l'ensemble de totalement professionnel.

## Méthode et preuves reproductibles

- `npm test` : 31 fichiers, 138 tests verts au moment de l'audit ;
- `npm run build` : PWA et backend compilés, avec avertissement Vite au-delà de 500 kB ;
- bundle principal : 766,81 kB (237,94 kB gzip), chunk Firebase : 838,68 kB (205,84 kB gzip) ;
- `npm run test:android` : contrat statique Android vert ;
- comptage source : 111 fichiers TS/TSX, 38 643 lignes dans `src`, 2 524 dans `server.ts` ;
- baseline de typage : 896 occurrences du jeton `any`, 193 appels `console.*` ;
- inspection de la CI, de l'historique Git, des règles Firestore, du service worker, des manifests,
  lockfiles, dépendances et fichiers racine.

Les chiffres décrivent la baseline auditée ; ils ne constituent pas à eux seuls des objectifs.

## Résultats par domaine

| Domaine | État | Risque principal | Décision |
|---|---|---|---|
| Identité média/Plex | Bon | régression future vers un matching titre/année | invariants SPEC/tests conservés |
| Isolation Firestore | Bon | règles larges sous le propre UID | acceptable pour usage personnel, validation de schéma à prévoir |
| Stockages locaux | Corrigé | logs globaux lisibles par le compte suivant | partition UID + redaction en 1.4.81 |
| Téléchargements | Bon | complexité et régressions dans un service de 2 442 lignes | tests métier solides, découpage progressif au backlog |
| Mise à jour APK | Corrigé | fallback backend absent dans l'APK, asset insuffisamment validé | fallback natif + URL stricte + SHA-256 |
| Identité APK | Corrigé | suppression icône ou rotation de clé accidentelle | contrat Android bloquant |
| CI/CD | Corrigé | CI capable de modifier `main`, actions Node 20 vieillissantes | CI en lecture/validation, actions Node 24 |
| Tests Android | Insuffisant | tests instrumentés encore factices | issue P1 dédiée |
| Sécurité API | À renforcer | pull Git accessible à tout compte authentifié | statut protégé ; allowlist admin au backlog |
| Secrets tiers | À renforcer | clés TVDB/OMDb/TMDB présentes dans le client | migration backend au backlog |
| Maintenabilité UI | À renforcer | écrans de 1 300 à 3 400 lignes | découpage par feature au backlog |
| Performance | Correcte sans budget | pas de seuil automatisé bundle/démarrage | budgets au backlog |
| PWA/service worker | Correcte | pas de test de mise à jour/offline automatisé | scénario E2E au backlog |

## Structure et maintenabilité observées

Les plus grands modules sont `ShowDetailScreen.tsx` (3 415 lignes), `sonarrRadarr.ts` (2 442),
`DiscoverScreen.tsx` (2 057), `syncPlex.ts` (1 833), `WatchListScreen.tsx` (1 565), `tmdb.ts`
(1 353), `liveDownloadStore.ts` (1 316), `SettingsScreen.tsx` (1 315) et
`EpisodeDetailModal.tsx` (1 137). Ils concentrent des responsabilités UI, réseau et état difficiles
à caractériser isolément.

Le dépôt possède aussi deux lockfiles alors que npm est déclaré comme gestionnaire, des fichiers de
travail suivis à la racine, aucun README racine, un script `clean` dépendant de `rm`, des dépendances
de base de données sans import applicatif retrouvé et plusieurs constantes d'environnement dupliquées.
Ces points restent P2 : ils augmentent le coût des évolutions, mais ne justifient pas une refonte
brutale pour une application personnelle stable.

## Corrections intégrées en 1.4.81

1. Contrat APK lisible par machine : applicationId, signature, deep link, nom, permissions, origine
   API, safe areas, canal de build, 19 actifs d'icône et leurs dimensions.
2. Empreintes figées pour la clé de signature et les icônes canoniques. La CI refuse leur perte ou
   remplacement accidentel avant et après `cap sync`.
3. Détection de mise à jour cohérente PWA/APK. L'APK utilise le backend de production en fallback et
   refuse tout asset hors du dépôt, du tag et du nom exacts.
4. Vérification SHA-256 de l'APK quand GitHub fournit le digest, avant ouverture de l'installateur.
5. Routes Git de diagnostic et de pull appelées via le transport authentifié compatible APK ; le
   statut n'est plus public.
6. Logs locaux partitionnés par UID et détails sensibles masqués avant stockage/export.
7. Version unique 1.4.81 synchronisée sur toutes les surfaces ; la CI n'écrit plus dans `main`.
8. Pipeline modernisé sur les actions Node 24, wrapper Gradle officiel 8.14.3 et distribution
   contrôlés par SHA-256, audit de dépendances et publication conjointe de l'APK et de son fichier
   `.sha256`.

## Constats ouverts et priorités

### P1 — fiabilité/sécurité

- Construire un test instrumenté d'installation par-dessus la version précédente : données,
  authentification, icône, notifications, deep links et retour Android.
- Concevoir une migration de la clé debug suivie dans Git vers une signature protégée sans casser
  les installations existantes. Aucune rotation ne doit précéder ce plan.
- Restreindre `/api/git/pull` à une allowlist d'UID administrateurs et le désactiver par défaut en
  production si l'allowlist est absente.
- Déplacer TVDB et OMDb derrière le backend ; traiter la clé TMDB comme identifiant public limité.
- Remplacer le traitement de corruption IndexedDB basé sur d'anciens noms de bases en dur par une
  récupération ciblée sur le projet Firebase courant.

### P2 — maintenabilité/performance/UX

- Découper `ShowDetailScreen`, `DiscoverScreen`, `SettingsScreen`, `sonarrRadarr` et `syncPlex` sans
  changement visuel, feature par feature, avec tests de caractérisation.
- Ajouter un budget de bundle et des mesures de démarrage à froid/reprise Android.
- Ajouter des tests E2E PWA et Android pour authentification, bibliothèque, téléchargement, Plex,
  notifications, mise à jour et navigation Retour.
- Ajouter des tests d'accessibilité automatisés et des snapshots visuels aux tailles APK usuelles.
- Tester le service worker : mise à jour, offline, notification click et absence de cache API.

## Matrice exhaustive des constats

| ID | Priorité | Constat / décision | Trace active |
|---|---|---|---|
| AUD-GLO-01 | Protégé | Identité média fondée uniquement sur des IDs techniques, jamais titre/année | `SEENIT-IDENTITY-001`, tests Plex |
| AUD-GLO-02 | Livré | Logs locaux isolés par UID et secrets masqués | 1.4.81, `SEENIT-DATA-003`, `SEENIT-SECURITY-003` |
| AUD-GLO-03 | Livré | Identité, icônes, signature et origine backend APK protégées statiquement | 1.4.81, contrat Android |
| AUD-GLO-04 | Livré | Récupération IndexedDB ciblée et bornée | [issue #10](https://github.com/julfou7/seenit-app/issues/10), [release 1.4.84](https://github.com/julfou7/seenit-app/releases/tag/v1.4.84) |
| AUD-GLO-05 | P1 | Opérations Git non limitées à une allowlist administrateur | [issue #11](https://github.com/julfou7/seenit-app/issues/11) |
| AUD-GLO-06 | P1 | Clés TVDB/OMDb livrées au client | [issue #12](https://github.com/julfou7/seenit-app/issues/12) |
| AUD-GLO-07 | P1/décision | Clé de signature historique suivie ; rotation interdite sans migration | [issue #9](https://github.com/julfou7/seenit-app/issues/9) |
| AUD-GLO-08 | Livré | Smoke instrumenté N → N+1 sur Android 12/cible, stockage privé, signature, icône, notifications, deep link et cycle de vie | [issue #13](https://github.com/julfou7/seenit-app/issues/13), `SEENIT-APK-003`, [release 1.4.92](https://github.com/julfou7/seenit-app/releases/tag/v1.4.92) |
| AUD-GLO-09 | P2 | Modules critiques trop volumineux | [issue #14](https://github.com/julfou7/seenit-app/issues/14) |
| AUD-GLO-10 | P2 | Couverture E2E/accessibilité et budgets de performance absents | [issue #15](https://github.com/julfou7/seenit-app/issues/15) |
| AUD-GLO-11 | Livré | Releases APK immuables et publication séparée du build | [issue #16](https://github.com/julfou7/seenit-app/issues/16), `SEENIT-RELEASE-004`, [release 1.4.87](https://github.com/julfou7/seenit-app/releases/tag/v1.4.87) |
| AUD-GLO-12 | P2 | Racine, lockfiles, dépendances et configuration à assainir | [issue #17](https://github.com/julfou7/seenit-app/issues/17) |
| AUD-GLO-13 | P2 | TypeScript permissif, lint/formatage incomplets et forte baseline `any` | [issue #18](https://github.com/julfou7/seenit-app/issues/18) |
| AUD-GLO-14 | P2 | En-têtes Web/CSP et cycle de vie du service worker non testés | [issue #19](https://github.com/julfou7/seenit-app/issues/19) |
| AUD-GLO-15 | Accepté | Règles Firestore larges sous le propre UID | Risque accepté pour l'usage personnel actuel : isolation inter-UID présente ; réévaluer avant ouverture multi-utilisateur |

Il ne reste donc aucun constat uniquement conservé dans ce document : chaque action ouverte possède
une issue priorisée et chaque absence d'action est soit déjà livrée, soit explicitement acceptée.

## Critères de sortie du programme de durcissement

- zéro perte d'icône, de signature, de package ou de données sur trois mises à jour APK consécutives ;
- smoke Android instrumenté vert dans la CI ;
- aucun secret privé dans le bundle ;
- toutes les routes d'administration protégées par UID ;
- budget de bundle et temps de démarrage suivis ;
- aucun fichier applicatif critique au-dessus de 1 000 lignes sans plan de découpage actif.
