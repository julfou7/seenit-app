# AUDIT-2026-10-23-ACCUEIL-MAQUETTES

Identifiant : AUDIT-2026-10-23-ACCUEIL-MAQUETTES.
Date : 23 octobre 2026. Baseline : v1.4.218, commit `b8fa793b55250c5377f09f9a5dd72772d879a392`.
Périmètre : header, trois onglets À voir, cartes 8f, billets, notifications et leurs gestes.
Références : archive SPEC-ACCUEIL, Prototype.dc.html, Card8f.dc.html, Row.dc.html ;
capture utilisateur 1000166106.jpg. Suivi unique : [#729](https://github.com/julfou7/seenit-app/issues/729).

Le terrain invalide la précédente déclaration de conformité : les smokes vérifiaient une géométrie
codée (180 px) plutôt que celle du prototype (150 px), et une fixture Harry Potter sans count ne
couvrait pas le vrai compte provisoire TMDB. Le texte du handoff est lui-même en retard sur le
prototype pour les icônes. Les dernières décisions utilisateur priment pour badge et ordre des sections.

## Matrice exhaustive des constats

| Contrôle exhaustif du périmètre | Baseline / décision | Priorité / sortie #729 |
|---|---|---|
| Header logotype/cloche/sync | Logotype trop grand (34 au lieu de 26), suivi sync existant conservé | P2, aligner taille et top |
| Filtre sticky et fondu | Flou coupé à la limite du header, fondu inférieur absent | P2, fondu progressif 26 px et clics traversants |
| Trois panneaux indépendants | Conforme, pas de scrollspy/swipe inter-onglets | Conserver, clavier et Retour testés |
| Rails séries | Trois cartes, snap et liste progressive présents | Conserver, élargir au gabarit 380/412 |
| Contrôles de vue | Texte Voir tout au lieu des deux icônes du prototype | P2, rail/liste avec libellés accessibles |
| Ordre des sections | Anciennes séries avant films | P2, anciennes séries toujours dernières |
| Corps carte et affiche | Corps 180 px au lieu de 150, trou sous affiche | P2, carte compacte et titres longs sans collision |
| Badge | Sous le sous-titre, augmente l’espace | P2, nouvelle consigne : près du code épisode |
| Action Vu | Fixée en haut, carré gris différent du contrôle du prototype | P2, centre vertical et glyphe dans rond sombre/or |
| Progression inconnue | Count TMDB provisoire interprété comme total | P1, preuve de total séparée de la liste ; TNR sync → carte Harry Potter/MobLand |
| Images et diffuseurs | Image débordante, teinte et secours présents | Conserver les vrais assets/cache et fallback |
| Billets affiche | Mode grille initial divergent du rail du prototype | P2, rail initial et bascule icônes vers liste |
| Billet horizontal | 116 px, glyph caché, genre à la place durée, talon mal découpé | P2, 104 px / affiche 70 / talon 96, fin, durée, fournisseur et glyphe visibles |
| Animation film Vu/Annuler | Talon retiré mais découpe appliquée à l’enveloppe entière | P2, découper le corps au raccord et annuler depuis tampon, acquittement réel conservé |
| À venir | Trois groupes, jours exacts et rappels présents | Conserver, contrôle centré et barre inconnue partagés |
| Historique | Mixte, dix puis plus, date discrète et gestes présents | Conserver, vérifier carte compacte et statut utilisateur |
| Notifications visuelles | Vignettes et fond non lu absents | P2, rétablir l’aspect du prototype avec sources réelles |
| Retrait individuel notification | Aucun geste ni bouton | P2, swipe gauche, alternative accessible, Annuler, persistance UID |
| États/gestes transversaux | Skeleton/cache/offline/reset/undo et confirmations existent | Conserver, cibles 44 px et reduced-motion |
| Bloc soirée | Retiré comme demandé | Conserver, ne pas réintroduire |

## Preuves et limites

Dernière vérification : 23 octobre 2026, corrections implémentées et smoke Chromium complet vert
à 360/412/1280 px, captures inspectées (accueil, billet horizontal, À venir, Historique, notifications,
fixture Harry Potter/MobLand). Les contrôles passent par les composants/handlers de production :
dimensions de référence, position badge/Vu, ordre, icônes, fondu, swipe réel, Annuler et rechargement.
Les deux synchronisations sont testées avec un count TMDB positif mais provisoire, puis la carte
consomme la preuve produite avec un ancien pointeur contradictoire. TypeScript et SPEC verts.
Toutes les sorties relèvent de #729 ; la validation canonique finale est requise avant push.
Aucune APK à publier pendant la collecte des retours. Aucun test sur téléphone réel n’est déduit
du smoke navigateur ; la reprise de v1.4.218 et la preuve de total sont versionnées une seule fois.
