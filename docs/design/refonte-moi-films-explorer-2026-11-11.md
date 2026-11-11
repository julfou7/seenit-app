# SeenIt · dossier de reprise — Moi, Films à voir, recherche Explorer (11/11/2026)

**Statut : maquettes validées, aucun code écrit.** Ce document suffit pour démarrer le développement sans
relire la conversation de conception. Base de code relevée : `main` au commit `6a122064` (1.4.290).

## 1. Où sont les maquettes

| Écran | Fichier (copie figée dans le dépôt) | Sujet | Interactif |
| --- | --- | --- | --- |
| 0 | `maquettes/refonte-2026-11-11/Moi.dc.html` | Moi en page unique : année en vitrine + Ma liste en étagères | liens |
| 1 | `…/Main.dc.html` | Mes chiffres : cadran animé, tendances, dix sections | oui |
| 2 | `…/Annee.dc.html` | Mon année : calendrier, records, année en séries | oui |
| 3 | `…/Abandons.dc.html` | Séries laissées en route | non (animations retirées à la demande) |
| 4 | `…/Films.dc.html` | Accueil · Films à voir, vue billets | non |
| 5 | `…/FilmsRail.dc.html` | Accueil · Films à voir, vue affiches (billets déchirables) | non |
| 6 | `…/ExplorerHero.dc.html` | Explorer : champ de recherche posé sur l’image à la une | non |
| 7 | `…/Accueil.dc.html` | Accueil complet : l’existant + écrans 4 et 5, cliquable | oui |

Toile d’origine (privée, compte du propriétaire) : <https://claude.ai/artifact/HmgVzRUJuVnX62bU12gG9x>.
`canvas.json` donne l’ordre et la taille des écrans.

**Lire une maquette.** Chaque `.dc.html` est autonome : le balisage entre `<x-dc>` et `</x-dc>` porte toutes
les tailles, couleurs et espacements en styles en ligne ; les `{{trous}}` sont alimentés par la classe
`Component` en bas de fichier (`renderVals()`), qui contient aussi la logique d’interaction et les durées
d’animation. Les `@keyframes` sont dans `<helmet><style>`. Rien n’est à réutiliser tel quel : c’est une
référence visuelle et comportementale à transposer en React + CSS du projet.

**Toutes les valeurs affichées sont des exemples** (titres, compteurs, heures, noms d’épisodes). Seules les
règles de calcul de ce document font foi. Deux exemples se contredisent d’ailleurs volontairement sans
importance (août : « 52 » ou « 53 épisodes » selon l’écran).

## 2. Décisions validées par le propriétaire (10–11/11/2026)

