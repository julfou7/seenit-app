# SeenIt · spec refonte de l’onglet Explorer

Version du 28/10/2026. Destinataire : l’agent de développement IA qui travaille dans `seenit-app`.
Base de code relevée : `main` au commit `bc571c2` (28/10/2026).

## 0. Comment utiliser ce document

- **Source visuelle :** `design/rendus/*.png`, un écran par fichier en 390 × 844. Les affiches y sont des aplats de couleur, parce que les images TMDB ne se chargent pas dans la toile. Dans l’app, ce sont les vraies images.
- **Prototype :** `design/sources/SeenIt Explorer.dc.html`, la page « SeenIt Explorer » de la toile SeenIt.
  - **Dans la toile :** le premier téléphone est cliquable. Il permet de faire défiler, de lancer une recherche, de fermer le clavier, d’ouvrir les filtres, de faire un appui long et de changer d’onglet.
  - **Hors de la toile :** le fichier sert à relever les valeurs exactes (styles en ligne, textes, logique dans le bloc script). Ce n’est pas du code de production.
- **Règles du dépôt :** applique `AGENTS.md`. Cette refonte modifie deux exigences existantes et des règles produit. C’est donc une Demande durable, à traiter « SPEC avant code » :
  1. inscrire la demande dans `docs/requests/registry.md` ;
  2. mettre à jour `docs/specifications/seenit.md`, `requirements.json` et `functional-reference.md` (§ navigation et § 7 Explorer) ;
  3. coder, avec les tests référencés.
- **Exigences modifiées :**
  - **`SEENIT-DISCOVER-003` :** la loupe quitte la navigation, et fermer le clavier ne restaure la navigation que si le champ est vide (E-15).
  - **`SEENIT-UX-017` :** la barre a la même taille sur tous les onglets (E-07).
- **Identifiants :** les exigences de ce document portent un identifiant (`E-01`…). Reprends-les dans les commits, dans les tests et dans les nouvelles exigences du catalogue.
- **Hors périmètre :** ne touche ni à l’onglet Télécharger, ni à son contenu, ni à sa place dans la barre (logique existante inchangée). Les fiches média ne changent pas non plus.
- **« À valider » :** la faisabilité n’est pas prouvée. Implémente le repli décrit et ouvre une issue pour la cible.

### 0.1 Lots de livraison

1. **Lot 1 :** barre fixe, loupe dans la page, retrait de la barre de recherche flottante, hero compact, rangée collante (E-01 à E-08).
2. **Lot 2 :** mode recherche et résultats en liste, comportement à la fermeture du clavier (E-10 à E-17).
3. **Lot 3 :** panneau Filtres par onglets et filtres actifs (E-20 à E-29).
4. **Lot 4 :** aperçu par appui long (E-30 à E-33).

## 1. État actuel (relevé du code)

| Zone | Aujourd’hui | Fichier |
| --- | --- | --- |
| Barre du bas | Loupe ronde à gauche de l’îlot, **seulement sur Explorer**. La coque prend la classe `bottom-nav-shell--search`, donc la barre change de largeur quand on passe d’À voir à Explorer. | `src/components/BottomNav.tsx`, `bottomNav.css` |
| Recherche | Barre flottante « Filtres \| Séries, films, acteurs… » empilée au-dessus de la navigation. Elle se masque en descendant et revient en remontant. En saisie, elle se place à 8 px du clavier et la navigation est masquée. | `src/components/DiscoverSearchDock.tsx`, `useSearchKeyboardDock`, `features/discover/searchKeyboardDock.ts` |
| Haut de page | Hero Top 10 (synopsis + « Voir plus », rangée de points), puis catégories, puis titre « Explorer » et bouton de tri « Populaires ▾ » (fenêtre « Trier les résultats »). | `DiscoverHero.tsx`, `DiscoverViewCore.tsx` |
| Résultats de recherche | Rangées Personnes / Séries / Films avec compteurs et « Voir tout », ou grille 3 colonnes. | `DiscoverViewCore.tsx` |
| Filtres | Une seule fenêtre longue : Type de contenu, Plateforme, Genre, Films · date de sortie (liste déroulante), Âge conseillé maximum, Note minimum. | `src/components/FilterModal.tsx` |
| Appui long | Bande-annonce YouTube en haut (lecture auto, son coupé), image en repli, puis badges, titre, synopsis et actions. | `GridMediaCard.tsx` (`PreviewModal`) |
| Remonter | Bouton flottant « Remonter tout en haut », en doublon de l’appui sur l’onglet actif. | `DiscoverViewCore.tsx` |

