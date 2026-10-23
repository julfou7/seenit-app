# Accueil « À Voir » — spec d'implémentation

Référence vivante : `SeenIt Prototype.dc.html` (onglet À Voir, mobile 412 px). Cartes : `SeenIt Card8f.dc.html` (séries), billets films dans le prototype. Specs déjà livrées et toujours valables : `SPEC-CARTE-8F.md`, nav 13j, films 16d/18c.

## Structure
1. **Header** : logotype `seenit●` (10b) à gauche · cloche à droite (point or si notifs non lues). Pas d'avatar ici (profil = onglet Moi).
2. **Segmented 3 onglets** : À regarder · À venir · Historique. Pilule active or plat, texte centré verticalement (hauteur 44, line-height 1). Pas de compteurs.
3. **Contenu** de l'onglet. Pas de swipe entre onglets, pas de changement d'onglet au scroll (testé, retiré : pas fluide, conflit avec le swipe archiver).

## À regarder (ordre)
1. **Continuer à regarder** — carte 8f, rail horizontal 3 cartes ; « Voir tout » passe en liste verticale, « Revenir en carrousel » (chevron or) referme.
2. **Nouveautés** — même carte 8f, même comportement rail → liste.
3. **Pas vu depuis un moment** (> 60 j) — carte 8f, info « Pas vu depuis N jours ».
4. **Films à voir** — billet horizontal (16d) avec heure de fin en gros ; bascule grille/liste ; 3 visibles puis « Afficher N de plus » (18c).
- Swipe gauche sur une carte série (Nouveautés / Pas vu depuis) : Archiver / Supprimer + toast Annuler. Fond d'actions invisible tant qu'on ne glisse pas.
- Appui long : feuille d'actions. Double tap onglet nav : reset.

## Badge statut (carte 8f)
- Position : **sous le titre de l'épisode**, dans le bloc texte (plus en surimpression → la carte ne bouge plus).
- Forme « écran SeenIt » : pilule 24 px, dégradé vertical de la couleur du statut, reflet verre en haut-gauche, contour 2 px #0B0B0F, glyphe custom + texte 12 px/800 sombre. Pas d'emoji.
- Couleurs : Aujourd'hui `#FDBA74→#FB7185` (pulse 1,6 s) · Nouveau `#6EE7B7→#34D399` · Plus que N `#C4B5FD→#A78BFA` · Dispo `#7DD3FC→#38BDF8` · Final/fin de saison `#FDE68A→#E5A93D` · Délaissé `#E2E8F0→#94A3B8`.
- Un seul badge par carte. Pas de « X restants » (déjà dans la barre de saison).

## Billet film — animation « vu »
- Tap talon → talon arraché (`hzTear` 0,7 s), bord droit du billet découpé en dents (mask zigzag), pointillés supprimés, tampon « VU » avec logo SeenIt.
- Après l'animation, le talon est retiré (`visibility:hidden`). **Annuler = tap sur le tampon VU** → talon recollé (`hzBack` 0,3 s).

## À venir
- Groupes : Aujourd'hui · Cette semaine · Plus tard. Ligne unifiée, jours exacts dans un rond sombre homogène avec le bouton vu ; tap = rappel (pastille cloche or si actif). Logo diffuseur sur l'image.
- Nombre d'épisodes inconnu : segments ouverts + « ? » (cf. spec 8f).

## Historique
- Films et séries mélangés, même ligne, homogène. Date/heure discrète (pas mise en valeur). Liste paginée : 10 puis « N de plus ».

## Cloche
Feuille « Notifications » (mêmes que mobile) : épisode dispo Plex (action Vu), rappel sortie, téléchargement terminé, date de film confirmée, mise à jour. Point or = non lu, « Tout marquer lu ».

## États à gérer
Chargement (skeleton), cache, offline, synchro Plex en cours (pastille anneau dans le header), liste vide par section (section masquée), image manquante (teinte + initiales), titres longs (2 lignes max).

## Écarts / mis de côté
- **Bloc « Un film ce soir ? » / organisateur de soirée : retiré de l'accueil**, en attente de validation. Code conservé : `old/Soiree-film-bloc.html` + overlay `night` dans le prototype.
- Données du prototype = démo (images TMDB réelles, épisodes Breaking Bad réels, le reste générique).
