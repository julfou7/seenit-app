# Audit fonctionnel SeenIt — 4 septembre 2026

- Identifiant : `AUDIT-2026-09-04-FONCTIONNEL`
- Baseline : SeenIt **1.4.112**, commit `main` `30f90cea9f35bc268ffa6e20aa44985b1e3b9e40`
- Statut : terminé ; documentation consolidée, constats ouverts transférés dans GitHub Issues
- Dernière vérification : 4 septembre 2026

Ce rapport est une photographie. La source de vérité courante est la
[`référence fonctionnelle`](../specifications/functional-reference.md), complétée par la
[`SPEC`](../specifications/seenit.md). GitHub Issues reste la source du travail non livré.

## Objectif et périmètre

L'audit devait reconstruire le fonctionnement de SeenIt afin qu'un agent puisse intervenir sans
réapprendre le produit dans des composants de plusieurs milliers de lignes ou dépendre d'un historique
de conversation inaccessible.

Périmètre inspecté :

- navigation, authentification, PWA et cycle de vie APK ;
- accueil, bibliothèque, profil/statistiques, Explorer, fiches média/personne/épisode ;
- états film/série, progression, archives, favoris, rappels et actualités ;
- synchronisation multi-appareils, Firestore et caches locaux ;
- Plex full/delta/watchlist/disponibilité et ouverture Android ;
- téléchargement C411/Sonarr/Radarr/qBittorrent, webhooks et notifications ;
- réglages, import TV Time, mise à jour intégrée et logs ;
- 64 fichiers de tests, SPEC, demandes durables, audits et issues ouvertes/fermées pertinentes.

Limites : aucun compte personnel réel, serveur Plex/Arr/qBittorrent, push FCM, navigateur ou émulateur
Android n'a été actionné. Les parcours externes sont audités par lecture du code, tests existants et
historique GitHub. L'audit ne prétend pas remplacer le futur programme E2E #15.

## Méthode et preuves reproductibles

- état GitHub `main` contrôlé avant analyse : `30f90cea9f35bc268ffa6e20aa44985b1e3b9e40` ;
- lecture intégrale de `AGENTS.md`, de la SPEC, du processus de livraison, du registre des demandes et
  des audits existants ;
- inventaire de 129 fichiers TypeScript/TSX, 38 107 lignes sous `src`, 64 fichiers `*.test.ts` ;
- inspection des dix écrans, des stores, des features navigation/shows/Plex/downloads/runtime/release,
  des routes Express et des chemins Firestore ;
- recherche des issues ouvertes et fermées avant création ; analyse détaillée de #15, #67 et #68 ;
- confrontation des états créés dans `LibraryScreen`, `DiscoverScreen`, `ShowDetailScreen`,
  `CsvImporter`, `syncPlex` et des transitions de `markEpisodeWatched` ;
- confrontation des données censées être partagées avec tous les usages de `readUserScopedJson` ;
- inspection du traitement séquentiel des rappels et de la construction des liens de partage.

Les validations automatisées de cette livraison sont consignées dans la PR de l'audit.

## Points solides à conserver

1. **Identité média stricte.** TMDB est bien la clé SeenIt ; Plex et les téléchargements disposent de
   garde-fous explicites contre le matching titre/année.
2. **Bibliothèque réellement multi-appareils.** Firestore serveur remplace le cache, le listener temps
   réel synchronise le même UID et l'ancien cache ne ressuscite pas une suppression distante.
3. **Plex prudent.** Provenance `plexImported`, preuves autoritatives, full/delta, serveurs hors ligne
   non bloquants et caches UID sont spécifiés et largement testés.
4. **Téléchargements riches et caractérisés.** La réconciliation, l'idempotence, les timeouts Android,
   l'ordre visuel, l'historique et le polling ont des TNR ciblés.
5. **Adaptations APK explicites.** Credential Manager, Retour Android, intents Plex/Reddit/magnet,
   safe areas, notifications et mise à jour sur place ne sont pas traités comme un simple navigateur.
