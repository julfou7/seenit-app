# AUDIT-2026-10-23-ACCUEIL-MAQUETTES

Identifiant : AUDIT-2026-10-23-ACCUEIL-MAQUETTES.
Date : 23 octobre 2026. Baseline : v1.4.218, commit `b8fa793b55250c5377f09f9a5dd72772d879a392`.
Périmètre : header, trois onglets À voir, cartes 8f, billets, notifications et leurs gestes.
Références : archive `Connexion du repository seenit-app (8).zip`, SPEC-ACCUEIL v3, Prototype.dc.html actualisé, Card8f.dc.html, Row.dc.html ;
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
| À venir | V3 : J-X/auj., rectangle neutre, date courte et ouverture épisode | P2, remplacer le rond/les couleurs de délai, J-7 inclus et aucun badge statut |
| Historique | V3 : liste compacte unique au lieu du cadre 8f et des groupes | P2, vignette 92×52, date par ligne, sans barres, dix puis Voir plus, actions et Annuler conservés |
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

## Réception du ZIP (8) — SPEC v3

Le ZIP actualisé a été identifié après le premier lot 2625ab8 ; la déclaration précédente « SPEC à jour » concernait encore le ZIP (7). La nouvelle source est comparée avant clôture de ce lot. Les différences v3 À venir/Historique sont intégrées dans la même PR #739. Les consignes utilisateur gardent priorité pour badge et dernière section. Les billets horizontaux suivent le prototype (année/durée et fin en talon) lorsque le texte v3 est contradictoire. Le nouveau smoke complet Chromium 360/412/1280 est vert : liste historique unique 92×52 sans groupes/progression, appui long sans ouverture au relâchement, clavier, Revoir passif, édition/retrait et Annuler legacy, J-132, J-X/auj., ouverture épisode et CTA Explorer des trois états vides. Captures historique et À venir inspectées. Les anciens tests liés au logo/cadre 8f historique ont été adaptés au contrat v3, sans retirer la résolution de Revoir. Validation canonique finale requise avant push.

## Contrôle avant APK — centrage demandé

L’utilisateur autorise désormais la publication et signale le centrage du bouton sur home-upcoming-412.jpg. La colonne d’action réserve explicitement 48 px et centre son contenu ; la cloche reste hors flux. Le contrôle navigateur mesure séparément cible, surface et texte pour auj., J-5, J-31 et J-132, à 360/412/1280 px, avec un écart maximal de 0,5 px au centre du corps de carte. Cette demande lève le report de publication après les validations.


## Retour terrain v1.4.219 et réception ZIP (9)

Baseline59022f331d6e30d115e91d52ce4221664961a783. Source : quatre captures du23octobre18h46/19h18 et SPEC-ACTEURS-FILMS.md / SeenIt Prototype.dc.html (ZIP9). Terrain KO du centrage précédent : l’hypothèse du centre du corps entier était erronée. La référence expose ckTop34px + cible48px, donc centre58px dans le corps150px, et non75px. Le nouveau TNR passe par SeriesEpisodeCard réel et mesure ce repère de référence.

| Constat | Frontière de production / cause | Correction attendue et preuve | Suivi |
|---|---|---|---|
| Rail séries limité à3 | WatchNextSection slice3 sans tuile terminale | six puis Voir en liste, liste par12 ; clic réel Chromium vers8séries | #729 |
| Films limités et ordre mouvant | slice3 ; sort sur durées enrichies en asynchrone | six puis liste, ajout récent/identité stable, libellé visible ; TNR permutation source/durée | #729 |
| Glyphes films/séries différents | SVG signature100×100 avec marges internes vs compact maquette100×74 | variante partagée écran/check, mêmes proportions | #729 |
| Vu/J-X trop bas | contrôle centré sur150px au lieu de la zone supérieure116px | centre58px, cloche hors flux ; mesures360/412/1280 | #729 |
| Groupes À venir trop gros | règle partagée20px des titres de sections |13px/700 neutres selon prototype | #729 |
| Punisher rogné | titre deux lignes borné et métriques CSS | titre15px/18px, deux lignes complètes, aucun overflow104px | #729 |
| Liste films peu informative | absence du module acteur du ZIP9 | acteur local top10/favori/connu/neutre, année seule, métadonnées100px dans corps104 | #729 |
| Mini-fiche acteur | nouvelle évolution explicite ZIP9 | DialogLayer/favoris/addShow/PersonDetailModal réutilisés, demande unique combined_credits à l’ouverture, cache UID, focus/Retour | #729 |

