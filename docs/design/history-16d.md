# Historique mixte 16d

Demande du 21 octobre 2026, suivi #708. Référence propriétaire : archive
`Connexion du repository seenit-app (3).zip`, `SPEC-HISTORIQUE-16D.md`, complément de
`SPEC-CARTE-8F.md` v2 et `SPEC-EPISODES-INCONNUS.md`. Ce contrat complète la carte partagée
`SEENIT-UX-014` sans réinventer son identité, sa progression ni la résolution des diffuseurs.

## Ordre et regroupement

L'Historique est une seule chronologie mélangeant films et épisodes. Chaque visionnage reste une entrée
indépendante et l'ordre suit son horodatage réel, du plus récent au plus ancien. Les entrées sont groupées
par jour local : `Aujourd'hui`, `Hier`, puis jour + date ; l'année n'est ajoutée que hors année courante.
Le titre de groupe est l'unique endroit où la date calendaire est affichée. À l'intérieur d'un groupe,
les entrées avec une heure connue sont triées par heure décroissante ; une heure inconnue n'est jamais
fabriquée pour l'interface.

Une date seule, même explicite, ne constitue pas une heure. Le calcul de « Hier » suit le calendrier
local et non une soustraction de 24 heures au passage heure d'été/hiver.
Une donnée legacy sans `watchedAt` explicite peut conserver un jour de repli afin de ne pas disparaître
de l'historique, mais ce repli ne devient pas une heure de visionnage. L'interface masque alors l'heure
et affiche uniquement la coche décorative. `00:00` et l'heure courante ne sont jamais inventés.

## Carte 8f partagée

Films et épisodes utilisent le même cadre 8f : wrapper vertical de 176 px comprenant les 20 px de
débordement de l'affiche, carte de 156 px, affiche 86 × 129 px inclinée de −3°, fond teinté, backdrop
sur la droite, voile sombre, titre or `#F2C36B`, code blanc, segments de progression et diffuseur en bas.
Le composant visuel reste partagé ; un film d'historique n'introduit pas une seconde géométrie de carte.

Pour une série, le code est `Sxx · Exx`, la seconde ligne expose la durée lorsqu'elle est connue et la
troisième le titre de l'épisode. Le fond privilégie le `still_path` de l'épisode puis le backdrop de la
série. Les segments représentent la saison de cet épisode selon la progression actuelle ; l'entrée de
l'historique reçoit l'état `history` déjà défini par la 8f. Les totaux ou diffusions inconnus restent
inconnus selon le contrat porté par #690/#659.

Pour un film, le code est `Film · AAAA` lorsque l'année TMDB est connue, la seconde ligne expose la durée
et la troisième au plus deux genres TMDB. Le backdrop du film est utilisé lorsqu'il existe. Si le film
appartient à une collection TMDB, un segment représente chaque film de la collection, trié par date de
sortie : déjà vu = `seen`, film de l'entrée courante = `history`, sorti non vu = `unseen`, pas encore sorti
= `future`. Sans collection, un unique segment `history` est rendu. Au-delà de 30 entrées, la barre devient
continue comme pour les saisons longues.

## Zone d'historique et interactions

En haut à droite, l'Historique rend uniquement une coche décorative or et, si elle est réellement connue,
l'heure locale en `HH:MM`. Cette zone n'est pas un CTA Vu/Non vu, n'a ni fond ni date et n'intercepte pas
l'ouverture de la carte.

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
le résolveur SeenIt existant ; une provenance Plex explicitement persistée peut forcer le visuel Plex pour
ce visionnage, sinon la préférence de plateforme existante s'applique.
`Revoir` utilise cette résolution et le cache public existant ; il ne lance pas de seconde requête
directe aux plateformes. À défaut de destination connue, l'utilisateur peut ouvrir la fiche exacte.
Les variantes de clé épisode sont normalisées avant déduplication et mutation. Lorsque la liste
`seenEpisodes` existe, elle fait foi : un record orphelin ne ressuscite pas un épisode retiré.

Les écritures de changement d'horodatage et de retrait non vu conservent les autres métadonnées du record,
recalculent `lastWatchedAt` à partir des preuves restantes et offrent un rollback utilisateur. PWA et APK
partagent exactement la même logique métier et le même rendu responsive 360/412/desktop.