## 2. Ce qui ne change pas

- **Cartes :** `GridMediaCard` reste tel quel (image, note, plateforme, bouton dessous), ainsi que la grille en 3 colonnes.
- **Données et règles :**
  - catégories et leurs règles (`SEENIT-DISCOVER-001` Au cinéma, `SEENIT-DISCOVER-002` année, âge progressif) ;
  - pagination, caches, enrichissement des plateformes ;
  - convergence `plan_to_watch` à l’ajout ;
  - isolation par UID.
- **Gestes de la barre :** appui sur l’onglet actif (remonter ou fermer le niveau), double appui (réinitialiser) et appui long (Explorer ouvre la recherche).

## 3. Page Explorer

- **E-01 · Hero compact (368 px de haut) :**
  - **Repère :** onglet `#1` en or en haut à droite.
  - **Contenu en bas :** badges (`FILM` ou `SÉRIE`, plus `AU CINÉMA` selon `SEENIT-DISCOVER-001`), titre (38 px, 800, en capitales), puis une ligne « ★ note · 2 genres · plateforme ».
  - **Boutons :**
    - principal (or) : `+ Ajouter`, `✓ Dans À voir` ou `Reprendre S05 | E06`, selon la logique de reprise actuelle du hero ;
    - secondaire : `Bande-annonce`.
  - **Points :** dans le hero, sous les boutons. La rangée séparée disparaît.
  - **Synopsis :** supprimé du hero, avec « Voir plus ». Il reste dans l’aperçu et dans la fiche.
- **E-02 · Hero masqué :** quand la catégorie n’est pas « Tout », quand un filtre est actif, et en mode recherche.
- **E-03 · Rangée collante,** juste sous la zone système, opaque (`rgba(11,11,13,0.96)`), dans cet ordre :
  - **Loupe :** rond de 40 px, contour or 1,5 px, fond `rgba(229,169,61,0.18)`, halo `0 0 0 4px rgba(229,169,61,0.08)`, icône or de 20 px, `aria-label="Rechercher"`.
  - **Filtres :** rond de 40 px, fond `#1C1C1F`, avec une pastille or qui donne le nombre de filtres actifs.
  - **Catégories :** pastilles de 40 px (Tout, Séries, Films, Top 100, Pépites, Au cinéma, Documentaires, Personnes), qui défilent horizontalement.

  La rangée reste visible pendant tout le défilement.
- **E-04 · Retraits :** le titre « Explorer » et le bouton « Populaires ▾ » disparaissent. Le tri passe dans Filtres › Trier.
- **E-05 · Filtres actifs :** une rangée sous les catégories, seulement si au moins un filtre est actif.
  - **Pastilles :** chaque pastille (32 px, or translucide) a deux zones. Le libellé rouvre Filtres sur son onglet, la croix retire le filtre.
  - **Fin de rangée :** un lien `Tout effacer`.
  - **Libellés :** `Mes plateformes` (ou le nom de chaque plateforme), le genre, `★ 7,5+`, `Âge ≤ 13` ou `Tous publics`, `Après 2015`, et le tri s’il n’est pas « Populaires ».
- **E-06 · Grille :** inchangée (cartes, 3 colonnes, défilement infini).
- **E-07 · Barre du bas :** **aucune loupe, sur aucun onglet.**
  - **À retirer :** `bottom-nav-search` et la classe `bottom-nav-shell--search`.
  - **Résultat :** l’îlot garde exactement la même largeur et la même position sur À voir, Explorer et Moi (et avec Télécharger quand il est activé).
  - **Repli au défilement :** toujours aucun.
- **E-08 · Barre flottante :** la barre de recherche flottante au repos et le bouton flottant « Remonter tout en haut » disparaissent. Pour remonter, on touche l’onglet actif, comme aujourd’hui.

## 4. Recherche

