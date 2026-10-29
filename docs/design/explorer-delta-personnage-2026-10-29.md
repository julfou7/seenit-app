# SeenIt · delta « Explorer intégré + fiche personnage »

Version du 29/10/2026. Destinataire : l’agent de développement IA qui travaille dans `seenit-app`.
Ce document complète le paquet « refonte Explorer » du 28/10 (`SPEC-EXPLORER-REFONTE.md`). Il ne le remplace pas. Même base de code : `main` au commit `bc571c2`.

## 0. Comment utiliser ce document

- **Ce qui change depuis le 28/10 :**
  1. **Un nouvel écran, la fiche personnage** (P-01 à P-12). C’est la fiche 4c de la planche v4, reprise telle quelle.
  2. **Trois précisions sur l’Explorer** : E-13 est modifiée, E-18 et E-19 sont nouvelles, et E-01 reçoit une précision.
  3. Tout le reste du paquet du 28/10 est inchangé (E-01 à E-33, critères, questions ouvertes).
- **Source visuelle :** `design/rendus/*.png`, en 412 × 892 et en résolution ×2.
  - `00-Parcours-fiche-personnage.png` : le parcours complet et les variantes.
  - Les autres fichiers : un écran chacun.
  - Les affiches sont des aplats de couleur, parce que les images TMDB ne se chargent pas dans la toile.
- **Prototype :** la page « SeenIt Prototype » de la toile. L’onglet Explorer est la version validée, et la recherche « saul », « walter » ou « paul » mène à la fiche personnage.
- **Sources :** `design/sources/prototype-delta/` contient seulement les morceaux du prototype qui ont changé (gabarits et logique). Ce ne sont pas des fichiers exécutables : ils servent à relever les valeurs exactes.
- **Règles du dépôt :** applique `AGENTS.md`. La fiche personnage est une nouvelle fonction, donc une Demande durable à traiter « SPEC avant code ».
  - Inscris-la dans le registre.
  - Crée l’exigence au catalogue (par exemple `SEENIT-CHARACTER-001`).
  - Mets à jour `SEENIT-DISCOVER-003` pour E-13, E-18 et E-19.
- **Identifiants :** reprends `P-xx` et `E-xx` dans les commits, les tests et le catalogue.
- **Hors périmètre, comme le 28/10 :** l’onglet Télécharger et son contenu, les cartes (`GridMediaCard`) et les fiches média.
- **« À valider » :** la faisabilité n’est pas prouvée. Implémente le repli décrit et ouvre une issue pour la cible.

### 0.1 Lots de livraison

Ces lots suivent les lots 1 à 4 du paquet du 28/10.

1. **Lot 5 · Précisions Explorer :** E-13 modifiée, E-18, E-19 et la précision sur E-01.
2. **Lot 6 · Fiche personnage, interface :** P-01 à P-12, avec les données déjà disponibles et les replis du §3.
3. **Lot 7 · Données personnage côté serveur (à valider) :** index de recherche, normalisation des alias, progression exacte et « Il croise le plus » (§3).

## 1. Explorer : ce qui change

- **E-13 (modifiée) · Section « Personnages » :**
  - **Ouverture :** chaque ligne ouvre la fiche personnage (P-01).
  - **Repère :** un chevron de 18 px (`#71717a`) à droite de la ligne.
  - **Personnage sans fiche** (par exemple plusieurs interprètes, question 5) : pas de chevron. Le toucher affiche un message court.
  - **Toujours conditionnée** à la source des personnages (question ouverte 1 du 28/10). Sans source, la section reste masquée.
- **E-01 (précision) · Bouton « Bande-annonce » du hero :** il ouvre l’aperçu E-30 du titre, le même que l’appui long.
  - **Repli :** garder le lecteur plein écran actuel.
- **E-18 (nouvelle) · Toasts en mode recherche :**
  - **Placement :** au-dessus du champ de recherche, jamais sous le clavier ni sur le champ.
  - **Valeurs du prototype :** 372 px du bas clavier ouvert, 96 px clavier fermé.
- **E-19 (nouvelle) · Ouvrir un résultat :**
  - **À l’ouverture :** toucher un résultat ferme le clavier, puis ouvre la fiche.
  - **Au retour :** on retrouve la liste, avec la même requête, le clavier fermé et le champ en bas (cas « avec texte » de E-15).

## 2. Fiche personnage (nouvel écran)

Repère visuel : `04-Fiche-personnage-Saul.png`.

- **P-01 · Entrées :**
  - **Recherche Explorer :** une ligne de la section « Personnages » (obligatoire).
  - **Autre fiche personnage :** un personnage de « Il croise le plus » qui a sa propre fiche (P-07).
  - **Fiche série (optionnel) :** la liste des personnages, si la fiche en affiche une. Le prototype le fait pour Breaking Bad.
