# Audit global SeenIt — 31 août 2026

Version auditée : 1.4.80, durcie dans la livraison 1.4.81.
Périmètre : 111 fichiers TypeScript/React (38 643 lignes), backend Express, Firebase,
Firestore, PWA, Capacitor Android, GitHub Actions, 31 fichiers de tests initiaux et historique Git.

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
8. Pipeline modernisé sur les actions Node 24, wrapper Gradle, audit de dépendances et publication
   conjointe de l'APK et de son fichier `.sha256`.

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

## Critères de sortie du programme de durcissement

- zéro perte d'icône, de signature, de package ou de données sur trois mises à jour APK consécutives ;
- smoke Android instrumenté vert dans la CI ;
- aucun secret privé dans le bundle ;
- toutes les routes d'administration protégées par UID ;
- budget de bundle et temps de démarrage suivis ;
- aucun fichier applicatif critique au-dessus de 1 000 lignes sans plan de découpage actif.