- **E-10 · Entrée :** la loupe de la rangée collante (ou l’appui long sur l’onglet Explorer) passe en mode recherche.
  - **Ce qui s’efface :** le hero, la barre du bas et son fondu.
  - **Le champ :** il se place à 8 px du clavier, avec le calcul existant de `SEENIT-DISCOVER-003` (viewport visuel, sans double compensation). Il reçoit le focus et le clavier s’ouvre.
  - **Position :** celle de défilement d’Explorer est mémorisée.
- **E-11 · Barre de recherche :** de gauche à droite :
  - `‹` (52 px, « Quitter la recherche ») ;
  - le champ (52 px, arrondi, contour or quand il a le focus, loupe, saisie, `×` quand il y a du texte) ;
  - Filtres (52 px, avec sa pastille de compte).
- **E-12 · Champ vide :** la liste Explorer en cours reste visible au-dessus. La rangée des catégories reste affichée, sans la loupe ni Filtres, qui sont déjà dans la barre.
- **E-13 · Résultats en liste,** repris de la recherche du prototype SeenIt :
  - **Une ligne :** 64 px, vignette 36 × 54 (rayon 6), titre en 15 px, 600, `#d4d4d8`. Le premier passage qui correspond est en 800, `#F2C36B`, sans tenir compte des accents. La méta est en 12 px, `#71717a`.
  - **Sections, dans cet ordre :**
    1. **« Dans ta bibliothèque »** (libellé or, « instantané » à droite) :
       - séries et films de l’utilisateur, cherchés en local, sans réseau ;
       - méta `Série · 2008–2013 · 59/62` ou `Film · 2017` ;
       - à droite, une étiquette d’état de 24 px : `En cours`, `À commencer`, `À jour`, `Vu` ou `À voir` (fond or translucide pour `Vu` et `À jour`, `#27272a` sinon).
    2. **« Personnages »** (voir la question ouverte 1) :
       - avatar or de 36 px avec les initiales ;
       - `Nom · alias` (alias en `#71717a`), méta `Personnage · Breaking Bad · 62 ép.` ;
       - un résultat trouvé par l’alias s’affiche sans surlignage.
    3. **« Films et séries · TMDB »**, avec `N résultats · 0,3 s` à droite, ou `recherche…` et 2 lignes de squelette pendant le chargement :
       - résultats TMDB, sans les titres déjà dans la bibliothèque ;
       - méta `Film · 2008 · ★ 8,5` ;
       - à droite, un bouton rond de 44 px : `+` ajoute à À voir, `✓` en or retire ;
       - défilement infini, avec la pagination actuelle.
    4. **« Personnes · TMDB »** : photo ronde de 36 px (initiales en repli), nom surligné, rôle.
  - **Aucun résultat :** `Rien pour « … ».`
- **E-14 · Portée des filtres :** ils s’appliquent aux sections TMDB, pas à la bibliothèque ni aux personnages. Une catégorie incompatible avec la recherche repasse à « Tout » (`isSearchCompatibleCategory`, déjà existant).
- **E-15 · Fermer le clavier** (geste retour Android ou masquage du clavier) :
  - **Champ vide :** on quitte la recherche et on revient sur Explorer **exactement où on était** : même position de défilement, même catégorie, mêmes filtres. La barre du bas revient.
  - **Champ rempli :** les résultats restent et occupent l’écran. Le champ redescend à 30 px du bas (plus la zone sûre). La barre du bas reste cachée.
    - toucher le champ rouvre le clavier ;
    - `‹` quitte la recherche et vide la requête ;
    - `×` vide la requête et garde le focus.
  - **Geste retour quand le clavier est fermé :** il quitte la recherche.
- **E-16 · Touche « Rechercher » du clavier :** avec du texte, elle ferme le clavier (cas E-15, champ rempli). Champ vide : rien.
- **E-17 · Accessibilité :** cibles de 44 px au minimum. Le clavier matériel fonctionne (Entrée = E-16, Échap = E-15). Les sections ont des titres lisibles par les lecteurs d’écran.

## 5. Filtres

