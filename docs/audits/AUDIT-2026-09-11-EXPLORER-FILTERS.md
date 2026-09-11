# AUDIT-2026-09-11-EXPLORER-FILTERS

- **Date** : 2026-09-11
- **Version auditée** : SeenIt 1.4.143
- **Commit de départ** : `ecaec22e73306870f146194b9751b297c97dcb6a`
- **Issue** : #294
- **Périmètre** : Explorer PWA + APK, filtres, tri, recherche, pagination, HERO, grille et diffuseurs des cartes
- **Preuve terrain** : vidéo utilisateur `1000158333.mp4` (64 s, Android)
- **Limites** : audit de la vidéo + audit statique du code et TNR automatisés. La vidéo ne permet pas d'établir la disponibilité TMDB réelle de chaque média affiché ; la validation finale repose donc sur les contrats de requête et la CI, complétés par le TNR vidéo.

## Résumé

La régression n'était pas un défaut isolé de l'âge ou d'un diffuseur. Explorer possédait plusieurs chemins de chargement dont la sémantique divergeait selon la combinaison choisie. Le cas visible `Âge conseillé ≤ 10` révélait en plus un défaut de présentation : quand dix résultats ou moins survivaient au filtre, ils étaient tous réservés au HERO puis retirés de la grille, donnant l'impression d'un Explorer vide alors que des résultats existaient.

Le correctif remplace les combinaisons filtrées/triées par un moteur canonique, conserve les contraintes propres aux catégories, rend la modale transactionnelle, ignore les réponses réseau obsolètes et stabilise la résolution des diffuseurs publics FR.

## Symptômes observés

1. Après validation de `Âge conseillé ≤ 10`, la surface repart en chargement puis peut aboutir à un HERO visible avec une grille vide.
2. Des diffuseurs réapparaissent ou changent lors des remounts virtuels des cartes.
3. Certains contrôles affichent une sélection qui ne correspond pas au chemin réseau réellement exécuté.
4. Le type de contenu peut être changé avant d'appuyer sur `Afficher les résultats`.
5. En recherche texte, certains filtres restent sélectionnables alors qu'ils ne sont pas appliqués.

## Causes racines prouvées

### C1 — HERO qui consomme toute une page filtrée

`DiscoverScreen` retirait systématiquement de la grille les éléments utilisés dans le TOP/HERO. Sur une page filtrée contenant au plus dix éléments, le résultat visible devenait donc : HERO non vide + grille vide. L'état vide ne s'affichait pas, car `processedResults` restait non vide.

**Correction** : le HERO est désactivé dès qu'un filtre de champ ou un tri explicite est actif. Une vue filtrée est une vue de résultats : aucun résultat n'est soustrait de la grille.

### C2 — perte de la catégorie dès qu'un filtre genre/âge/note est actif

Le branchement historique testait les filtres avant `Pépites`, `Top 100`, `Au cinéma` et `Documentaires`. Toute combinaison avec genre, âge ou note basculait vers un `discover` générique. La puce de catégorie restait visible alors que ses contraintes avaient disparu.

**Correction** : `discoverSeenIt()` reçoit explicitement la catégorie et conserve ses invariants :
- `Top 100` : `vote_count >= 3000` ;
- `Pépites` : contenu récent, note >= 7,5, `vote_count >= 100` ;
- `Documentaires` : genre documentaire TMDB 99 ;
- `Au cinéma` : région FR, release type 2/3, fenêtre cinéma canonique.

### C3 — plateforme ignorée dans certaines catégories

`Top 100` et `Au cinéma` utilisaient des fonctions spécialisées ne recevant pas `selectedPlatforms`. La plateforme pouvait donc être affichée comme active sans influencer la source.

**Correction** : toutes les vues filtrées passent par le moteur canonique, qui applique `watch_region=FR` et `with_watch_providers` aux catégories concernées.

### C4 — modale non transactionnelle

Les boutons de type appelaient directement `setActiveCategory`. Fermer la modale sans valider laissait donc le changement appliqué. `Réinitialiser` ne remettait pas le type sur `Tout`.

**Correction** : `draftCategory` est local à la modale. Le parent n'est modifié qu'au clic `Afficher les résultats`. `Réinitialiser` remet type, plateforme, genre, âge et note aux valeurs par défaut.

### C5 — réponses asynchrones obsolètes

Deux requêtes lancées à la suite pouvaient terminer dans l'ordre inverse. La plus ancienne pouvait alors écraser le résultat du critère le plus récent.

**Correction** : générations séparées pour le flux Explorer et la recherche texte. Toute réponse dont la génération n'est plus courante est ignorée avant commit d'état.

### C6 — recherche texte et filtres divergents