| Sujet | Décision |
| --- | --- |
| Structure de Moi | **Page unique**, plus d’onglets Ma liste / Chiffres / Mon année. Mes chiffres, Mon année et Séries laissées en route s’ouvrent comme des pages avec retour. |
| Texte coupé | Aucun texte tronqué dans les nouveaux écrans. **Exception voulue** : les cartes de Ma liste reprennent le gabarit d’Explorer (titre sur une ligne avec « … ») pour garder une taille constante. |
| Cartes de Ma liste | Gabarit `GridMediaCard` actuel (note en haut à gauche, diffuseur en haut à droite, bandeau d’action, badge + année), **titre en blanc**. |
| Séries / films | Couleurs actuelles de l’app : **FILM `rose-600` (#E11D48), SÉRIE `indigo-600` (#4F46E5)**. Filtre Tout · Séries · Films dans Ma liste. |
| Graphes | Les valeurs sont toujours lisibles. Moi : douze barres chiffrées. Mes chiffres : cadran conservé, mois en trois-quatre lettres (« janv », « févr »…), valeur sous chaque mois. Tendances : valeur au-dessus de chaque semaine. |
| Mois en cours | Mis en avant dans le cadran (pastille cerclée d’or, contour qui pulse). |
| Animations | Oui sur Mes chiffres et Mon année (§ 8). **Non** sur Séries laissées en route. **Non** sur l’accueil, hormis la déchirure du billet qui existe déjà. Halo de la dernière semaine de Tendances : discret. |
| Fil de l’année | Devient « Ton année en séries » : **uniquement des séries**, avec affiche. Aucun film, aucune note. |
| En pause | Une série en cours sans épisode vu depuis **60 jours**. |
| Badges à niveaux, Têtes d’affiche | Acceptés ; ce sont de **nouvelles règles** (§ 6.4, § 6.5). |
| Films à voir | « À l’affiche » = un film tiré au hasard parmi les mieux notés de la liste, **sans notion de « ce soir »**, présent dans les deux vues. Ordre par défaut : ajouts les plus récents. **Pas de bouton Vu sur un film pas encore sorti.** |
| Recherche Explorer | Champ posé sur l’image à la une (écran 6). La variante « onglet du bas » est abandonnée. |

## 3. Règles transverses à respecter

- **Données réelles uniquement**, mêmes conventions que `docs/design/moi-2026-10-30.md` : datation par
  `watchedAt`, 45 min par épisode et 110 min par film à défaut de durée, journées d’import exclues
  (`partitionProfileViewings`), visionnage sans heure prouvée compté dans son mois mais jamais dans
  « Quand tu regardes ».
- **Aucune comparaison d’une année sur l’autre** : les visionnages datés du propriétaire commencent en 2026.
  Les tendances comparent des fenêtres glissantes (28 jours contre les 28 précédents).
- **Section vide = section absente.** Chaque bloc statistique disparaît s’il n’a pas de donnée, sans texte
  de remplissage. Le propriétaire note très peu d’épisodes : « Tes réactions » sera souvent masquée (§ 9).
- **Budget du point d’entrée : 280 KiB gzip** (`scripts/quality-bundle-budget.cjs`), mesuré à 244 KiB sur 1.4.290.
  Mes chiffres, Mon année et Séries laissées en route doivent rester en import paresseux, comme
  `ProAnalyticsDashboard` et `ProfileYearStory` aujourd’hui.
- **Animations sur `transform` et `opacity` uniquement** (règle du projet, cf.
  `tests/mediaDetailPerformance.test.ts`). Les maquettes utilisent par commodité `box-shadow`,
  `text-shadow`, `filter` et `stroke-dashoffset` : voir § 8 pour l’équivalent conforme.
- `prefers-reduced-motion: reduce` → tout s’affiche dans son état final, sans mouvement.
- Cibles tactiles ≥ 44 px, vrais `<button>` / `<a>`, pas d’emoji, icônes au trait.
- **Hors périmètre** : l’onglet Télécharger et toutes les entrées de téléchargement restent strictement
  inchangés. Les maquettes ne dessinent que trois onglets de la barre du bas par simplicité.

## 4. Découpage proposé (une issue et une PR par lot)

| Lot | Contenu | Dépend de | Taille |
| --- | --- | --- | --- |
| A | Accueil · Films à voir (écrans 4, 5, 7) | — | S |
| B | Explorer · champ de recherche sur l’image (écran 6) | — | S |
| C | Module de données « devenir des séries » + écran Séries laissées en route (écran 3) | — | M |
| D | Moi en page unique + Ma liste en étagères (écran 0) | C pour la ligne « N séries laissées en route » | M |
| E | Mes chiffres (écran 1), données puis animations | C pour la section 7 | L |
| F | Mon année (écran 2), données puis animations | C pour « Tes séries en AAAA » | M |

Ordre conseillé : A, B, C, D, E, F. A et B sont indépendants et peuvent partir en parallèle.
E peut se livrer en deux PR : sections et calculs d’abord, animations ensuite.

## 5. Lot A — Accueil · Films à voir

Fichiers : `src/screens/WatchNextSection.tsx` (bloc « Films à voir », l. ~285),
`src/components/cards/MovieTicketCard.tsx`, `src/screens/watchNext18c.css`,
`src/features/watchlist/watchNext18c.ts` (`orderWatchMovies`). Tests existants à adapter :
`tests/watchNext18c.test.ts`.

Comportement attendu :

1. **Tri** : trois pastilles sous l’en-tête, à la place du texte « Ajouts les plus récents ».
   - « Récents » (défaut) = `orderWatchMovies` actuel.
   - « Mieux notés » = note TMDB décroissante ; un film sans note passe en dernier.
   - « Chez moi » = films disponibles sur un diffuseur du propriétaire ou sur son Plex.
   - Le choix est mémorisé comme la présentation affiches / billets.
2. **Carte « À l’affiche »** au-dessus de la liste, dans les deux présentations : image du film, titre,
   « durée · genre · ★ note », phrase « Tiré au hasard parmi tes films à voir les mieux notés. », tuile du
   diffuseur, bouton « Voir la fiche », bouton « Tirer un autre film ».
   - Vivier : films à voir **sortis**, non vus, classés par note ; proposition : les dix mieux notés, à
     défaut tous les films notés. Moins de trois films éligibles → pas de carte.
   - Le tirage ne change pas à chaque rendu : un tirage par ouverture de l’accueil, puis à la demande.
3. **Billets** (les deux présentations) : note en pastille sur l’affiche, ligne « durée · genre », accroche
   acteur existante (`MovieActorLine`) sur deux lignes si besoin, titre **non tronqué** (retirer le
   `-webkit-line-clamp` de `.movie-ticket--poster > h3` et de la vue liste).
4. **Film pas encore sorti** : talon gris « sortie dans N j » (et la date en vue billets), **sans bouton
   Vu**. Film en salle : talon « au cinéma » + durée.
5. La déchirure du talon, le tampon « VU » et l’annulation restent ceux d’aujourd’hui.

À ajouter côté données : la note TMDB (`vote_average`) dans les détails déjà chargés par
`MovieTicketCard`, et un critère « chez moi » calculé pour toute la liste (réutiliser le lot groupé
`getWatchProviders` / `watchProviderBatchClient`, pas un appel par carte).

Critères d’acceptation :

- [ ] Les trois tris donnent l’ordre décrit ; le tri choisi survit à un changement d’onglet.
- [ ] « À l’affiche » n’affiche jamais un film vu, ni un film non sorti, ni le mot « ce soir ».
- [ ] « Tirer un autre film » change de film sans recharger la section ni déplacer le défilement.
- [ ] Un film non sorti n’a aucun contrôle Vu dans les deux présentations.
- [ ] Aucun titre de film n’est coupé à 360 px de large.
- [ ] La déchirure et son annulation fonctionnent à l’identique (test existant inchangé).

## 6. Lots C, D, E, F — Moi

### 6.1 Lot C — Devenir des séries et écran « Séries laissées en route »

Nouveau module pur proposé : `src/features/profile/profileSeriesFate.ts`.

```ts
type SeriesFate = 'finished' | 'active' | 'paused' | 'dropped';
buildSeriesFate(shows: readonly Show[], viewings: readonly ProfileViewing[], now: number): {
  fate: SeriesFate; show: Show; lastSeenAt: number | null; hoursSpent: number;
  nextCode: string | null;       // « S02 | E04 »
  remainingEpisodes: number | null; remainingMinutes: number | null;
  progress: number;              // 0..1
  dropBucket: 'beforeE3' | 'endS1' | 'S2' | 'S3plus' | null;
}[]
```

- `dropped` : statut `dropped` de la série. `finished` : à jour ou terminée. `paused` : en cours, au moins
  un épisode vu, **aucun épisode vu depuis 60 jours**. `active` : le reste.
- **Aligner ce seuil sur la section « Pas vu depuis un moment » de l’accueil** (« depuis plus de 2 mois »,
  `WatchNextSection.tsx`) : une seule fonction partagée, pas deux définitions.
- `dropBucket` se calcule sur les séries `paused` et `dropped`, d’après le dernier épisode vu.
- « Presque finies » : `paused` ou `active` avec trois épisodes restants ou moins, triées par temps restant.
- « Ton point de décrochage » : médiane du numéro du dernier épisode vu des séries `paused` et `dropped`.
- « Une série qui passe ta saison 1 a N chances sur 4 d’être encore suivie » : part des séries ayant
  dépassé la saison 1 qui sont `active` ou `finished`, arrondie au quart ; phrase absente sous dix séries.

Écran (maquette 3) : constat (N séries, heures déjà passées, point de décrochage), « Où tu décroches »
(quatre barres), « Presque finies » (bouton Reprendre plein), « En pause » (trois lignes puis « Afficher
les N »), « Abandonnées », note de définition en pied. « Reprendre » et le toucher d’une ligne ouvrent la
fiche de la série. **Aucune animation.**

Critères d’acceptation :

- [ ] Une série dont le dernier épisode vu a 59 jours est `active`, à 60 jours elle est `paused`.
- [ ] Les compteurs de l’écran, de la ligne de Moi, de la section 7 de Mes chiffres et de « Tes séries en
      AAAA » sont identiques (même fonction).
- [ ] Les séries listées dans « En pause » sont les mêmes que celles de l’accueil pour la même règle.
- [ ] Chaque bloc vide est absent ; avec zéro série concernée, l’écran affiche un état vide simple.

### 6.2 Lot D — Moi en page unique

Fichiers : `src/screens/ProfileScreen.tsx` (types `ProfileTab`, `PROFILE_TABS`, gestion du retour l.
~100–117, `Activity`), `src/screens/LibraryScreen.tsx` (sections l. ~300–330, `LibrarySectionGrid`),
`src/components/GridMediaCard.tsx`, `src/screens/moi.css`. Tests existants : `tests/profileMoi.test.ts`.

1. **En-tête** inchangé.
2. **Carte « Ton année AAAA »** : total d’heures, épisodes et films de l’année, douze barres « Heures par
   mois » avec la valeur au-dessus de chacune (record en or, mois en cours en blanc, mois à venir en
   pointillé avec « – »), boutons « Mes chiffres » et « Mon année ». Source : `buildProfileYearStats`
   (`months`, `recordMonth`, `minutes`, `episodes`, `films`).
3. **Ligne « N séries laissées en route · M presque finies à reprendre »** → écran du lot C. Absente si N = 0.
4. **Ma liste** : titre + total, filtre Tout · Séries · Films avec compteurs, puis :
   - étagères horizontales (cartes `GridMediaCard`, largeur fixe) pour **En cours**, **Films à voir** et
     **Favoris**, chacune avec « Tout voir » ;
   - une ligne par section restante (À commencer, À venir, Au cinéma, À jour, Films vus) avec un point de
     la couleur du type et le compteur.
   - « Tout voir » ou une ligne ouvre la grille actuelle de la section (`LibrarySectionGrid`) en page avec
     retour. Le filtre masque les étagères et lignes de l’autre type ; Favoris se filtre.
5. Les trois sous-pages (Mes chiffres, Mon année, Séries laissées en route) gardent le montage paresseux
   et le retour matériel/geste actuel ; le double appui sur l’onglet Moi revient à la page unique.

Titre des cartes en blanc dans Ma liste : surcharge locale de `--seenit-media-title`, pas de nouvelle
variante de composant.

Critères d’acceptation :

- [ ] Plus aucun segment Ma liste / Chiffres / Mon année ; Moi s’ouvre sur la page unique.
- [ ] Retour depuis chaque sous-page et depuis une grille « Tout voir » ramène à la même position de
      défilement.
- [ ] Les compteurs du filtre et des sections sont ceux de la bibliothèque actuelle (mêmes prédicats).
- [ ] Toutes les cartes d’une étagère ont la même hauteur ; un titre long finit par « … ».
- [ ] La carte de l’année affiche les mêmes heures par mois que Mes chiffres.
- [ ] Le point d’entrée reste ≤ 280 KiB gzip.

### 6.3 Lot E — Mes chiffres (dix sections, dans l’ordre de la maquette 1)

Fichiers : `src/components/ProAnalyticsDashboard.tsx`, `src/features/profile/profileYearStats.ts`,
`src/features/profile/profileAnalyticsSnapshot.ts`, `src/screens/moi.css`. Tests :
`tests/profileMoi.test.ts`, `tests/profileAnalyticsSnapshot.test.ts`.

| # | Section | Règle de calcul | Existant réutilisable |
| --- | --- | --- | --- |
| 1 | Heures par mois (cadran) | minutes par mois de l’année choisie ; détail au toucher : films et épisodes du mois | `ProfileYearStats.months`, à étendre par mois (films, épisodes) |
| 2 | Trois repères | **Rythme** : heures par semaine sur 28 jours, variation contre les 28 précédents. **Soirée type** : durée médiane d’une journée avec visionnage, nombre médian de titres, nombre de journées. **D’affilée** : série de jours en cours et record | à créer |
| 3 | Tendances | 12 semaines glissantes (heures par semaine) + au plus trois constats : rythme, part des films, genre qui monte | à créer |
| 4 | Ce que tu regardes | part séries / films en temps ; quatre genres en part du temps avec flèche ▲ ▼ = | genres par compteur dans `AnalyticsData`, à passer en temps |
| 5 | Quand tu regardes | grille 7 jours × 8 tranches de 3 h ; créneau = case la plus forte | **remplace** la fenêtre de huit heures actuelle (`buildPunchCard`) |
| 6 | Où tu regardes | six plateformes en part du temps ; le temps sans plateforme connue est **annoncé à part**, plus de ligne « Autres » | `ProfileYearStats.platforms`, règle modifiée |
| 7 | Séries laissées en route | résumé du lot C + bouton vers l’écran 3 | lot C |
| 8 | Tes réactions | répartition J’adore / Bien / Bof des épisodes notés + trois séries les plus aimées | `episodeRecords[].emotion` |
| 9 | Tes têtes d’affiche | § 6.5 | `AnalyticsData.topActors` à enrichir |
| 10 | Badges à niveaux | § 6.4 | `buildProfileBadges` à étendre |

Précisions :

- **Constats de Tendances** : chacun n’apparaît que si l’écart est significatif (proposition : ± 10 % pour
  le rythme, ± 10 points pour les parts) et si chaque fenêtre comparée contient au moins dix visionnages.
  Fenêtres : 28 jours contre 28 jours pour le rythme ; 60 derniers jours contre les 120 précédents pour
  la part des films et le genre.
- **Le vocabulaire « soirs » de la maquette est à remplacer par « jours »** tant que l’heure n’est pas
  prouvée, conformément à la décision du 30/10 (« jours d’affilée » remplace « soirs d’affilée »).
- **Note d’import** : une seule, en pied de page (`formatProfileImportNote`, `formatProfileUndatedNote`).
- Le sélecteur d’année reste ; toutes les sections sauf Tendances suivent l’année choisie.

Critères d’acceptation :

- [ ] Chaque section applique sa règle sur un jeu de visionnages de test (un test par fonction pure).
- [ ] Les valeurs du cadran, des barres de Moi et de « Mon année » concordent pour une même année.
- [ ] Toucher un mois affiche son nom, ses heures et son détail au centre ; un second toucher ou le centre
      revient au total. Le mois en cours est identifiable sans interaction.
- [ ] Chaque semaine de Tendances affiche sa valeur ; les constats absents ne laissent pas de trou.
- [ ] « Où tu regardes » n’a plus de ligne « Autres » et annonce la part sans plateforme connue.
- [ ] Une section sans donnée est absente, y compris « Tes réactions ».

### 6.4 Badges à niveaux (nouvelle règle, paliers proposés à valider)

L’anneau montre la progression vers le **prochain** palier, le chiffre au centre est le niveau atteint, la
ligne du dessous dit « N sur palier ».

| Badge | Mesure | Paliers proposés |
| --- | --- | --- |
| Centenaire | visionnages | 100, 500, 1 000, 2 500, 5 000, 7 500, 10 000 |
| Oiseau de nuit | nuits avec un visionnage daté entre 23 h et 5 h | 10, 25, 50, 100 |
| Grand écran | films vus | 1, 25, 75, 150, 300 |
| Binge-Master | séries terminées | 1, 5, 15, 30 |

Les seuils actuels de `buildProfileBadges` deviennent le niveau 1 de chaque badge. Au dernier palier,
l’anneau est plein et la ligne dit « palier maximal ».

### 6.5 Têtes d’affiche (nouvelle règle)

Acteurs tenant un **rôle principal** (proposition : trois premiers du générique) dans les titres vus,
classés par temps de visionnage cumulé ; ligne : « N titres vus · M favori(s) » et les heures. Trois
personnes au plus, chacune ouvre la fiche personne existante. Section absente sous trois personnes.

### 6.6 Lot F — Mon année (maquette 2)

Fichiers : `src/components/ProfileYearStory.tsx`, `profileYearStats.ts` (`buildProfileYearStory`,
`buildProfileProjection`).

| Bloc | Règle |
| --- | --- |
| Titre | « L’année X, puis Y » : les deux séries les plus regardées en temps ; une seule série → « L’année X » ; aucune → titre neutre. Sous-titre : heures, épisodes, films, journées. |
| AAAA, jour par jour | douze mois, une case par jour, quatre niveaux selon le temps du jour ; jours à venir estompés ; journée record signalée et citée dessous. |
| Records | mois record, plus longue suite de jours, plus gros marathon (le plus d’épisodes d’une même série en un jour), plus longue pause entre deux jours de visionnage. |
| Ton année en séries | par mois, la série la plus regardée (épisodes, heures, barre relative au meilleur mois) avec son affiche et une étiquette : marathon, saison ou série terminée, reprise après N jours, « en cours ». Mois sans série → ligne absente. Six mois récents puis « afficher les autres ». **Aucun film.** |
| Films ou séries, mois par mois | colonnes empilées en temps + un constat si la part bascule de plus de dix points. |
| Tes séries en AAAA | barre et légende à quatre états (lot C) + bouton vers l’écran 3. |
| Ton top de l’année | cinq séries au temps passé. |
| Et maintenant | `buildProfileProjection` existant. |

Critères d’acceptation :

- [ ] « Ton année en séries » ne contient aucun film et aucune note.
- [ ] Chaque record est vérifié par un test sur données construites ; un record impossible à établir est absent.
- [ ] Les quatre états de « Tes séries en AAAA » totalisent le nombre de séries regardées dans l’année.

## 7. Lot B — Explorer · recherche sur l’image

Fichiers : `src/screens/DiscoverHero.tsx`, `src/screens/DiscoverViewCore.tsx` (bouton
`.explorer-control-search`, l. ~75), `src/screens/explorer.css`. Test à adapter :
`tests/explorerSearchVisibility.test.ts` (**exigence SEENIT-DISCOVER-003 E-03 : recherche accessible à
toute profondeur**).

- Tant que l’image à la une est visible : un champ « Rechercher un film, une série… » (48 px, fond sombre
  translucide) est posé en haut de l’image ; le toucher appelle `enterSearch`, comme le bouton actuel. Le
  bouton loupe rond n’apparaît pas dans la ligne des filtres.
- Dès que l’image sort de l’écran : le bouton loupe rond revient dans la barre collante, comme
  aujourd’hui. L’exigence E-03 reste donc vraie ; seule sa forme en haut de page change.
- Le rang « #1 » quitte le coin haut droit et se place à droite des badges FILM / AU CINÉMA.
- Le raccourci existant `useNavigationSearchShortcut` est conservé.

Critères d’acceptation :

- [ ] À l’ouverture d’Explorer, la recherche est visible sans défilement et sans hauteur ajoutée.
- [ ] À toute profondeur de défilement, un contrôle « Rechercher » reste atteignable (E-03).
- [ ] Jamais deux contrôles de recherche visibles en même temps.
- [ ] Le champ ne masque ni le titre ni les boutons de l’image à la une à 360 px de large.

## 8. Animations (Mes chiffres et Mon année uniquement)

Déclenchement : chaque bloc s’anime **une fois**, quand il entre dans l’écran (`IntersectionObserver`,
seuil 0,12). Courbe par défaut : `cubic-bezier(0.2, 0.8, 0.2, 1)`.

| Effet | Où | Détail |
| --- | --- | --- |
| Apparition de bloc | toutes les sections | opacité 0 → 1 et translation 22 px → 0, 600 ms |
| Barre horizontale | genres, plateformes, progressions, répartitions | `scaleX` 0 → 1 depuis la gauche, 800 ms, décalage 150 ms + 90 ms par barre |
| Colonne | 12 semaines, films / séries par mois | `scaleY` 0 → 1 depuis le bas, 700 ms, décalage 120 ms + 55 à 60 ms par colonne |
| Surgissement | trois repères, records, mois du calendrier, cases de « Quand tu regardes » | échelle 0,4 → 1 + opacité, 450 à 500 ms, courbe `cubic-bezier(0.2, 0.9, 0.3, 1.2)`, décalage par élément (cases : 40 ms × (ligne + colonne)) |
| Cadran, ouverture | Mes chiffres | secteurs : échelle 0,5 → 1 depuis le centre, 650 ms, 55 ms d’écart ; total qui compte de 0 à la valeur en 1,1 s |
| Cadran, sélection | Mes chiffres | secteur déplacé de 6 px vers l’extérieur, les autres à 30 % d’opacité, pastille du mois à l’échelle 1,12, 350 ms ; chiffre central qui défile en 380 ms |
| Mois en cours | cadran | contour clair dont l’opacité oscille, période 1,8 s |
| Anneaux de badge | Mes chiffres | tracé de l’anneau en 1,1 s, 140 ms d’écart |
| Reflet | barre n° 1 des genres, des plateformes, de « Ton année en séries » | bande claire qui traverse la barre, période 2,8 s |
| Lueur douce | un élément fort par section (liste dans les maquettes, attribut `data-anim`) | période 2,2 à 3 s ; **dernière semaine de Tendances : lueur faible** |

**Mise en conformité « `transform` / `opacity` uniquement ».** Dans les maquettes, les lueurs animent
`box-shadow`, `text-shadow` ou `filter`, et les anneaux `stroke-dashoffset`. En production :

- lueur = calque frère ou pseudo-élément portant l’ombre **fixe**, dont seule l’`opacity` est animée ;
- anneau de badge = soit un tracé unique non répété accepté par dérogation documentée, soit un masque
  tournant en `transform` ; à trancher au début du lot E ;
- le compteur du cadran passe par `requestAnimationFrame` avec arrêt hors écran, pas par un minuteur.

Éléments forts retenus : dernière semaine et « + N % » (Tendances), barre du premier genre, case et libellé
du créneau, barre de la première plateforme, série la plus aimée, première tête d’affiche, badge le plus
proche du palier ; sur Mon année : journée record, mois record, série du meilleur mois, constat films /
séries, n° 1 du top.

## 9. Points à trancher au démarrage des lots

1. **Tes réactions** : seuil d’affichage (proposition : dix épisodes notés), puisque le propriétaire note
   rarement.
2. **Paliers des badges** (§ 6.4) et **définition de « rôle principal »** (§ 6.5).
3. **Vivier de « À l’affiche »** : dix mieux notés ou note minimale.
4. **« Chez moi »** : liste des plateformes du propriétaire (réglage existant ou à créer).
5. **Étagères de Ma liste** : les trois retenues sont-elles fixes ou choisies selon le contenu.
6. **Anneaux de badge** : dérogation ou masque (§ 8).

## 10. Démarrer un lot (rappel du cadre `AGENTS.md`)

1. Créer l’issue du lot, y poser le bail `<!-- seenit-agent-lease -->` et renvoyer à ce document.
2. Inscrire la demande au registre `docs/requests/registry.md` (les règles des § 6.1, 6.3, 6.4, 6.5 et la
   modification de E-03 sont des demandes durables) et mettre à jour `docs/specifications/seenit.md`,
   `requirements.json`, `functional-reference.md` et `ux-reference.md` **avant le code**.
3. Écrire les fonctions pures et leurs tests, puis l’interface, puis les animations.
4. `validate:change` vert avant tout push ; version préparée dans la PR si une APK est prévue ; aucune
   release sans « go apk » explicite.