- **E-20 · Panneau :** il monte du bas, fait 476 px de haut, avec un rayon de 28 px. Le voile est léger (`rgba(0,0,0,0.38)`) pour qu’on voie la grille derrière.
  - **Effet immédiat :** les choix s’appliquent tout de suite et la grille change derrière le panneau.
  - **Bouton du bas :** `Afficher N titres`. Il affiche `Aucun titre avec ces filtres` s’il n’y a aucun résultat, et `Afficher les résultats` tant que le nombre n’est pas connu.
- **E-21 · Onglets :** `Trier`, `Plateformes`, `Genres`, `Note`, `Âge`, `Année`.
  - **Compteur :** chaque onglet porte une pastille or avec son nombre de choix.
  - **Onglet d’ouverture :** le dernier utilisé (« Plateformes » par défaut), ou celui de la pastille touchée (E-05).
  - **Réinitialiser :** dans l’en-tête, visible seulement s’il y a des filtres actifs.
- **E-22 · Trier :** 4 lignes de 52 px avec bouton radio : Populaires, Mieux notés, Plus récents, `A → Z` (l’« ordre alphabétique » actuel).
- **E-23 · Plateformes :**
  - **Interrupteur « Mes plateformes » :** il coche d’un coup les plateformes choisies dans Réglages, dont la liste s’affiche en sous-titre.
  - **Grille :** 4 colonnes de tuiles de 76 px pour les 7 plateformes actuelles (Netflix, HBO, Disney+, Apple TV+, Prime, Canal+, Max), avec les logos déjà embarqués. Une tuile choisie a un contour or et une coche.
- **E-24 · Genres :** grille de 3 colonnes de tuiles de 50 px, avec les 11 genres actuels (`GENRE_OPTIONS`).
- **E-25 · Note :** un curseur sur `RATING_OPTIONS` (Toutes → 9+), avec la valeur en grand : `★ 7,5 et plus` ou `Toutes les notes`.
- **E-26 · Âge :** un curseur sur `AGE_OPTIONS`, avec la valeur `Jusqu’à 13 ans`, `Tous publics` ou `Tous les âges`, et la note « Classification US TMDB. Un âge inconnu est exclu. » Les règles actuelles ne changent pas.
- **E-27 · Année :**
  - **Curseur :** de « Toutes » à l’année en cours, en passant par 1900, avec la valeur `Sortis après 2015`.
  - **Effet :** choisir une année active Films (`SEENIT-DISCOVER-002` inchangée).
  - **Saisie :** sur téléphone, le curseur est le contrôle principal ; la liste déroulante actuelle peut rester en repli accessible.
- **E-28 · Type de contenu :** cette section quitte le panneau. Les catégories (dont Top 100) restent dans la rangée collante.
- **E-29 · Même panneau partout :** le panneau est le même en mode recherche (accessible depuis le bouton Filtres de la barre de recherche).

## 6. Aperçu par appui long

- **E-30 · Bande-annonce en haut :**
  - **Comme aujourd’hui :** zone 16:9, lecture auto sans le son, image du titre en repli s’il n’y a pas de bande-annonce.
  - **Ajouts :**
    - pastille « BANDE-ANNONCE » en haut à gauche ;
    - bouton son de 40 px en haut à droite ;
    - durée et icône plein écran en bas à droite ;
    - barre de progression or de 3 px ;
    - toucher la vidéo ouvre le lecteur plein écran existant.
  - **À valider :** le bouton son et la progression demandent l’API IFrame de YouTube. Repli : garder les commandes YouTube et ne pas afficher ces deux éléments.
- **E-31 · Sous la vidéo :** titre (22 px, 800), une ligne « ★ note · Film ou Série · année · genres », puis le synopsis.
- **E-32 · Actions,** en lignes de 50 px :
  - **Première ligne (en or) :** `Ajouter à À voir`, `Retirer d’À voir` ou `Déjà vu` ;
  - **Deuxième ligne :** `Marquer comme vu` pour un film, `Voir les épisodes` pour une série ;
  - **Dernière ligne :** `Ouvrir la fiche`.

  La ligne « Bande-annonce » disparaît, puisque la vidéo passe déjà en haut.
- **E-33 · Fermeture :** toucher en dehors (voile flouté) ou geste retour. La lecture s’arrête et le son est recoupé à la prochaine ouverture.

## 7. Repères visuels