Validation en cours : tests de sélection/ordre et transport Plex verts, compilation TypeScript en cours de confirmation, smoke Chromium en cours. Aucune validation téléphone physique déduite des captures navigateur. Les anciennes assertions de centre75px et de rail3 sont remplacées par les références ZIP9, sans masquer les effets métier. Difficulté effectivement rencontrée : TNR textuels anciens contraignant la valeur3 malgré le nouveau besoin ; ils suivent maintenant HOME_PAGE_SIZE et des interactions de composants réels vérifient l’accès exhaustif. Le suivi #729 porte ces constats, sans issue doublon.


Validation finale du lot ZIP9/Plex :1019/1019 tests unitaires verts ; smoke Chromium complet360/412/1280 vert, notamment accès aux8séries et22films par tuile/lots, Punisher sur2lignes dans104px, filmographie à l’ouverture/réouverture en cache, favoritisme et ajout via les handlers, Échap/Retour et focus, isolation au changement de compte. Captures mini-fiche412, billets360 et À venir412 inspectées. Les mesures8f utilisent58px et non l’ancien centre75px. La première fixture ne reproduisait pas le reset favoris à l’authentification : alignée sur le listener réel avant le TNR d’isolation. Les tests réseau localhost/Git temporaires requièrent le contexte de validation autorisé sous Windows ; leur relance autorisée est verte. Validation canonique APK requise avant push ; téléphone physique et latence réelle restent à vérifier dans la prochaine APK groupée.


## P2 de revue #744, avant APK220

