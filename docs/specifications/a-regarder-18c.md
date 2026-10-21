# À Regarder 18c — cartes séries et tickets films

Référence produit : issue #712. Ce contrat complète la carte partagée 8f et l'historique 16d sans modifier l'identité média, les écritures métier ni les règles de progression existantes.

## Contrat UX-016

`SEENIT-UX-016` — La vue **À Regarder** présente les séries à reprendre avec la géométrie partagée 8f et les films à voir sous forme de tickets déchirables, en conservant l'ordre métier canonique et des actions réversibles.

### Séries

- La zone « Continuer à regarder » affiche d'abord au plus trois cartes série, dans l'ordre déjà calculé par le produit, sans doublon ni nouvelle règle de priorité.
- Lorsque plus de trois séries sont disponibles, un contrôle distinct affiche les trois affiches suivantes et le nombre d'éléments encore masqués. Chaque activation ajoute au plus trois cartes ; un contrôle « Réduire » revient aux trois premières.
- Une carte série réutilise le composant 8f et son identité `tv + TMDB ID`. Elle affiche le prochain épisode réellement regardable à partir des preuves de progression existantes ; `nextEpisodeToAir` reste une information de diffusion et ne remplace jamais artificiellement le prochain épisode à voir.
- Marquer l'épisode proposé comme vu utilise l'écriture métier de production, conserve Annuler et met à jour la progression visible. Une série à jour peut proposer le retour vers un épisode explicitement connu, sans inventer d'épisode ni de total.
- L'animation de coche/tampon/segment est une conséquence visuelle de la mutation confirmée. Elle respecte `prefers-reduced-motion` et ne masque jamais l'état final.

### Films

- Les films à voir sont rendus dans un rail de tickets ordonné comme la source métier, sans reclassement local. Chaque ticket mesure environ 144 px de large ; l'affiche occupe la partie haute et un talon d'environ 36 px porte l'action et les informations compactes.
- Le ticket conserve l'identité `movie + TMDB ID`. L'année provient des métadonnées connues. La durée inconnue reste inconnue : aucune heure de fin n'est calculée sans durée fiable.
- Lorsque la durée est connue, l'heure de fin est calculée à la minute depuis l'heure de lancement choisie, ou depuis l'instant présent lorsque l'utilisateur lance maintenant. Une fin après minuit reste explicitement distinguée ; aucun changement de jour n'est déduit d'une durée absente.
- Marquer un film vu utilise l'écriture métier existante, garde Annuler et joue la déchirure/tampon SeenIt. Le film reste à sa position pendant la session afin que l'annulation soit compréhensible ; il peut disparaître au prochain rafraîchissement canonique.
- Le rail peut se terminer par une tuile « Voir tout » lorsque la collection dépasse le sous-ensemble visible. Cette tuile n'est pas un média et ne reçoit aucune identité TMDB.

### Interaction et accessibilité

- Les cibles tactiles et clavier structurantes font au moins 44 px ; les contrôles ont un nom accessible et un focus visible.
- Les actions coche, développement/réduction et Voir tout n'ouvrent pas accidentellement la fiche média. L'ouverture de fiche conserve le point d'entrée de production existant.
- Les confirmations, toasts et Annuler existants sont préservés. Aucun swipe Archiver/Supprimer n'est ajouté.
- Les images utilisent les helpers/fallbacks partagés déjà validés pour PWA et Android ; ce chantier n'introduit pas une nouvelle stratégie d'images.
- Le comportement reste utilisable à 360 px, 412 px et desktop, sans dépendance supplémentaire pour CSS ou animation.

## Non-objectifs

Aucune migration de données, nouvelle identité média, modification Firestore, refonte transverse de l'accueil, changement Plex, changement d'identité/signature APK ou publication implicite n'appartient à ce contrat.

## TNR attendus

Les tests passent par les composants et handlers de production : séries 0/1/3/4/7+, ajout par lots de trois puis Réduire ; progression à jour/en retard/total inconnu ; film durée connue/inconnue et passage après minuit ; coche série et film avec Annuler ; ordre stable pendant la session ; séparation des actions et de l'ouverture de fiche ; réduction des animations. Le smoke Chromium couvre 360/412/1280 et les interactions clavier essentielles.
