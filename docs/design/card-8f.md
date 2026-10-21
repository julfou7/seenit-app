# Carte série 8f

Demande du 21 octobre 2026, suivi #690. Référence fournie par le propriétaire :
`Connexion du repository seenit-app.zip`, `handoff-8f/SPEC-CARTE-8F.md`, le prototype
`handoff-8f/SeenIt Card8f.dc.html` et la section `#8f` de `SeenIt Cartes.dc.html`.
Les retours terrain du propriétaire sur les APK 1.4.212/1.4.213/1.4.214 priment sur les passages
plus anciens du handoff en cas de contradiction.

La carte partagée mesure 156 px, avec 20 px réservés au débordement de l'affiche.
Affiche 86 × 129 px inclinée de −3°, à gauche 14 px et en haut −20 px ; fond arrondi
22 px teinté par la couleur de l'affiche (fallback 260), backdrop à droite et voile sombre.
Le titre de série est or clair `#F2C36B`, 17 px/800 sur deux lignes ; le code `S05 · E04`
est blanc et 13 px/800. Le titre d'épisode reste blanc 14 px/600 sur deux lignes.

Le compteur textuel `N restant(s)` est supprimé de la carte : l'espace est réservé aux
badges contextuels. Pour un épisode de reprise diffusé récemment, la carte peut afficher
`🔥 Sorti aujourd’hui`, `🌟 Sorti hier` ou `🆕 Il y a N jours`. Les compteurs de retard
restent autorisés dans les notifications, où ils répondent à un autre besoin.

Le libellé redondant `S5 · 3/8` sous l'affiche est supprimé. La ligne basse contient seulement
les segments de progression et, lorsqu'il est connu, le logo diffuseur 26 × 26 px dans une
cible de 44 px. Un épisode vu est or, le prochain a un contour blanc, un futur est hachuré ;
l'entrée d'historique est mise en évidence. Une diffusion inconnue reste explicitement inconnue.
Au-delà de 30 épisodes, une barre continue exprime les proportions sans multiplier le DOM.
L'absence de taille de saison ne doit jamais produire un faux total.

Dans les trois rails séries réduits de À Regarder (`Continuer`, `Nouveautés`, `Pas vu depuis`),
le défilement n'est plus libre : `scroll-snap-type: x mandatory`, chaque carte est un arrêt
`scroll-snap-stop: always` et une carte mobile occupe environ 88 % du viewport afin de laisser
un aperçu de la suivante à droite. Le rail Films à voir conserve son défilement libre issu de
#229. Les listes verticales et les films ne changent pas.

La coche SeenIt de la 8f suit la maquette v2 : cible 48 × 48 px, pictogramme 34 px, écran plein
`#0B0B0F`, cadre `#A1A1AA` 4,5 px et coche `#E4E4E7` 6,5 px. Elle doit rester très lisible sur
le backdrop, sans opacité grise ni animation de texte concurrente. Elle réutilise l'écriture
métier et le toast Annuler existants.

Pour le cartouche affiche, `posterPath` reste prioritaire ; s'il est absent ou cassé, le
backdrop/still déjà injecté dans la carte est réutilisé avant le fallback aux initiales,
sans ajouter d'appel fournisseur. Dans l'APK Android, l'image visible ne dépend jamais d'un
chargement CORS destiné au calcul de teinte : la WebView charge d'abord le visuel normalement,
et une lecture de pixels refusée conserve simplement la teinte de secours. La PWA peut garder
le chargement CORS anonyme TMDB qui permet le calcul de teinte lorsqu'il est accepté. Aucun
nouveau chargement TMDB n'est déclenché par la couleur, les segments ou ces fallbacks.

L'ouverture de série, la coche Vu, les rappels et les actions d'historique sont séparés.
À venir affiche les jours exacts et la cloche ; Historique l'heure et un accès aux actions,
sans coche Vu/Non vu. Les menus contextuels et l'appui long possèdent un accès clavier et
annulent leur timer au mouvement/démontage. Les gestes de retrait existants gardent leurs
confirmations et Annuler.

Le résolveur partagé de reprise est aussi utilisé par l'action Vu. Il ne prend jamais le
prochain épisode à diffuser comme prochain à voir. Un pointeur manquant se replie sur des
épisodes du cache dont la diffusion est prouvée, puis sur le premier épisode si la série
n'a jamais été commencée et possède une preuve positive de diffusion. Sans preuve suffisante,
la carte demande une actualisation plutôt que d'annoncer « À jour » ou d'inventer une écriture.