- **P-02 · En-tête de 260 px :**
  - **Fond :** l’image du titre principal du personnage, floutée (flou 18 px, saturation 1,2, opacité 0,6), puis un dégradé vers `#09090b`.
  - **Vignette :** 92 × 116 px, rayon 16, contour `0 0 0 2px #09090b, 0 0 0 3px rgba(229,169,61,0.6)`. Elle affiche les initiales en 26 px, 800 (question 6).
  - **Textes, dans l’ordre :**
    - « Personnage · univers Breaking Bad » (12 px, 700, `#E5A93D`) ;
    - le nom (28 px, 800, interlettrage −0,03 em) ;
    - les alias (13 px, `#a1a1aa`), au format « alias Jimmy McGill · Gene Takavic ».
- **P-03 · Barre du haut :**
  - **À gauche :** le bouton retour habituel.
  - **À droite :** un cœur de 44 px, « Suivre ce personnage ». Il est rempli d’or quand le personnage est suivi. Son effet est la question 4.
- **P-04 · « Joué par » :**
  - **Ligne :** marge interne 8 px, rayon 14, fond `rgba(24,24,27,0.7)`.
  - **Contenu :** un avatar rond de 40 px (photo de l’interprète, initiales en repli), « Joué par » (12 px, `#71717a`), le nom (14 px, 700) et un chevron.
  - **Action :** ouvre la fiche acteur existante.
  - **Plusieurs interprètes :** voir la question 5.
- **P-05 · Chiffres :** trois tuiles en grille de 3 colonnes (écart 8 px, marge interne 10 px, rayon 12) :
  1. **Total :** « 106 » et « épisodes », ou « 3 » et « films » ;
  2. **Période :** « 2009→22 » et « 13 ans », de la première à la dernière apparition ;
  3. **Progression :** « 63/106 » et « vus par toi », en or (fond `rgba(229,169,61,0.12)`, contour or à 35 %).
- **P-06 · « Son parcours » :** une carte par titre, dans l’ordre chronologique.
  - **Carte :** marge interne 10 px, rayon 16, fond `rgba(24,24,27,0.7)`, contour blanc à 8 %.
  - **Contenu :**
    - affiche de 48 × 72 px, rayon 8 ;
    - titre (15 px, 700) ;
    - à droite, « 43 ép. » pour une série ou l’année pour un film ;
    - la plage (12 px, `#71717a`) ;
    - une barre de 4 px en or ;
    - l’état (12 px, 700).
  - **Plage d’une série :**
    - format `S02 | E08 « Better Call Saul » → S05 | E15` ;
    - les titres d’épisode entre guillemets sont facultatifs (première ou dernière apparition) ;
    - si le personnage apparaît dans 3 épisodes ou moins de la série, on liste ces épisodes : « S06 | E11 et S06 | E13 ».
  - **États d’une série :**
    - « Vu en entier » (or) ;
    - « 20/63 · reprendre S03 | E01 » (blanc), où « reprendre » désigne le premier épisode non vu du personnage dans la série ;
    - « Pas encore vu · S06 | E11 » (blanc).
  - **Film :**
    - plage : « Film · 2 h 35 », ou la date de sortie en salle ;
    - états : « Vu » (or), « Dans À voir », « À voir », « Au cinéma · rappel possible » ou « Rappel activé ».
  - **Action :** toucher la carte ouvre la fiche du titre.
- **P-07 · « Il croise le plus » :**
  - **Contenu :** 4 personnages au plus, sur une ligne. Pour chacun :
    - un cercle de 56 px (initiales, ou photo de l’interprète) ;
    - le nom (12 px, 700, centré) ;
    - « 63 ép. » ou « 2 films » (11 px, `#71717a`).
  - **Personnage qui a sa fiche :** contour or de 1,5 px, et le toucher ouvre sa fiche.
  - **Masquage :** la section est masquée tant que le calcul n’existe pas (P-11).
- **P-08 · Mise à jour :** si on marque un épisode ou un film vu ailleurs, P-05 et P-06 sont à jour au retour sur la fiche.
- **P-09 · Retour :** il ramène à l’écran précédent : les résultats (E-19), une fiche ou une autre fiche personnage. La pile fonctionne comme pour les autres fiches.
- **P-10 · Chargement :**
  - **En-tête :** affiché dès que le nom et l’univers sont connus.
  - **Squelettes :** P-05 et P-06 en ont pendant le chargement.
- **P-11 · Données partielles :**
  - **Sans croisement :** P-07 est masquée.
  - **Sans progression exacte :** on affiche le repli du §3, sans « reprendre ».
- **P-12 · Accessibilité :**
  - **Cibles :** 44 px au minimum.
  - **Libellés :** les lignes portent un libellé lisible (« Joué par Bob Odenkirk », titre et état pour chaque carte).
  - **Sections :** « Son parcours » et « Il croise le plus » sont des titres de section.

## 3. Données

