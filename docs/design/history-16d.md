# Historique mixte 16d

Demande du 21 octobre 2026, suivi #708. Référence propriétaire : archive
`Connexion du repository seenit-app (3).zip`, `SPEC-HISTORIQUE-16D.md`, complément de
`SPEC-CARTE-8F.md` v2 et `SPEC-EPISODES-INCONNUS.md`. Ces références historiques sont remplacées pour la présentation par la SPEC accueil v3 du 23 octobre ; les invariants de données et les opérations réversibles restent applicables.

## Liste compacte v3 — remplace la carte 16d historique

La SPEC accueil v3 reçue dans `Connexion du repository seenit-app (8).zip` remplace la géométrie précédente. Un seul bloc de rayon 20 px contient films et épisodes triés depuis leur horodatage réel, sans en-têtes de dates et sans progression de saison/collection. Dix entrées, puis Voir plus avec le nombre restant (dix entrées supplémentaires par lot).

Chaque ligne : minimum 76 px, padding 10/12/10/10, gap 12, vignette 92×52 de rayon 9 (still épisode ou backdrop film, puis image connue/initiales). Titre or 15 px/800, sur une ligne avec ellipse ; code série Sxx·Exx blanc 800 puis date courte neutre sur la seconde ligne ; titre épisode neutre 13 px sur deux lignes maximum. Pour un film, seule la date est affichée, sans année ni mention Film. La date devient ce soir en or aujourd’hui. À droite : pastille SeenIt or 26 px, dans une cible d’actions 44 px, effet tampon 0,32 s aujourd’hui et réduction d’animation respectée.

Une date seule ou un repli legacy ne constitue jamais une heure. Les heures réelles restent conservées pour le tri, l’édition et le libellé accessible. Aucun 00:00 ni horaire courant n’est inventé. Les enrichissements utilisent les identités exactes existantes ; la liste ne demande plus une collection seulement pour dessiner une progression qui a été retirée.

## Zone d'historique et interactions

À droite, la pastille SeenIt or est le repère vu de la maquette ; une cible 44 px permet d’accéder aux mêmes actions que l’appui long. Elle ne marque jamais directement Non vu. L’heure réellement connue est conservée dans le libellé accessible, sans réintroduire d’horaire visible dans la ligne v3.

Un tap/clic ouvre l'épisode exact pour une série et la fiche du film pour un film. L'appui long d'au moins
480 ms, le clic droit et le raccourci clavier de menu contextuel ouvrent la feuille d'actions. Elle propose
dans ce contexte :

- `Marquer non vu`, avec confirmation métier existante puis toast et `Annuler` ;
- `Changer la date/heure`, en conservant explicitement le fait qu'une heure puisse rester inconnue ;
- `Revoir`, qui ouvre le diffuseur résolu lorsque sa destination est disponible ;
- `Ouvrir la série` pour une entrée épisode.

L'Historique n'hérite d'aucun swipe Archiver/Supprimer. Toutes les cibles interactives font au moins
44 CSS px. Le libellé accessible de la carte décrit le média, l'épisode le cas échéant, le jour de
visionnage et l'heure uniquement lorsqu'elle est connue.

## Sources et garde-fous

L'identité reste `mediaType + TMDB ID`. Le titre, l'année ou la position dans une liste ne servent jamais
à rapprocher des médias. Les métadonnées supplémentaires viennent de TMDB par l'identité canonique ; les
requêtes passives restent bornées et réutilisent les caches existants. Le diffuseur continue d'utiliser
le résolveur SeenIt existant ; une provenance Plex explicitement persistée peut forcer la destination Plex pour
Revoir, sinon la préférence de plateforme existante s'applique.
`Revoir` utilise cette résolution et le cache public existant ; il ne lance pas de seconde requête
directe aux plateformes. À défaut de destination connue, l'utilisateur peut ouvrir la fiche exacte.
Les variantes de clé épisode sont normalisées avant déduplication et mutation. Lorsque la liste
`seenEpisodes` existe, elle fait foi : un record orphelin ne ressuscite pas un épisode retiré.

Les écritures de changement d'horodatage et de retrait non vu conservent les autres métadonnées du record,
recalculent `lastWatchedAt` à partir des preuves restantes et offrent un rollback utilisateur. PWA et APK
partagent exactement la même logique métier et le même rendu responsive 360/412/desktop.
Avant une mutation, les épisodes legacy encore vus mais sans record conservent explicitement leur ancien
jour de repli dans un record à heure inconnue. Modifier/retirer un voisin ne les déplace donc jamais à
la nouvelle date agrégée ou à aujourd'hui. Annuler restaure les records originaux.


Retour terrain225 du25/10/2026 (#729), prioritaire sur les regroupements antérieurs : un visionnage = une ligne, sans ×N ni plage d’épisodes, même pour une saison marquée en une fois. Périodes, totaux, heure et actions par épisode conservés. Navigation : centres du pictogramme et du texte identiques sur tous les écrans. Vu : anneau progressif760ms puis coche240ms, tampon puis reprise ; réduction des animations immédiate. Splash : huit segments160ms, anneau1280ms, coche1640ms, signature1860ms/300ms puis lecture complète pendant1540ms ; durée3700ms et fondu500ms inchangés. Référentiel détaillé : docs/design/marque-2026-10-25.md.
