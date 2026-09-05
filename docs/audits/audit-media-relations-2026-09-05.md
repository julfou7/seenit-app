# Audit des sagas, univers et médias similaires — 5 septembre 2026

**Identifiant :** AUDIT-2026-09-05-MEDIA-RELATIONS  
**Version observée :** SeenIt 1.4.114  
**Commit observé :** afae1ae7654af1f34839d0240f006ac74ea772db  
**Statut :** terminé ; écarts ouverts dans [#130](https://github.com/julfou7/seenit-app/issues/130)  
**Dernière vérification :** 5 septembre 2026

## Objectif

Évaluer la fiabilité fonctionnelle, l'identité, la réciprocité, la performance et la résilience des
sections « Ordre de visionnage », « Dans le même univers » et « Similaires » sur les fiches Film et
Série. L'audit doit empêcher le retour de corrections au cas par cas qui améliorent une franchise
tout en en cassant une autre.

## Périmètre et méthode

Le contrôle a porté sur :

- le chargement collection/univers/similaires dans
  [tmdbClient.ts](../../src/features/shows/tmdbClient.ts) ;
- le résolveur de listes et identifiants TVDB dans [tvdb.ts](../../src/services/tvdb.ts) ;
- l'agrégation et le rendu de la fiche dans
  [ShowDetailScreen.tsx](../../src/screens/ShowDetailScreen.tsx) ;
- la navigation cross-media dans
  [useNavigation.ts](../../src/features/navigation/useNavigation.ts) ;
- l'historique Git des correctifs Wikidata, TVDB, TMDB, Harry Potter, Vikings, Daredevil et
  Punisher ;
- des appels reproductibles au résolveur actuel sur les franchises demandées.

Les durées sont des mesures ponctuelles depuis l'environnement d'audit. Elles montrent l'ordre de
grandeur et le fan-out, pas un benchmark contractuel de l'infrastructure.

## Modèle produit observé

L'interface présente trois intentions différentes :

| Section | Source dominante actuelle | Promesse utilisateur attendue |
|---|---|---|
| Ordre de visionnage | belongs_to_collection TMDB pour les films | groupe explicite et ordonné |
| Dans le même univers | listes TVDB, puis recherche TMDB par titre | continuité narrative film/série/spin-off |
| Similaires | recommendations + similar TMDB | découverte contextuelle, sans preuve de franchise |

Cette séparation d'interface est pertinente. Le défaut central se situe dans la preuve acceptée pour
construire l'univers et dans l'absence de groupe canonique indépendant du média de départ.

## Preuves reproductibles et mesures de caractérisation

| Point d'entrée | Résultat | Temps observé | Analyse |
|---|---:|---:|---|
| Yellowstone | 6 membres | 1 172 ms | ensemble attendu sur ce point d'entrée |
| 1883 / 1923 / Lawmen | même ensemble de 6 | 600–1 100 ms | réciprocité correcte sur cette famille |
| Breaking Bad | 3 membres | 841 ms | Breaking Bad, Better Call Saul, El Camino |
| Better Call Saul | **42 membres** | 1 051 ms | faux positifs, dont Star Wars: The Clone Wars, Fargo, Bosch, The Bureau et Westworld |
| El Camino | 3 membres | 961 ms | résultat attendu obtenu par fallback titre |
| Harry Potter 1 | 12 membres | **7 537 ms** | huit Harry Potter, trois Fantastic Beasts et la série attendue ; trop lent |
| Fantastic Beasts | 12 membres | 1 864 ms | ensemble Wizarding World réciproque sur cet essai |
| Série Harry Potter | 12 membres | 830 ms | ensemble réciproque sur cet essai |
| Iron Man | 85 membres | 2 276 ms | périmètre Marvel trop large pour prouver une continuité |
| Avengers: Endgame | 85 membres | 1 248 ms | cohérent avec Iron Man mais mélange possible de continuités |
| The Dark Knight | 3 membres | 1 067 ms | trilogie Nolan correctement isolée sur cet essai |
| House of Guinness | 0 TVDB, puis univers contenant seulement la fiche courante | 825 ms avant fallback | auto-référence sans relation réelle |

## Points solides à préserver

- La collection TMDB explicite fournit une base robuste pour les sagas de films.
- La structure de carte supporte déjà films et séries dans un même carrousel.
- L'élément courant peut être conservé pour matérialiser sa place et afficher le badge « actuel ».
- Les recommandations et résultats similaires TMDB sont déjà fusionnés avec une priorité.
- Yellowstone, Breaking Bad depuis sa propre fiche, Wizarding World et la trilogie Nolan montrent
  qu'un résultat utile est possible lorsque la source sélectionnée est la bonne.
- Les erreurs de relation sont déjà isolables du reste de la fiche ; cette propriété doit devenir
  contractuelle.

## Constats détaillés

### REL-01 — P1 — Le titre et la popularité sont encore utilisés comme preuve d'univers

Le fallback nettoie le titre, retire notamment des préfixes Marvel/DC, exécute une recherche multi
TMDB puis retient des titres inclus/préfixés selon popularité et votes. Cette logique peut rapprocher
homonymes, remakes, adaptations parallèles ou œuvres partageant seulement une marque.

**Impact :** faux positifs visibles et confiance perdue.  
**Sortie :** aucune appartenance saga/univers ne provient d'une recherche textuelle, de l'année, de
la popularité ou d'un premier résultat.  
**Backlog :** [#130](https://github.com/julfou7/seenit-app/issues/130).

### REL-02 — P1 — Toute liste TVDB officielle peut être prise pour une franchise

Le prédicat courant accepte une liste si elle est officielle **ou** si son nom ressemble à une
franchise. Better Call Saul rejoint ainsi plusieurs listes éditoriales officielles et produit 42
membres, alors que Breaking Bad n'en produit que trois.

**Impact :** résultat dépendant du point d'entrée, faux positifs massifs.  
**Sortie :** seules des listes de groupe épinglées/approuvées, atteintes depuis un identifiant exact,
sont admissibles ; le statut officiel ou le nom ne suffisent jamais.  
**Backlog :** [#130](https://github.com/julfou7/seenit-app/issues/130).

### REL-03 — P1 — La réciprocité n'est pas garantie par un groupe canonique

Les listes sont recherchées et fusionnées depuis le média courant. Il n'existe pas de groupId
normalisé garantissant que chaque membre restitue le même ensemble et le même ordre.

**Impact :** Breaking Bad et Better Call Saul affichent deux réalités différentes ; les corrections
restent fragiles.  
**Sortie :** relation persistée/cachée par groupe versionné, indépendante du point d'entrée.  
**Backlog :** [#130](https://github.com/julfou7/seenit-app/issues/130).

### REL-04 — P1 — L'identité TMDB n'est pas toujours qualifiée par le type

Des lookups locaux, comparaisons d'historique et déduplications comparent encore des IDs numériques
sans toujours associer movie ou tv. Or les espaces d'ID TMDB sont distincts.

**Impact :** collision potentielle entre un film et une série portant le même nombre, mauvais badge
actuel, navigation ou état de fiche contaminé.  
**Sortie :** mediaKey movie:<id>/tv:<id> de bout en bout, avec TNR movie:42 contre tv:42.  
**Backlog :** [#130](https://github.com/julfou7/seenit-app/issues/130).

### REL-05 — P1 — Une section auto-référente peut être affichée

Pour House of Guinness, TVDB ne renvoie aucun groupe. Le fallback TMDB ajoute ensuite le média courant
à un univers vide et ne réapplique pas la règle « au moins deux membres ».

**Impact :** « House of Guinness dans le même univers que House of Guinness », résultat absurde et
directement visible.  
**Sortie :** masquer toute section dont le seul membre est la fiche courante.  
**Backlog :** [#130](https://github.com/julfou7/seenit-app/issues/130).

### REL-06 — P2 — Les similaires ne sont pas complètement exclus des groupes prioritaires

La sélection des similaires exclut la collection mais pas systématiquement l'univers. La
déduplication est en outre parfois numérique plutôt que typée. Un spin-off peut donc apparaître dans
« Même univers » puis dans « Similaires ».

**Impact :** répétition, hiérarchie floue et comportements différents selon le chemin.  
**Sortie :** priorité saga > univers > similaires et déduplication par mediaKey. La réciprocité ne
s'applique pas aux similaires.  
**Backlog :** [#130](https://github.com/julfou7/seenit-app/issues/130).

### REL-07 — P2 — Le fan-out distant est coûteux et non normalisé

Le résolveur peut charger plusieurs listes puis tous leurs médias sans cache de groupe ni borne
explicite de concurrence. Harry Potter a pris 7,5 secondes lors du test à froid.

**Impact :** fiche lente, consommation de quotas et variance PWA/APK/réseau mobile.  
**Sortie :** cache mediaKey/groupId, stale-if-error, concurrence bornée, annulation, cible froide
2,5 secondes et timeout dur 4 secondes.  
**Backlog :** [#130](https://github.com/julfou7/seenit-app/issues/130).

### REL-08 — P1 sécurité — Les fournisseurs et clés sont encore sollicités depuis le client

La clé TVDB et plusieurs appels de métadonnées sont exposés au frontend. Ce point est antérieur et
déjà suivi indépendamment.

**Impact :** secret récupérable, quotas partagés et résilience limitée.  
**Sortie :** resolver derrière le backend authentifié, sans proxy générique ni secret client.  
**Backlog :** [#12](https://github.com/julfou7/seenit-app/issues/12). La logique fonctionnelle reste
définie dans [#130](https://github.com/julfou7/seenit-app/issues/130).

### REL-09 — P2 — Wikidata ne doit pas redevenir une dépendance synchrone de fiche

Le service public Wikidata impose des règles d'usage, du throttling et un timeout. Sa richesse de
graphe est utile pour une préparation hors ligne, mais sa disponibilité et la qualité variable des
relations ne conviennent pas à une vérité synchrone sans validation.

**Impact :** lenteur, indisponibilité et nouvelles heuristiques pour compenser des données partielles.  
**Sortie :** éventuel enrichissement hors ligne, résolu par identifiants exacts, validé et versionné
dans un manifeste SeenIt.  
**Backlog :** [#130](https://github.com/julfou7/seenit-app/issues/130).

## Architecture cible

1. La fiche demande un mediaKey typé.
2. Le résolveur exact obtient d'abord les identifiants externes fiables.
3. Le média rejoint un groupe versionné par identifiant explicite, jamais par recherche textuelle.
4. Le cache restitue le même groupe à chaque membre.
5. Le rendu applique saga > univers > similaires et déplace uniquement le badge « actuel ».
6. Les résultats trop incomplets sont masqués ; le reste de la fiche continue.
7. Les suggestions TMDB restent indépendantes et contextuelles.

Les continuités de marque ne sont pas des groupes universels : MCU, Sony/Fox/X-Men, DCEU, DCU,
Arrowverse et trilogie Nolan sont des groupes séparés tant qu'une relation explicite ne dit pas
autrement.

## Matrice de TNR contractuelle

| Fixture | Invariant |
|---|---|
| Yellowstone, 1883, 1923, Lawmen, Marshals, Dutton Ranch | même groupe de six depuis chaque fiche |
| Breaking Bad, Better Call Saul, El Camino | même groupe exact de trois ; aucun faux positif éditorial |
| 8 Harry Potter + 3 Fantastic Beasts + série Harry Potter | groupe cross-media réciproque et ordre stable |
| House of Guinness tv:250988 | aucune section si elle ne contiendrait que soi |
| Iron Man et Avengers: Endgame | même groupe MCU ; aucune adaptation Marvel externe implicite |
| The Dark Knight | trilogie Nolan séparée de DCEU, DCU et Arrowverse |
| movie:42 et tv:42 | deux identités, états, badges et navigations distincts |
| Similaires | exclut soi/saga/univers ; réciprocité non requise |
| Panne/timeout fournisseur | fiche intacte, relation masquée, aucun fallback titre |

## Sources externes et décision

- [TMDB Similar](https://developer.themoviedb.org/reference/movie-similar) décrit un calcul fondé sur
  genres et mots-clés et avertit que le résultat n'est pas toujours parfait : il s'agit de découverte,
  pas d'une identité de franchise.
- [TMDB Find](https://developer.themoviedb.org/reference/find-by-id) permet la résolution depuis un
  identifiant externe exact.
- [TMDB Finding Data](https://developer.themoviedb.org/docs/finding-data) distingue la recherche
  textuelle de la résolution par identifiant.
- [TVDB API v4](https://thetvdb.github.io/v4-api/) expose séries, films, listes et recherche par
  identifiant distant ; l'application doit toutefois épingler les groupes admis.
- [Wikidata Query Service](https://www.mediawiki.org/wiki/Wikidata_query_service/User_Manual) documente
  timeout et limites d'usage qui excluent son endpoint public comme dépendance temps réel fiable.

## Matrice exhaustive des constats

| Constat | Priorité | Issue | Statut au 5 septembre 2026 |
|---|---:|---|---|
| REL-01 titre/popularité comme preuve | P1 | #130 | ouvert |
| REL-02 listes officielles TVDB trop larges | P1 | #130 | ouvert |
| REL-03 groupes non réciproques | P1 | #130 | ouvert |
| REL-04 identité non typée partout | P1 | #130 | ouvert |
| REL-05 auto-référence House of Guinness | P1 | #130 | ouvert |
| REL-06 doublons avec similaires | P2 | #130 | ouvert |
| REL-07 cache/fan-out/performance | P2 | #130 | ouvert |
| REL-08 secrets et appels fournisseurs client | P1 sécurité | #12 | ouvert |
| REL-09 Wikidata synchrone non fiable | P2 | #130 | ouvert |

## Décision

La correction doit être menée comme un chantier de modèle de données et de contrat, pas comme une
nouvelle série d'exceptions par titre. Les règles cibles sont intégrées à SEENIT-RELATION-001 et
l'implémentation reste explicitement ouverte dans #130. Aucun comportement courant incorrect n'est
promu au rang de spécification.