6. **Gouvernance mature.** SPEC avant code sur les zones sensibles, audits traçables, validation
   proportionnée et releases APK groupées limitent la bureaucratie sans retirer les invariants.

## Couverture fonctionnelle obtenue

| Domaine | Avant l'audit | Après consolidation |
|---|---|---|
| Vision produit et plateformes | SPEC existante | Conservée et reliée à la carte produit |
| Navigation et Retour | Dispersés entre code/contrat APK | Parcours et ordre de fermeture documentés |
| Écrans et actions | Presque absents de la SPEC | Référence écran par écran |
| États film/série | Implicites, issue #67 ouverte | Tables canoniques dans la SPEC |
| Mapping événements Plex | Invariants techniques sans matrice fonctionnelle | Matrice événement → effet/no-op/full/delta |
| Multi-appareils | Principe documenté | Tableau donnée par compte vs donnée appareil |
| Notifications/news | Invariants d'isolation uniquement | Horaires, intentions, deep links et limites documentés |
| Dépendances externes | Déductibles du code | Responsabilités et politiques d'échec explicites |
| Écarts produit/code | Non centralisés | Matrice priorisée et liée aux issues |
| Lecture agent | Trois documents génériques | Référence fonctionnelle obligatoire depuis `AGENTS.md` |

## Constats

### AUD-FONC-01 — Référence fonctionnelle absente — livré

La SPEC couvrait surtout les invariants sensibles. Un agent devait parcourir `App.tsx`, dix écrans et
plusieurs stores pour savoir ce que signifient les onglets, les boutons, les sections et les parcours.

Critère de sortie : référence canonique écran par écran, architecture fonctionnelle, données, erreurs,
plateformes et checklist de modification, liée depuis `AGENTS.md` et protégée par test.

Décision : corrigé dans la livraison de cet audit via `SEENIT-FUNCTIONAL-001`.

### AUD-FONC-02 — États initiaux incohérents — P1

L'ajout Watchlist Plex et « Ajouter aux films à voir » écrivent `plan_to_watch`. L'ajout depuis
Explorer, certaines actions Ma Liste/fiche et le favori d'un média absent écrivent `watching` avec
aucune progression. Le même geste peut donc classer différemment un média jamais commencé.

Critère de sortie : état initial unique, normalisation legacy idempotente et tests de chaque entrée.

