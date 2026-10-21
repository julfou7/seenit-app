# Carte série 8f

Demande du 21 octobre 2026, suivi #690. Référence fournie par le propriétaire :
`Connexion du repository seenit-app.zip`, `handoff-8f/SPEC-CARTE-8F.md` et section
`#8f` de `SeenIt Cartes.dc.html`. Les variantes 8g/8h et la refonte globale sont distinctes.

La carte partagée mesure 156 px, avec 20 px réservés au débordement de l'affiche.
Affiche 86 × 129 px inclinée de −3°, à gauche 14 px et en haut −20 px ; fond arrondi
22 px teinté par la couleur de l'affiche (fallback 260), backdrop à droite et voile sombre.
Titre 17 px/800 sur deux lignes, code S05 · E04 or clair, information secondaire,
puis titre épisode 14 px sur deux lignes. Saison en bas : S5 · 3/8, segments de 8 px,
logo diffuseur 26 px dans une cible de 44 px. Police Plus Jakarta Sans déjà chargée.

Un épisode vu est or, le prochain a un contour blanc, un futur est hachuré ; l'entrée
d'historique est mise en évidence. Une diffusion inconnue reste explicitement inconnue.
Au-delà de 30 épisodes, une barre continue exprime les proportions sans multiplier le DOM.
L'absence de taille de saison ne doit jamais produire un faux total.

Les carrousels restent libres et virtualisés ; une carte y prend la largeur mobile utile
(420 px sur grand écran). La même carte en liste prend la largeur disponible. Les films
gardent leur présentation actuelle. Aucun nouveau chargement TMDB par carte pour la couleur
ou les segments : métadonnées déjà connues, affiche existante et cache local borné.
Pour le cartouche affiche, `posterPath` reste prioritaire ; s'il est absent ou cassé, le
backdrop/still déjà injecté dans la carte est réutilisé avant le fallback aux initiales,
sans ajouter d'appel fournisseur.

L'ouverture de série, la coche Vu, les rappels et les actions d'historique sont séparés.
La coche réutilise l'écriture et le toast Annuler existants. À venir affiche les jours
exacts et la cloche ; Historique l'heure et un accès aux actions, sans coche Vu/Non vu.
Les menus contextuels et l'appui long possèdent un accès clavier et annulent leur timer
au mouvement/démontage. Les gestes de retrait existants gardent confirmations et Annuler.

Ce contrat est limité au composant et à ses intégrations. Les propositions fonctionnelles
non encore câblées dans le handoff ne deviennent pas des comportements fictifs.

Le résolveur partagé de reprise est aussi utilisé par l'action Vu. Il ne prend jamais le
prochain épisode à diffuser comme prochain à voir. Un pointeur manquant se replie sur des
épisodes du cache dont la diffusion est prouvée, puis sur le premier épisode si la série
n'a jamais été commencée et possède une preuve positive de diffusion. Sans preuve suffisante,
la carte demande une actualisation plutôt que d'annoncer « À jour » ou d'inventer une écriture.