| Élément | Source | Statut |
| --- | --- | --- |
| Nom, alias, univers | Chaînes `character` des génériques TMDB : `roles[].character` de `/tv/{id}/aggregate_credits`, `cast[].character` de `/movie/{id}/credits`. Elles sont découpées sur « / », normalisées puis fusionnées dans un univers (collection TMDB pour les films, groupe de séries liées). | Nouveau dev · question 2 |
| Recherche par nom de personnage | TMDB ne cherche pas les personnages (`/search/person` cherche des personnes). Il faut un index côté serveur. | Question 1 du 28/10, toujours ouverte |
| Interprète | Le même crédit (`id`, `profile_path`). | Données déjà là |
| « 43 ép. » par série | `aggregate_credits` → `roles[].episode_count`. | Données déjà là |
| « vus par toi », « reprendre », période exacte | Croiser la liste des épisodes du personnage avec l’historique. | À valider, voir ci-dessous |
| « Il croise le plus » | Crédits par épisode, avec les co-apparitions comptées par paire. Calcul côté serveur, une fois par série, mis en cache. | Nouveau dev |
| Suivre un personnage | Stocké avec le profil, isolé par UID. | Question 4 |

- **Correction de la note de la planche v4 :** `aggregate_credits` donne le **nombre** d’épisodes d’un personnage, pas **lesquels**.
  - **Cible (à valider) :** pour un « 63/106 » exact et pour « reprendre », il faut les crédits par épisode (`/tv/{id}/season/{n}/episode/{e}/credits`). Calcule-les côté serveur, avec le même travail que « Il croise le plus », puis mets-les en cache.
  - **Repli du lot 6 :** la progression se calcule par saison avec `/tv/{id}/season/{n}/aggregate_credits`.
    - **Exacte :** quand le personnage est dans tous les épisodes de la saison.
    - **Sinon :** proportionnelle (épisodes vus de la saison × part du personnage dans la saison), affichée sans « reprendre ».
- **Chiffres du prototype :** les valeurs (106, 63, 38…) sont des exemples. Les vraies viennent du calcul.

## 4. Critères d’acceptation

1. **Depuis la recherche :** taper « saul », toucher la ligne Personnages. La fiche s’ouvre en un geste, clavier fermé. Le retour ramène aux résultats avec « saul » (E-19).
2. **Chiffres cohérents :** le total est la somme des épisodes (ou des films) du parcours. « Vus par toi » est la somme des vus de chaque carte.
3. **Reprendre :** l’épisode proposé est le premier non vu du personnage dans la série, pas le prochain épisode de la série.
4. **Mise à jour :** si on marque un épisode vu puis qu’on revient, P-05 et P-06 changent sans recharger l’app.
5. **Joué par :** ouvre la fiche acteur existante. Le retour ramène à la fiche personnage.
6. **Il croise le plus :** la section est masquée sans calcul. Un personnage qui a sa fiche l’ouvre, les autres ne font rien de trompeur.
7. **Films :** un personnage de films (Paul Atréides) affiche « films » dans la tuile, les années et les états de film.
8. **Toasts :** en mode recherche, un ajout depuis une ligne TMDB affiche le toast au-dessus du champ, clavier ouvert comme fermé (E-18).
9. **Non-régression :** les exigences du 28/10 (E-01 à E-33), les cartes, les fiches média, la fiche acteur et l’onglet Télécharger sont inchangés.

## 5. Questions ouvertes (ne pas trancher seul)

1. **Source des personnages :** c’est la question 1 du 28/10. La fiche en dépend aussi : sans source, pas d’entrée.
2. **Normalisation et univers :** quelles règles pour fusionner « Saul Goodman / Jimmy McGill » et rattacher des titres à un même univers (collection TMDB, personnages communs, table éditée à la main) ? Qui corrige une mauvaise fusion ?
3. **Progression exacte :** le coût des crédits par épisode (appels TMDB, cache, fréquence de mise à jour) est-il acceptable ? Sinon, le repli par saison suffit-il ?
4. **Suivre un personnage :** que fait le cœur ? Prévenir d’une nouvelle apparition, nourrir les recommandations, ou seulement un favori ? Repli : un favori stocké avec le profil, sans notification.
5. **Plusieurs interprètes** (Batman, Spider-Man) : hors du lot 6. La ligne « Joué par » affiche l’interprète principal. Faut-il une liste d’interprètes dans un second temps ?
6. **Image du personnage :** TMDB n’a pas d’image de personnage. Repli : initiales sur le fond du titre. Faut-il utiliser la photo de l’interprète à la place ?

## 6. Contenu du paquet

| Élément | Contenu |
| --- | --- |
| `DELTA-EXPLORER-PERSONNAGE.md` | Ce document |
| `design/rendus/00-Parcours-fiche-personnage.png` | Le parcours (recherche → fiche → Joué par) et les variantes |
| `design/rendus/01` à `09` | Un écran par fichier (repos Explorer, recherche « saul », fiches Saul, Walter et Paul, suivi, fiche acteur, toast) |
| `design/sources/prototype-delta/explorer.template.html` | Gabarit de l’onglet Explorer, puis les calques au-dessus (champ de recherche, clavier, panneau Filtres, aperçu) |
| `design/sources/prototype-delta/explorer.logic.js` | Données de démonstration et logique de l’Explorer |
| `design/sources/prototype-delta/fiche-personnage.template.html` | Gabarit de la fiche et bouton cœur de la barre du haut |
| `design/sources/prototype-delta/fiche-personnage.logic.js` | Données des trois personnages, calcul du parcours, et deux interprètes ajoutés à la démonstration |
