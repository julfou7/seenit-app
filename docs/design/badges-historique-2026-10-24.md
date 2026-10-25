# Spec dev — Badges, codes épisode et Historique

24 oct. 2026

## Résumé

Six changements validés le 24 oct. 2026 sur le prototype SeenIt, à reporter dans l'app :

1. Codes épisode au format `S05 | E14` partout.
2. Nouveaux badges en ruban dans le coin de l'affiche, couleurs métalliques, sans emoji ; « Ce soir » et « Sorti hier » animés par un reflet.
3. Badges « X dispo », « Vu ce soir » et « 3 sem. » supprimés.
4. Historique : heure de visionnage, titre d'épisode aligné sur À venir, badge seen it identique aux autres onglets.
5. « Pas vu depuis un moment » : durée en badge (« 3 MOIS »), qui distingue les séries en pause de celles jamais commencées.
6. Message d'erreur TMDB qui distingue clé refusée et réseau bloqué.

Référence visuelle : `SeenIt Prototype.dc.html` dans ce dossier (voir README.md pour l'ouvrir).

## Format des codes épisode

Tous les codes épisode s'écrivent `S05 | E14` : saison et épisode sur deux chiffres, séparés par espace, barre verticale, espace. L'app l'utilise déjà sur les cartes Continuer, À venir et la fiche épisode : il faut l'étendre aux écrans qui affichent encore `S05·E06`, `S05 · E06` ou `S05E06`.

| Cas | Format |
| --- | --- |
| Un épisode | S05 \| E14 |
| Plage dans une même saison | S05 \| E11 → E12 |
| Plage sur deux saisons | S04 \| E16 → S05 \| E02 |
| Libellé d'action | « Marquer S02 \| E05 vu » |

- Écrans concernés : cartes À regarder et À venir, grande carte « Ce soir », Historique, notifications (push et fil), toasts, téléchargements, planning de soirée, popup « Retirer X (S01E01) de votre historique ? ».
- Exception : les noms de releases et la requête de recherche C411 gardent `S05E06`, c'est la syntaxe des indexeurs.

## Badges (ruban B07)

Une série affiche au plus un badge, en ruban diagonal dans le coin de l'affiche, sans emoji. Le badge n'apparaît que s'il reste un épisode à voir. Texte de 10 caractères maximum, sinon il est coupé par le bord de l'affiche.

### Règles et couleurs

| Badge | Quand | Fond (dégradé 90°) | Texte | Animation |
| --- | --- | --- | --- | --- |
| Ce soir | Prochain épisode sorti aujourd'hui | #FFF2B8 → #F5C518 (45 %) → #E5A93D | #1A1206 | Reflet 3,2 s + halo |
| Sorti hier | Sorti hier | #FFF8E7 → #EFD5A0 | #1A1206 | Reflet 4,8 s, décalé de 1,2 s |
| Nouveau | Sorti il y a 2 jours ou plus (maquette : jusqu'à 5 j) | #FFFFFF → #E4E4E7 | #0B0B0F | Aucune |
| Plus que N | Il reste N épisodes sortis (maquette : N = 2 ou 3) | #FBC59A → #DC8455 | #1C0D05 | Aucune |
| Fin saison | Prochain épisode = dernier de la saison | #EBCB96 → #B8823A | #170F04 | Aucune |
| Final | Prochain épisode = dernier de la série | #1C1C21 → #0B0B0F + filet intérieur 1 px rgba(242,195,107,0.8) | #F2C36B | Aucune |

Deux autres badges, « En pause » et « Jamais commencée », ne servent que dans « Pas vu depuis un moment » : voir leur section.

### Placement et dimensions

| Endroit | Forme | Valeurs |
| --- | --- | --- |
| Carte 8f (À regarder, Nouveautés, À venir) | Ruban dans l'affiche (86 × 129 px, rayon 12 px, overflow hidden) | top 10 px, left −26 px, largeur 110 px, rotate(−38°), padding 3 px 0, 9 px / 900, majuscules, letter-spacing 0.06em, centré, ombre 0 2px 8px rgba(0,0,0,0.5) |
| Grande carte du haut (hero « Ce soir » et hero classique) | Ruban dans le coin haut gauche de l'image, l'image coupe ce qui dépasse | top 14 px, left −30 px, largeur 130 px, 10 px, padding 4 px 0 ; aucun badge une fois l'épisode vu |
| Affichage en liste | Étiquette compacte sous les métadonnées | hauteur 20 px, padding 0 10 px, rotate(−6°) depuis la gauche, même police et mêmes couleurs |

Sur la carte 8f, le badge quitte la ligne du code épisode.

### Animation

Seuls « Ce soir » et « Sorti hier » s'animent : un reflet blanc traverse le ruban puis s'arrête, et « Ce soir » pulse doucement d'un halo or. Rien ne clignote franchement.

```css
.badge {
  background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,.8) 50%, transparent 60%) 150% 0 / 250% 100% no-repeat, var(--badge-bg);
  box-shadow: 0 2px 8px rgba(0,0,0,.5);
}
.badge--today { --bdg: rgba(245,197,24,.6); animation: bdSheen 3.2s ease-in-out infinite, bdBreath 3.2s ease-in-out infinite; }
.badge--yday { animation: bdSheen 4.8s ease-in-out 1.2s infinite; }
@keyframes bdSheen { 0%, 58% { background-position: 150% 0, 0 0 } 100% { background-position: -50% 0, 0 0 } }
@keyframes bdBreath { 0%, 100% { box-shadow: 0 2px 8px rgba(0,0,0,.5) } 50% { box-shadow: 0 2px 8px rgba(0,0,0,.5), 0 0 12px 1px var(--bdg) } }
@media (prefers-reduced-motion: reduce) { .badge { animation: none } }
```

### Correspondance avec les badges actuels

Liste relevée dans le code de l'app le 17 oct. 2026.

| Badge actuel | Devient |
| --- | --- |
| SORTI AUJOURD'HUI 🔥 | Ce soir |
| SORTI HIER 🌟 | Sorti hier |
| SORTI IL Y A N J 🆕 | Nouveau |
| PLUS QUE N ⚡ | Plus que N |
| FIN DE SAISON 🎬 | Fin saison |
| FINAL ABSOLU 🏁 | Final |
| N/M ÉP. DISPOS 🍿 | Supprimé : le suivi des épisodes le montre déjà |
| SAISON DISPO 🍿 | Supprimé |
| BIENTÔT DISPO ⏳ | À confirmer |

Les badges « Vu ce soir » et « 3 sem. » de la maquette sont aussi supprimés.

## Historique

Chaque ligne de l'Historique affiche l'heure de visionnage sous le badge seen it, reprend le style de titre d'À venir et utilise le même badge seen it que les autres onglets.

| Élément | Avant | Après |
| --- | --- | --- |
| Heure | Absente | HH:MM en 24 h (watchedAt), sous le badge : 12 px / 700, chiffres tabulaires, #D4D4D8 ; #F2C36B pour aujourd'hui |
| Date | Ligne du code | Inchangée : « S05 \| E13 · 13 oct. », « ce soir » pour aujourd'hui |
| Titre de l'épisode | 13 px, gris #D4D4D8 | 14 px / 600, #F4F4F5, interligne 1.3, 2 lignes max (comme les cartes À venir) |
| Badge seen it | Pastille or pleine de 26 px | Bouton seen it des autres onglets en état « vu », dans une colonne de 52 px |

- Plusieurs épisodes vus d'affilée : afficher l'heure du plus récent.
- Accessibilité : aria-label « Vu le 13 oct. à 22:07 » ou « Vu ce soir à 21:40 ».
- Le style du titre s'applique aussi au genre d'un film et à « N épisodes d'affilée ».

Valeurs du badge seen it état « vu » (mêmes que dans les autres onglets) :

- Cercle 42 px, fond rgba(229,169,61,0.16), filet intérieur 1,5 px rgba(242,195,107,0.7), ombre 0 4px 14px rgba(0,0,0,0.45).
- Pictogramme 26 × 19 px : écran rempli #E5A93D avec contour #F2C36B, coche #0B0B0F, pied #F2C36B.
- Épisodes du jour : apparition scale 0.6 → 1.08 → 1 en 0,32 s.

## Pas vu depuis un moment

La section distingue maintenant les séries commencées puis arrêtées de celles ajoutées il y a plus de 60 jours mais jamais commencées. La durée s'affiche en badge ruban, comme les autres badges, avec une icône et une couleur propres à chaque cas.

| | En pause | Jamais commencée |
| --- | --- | --- |
| Condition | Au moins un épisode vu, aucun depuis 60 jours ou plus | Aucun épisode vu, ajoutée il y a 60 jours ou plus |
| Durée comptée depuis | Le dernier épisode vu | L'ajout à la liste |
| Badge | Icône pause + durée, ex. « 3 MOIS » | Icône signet + durée, ex. « 7 MOIS » |
| Couleur | Acier plein : #D4D6DC → #8E929B, texte #111114 | Acier creux : #1C1C21 → #0E0E12, filet intérieur 1 px rgba(228,228,231,0.7), texte #E4E4E7 |
| Ligne du code (carte 8f) | « S07 \| E05 » seul | « S01 \| E01 · jamais commencée », 13 px / 600, #A1A1AA |
| Affichage en liste | « En pause depuis 3 mois » | « Ajoutée il y a 7 mois · jamais commencée » |
| Ordre dans la section | En premier | Après les séries en pause |

| Durée | Texte du badge | Exemple |
| --- | --- | --- |
| Moins de 60 jours | Semaines arrondies | 45 j → « 6 SEM. » |
| 60 à 364 jours | Mois arrondis (jours ÷ 30,44) | 74 j → « 2 MOIS » ; 92 j → « 3 MOIS » |
| 365 jours et plus | Années, avec ½ au-delà de 6 mois de reste | 400 j → « 1 AN » ; 560 j → « 1 AN ½ » |

- Placement et dimensions : comme les autres badges (ruban sur l'affiche de la carte 8f, étiquette compacte en liste). Pas d'animation.
- Icônes en SVG 8 × 8 px, couleur du texte, 4 px avant le texte : pause = deux barres 2,5 × 8 (viewBox 10), rayon 1 ; signet = contour 1,4 px.
- Sous-titre de la section : « En pause ou jamais commencées, depuis plus de 2 mois ».
- La pastille grise « ⏸ depuis 3 mois » de la version précédente est abandonnée.

## Message d'erreur TMDB

Le test de la clé TMDB distingue trois cas au lieu d'afficher « clé refusée ou réseau bloqué » dans tous les cas. À reprendre dans l'app seulement si elle a un écran de test de clé.

| Cas | Détection | Message |
| --- | --- | --- |
| Clé refusée | Réponse HTTP 401 ou 403 | « Échec : clé refusée par TMDB (401) » |
| Réseau bloqué | fetch rejette avec une TypeError, aucune réponse | « Réseau bloqué : TMDB injoignable depuis cette page (la clé n'est pas en cause) » |
| Autre échec | Réponses non OK ou vides | « Échec : TMDB n'a renvoyé aucune saison » |

## Points à confirmer

- [ ] Priorité quand plusieurs badges s'appliquent à une série. Proposition : Ce soir > Sorti hier > Final > Fin saison > Plus que N > Nouveau.
- [ ] Seuil haut de « Nouveau » : la maquette va jusqu'à 5 jours après la sortie.
- [ ] Seuil de « Plus que N » : la maquette l'affiche pour N = 2 et 3.
- [ ] Sort de « BIENTÔT DISPO » : supprimé ou gardé ?
- [ ] « Final » et « Fin saison » : garder deux couleurs (noir et or, bronze) ou une seule.
- [ ] Seuil « Jamais commencée » : 60 jours après l'ajout, comme pour la pause ?
