# Décision produit — Relations sur les fiches média

Date : **6 septembre 2026**  
Statut : **acceptée et canonique**  
Suivi d'implémentation : [issue #130](https://github.com/julfou7/seenit-app/issues/130)  
Exigence : `SEENIT-RELATION-001`

## Décision

SeenIt simplifie durablement les relations affichées sur les fiches. Une fiche média sert à répondre à la question **« qu'est-ce qui est réellement lié à ce média ? »** ; la découverte approximative reste la responsabilité d'Explorer.

La cible produit est donc :

| Type de fiche | Section 1 | Section 2 | Similaires |
|---|---|---|---|
| Film | **Ordre de visionnage** via collection TMDB explicite | **Même franchise / même univers** via TVDB | **Supprimés de la fiche** |
| Série | — | **Même franchise / même univers** via TVDB | **Supprimés de la fiche** |

Une fiche peut n'afficher aucune section relationnelle. Ce résultat est normal et préférable à une recommandation bruitée ou à une relation inventée.

## 1. Films — ordre de visionnage

L'**Ordre de visionnage** d'un film provient exclusivement de la collection TMDB explicite du film.

- TMDB est la source normale et suffisante pour cette section.
- L'ordre de la collection est conservé comme ordre de saga SeenIt.
- Aucune série n'est ajoutée dans cette section.
- Aucun catalogue SeenIt, TVDB, Wikidata ou rapprochement par titre ne complète une collection TMDB manquante.
- Si TMDB ne fournit aucune collection exploitable, la section n'est pas affichée.

## 2. Films et séries — franchise / univers via TVDB

TVDB devient la source normale des relations **franchise / univers**, pour les films comme pour les séries.

Le résolveur cible respecte les règles suivantes :

1. partir de l'identité SeenIt exacte `movie:<tmdbId>` ou `tv:<tmdbId>` ;
2. obtenir les identifiants externes exacts depuis TMDB, en priorité le TVDB ID lorsqu'il existe et l'IMDb ID comme pont technique si nécessaire ;
3. rejoindre TVDB uniquement par identifiant externe exact ; **aucune recherche du média par titre** ;
4. examiner uniquement les listes effectivement rattachées à cette œuvre TVDB ; **aucune recherche globale de listes** ;
5. retenir au maximum **une** liste officielle qui représente une franchise ou un univers ; **plus aucune fusion de plusieurs listes** ;
6. le libellé d'une liste déjà rattachée à l'œuvre exacte peut servir uniquement à qualifier sa nature pour l'interface (`franchise` ou `univers`) ; il ne peut jamais servir à identifier une œuvre ni à rattacher un membre ;
7. si plusieurs listes officielles admissibles restent réellement ambiguës, ne rien afficher plutôt que choisir arbitrairement ;
8. résoudre chaque membre TVDB vers un `movie:<tmdbId>` / `tv:<tmdbId>` exact avant affichage ; aucune correspondance par titre, année, casting, studio, marque, popularité ou premier résultat ;
9. mettre en cache le résultat par identifiant de liste TVDB afin que tous les membres résolus retrouvent le même groupe sans fan-out inutile.

### Libellé utilisateur

- Une liste TVDB qualifiée comme **franchise** s'affiche sous **« Dans la même franchise »**.
- Une liste TVDB qualifiée explicitement comme **univers** s'affiche sous **« Dans le même univers »**.

Le vocabulaire reflète donc la sémantique de la source au lieu de promettre artificiellement une continuité narrative pour toute franchise.

## 3. Déduplication sur les films

La priorité d'affichage d'un film est :

1. **Ordre de visionnage** TMDB ;
2. **Franchise / univers** TVDB.

Tout média déjà présent dans l'Ordre de visionnage est retiré de la seconde section par `mediaType + tmdbId`.

Exemple attendu : une trilogie présente dans la collection TMDB reste dans **Ordre de visionnage** ; la section TVDB peut ensuite montrer les films ou séries supplémentaires de la franchise sans répéter cette trilogie.

La fiche courante peut apparaître comme repère dans un vrai groupe TVDB. Une section qui ne laisserait aucun autre média affichable est masquée.

## 4. Suppression des similaires sur les fiches

Les sections **Films similaires** et **Séries similaires** sont supprimées des fiches média.