Décision : [issue #93](https://github.com/julfou7/seenit-app/issues/93).

### AUD-FONC-03 — Retrait Watchlist Plex non bidirectionnel — P1

L'ajout Watchlist crée un suivi ; son retrait ne peut pas encore supprimer uniquement le suivi dont
la provenance Watchlist est prouvée.

Critère de sortie : convergence full/delta, aucune suppression d'une intention SeenIt, aucune action
sur source incomplète.

Décision : issue existante [#68](https://github.com/julfou7/seenit-app/issues/68), réutilisée.

### AUD-FONC-04 — Une entrée inéligible peut bloquer tous les rappels — P1

Dans la boucle des médias de `useRemindersNotifier`, les cas « archivé/abandonné », film sans date ou
série sans prochain épisode utilisent `return`, ce qui quitte le traitement complet.

Critère de sortie : chaque média est indépendant et les scénarios avec un premier élément inéligible
sont testés.

Décision : [issue #94](https://github.com/julfou7/seenit-app/issues/94).

### AUD-FONC-05 — Personnes favorites non synchronisées — P1

`favoritePeopleStore` est uniquement local, alors que cette intention influence les recommandations.
Le même UID peut donc avoir des recommandations différentes entre téléphone et ordinateur.

Critère de sortie : Firestore autoritatif, cache local hors-ligne, migration et concurrence testées.

Décision : [issue #95](https://github.com/julfou7/seenit-app/issues/95).

### AUD-FONC-06 — Partage non réouvrable ou trompeur — P2

La fiche et le profil partagent `window.location.href`, tandis que la sélection média réside souvent
seulement dans `history.state`. Aucun profil public n'existe.

Critère de sortie : URL média canonique TMDB/type et décision explicite sur la confidentialité du
profil.

Décision : [issue #96](https://github.com/julfou7/seenit-app/issues/96).

### AUD-FONC-07 — Absence de preuve E2E des parcours — P2

Les tests unitaires protègent de nombreux algorithmes mais pas encore le rendu, la navigation réelle,
l'offline/service worker, l'accessibilité ou le parcours notification sur appareils.

Critère de sortie : scénarios critiques PWA/APK sans accès aux comptes personnels.

Décision : issue existante [#15](https://github.com/julfou7/seenit-app/issues/15), réutilisée.

### AUD-FONC-08 — README procédural devenu contradictoire — livré

Le README racine décrivait encore toute livraison comportementale comme un bump/release APK immédiat
et recopait une procédure désormais remplacée par la classification `light/backend/apk` et la release
groupée.

Critère de sortie : README orienté démarrage, liens vers les sources canoniques et absence de procédure
dupliquée.

Décision : corrigé dans la livraison de cet audit.

## Validation de la consolidation

- `npm test` : **266 tests verts**, incluant SPEC, contrat Android, TypeScript et les quatre nouveaux
  contrôles de la référence fonctionnelle ;
- `npm run build` : build PWA et backend vert ;
- contrat APK : `com.seenit.app` v1.4.112, 19 icônes contrôlées, aucune mutation native ;
- avertissements Vite existants : chunks `index` et `firebase` supérieurs à 500 kB, déjà couverts par
  le programme de budgets/performance #15 ;
- aucune connexion à un service personnel et aucune modification de donnée utilisateur.

## Matrice exhaustive de traçabilité

| ID | Priorité | Statut | Trace |
|---|---|---|---|
| AUD-FONC-01 | P1 documentation | Livré | `SEENIT-FUNCTIONAL-001`, référence fonctionnelle, test |
| AUD-FONC-02 | P1 | Ouvert | [#93](https://github.com/julfou7/seenit-app/issues/93) |
| AUD-FONC-03 | P1 | Ouvert | [#68](https://github.com/julfou7/seenit-app/issues/68) |
| AUD-FONC-04 | P1 | Ouvert | [#94](https://github.com/julfou7/seenit-app/issues/94) |
| AUD-FONC-05 | P1 | Ouvert | [#95](https://github.com/julfou7/seenit-app/issues/95) |
| AUD-FONC-06 | P2 | Ouvert | [#96](https://github.com/julfou7/seenit-app/issues/96) |
| AUD-FONC-07 | P2 | Ouvert | [#15](https://github.com/julfou7/seenit-app/issues/15) |
| AUD-FONC-08 | P2 documentation | Livré | README racine simplifié dans la PR de l'audit |

Aucun constat n'est laissé uniquement dans ce rapport. Aucun risque fonctionnel supplémentaire n'est
accepté silencieusement.

## Priorisation proposée

1. #94 : défaut silencieux de rappels, correctif borné et à fort impact.
2. #93 : stabiliser la machine d'états avant toute nouvelle évolution bibliothèque/Plex.
3. #95 : rétablir la promesse multi-appareils pour les recommandations.
4. #68 : terminer la bidirectionnalité Watchlist avec provenance stricte.
5. #96 : fiabiliser le partage après décision sur le profil.
6. #15 : construire progressivement les E2E autour de ces parcours stabilisés.

## Critères de réaudit

Relancer un audit fonctionnel complet après résolution de #68, #93, #94 et #95, ou après l'ajout d'un
nouvel onglet/parcours majeur. Pour une modification plus petite, mettre à jour directement la
référence fonctionnelle, la SPEC concernée, les tests et l'issue sans réécrire cet audit historique.