Plateforme et âge ne sont pas supportés par l'endpoint TMDB de recherche texte ; genre et note étaient pourtant également ignorés côté écran bien qu'ils restent sélectionnables.

**Correction** :
- plateforme et âge restent visibles mais désactivés avec l'explication `Indisponible en recherche texte` ;
- genre et note sont appliqués localement aux résultats de recherche ;
- seules `Tout`, `Séries`, `Films`, `Personnes` sont des catégories compatibles avec une recherche texte ; les catégories spéciales sont désactivées dans la modale et une recherche commencée depuis l'une d'elles repasse sur `Tout`.

### C7 — deuxième sémantique parentale locale

`DiscoverScreen` contenait encore l'ancien calcul FR/US + heuristiques de genres. Les tokens modernes `age:*` tombaient actuellement hors de ses branches et n'étaient donc pas la cause directe du blanc de la vidéo, mais ce code mort contradisait `SEENIT-PARENTAL-001` et constituait un risque de régression.

**Correction** : suppression de cette seconde interprétation. L'âge est résolu exclusivement par la façade canonique et `matchesMaxRecommendedAge`.

### C8 — réseau TV confondu avec diffuseur

Une carte possédant `show.networks` indiquait au hook qu'un diffuseur était déjà connu. Un network de série pouvait donc empêcher la résolution du vrai watch provider public FR et produire un rendu différent selon l'origine de la carte.

**Correction** : les cartes demandent toujours le diffuseur public FR via le cache mémoire/persistant existant. Le network local ne reste qu'un fallback visuel si aucun provider public n'existe.

## Matrice fonctionnelle après correction

| Contrôle | Source | Sémantique | Pagination | Recherche texte |
| --- | --- | --- | --- | --- |
| Type `Tout/Séries/Films` | TMDB discover | exact | oui | oui |
| `Top 100` | TMDB discover | >= 3000 votes, tri note par défaut | max 5 pages historiques | non |
| `Pépites` | TMDB discover | 1 an, >= 7,5, >= 100 votes | oui | non |
| `Au cinéma` | TMDB discover | FR + type 2/3 + fenêtre cinéma | oui | non |
| `Documentaires` | TMDB discover | genre 99 | oui | non |
| Plateformes | `with_watch_providers` | OU entre plateformes ; ET avec autres familles | oui | indisponible, contrôle désactivé |
| Genres | `with_genres` / filtre local documentaire | OU entre genres ; ET avec autres familles | oui | oui, filtre local |
| Âge conseillé | détail TMDB + `SEENIT-PARENTAL-001` | borne max cumulative, inconnues exclues | la page brute décide de la suite | indisponible, contrôle désactivé |
| Note minimum | `vote_average.gte` | seuil inclusif | oui | oui, filtre local |
| Tri | TMDB discover puis fusion déterministe TV/film | popularité, note, date ou titre | reset page 1 à chaque changement | tri local sur max 30 résultats |
| Réinitialiser | UI | restaure `Tout`, aucun filtre, tri inchangé dans la modale | reset page 1 | idem |

### Composition

- Plusieurs valeurs d'une **même famille** (genres, plateformes) sont combinées en **OU**.
- Des familles **différentes** (type + plateforme + genre + âge + note) sont combinées en **ET**.
- Un changement de filtre ou de tri remet la pagination à la page 1.
- La présence de pages suivantes est calculée à partir de `total_pages` TMDB brut quand disponible ; une page clairsemée après filtre parental ne coupe pas la pagination.

## Points solides conservés

- Explorer reste monté entre les changements d'onglet ; le correctif #289 n'est pas annulé.
- Le retour en haut avant application des filtres est conservé.
- Le cache public des diffuseurs reste borné, persistant, stale-if-error et séparé du cache Plex utilisateur.
- `Au cinéma` continue de respecter `SEENIT-DISCOVER-001`.
- L'âge continue de respecter `SEENIT-PARENTAL-001`.
- La virtualisation bornée et le déclenchement passif des diffuseurs restent en place pour protéger `SEENIT-PERF-001`.

## TNR

`tests/explorerFiltersMatrix.test.ts` verrouille :
- la sémantique OU des genres ;
- le mapping type/catégorie ;
- la compatibilité recherche texte ;
- la transaction de la modale et le reset ;
- le routage de toute combinaison vers `discoverSeenIt` ;
- le cas vidéo HERO/grille vide ;
- la garde anti-réponse obsolète ;
- recherche + genre + note + type ;
- l'absence de seconde classification parentale dans `DiscoverScreen` ;
- les contraintes des catégories spéciales ;
- la non-confusion network/diffuseur.

## Statut

Correctif implémenté sur `fix/294-explorer-filters`. Validation CI et revue PR requises avant fermeture de #294.