- Les résultats TMDB `recommendations` / `similar` ne sont plus utilisés pour remplir le bas d'une fiche.
- Ils ne sont jamais utilisés comme fallback d'une franchise TVDB absente.
- La découverte, les recommandations et les contenus approchants restent dans **Explorer**, où leur caractère probabiliste est cohérent avec l'intention utilisateur.

Cette séparation évite le doublon fonctionnel entre « même univers » et « similaire » et évite de présenter des résultats TMDB aléatoires comme des relations utiles au média courant.

## 5. Sources explicitement retirées du chemin normal

Le chemin produit normal des relations de fiche est volontairement réduit à **TMDB + TVDB**.

Ne font plus partie de la stratégie normale de couverture des relations :

- Wikidata ;
- Kometa ;
- MDBList ;
- AniList / AniDB ;
- tout pipeline de collecte multi-source destiné à construire une encyclopédie SeenIt des univers.

Le catalogue relationnel SeenIt existant n'est plus la source normale de couverture. Pendant la migration il peut subsister comme **legacy** ; après migration, un éventuel override SeenIt ne peut être qu'une exception rare, versionnée, fondée sur des `mediaKey` exactes et documentée dans une issue. Il ne doit jamais redevenir une stratégie d'enrichissement manuel continu.

## 6. Invariants conservés

Les simplifications ci-dessus ne relâchent pas l'identité média :

- `movie:42` et `tv:42` restent deux médias différents ;
- aucun titre, titre original, année, popularité, genre, mot-clé, casting, studio ou marque n'identifie une œuvre ;
- un cas nommé dans un bug devient un TNR, jamais une branche spéciale de production ;
- aucune panne TVDB ne déclenche de fallback par titre ;
- l'absence ou l'ambiguïté masque uniquement la section relationnelle ; la fiche reste utilisable.

Le nom d'une **liste TVDB déjà atteinte depuis l'identité exacte** constitue uniquement une métadonnée de classification de la liste et non une preuve d'identité ou de membership.

## 7. Scénarios de référence

Les scénarios ci-dessous servent à valider le mécanisme commun, pas à introduire des exceptions nominatives :

- **House of the Dragon** : doit pouvoir rejoindre la franchise Game of Thrones via TVDB, avec Game of Thrones et A Knight of the Seven Kingdoms lorsque la liste TVDB officielle les expose ;
- **Breaking Bad** : Breaking Bad, Better Call Saul et El Camino doivent provenir du même groupe TVDB admissible ;
- **Yellowstone** : les spin-offs présents dans la franchise TVDB officielle doivent être retrouvés depuis leurs identités exactes ;
- **Harry Potter** : la collection TMDB fournit d'abord l'Ordre de visionnage des films ; une franchise TVDB éventuelle ne répète pas ces films et peut apporter les médias supplémentaires ;
- **MCU** : les films d'une collection TMDB restent dans leur saga locale ; les autres films/séries de la franchise TVDB peuvent apparaître dans la seconde section sans fusionner des continuités non rattachées par TVDB ;
- **film ou série indépendant(e)** : aucune section relationnelle si TMDB/TVDB ne fournit pas de relation admissible.

## 8. Écart de mise en œuvre au moment de la décision

Au 6 septembre 2026, le runtime `main` ne respecte pas encore cette cible :

- le catalogue relationnel généré SeenIt reste la source principale des univers ;
- le pipeline hors ligne Wikidata existe encore ;
- le service TVDB legacy n'est plus appelé par la fiche et contient d'anciennes heuristiques interdites ;
- les sections Films/Séries similaires sont encore présentes.

L'issue #130 reste donc **ouverte** jusqu'à la migration runtime, aux TNR PWA/APK et à la suppression du chemin legacy devenu inutile.

## 9. Décisions remplacées

Cette décision remplace explicitement :

- `USR-2026-09-05-002` pour la promesse de trois sections distinctes sur les fiches ;
- `USR-2026-09-06-005` pour le catalogue éditorial + détection hors ligne comme architecture normale de couverture.

Elle conserve les garde-fous d'identité exacte et d'absence de rustine nominative de `USR-2026-09-06-003`.

Cette architecture est la cible canonique. Elle ne doit pas être remise en débat lors de l'implémentation sauf nouvelle décision produit explicite du propriétaire.