Baseline51dac1ee7dca5f055c00d41534bd4203160ee249 (#742). Revue4362661319 confirmée : suspendre setDoc de migration dans performPlexSync réel, passer A→B puis reprendre envoyait1requête avec le token Plex A et mettait B en pause. TNR rouge avant correction (requests1 au lieu0). Le transport impose désormais l’UID d’origine, vérifie l’auth avant l’envoi et après les en-têtes, et l’engine recontrôle après migration. TNR verts :0requête après migration/en-têtes si changement ;429 d’une requête A déjà en vol persiste uniquement la pause A. Aucun curseur écrit. Portée transport/engine, aucune modification UI ; les captures360/412/1280 du lot #742 restent applicables. Candidate220 existante conservée en attente et recyclée sur le nouveau main après merge/CI, aucune APK lancée avec le finding connu. Suivi dédié auto-créé #744, commun à #741.

Revue de #745 (4362748684) : la garde native était verte mais authenticatedFetch cachait encore une attente getIdToken côté Web. TNR ajouté en bundlant la vraie façade apiAuth : rouge avant (« Missing expected rejection »), vert après pour PWA et secours WebView avec deux DNS natifs refusés. expectedUid est contrôlé immédiatement avant fetch, sans retirer le diagnostic delta ni la protection HTML. Le lot #745 corrige les deux frontières avant merge ; aucune APK intermédiaire.

## Vidéo de bascule, avant APK220 (#729)

Baseline40eed2a854436b3c3acc32ddad2a31cb4b577eae. Source : Screen_Recording_20261023_193241_SeenIt.mp4 et précision utilisateur « Carrousel ↔ liste des films ». Le rail conservait scrollLeft, mais la liste reprenait au début sans ancrage vertical. Le tri restait identique. La bascule mémorise désormais l’identité exacte et la coordonnée de la première carte lisible, restaure le défilement avant affichage et conserve assez de cartes chargées au retour. Le bouton inférieur permet de revenir depuis une liste paginée ; reset et démontage nettoient les compensations locales. Aucune progression métier ni ordre média modifié. TNR Chromium de production : défilement jusqu’au troisième film, bascule dans les deux sens, retour depuis les derniers films chargés et reset ; baseline rouge sur la conservation des coordonnées, correction à confirmer à360/412/1280.

Deux frontières CSS supplémentaires mesurées : la réduction des animations créait une transition implicite sur toutes les marges ; sa durée passe à0s. Sur écran large, le padding24px du rail gardait un scroll-padding16px ; les deux valent désormais24px. Les TNR vérifient les coordonnées avant/après avec et sans mouvement réduit, sans tolérance élargie.


## Terrain220 KO et ZIP10 — V4 du24octobre

Les captures terrain invalident la preuve220 : elle ne couvrait ni le déplacement collatéral de l’en-tête/section précédente ni le changement de groupe optimiste lors de Vu. La V4 conservée dans `docs/design/home-a-voir-v4.md` remplace les descriptions intermédiaires ci-dessus (v3, popup acteur et listes par12).

| Retour / évolution | Frontière réelle et correction | Suivi |
|---|---|---|
| Bascule qui décale les cartes | wrappers rail/liste et hauteur variable avec badge ; hôte170 et mêmes marges, ancrage conservé ; mesure carte/en-tête/section précédente/scroll<1px | #729 |
| Swipe déformé et premier tap perdu | fermeture en flux et actions trop hautes ; boutons150, fermeture absolue, clic synthétique isolé et garde relâchée sur action explicite | #729 |
| Animation Nouveautés perdue | store optimiste changeant le groupe avant acquittement ; source retenue puis animation800ms et transfert en tête/scroll, jamais après échec | #729 |
| Totaux Knight/Harry | preuvev2 confondant planning et compte positif, placeholder1 confirmé ; v3 garde un total déclaré>1 et laisse1 inconnu sur saison ouverte, réparationv2 ciblée | #729 |
| Film3 sans barres | adaptateur film sans progression ; collection TMDB explicite, identités exactes, tri dates et états locaux, aucune déduction du titre | #729 |
| Billets rognés / serveur | corps120/affiche80/talon84 ; titre/acteur séparés dans le rail ; nom serveur retiré, logo gardé | #729 |
| Rythme, badges, chargement | titres40/20, espaces28, barrebottom7, voile gauche sans flou, emoji22 et réglage animation ; rail6+tuile, liste3+6 sans Revenir | #729 |
| Historique V4 | frise, durées réellement connues (partiel signalé), groupes adjacents même jour et épisodes consécutifs, affiche64×96, actions individuelles préservées | #729 |
| Fiche acteur V4 | plein écran, Ton lien unique, futurs/rappels existants, À voir4, Vus rail, grille9+9 sans doublons, bio tronquée selon débord réel ; cachefr-FR/UID | #729 |
| FPS lancement/Plex | abonnement global aux messages, réhydratations disque en rafale, historique masqué actif ; abonnement isolé, disque par4/index par20 hors premier rendu, historique différé | #741 |

Preuves ciblées :47tests verts ; Chromium360/412/1280 vert pour ancrage complet, swipe tactile150/170, vraie confirmation Firestore avant animation/transfert/scroll et messages Plex sans rerendre la liste. Stress412 :192identités hydratées, puis12mises à jour sans nouvelle lecture et0filmographie avant ouverture. Les variantes fiche acteur/frise/collection, les rappels acteur, le réglage des badges et le retour système passent aussi le smoke complet. La validation canonique confirme1027tests verts, TypeScript, contrats, sécurité et budgets du build. Un TNR plus strict a ensuite trouvé un décalage de2,5px entre premiers titres : même gabarit40px et même alignement flex désormais imposés aux trois onglets, avec mesure du texte±1px. Les résultats du SHA final sont consignés dans le checkpoint #729/#741 et la PR. Les fournisseurs et écritures sont simulés derrière les façades de production ; aucun compte personnel ni appel Firestore réel. Pas de résultat FPS téléphone revendiqué. Aucune APK ni version supplémentaire pendant la collecte utilisateur.

Revue #750, finding4366417266 P2 confirmé : ShowDetail marque parfois une saison entière avec le même watchedAt ; le tri lexical de HistoryFeed produisait E1,E10,E11… et cassait le regroupement. Reproduction rouge sur le vrai HistoryFeed :12épisodes simultanés rendaient10lignes paginées au lieu de la session×12. Le comparateur de production ordonne les égalités par série puis saison/épisode décroissants (heure attestée seulement), avant regroupement/pagination. TNR pur du même comparateur et scénario navigateur réel ajoutés ; films ex æquo séparés et heures inconnues non regroupées. Validation finale du correctif requise avant push.
