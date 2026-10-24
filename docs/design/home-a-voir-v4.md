# SeenIt : spec dev v4, à appliquer depuis l'export « Acteurs » (handoff-acteurs)

Maquette de référence : `SeenIt Prototype.dc.html`, avec les composants `SeenIt Card8f.dc.html` (carte série) et `SeenIt Row.dc.html`.
**La maquette fait foi.** Les valeurs ci-dessous sont celles du prototype au 24/10/2026.
Non concerné : les données de démo du prototype (séries ajoutées, affiches TMDB approximatives). En prod, tout vient de TMDB et des stores.

---

## 0. Corrections à apporter à `handoff-accueil/ECARTS-PROD.md`

| Point | Décision |
|---|---|
| 1. Position du badge | **Annulé.** On garde le badge **sur la ligne du code** (comme en prod), mais avec les **badges emoji** (§2.3). |
| 3. Compteurs dans les titres de section | **Annulé.** On garde la pastille compteur à côté du titre (§1.2). |
| 2, 4, 5, 6, 7 | Inchangés. |

---

## 1. Onglet À Voir : rythme global (3 sous-onglets)

### 1.1 Espacements

| Élément | Valeur |
|---|---|
| Padding horizontal de page | 16 px |
| Entre les sous-onglets (segmented) et le 1er titre de section | gap de 14 px + rangée titre de 40 px. Le premier titre tombe **au même y dans À regarder, À venir et Historique** (±1 px) : pas de saut au changement d'onglet. |
| Entre deux sections | **28 px partout** : Continuer → Nouveautés → Films à voir → Pas vu depuis, groupes d'À venir, périodes de l'Historique |
| Titre de section → contenu | 6 px + 6 px de margin du rail ou de la liste (la carte 8f ajoute ses 20 px de débord d'affiche) |
| Entre deux cartes séries en **liste verticale** | **14 px** (À regarder et À venir). Avant : 6 px, l'affiche touchait la carte du dessus. |
| Entre deux cartes en carrousel | 10 px |
| Entre deux lignes de l'Historique | 8 px |
| Bas de page | padding de 8 px + réserve de **74 px** pour la nav flottante (au lieu de 24 + 84). Le vide sous la dernière carte ≈ le vide au-dessus du 1er titre. |

### 1.2 Titre de section (identique dans les 3 sous-onglets)
- Rangée `display:flex; align-items:center; height:40px`.
- Titre : 20 px / 800, `letter-spacing:-0.025em`, `line-height:1`, `text-box:trim-both cap alphabetic`, nowrap, blanc.
- À regarder : pastille compteur 22 px (radius 11, `rgba(255,255,255,.08)`, 12 px/800 `#D4D4D8`) et switch carrousel/liste à droite. Pas de compteur dans À venir ni dans l'Historique.
- **À venir** : « Aujourd'hui », « Cette semaine », « Plus tard » passent dans ce gabarit. Avant : 13 px gris.
- **Historique** : même gabarit pour le libellé de période. Le bilan passe **dessous** (§4.2).

---

## 2. Carte série 8f (`SeriesEpisodeCard`) : changements

### 2.1 Géométrie
- Hauteur racine **constante 170 px** (20 de débord + 150 de carte), **avec ou sans badge**. Avant : 184 px avec badge, d'où des écarts irréguliers entre cartes.
- **Bloc texte** (titre, code, épisode) : `top:8px; bottom:34px; justify-content:center`, centré verticalement entre le haut de la carte et la barre. Avant : collé en haut.
- **Barre de saison** : `bottom:7px; height:26px; align-items:center`. La rangée est centrée entre le bas de l'affiche inclinée (~111 px) et le bas de la carte (150 px). Hauteur fixe même sans logo diffuseur.

### 2.2 Voile gauche (met l'affiche en valeur)
- Calque dans le fond de la carte, après le dégradé existant : `left:0; top:0; bottom:0; width:34%; border-radius:22px 0 0 22px`.
- `background: linear-gradient(90deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.40) 45%, rgba(0,0,0,.18) 75%, transparent 100%)`.
- **Pas de `backdrop-filter`** : testé sur Android WebView, le flou casse l'arrondi en bas à gauche (coin carré).

### 2.3 Badges : retour aux badges emoji, **sur la ligne du code**
- Position : `S05 · E06` puis le badge, dans la même rangée flex (`column-gap:6px; flex-wrap:wrap`). **Plus sous le titre de l'épisode.**
- Style : `inline-flex; gap:4px; height:22px; padding:0 8px; radius:7px; 11px/800; line-height:1; nowrap`.
  - Normal : fond `rgba(9,9,11,.82)`, texte `#F4F4F5`, `inset 0 0 0 1px rgba(255,255,255,.14)`.
  - **Chaud** (sorti aujourd'hui) : fond `rgba(251,146,60,.22)`, texte `#FED7AA`, bord `rgba(251,146,60,.6)`, animation `sbPulse 1.6s ease-in-out infinite` (scale 1 → 1.06 + halo orange). Coupée si `prefers-reduced-motion` ou si le réglage « badges animés » est off.
- Catalogue des textes, courts pour tenir à côté du code :

| Situation | Badge |
|---|---|
| Plus que N épisodes avant la fin | `⚡ Plus que N` |
| N épisodes disponibles d'un coup | `🍿 N dispo` |
| Dernier épisode de saison | `🎬 Fin de saison` |
| Nouvelle saison disponible | `🆕 SN dispo` |
| Pas vu depuis X semaines | `⏳ X sem.` |
| Sorti aujourd'hui | `🔥 Sorti aujourd'hui` (chaud) |
| Sorti hier | `🌟 Sorti hier` |
| Sorti il y a N jours | `🆕 Il y a N j` |
| Final de série | `🏁 Final` |
| Nouvelle série | `🆕 Nouveau` |

- Un seul badge par carte. Priorité : chaud > final > fin de saison > dispo > récence.

---

## 3. Pagination des sections (séries et films)

### 3.1 Carrousel (vue par défaut)
- **6 cartes**, puis en dernière position une **tuile « Afficher plus »** : 150 px de large, `scroll-snap-align:start`, radius 22.
  - Fond `rgba(24,24,27,.7)`, bordures `inset 0 0 0 1px rgba(255,255,255,.1)` et `inset 0 1px 0 rgba(255,255,255,.08)`.
  - Au centre : 3 mini-affiches rondes de 40 px qui se chevauchent (-10 px, anneau 2 px `#0B0B0E`), puis « Afficher 6 de plus » (14 px/800), puis « N en attente » (12 px/600 `#71717A`).
  - Libellé : « Afficher 6 de plus » s'il reste plus de 6 titres, « Afficher les N » s'il en reste 2 à 6, « Afficher la dernière » (séries) ou « Afficher le dernier » (films) s'il n'en reste qu'un.
  - Un tap ajoute 6 cartes dans le **même carrousel**.
- Séries : la tuile fait 156 px de haut, `margin-top:20px` (alignée sur la carte).
- **Films à voir** : même tuile, hauteur **212 px** (hauteur de l'affiche du billet).
- **Supprimé** : la tuile « Voir en liste » en fin de carrousel. On passe en liste uniquement par le switch à côté du titre.

### 3.2 Liste verticale
- **3 cartes** au premier affichage, puis la pastille **« Afficher plus »** pleine largeur ajoute **6 cartes** à chaque tap (3 → 9 → 15…).
- Pastille : 52 px, radius 26, même fond et mêmes bordures que la tuile, mini-affiches de 30 px (-8 px), libellé 14 px/700, « N en attente » à droite.
- **Supprimé** : le bouton « Revenir en carrousel ». Le retour se fait par le switch du titre, qui remet la pagination à zéro.

---

## 4. Historique : la frise chronologique (refonte complète)

Remplace la liste actuelle (vignette d'épisode 92×52).

### 4.1 Données et regroupement
- Source : l'historique réel (épisodes et films vus), du plus récent au plus ancien, films et séries mélangés.
- **Regroupement** : les épisodes **consécutifs** d'une même série vus **le même jour** forment **une seule ligne**. Un film ne se regroupe jamais.
- **Périodes**, calculées par rapport à aujourd'hui (fuseau local) :

| Écart | Libellé |
|---|---|
| 0 j | Aujourd'hui (en **or**) |
| 1 j | Hier |
| 2 à 6 j | Cette semaine |
| 7 à 13 j | La semaine dernière |
| ≥ 14 j, mois en cours | Plus tôt en {mois} |
| mois précédents | {Mois} (« Septembre », « Août »…) |

### 4.2 En-tête de période
- Libellé : gabarit titre de section (§1.2), dans une rangée de 40 px.
- Dessous, le **bilan** en 12 px/700 `#A1A1AA` tabular : « 4 épisodes · 1 film · **6 h 05** » (la durée en blanc). Durée = Σ `runtime` (films) + Σ `episode_run_time` × épisodes.
- Pas de badge ni d'emoji dans l'en-tête (le « Binge » a été testé puis **abandonné**, ne pas implémenter).

### 4.3 La frise
- Chaque période est un bloc `position:relative; padding:0 0 28px 30px`.
- **Ligne verticale** : `left:10px; top:20px; bottom:0; width:2px`, couleur `#27272A`. La dernière période se termine par un dégradé vers transparent.
- **Losange de période** : 12×12, `rotate(45deg)`, radius 3, `left:5px; top:14px`, avec un anneau `0 0 0 4px` couleur fond. Couleur : or `#E5A93D` pour Aujourd'hui, `#71717A` sinon.
- **Point par ligne** : 10 px, centré verticalement sur la carte, sur la ligne. Couleur : or avec halo `0 0 0 4px rgba(229,169,61,.22)` pour aujourd'hui, `#3F3F46` sinon, anneau couleur fond.

### 4.4 Carte de ligne (96 px)
- `height:96px; radius:18px`, `align-items:stretch`, `padding:0 12px 0 0`, gap de 14 px.
- Fond : teinte de l'affiche, `linear-gradient(100deg, oklch(.32 .07 H / .42) 0%, oklch(.20 .04 H / .14) 55%, transparent)`, sur `rgba(20,20,24,.72)`, avec `inset 0 0 0 1px rgba(255,255,255,.07)`.
- **Image : l'affiche de la série ou du film, plus l'image d'épisode.**
  - 64 px de large, **pleine hauteur**, collée au bord gauche, `border-radius:18px 0 0 18px`, cover.
  - Petit fondu à droite : 18 px, `transparent → rgba(20,20,24,.55)`.
- **Ligne groupée** : pastille or « ×N » en bas à gauche de l'affiche (22 px, radius 11, `#E5A93D`, texte `#0B0B0F` 11 px/900).
- Texte, colonne centrée verticalement :
  1. Titre série ou film : 15 px/800 **or** `#F2C36B`, 1 ligne avec ellipse.
  2. Code + date : `S05·E13` en blanc 800 · « 13 oct. » en `#A1A1AA`, ou en or pour aujourd'hui. Groupe : `S05·E11 → E13` (même saison) ou `S04·E12 → S05·E02` (deux saisons).
  3. Détail, 13 px `#D4D4D8`, 2 lignes max :
     - épisode seul : le titre de l'épisode ;
     - groupe : « N épisodes d'affilée », **sans titre d'épisode** ;
     - film : le premier genre. Pas de « Film », pas d'année.
- À droite : pastille SeenIt « vu » de 26 px, or. Pour les visionnages du jour, animation `hdStamp .32s` à l'apparition.

### 4.5 Interactions
- Tap sur un épisode seul : ouvre la fiche épisode. Tap sur un groupe : ouvre la fiche série. Tap sur un film : ouvre la fiche film.
- Appui long ou clic droit : feuille d'actions (inchangée).
- **10 lignes** au départ (un groupe compte pour une ligne), puis pastille « Afficher plus » au format §3.2 : « Afficher 10 de plus » ou « Afficher les N », mini-affiches des 3 lignes suivantes, « N en attente ».
- Vide (aucun visionnage) : « Rien de vu pour l'instant », avec un lien vers Explorer.

---

## 5. Fiche acteur (remplace la mini-fiche popup)

Toucher la ligne acteur d'un billet « Films à voir » ouvre **directement la fiche acteur plein écran**, poussée dans la pile de navigation (retour Android = fermer). La popup de la spec acteurs §6 est **abandonnée**. Les règles du billet (§1 à §5 de `SPEC-ACTEURS-FILMS.md`) restent valables.

### 5.1 Règle anti-doublon (constatée en prod)
**Un titre n'apparaît qu'une seule fois sur la fiche**, et un compteur n'est affiché qu'à un seul endroit.
- Pas de pastilles « 5 titres vus », « 10 h ensemble », « 368 films et séries » : tout passe dans le bloc « Ton lien ».
- Pas de rôle dans l'en-tête (« Maui dans Vaiana ») : le rôle est sur chaque titre.
- Pas de durée sur les titres déjà vus.
- Rôles en **français** (TMDB `language=fr-FR`), « (voice) » remplacé par « · voix ». **Une ligne** avec ellipse.

### 5.2 Structure (de haut en bas)
1. **En-tête** de 290 px.
   - Fond : backdrop du premier titre vu ensemble, sinon du film d'origine, en opacité .5, avec un dégradé vers `#09090B`.
   - En bas à gauche : portrait 96×120, radius 18, anneau or s'il est favori (`0 0 0 3px #E5A93D`), sinon `0 0 0 2px rgba(255,255,255,.18)`.
   - À côté : nom en 28 px/800, puis « Acteur · 30 ans · New York » en 13 px `#A1A1AA` (`known_for_department`, âge à partir de `birthday`, `place_of_birth`).
   - Bouton cœur de 44 px à droite : ajoute ou retire des favoris (`favoritePeopleStore`), avec un toast.
2. **Ton lien** : carte radius 20 avec un liseré or léger.
   - Anneau SeenIt de 64 px en `conic-gradient` or : la part de sa filmographie vue, minimum 4 % si au moins un titre est vu. Au centre, « 2 » en 20 px/800 or, puis « sur 22 » en 9 px.
   - À droite : « Ton lien avec {Prénom} », puis « N titres vus · X h ensemble », puis « Dernier vu : {titre} · {mois} ». S'il est favori : « Favori · ses nouveaux projets te sont signalés » en or.
   - Si rien n'est vu : « Pas encore croisé » et « Commence par ce qui est dans ta liste ».
3. **Bientôt**, si au moins un titre a une date de sortie future dans `combined_credits`.
   - Ligne au format À venir : affiche 48×72, titre, puis « Au cinéma · 18 déc. » ou « Netflix · 4 nov. ».
   - Bloc **J-X** neutre identique à À venir, avec la pastille cloche. Un tap active ou coupe le rappel.
4. **À voir avec lui** : titres non vus, **ceux de la liste en premier**, 4 maximum.
   - Ligne de 80 px : affiche 48×72, titre en or sur 2 lignes, puis logo diffuseur 18 px + « rôle · fin à HH:MM » (film) ou « rôle · N saisons » (série).
   - À droite : le signet or si le titre est dans la liste, sinon un bouton « + À voir ».
5. **Vus ensemble** : rail d'affiches 104×156, `align-items:flex-start`.
   - Titre sur 2 lignes dans une **hauteur fixe de 32 px**, pour que les affiches soient alignées.
   - Rôle sur 1 ligne. Coche SeenIt en bas à droite de l'affiche.
   - Pas de compteur dans le titre de section.
6. **Le reste de sa filmographie** : `combined_credits` **moins** les titres déjà affichés en 3, 4 et 5.
   - Grille de 3 colonnes 2:3, gap 10/8.
   - Sur chaque affiche : un voile et une coche si le titre est vu, un signet s'il est dans la liste. Dessous, le rôle (12 px/700) et l'année (11 px).
   - Filtres **Tout / Films / Séries**, affichés **uniquement si films et séries coexistent** dans cette liste. Filtre « Non vus » affiché **uniquement si au moins un titre de la grille est vu**.
   - 9 titres au départ, puis « Afficher 9 de plus ». Pas de compteur total : il est déjà dans l'anneau.
   - Section masquée si la liste est vide.
7. **Biographie** (TMDB fr-FR, sinon en) : 3 lignes. « Lire la suite » n'apparaît que si la bio dépasse 3 lignes.

### 5.3 Données
| Donnée | Source |
|---|---|
| Fiche, `birthday`, `place_of_birth`, `biography` | `/person/{id}?language=fr-FR` |
| Filmographie et rôles | `/person/{id}/combined_credits?language=fr-FR`, tri par popularité, dédoublonnée par média |
| Vu / dans la liste | `showsStore` (série avec au moins un épisode vu = vu) |
| Heures ensemble | Σ `runtime` des films vus + `episode_run_time` × épisodes vus |
| Dernier vu | date de visionnage la plus récente parmi ses titres |
- Tout est mis en cache par personne. Pas de skeleton plein écran : l'en-tête et « Ton lien » s'affichent avec le cache, la grille se complète ensuite.

---

## 6. Récapitulatif des suppressions
- Tuile « Voir en liste » en fin de carrousel.
- Bouton « Revenir en carrousel ».
- Badges sans emoji (pilules colorées avec glyphe) : remplacés par les badges emoji.
- Hauteur de carte +14 px quand elle porte un badge.
- Vignette d'épisode dans l'Historique : remplacée par l'affiche.
- Titre d'épisode sur les lignes groupées de l'Historique.
- Binge, barres de durée et pauses dans la frise (testés, refusés).
- Popup acteur : remplacée par la fiche acteur.
- Pastilles et compteurs en double sur la fiche acteur.

## 7. Fichiers joints
- `SeenIt Prototype.dc.html` : maquette cliquable. Elle s'ouvre directement dans le navigateur avec `support.js` à côté.
- `SeenIt Card8f.dc.html` : carte série (géométrie, voile, badges).
- `SeenIt Row.dc.html` : ligne générique (films en salle dans À venir).
- `support.js` : runtime nécessaire pour ouvrir les maquettes.
- À relire avec : `handoff-acteurs/SPEC-ACTEURS-FILMS.md` (billet et choix de l'acteur), `handoff-accueil/SPEC-ACCUEIL.md` et `ECARTS-PROD.md` (corrigés par le §0).


### Retour terrain v1.4.221 — 24 octobre 2026
Les consignes terrain priment sur V4 : titres de section homogènes uniquement dans À voir (les trois panneaux), taille responsive16–18px et interligne1.25 sans rognage des descendantes ; libellé intégral, deux lignes si la largeur le nécessite. Les titres de films en rail et les titres longs À venir disposent de trois lignes réelles, sans chevaucher code/épisode/acteur. Les lignes Historique peuvent grandir pour le titre intégral et affichent l’heure locale réelle de visionnage (ou « heure inconnue »), jamais « ce soir » déduit du jour. Une session groupée affiche sa plage horaire prouvée. La réserve inférieure commune tient compte de la zone système Android et conserve16px environ au-dessus de la navigation flottante en fin de contenu. Aucun badge de statut/récence/finale/disponibilité dans « Pas vu depuis un moment ». Les rappels donnent un retour visuel immédiat « enregistrement » puis confirmation ou retour à l’état précédent sur erreur, en conservant le garde UID et les écritures existantes. Les compteurs doivent être vérifiés au travers des façades TMDB, synchronisation automatique, marquage Vu et rendu réels ; aucune exception par titre ni total déduit d’une liste partielle.