- **Couleurs :**
  - or `#E5A93D`, or clair `#F2C36B` ;
  - fond `#0B0B0D` ;
  - surfaces `#141417` et `#1C1C1F`, bordures `rgba(255,255,255,0.08)` ;
  - texte secondaire `#a1a1aa`, texte tertiaire `#71717a`.
- **Police et rayons :** Plus Jakarta Sans. Pastilles de 40 px (rayon 20), panneau de rayon 28, lignes de liste de 64 px.
- **Mouvements :** 160 à 200 ms (apparition du panneau, du clavier, du champ).

## 8. Critères d’acceptation

1. **Barre identique :** en passant d’À voir à Explorer puis à Moi, la position et la largeur de chaque onglet ne changent pas d’un pixel (test de géométrie), avec et sans l’onglet Télécharger.
2. **Loupe toujours là :** la loupe de la rangée collante reste visible à toute profondeur de défilement, avec une cible d’au moins 40 px et un contraste or.
3. **Entrée en recherche :** la loupe ouvre le mode recherche avec le focus, le champ à 8 px du clavier, sans hero ni barre du bas.
4. **Clavier fermé, champ vide :** retour sur Explorer à la même position de défilement (à ±1 px), même catégorie, mêmes filtres, barre revenue.
5. **Clavier fermé, avec texte :** les résultats restent, le champ est en bas, la barre reste cachée. `‹` quitte la recherche et vide la requête.
6. **Ordre des sections :** bibliothèque (instantanée, sans requête réseau), personnages, TMDB, personnes. Le surlignage ignore les accents (« atre » trouve « Atréides »).
7. **Ajout depuis une ligne :** le `+` d’une ligne TMDB ajoute en `plan_to_watch` sans ouvrir la fiche, et passe à `✓`.
8. **Filtres en direct :** un choix met la grille à jour sans fermer le panneau. Le compte du bouton suit. Toucher une pastille active rouvre le bon onglet.
9. **Mes plateformes :** l’interrupteur coche exactement les plateformes des Réglages, et le décocher les retire toutes.
10. **Année :** choisir une année active Films (`SEENIT-DISCOVER-002` vert).
11. **Aperçu :** la vidéo démarre sans le son et l’image s’affiche quand il n’y a pas de bande-annonce. Les 3 actions marchent.
12. **Non-régression :** les cartes, Au cinéma, l’âge progressif, la pagination, l’isolation par UID et les gestes de l’onglet actif sont inchangés.

## 9. Questions ouvertes (ne pas trancher seul)

1. **Personnages :** TMDB ne cherche pas par nom de personnage. Il faut choisir une source (index côté serveur construit à partir des génériques des titres suivis, ou autre). En attendant, la section reste masquée.
2. **Bouton `+` sur les lignes TMDB :** il est proposé pour garder l’ajout rapide des cartes. À confirmer.
3. **Hero et filtres :** faut-il bien masquer le hero dès qu’un filtre est actif ?
4. **Synopsis :** son retrait du hero (et de « Voir plus ») est à confirmer.
5. **Bouton son et progression de l’aperçu :** ils dépendent de l’API IFrame YouTube (E-30).
6. **Bouton « Remonter tout en haut » :** son retrait est à confirmer, puisqu’il double l’appui sur l’onglet actif.

## 10. Contenu du paquet

- `SPEC-EXPLORER-REFONTE.md` : ce document.
- `README.md` : ordre de lecture et message type pour l’agent.
- `design/rendus/` : un PNG par écran (01 à 10), le parcours de recherche, et la page entière en aperçu.
- `design/sources/` : `SeenIt Explorer.dc.html` (la page de la toile, avec le prototype) et son runtime `support.js`.

## Complément reçu le29octobre

Voir la [fiche personnage 4c](explorer-personnage-2026-10-29.md), personnage de fiction distinct de l’acteur. Le périmètre de la source est soumis au propriétaire ; le repli masqué reste actif dans E-01..33 tant que cet index n’existe pas.

## Précisions de non-régression issues de la revue

Un résultat TMDB déjà suivi reste visible si son titre alternatif ne correspond pas à la recherche locale. La déduplication concerne uniquement les entrées locales réellement affichées. Annuler un retrait restaure le document sous son identifiant d’origine et le même compte, puis remet à jour le store local sans attendre le listener.
