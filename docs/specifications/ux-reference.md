# SeenIt — Référence UX

Date : 9 septembre 2026. Baseline inspectée : 1.4.125.

Ce document complète `seenit.md` §9 et `functional-reference.md`. Il distingue les comportements
observés des cibles de normalisation encore ouvertes. Il ne certifie ni le rendu sur appareil ni la
conformité accessibilité. Les exigences existantes `SEENIT-UX-001..004`, `SEENIT-FUNCTIONAL-001`,
`SEENIT-QUALITY-002/003` et les règles métier restent autoritatives. Les cibles non encore livrées
ci-dessous restent des propositions de réalisation dans les issues liées ; les règles explicitement
marquées comme livrées décrivent le comportement attendu du runtime courant.

## 1. Principes à préserver

- Même action, même sens, même libellé et mêmes états dans les écrans qui l'exposent.
- Garder l'identité SeenIt sombre/or et son glyph de validation. L'or principal est `#E5A93D`.
- Conserver les variantes utiles : affiche verticale, carte épisode horizontale, transfert avec
  progression, personne. Une carte de téléchargement n'est pas un poster avec tous ses boutons.
- Un geste accélère une action explicite accessible. Il ne doit pas devenir obligatoire pour utiliser
  la fonction, notamment au clavier ou avec TalkBack.
- Séparer consulter, marquer vu/non vu, abandonner, retirer du suivi et annuler un transfert.
  La normalisation n'autorise aucune modification de leurs effets métier ou de leurs identités.
- Un changement local suit le parcours light si applicable ; une migration de composants se fait par
  écran, sans refonte complète ni dépendance UI lourde par défaut.

## 2. Carte des gestes observés

| Contexte | Geste actuellement codé | Effet | À préserver / écart |
|---|---|---|---|
| Navigation basse, autre onglet | Appui | Ouvre l'onglet, ferme les superpositions via l'événement global | Conserver la destination ; le timestamp compte actuellement ce tap dans un futur double appui. |
| Navigation basse, onglet actif | Appui simple | Émet `app-close-modals`, puis recule l'historique si modal, sinon ferme la fiche | Intention de retour utile ; vérifier qu'un seul niveau se ferme. |
| Navigation basse | Deux taps espacés de moins de 450 ms | Appelle le reset ; le premier appui simple est immédiat | Reconnaissance à fiabiliser et portée à limiter : #178. |
| Double appui Explorer | Reset + remontée | Recherche vide, catégorie Tout, plateformes/genres vides, âge Tous, note Toutes, tri populaire descendant, hero première carte | Préserver ce raccourci volontaire, montrer son effet ; jamais effacer les préférences du compte. |
| Double appui Profil | Ferme Réglages/personne + remontée | Le sous-onglet Statistiques/Ma Liste reste inchangé | Ne pas annoncer un retour à Statistiques comme déjà réalisé. Cible à décider dans #178. |
| Double appui À voir/Télécharger | Remontée | Aucun événement local de reset métier | Préserver filtres/choix de ces écrans. |
| Modal épisode | Glisser vers la gauche | Épisode suivant, puis saison suivante si disponible | Aucune progression vue ajoutée par la navigation. |
| Modal épisode | Glisser vers la droite | Épisode précédent, puis fin de saison précédente si disponible | Même série exacte ; limites sans bouclage. |
| Modal épisode | Déplacement > 60 px ou vitesse > 200 | Déclenche précédent/suivant si disponible, sinon retour en place | Seuils observés, pas une certification de confort. Alternatives absentes : #179. |
| Carte série `SwipeableCard`, par défaut | Gauche / droite | Supprimer / Abandonner, configurables par le parent | Afficher l'action réellement liée, conserver confirmation/annulation du contexte. |
| Carte téléchargement | Droite | Retirer historique ou demander confirmation pour annuler actif | Aucun effacement de fichier implicite ; directions différentes justifiées par le contexte. |
| Grille Explorer | Appui long 500 ms, ou menu contextuel | Aperçu lorsque `onLongPress` existe ; mouvement annule le timer | Ajouter annulation au démontage/pointercancel et alternative accessible : #180. |
| Réglages et personne | Depuis bord gauche (zone 70 px), glissement droit > 90 px | Ferme le panneau | Conflit avec geste système Android à vérifier ; ne pas généraliser à tous les écrans. |
| Fiche média | Handlers de bord actuellement vides | Pas de swipe Retour personnalisé actif | Utiliser Retour visible/natif ; ne pas promettre ce geste partout. |

Le reset actuel scrolle tous les éléments scrollables du document, y compris les onglets cachés.
Cette portée est un écart (#178), pas une règle produit à reproduire.

## 3. Navigation — ordre livré et cible #178

L'organisation de la barre basse est désormais explicite et stable :

- sans la fonctionnalité Téléchargements : **À Voir → Explorer → Profil** ;
- avec Téléchargements activés : **À Voir → Explorer → Télécharger → Profil** ;
- **Profil reste toujours à droite** et **Télécharger occupe toujours la troisième position** lorsqu'il
  est visible ; son masquage continue de dépendre exclusivement du réglage personnel déjà défini ;
- chaque destination se partage la largeur utile au lieu d'être enfermée dans une largeur maximale
  étroite ; le contrôle conserve au moins **44 × 44 CSS px**, les glyphes de la barre sont rendus à
  **28 px** et les libellés mobiles à **10 px** afin de rester lisibles sans agrandir inutilement la barre ;
- l'onglet actif est annoncé par `aria-current` en plus de son état visuel or.

Le contrat d'appui/reset de #178 reste distinct de cet ordre visuel et doit encore être finalisé :

- Une activation d'un autre onglet change de destination sans reset.
- Un appui sur l'onglet actif revient d'un seul niveau visible ; à la racine il n'efface rien.
- Deux appuis sur le même onglet déjà actif constituent un raccourci de reset de sa vue uniquement.
  Le passage A → B → B ne doit pas consommer le premier tap comme un reset inattendu.
- Explorer conserve le reset détaillé ci-dessus ; À voir et Télécharger remontent seulement.
  Pour Profil, la proposition est retour à Statistiques, à intégrer explicitement avec #178.
- Chaque reset a une alternative visible accessible et ne touche ni bibliothèque, ni progression,
  ni préférences cloud. L'onglet actif est annoncé aux technologies d'assistance.
- Le double appui applicatif ne remplace pas l'activation standard du lecteur d'écran. Les tests
  TalkBack doivent vérifier son comportement réel.

## 4. Boutons et retours d'action — proposition #180

| Rôle | Présentation commune cible | Exemples |
|---|---|---|
| Action principale | Or SeenIt, texte lisible, verbe explicite | Enregistrer, Ajouter à voir, Installer |
| Secondaire | Surface neutre, contour discret | Fermer, Plus tard, Réessayer |
| Destructive | Ton rouge/rose + texte précis, jamais couleur seule | Retirer du suivi, Annuler le téléchargement |
| État sélectionné / vu | État métier exprimé par texte et symbole | Vu ; action inverse Marquer comme non vu |
| Fournisseur | Accent/logo du service dans le contrôle concerné | Plex, Sonarr, Radarr, qBittorrent |

Une famille légère `Button`, `IconButton`, `WatchToggle` suffit comme cible ; noms indicatifs, pas une
obligation d'architecture. Les cartes et en-têtes consomment ces rôles plutôt que copier les classes.

- Cible tactile au moins 44 × 44 CSS px ; la taille du pictogramme peut rester plus petite. Les contrôles
  compacts doivent élargir leur zone de clic sans chevaucher l'action voisine.
- Nom accessible, focus visible, `type="button"` sauf soumission réelle ; contrôle sélectionné annoncé.
- Une action async distingue appui, en cours, réussite et échec. La brève animation de pression n'est
  pas une preuve de succès ; la valeur finale vient de l'état métier.
- L'action en cours empêche un second envoi de la même intention ; une erreur rend l'action utilisable
  avec contexte et possibilité de reprise. Ne pas désactiver toute la page pour une action locale.
- `SeenItCheckButton` reste le symbole SeenIt ; sa cible, son état pending et son libellé doivent être
  corrigés sans modifier le launcher Android.
- Garder/Annuler reçoit le focus initial d'une confirmation destructive. Un texte précise ce qui sera
  retiré et si les fichiers sont conservés. Une opération réussie annulable expose Annuler.

## 5. Cartes — proposition #180

L'action d'ouverture de fiche et les actions rapides sont deux zones distinctes, accessibles au
clavier et sans bouton imbriqué dans un autre bouton. Entrée/Espace ouvre la fiche focalisée ; agir
sur Vu, favori ou téléchargement ne doit pas ouvrir aussi la fiche. Les raccourcis ne capturent jamais
la frappe dans un champ de texte.

L'affiche garde un ratio stable et un fallback cohérent. Type Film/Série, statut et progression ne
reposent pas sur une couleur seule. Une légende importante ne disparaît pas derrière la nav ou une
troncature sans accès au contenu complet. Le chargement chaud préserve contenu et position ; le skeleton
est réservé au contenu inconnu. Les cartes de transfert conservent leur clé et leur affiche pendant
la réconciliation (contrat existant `SEENIT-UX-002`).

L'appui long ne déclenche pas un clic supplémentaire à son relâchement. Scroll, annulation système et
démontage annulent tout timer ; un menu ou bouton accessible permet aussi d'ouvrir l'aperçu.

## 6. En-têtes, dialogues et safe areas — proposition #181

Trois familles suffisent : en-tête d'onglet racine, en-tête de fiche avec Retour et actions, en-tête de
dialogue avec titre et fermeture. Elles partagent tailles de contrôle, espacement, noms accessibles et
safe areas ; le hero d'un film peut conserver sa présentation propre.

La pile visible est la source de l'action Retour : dialogue supérieur → fiche → onglet → accueil →
sortie Android. Chaque activation ferme un seul niveau. L'arrière-plan d'un dialogue modal ne reçoit
ni clic ni focus ; à la fermeture, focus et position reviennent à l'élément déclencheur.

Les niveaux de superposition ont des rôles nommés et sont rendus dans un contexte maîtrisé. Une valeur
z-index plus grande n'est pas une preuve suffisante si un parent crée un autre stacking context.
Les panneaux bloquants recouvrent la navigation ; une fiche qui conserve la nav réserve son espace.
Le footer doit rester utilisable avec clavier ouvert, texte agrandi et safe area basse. Éviter le
padding supérieur fixe `pt-10` comme compensation universelle des barres système.

Les erreurs inline concernent leur champ/action ; les toasts restent transitoires et lisibles. Une
annulation utilisateur n'est pas affichée comme une panne. L'installateur lancé garde son succès,
conformément à `SEENIT-UPDATE-004`.

## 7. Preuves UX et ordre de réalisation

1. #178 : ordre et dimensions de la barre livrés ; contrat d'appui/reset et tests à horloge contrôlée encore ouverts.
2. #179 : épisode précédent/suivant accessible avec TNR aux frontières des saisons.
3. #180 : composants pilotes puis migration des cartes/boutons par écran.
4. #181 : pile Retour, dialogues et en-têtes partagés.
5. #15, existante : contrôles de rendu et de parcours communs aux lots précédents.

Les tests unitaires de logique ne certifient pas le confort tactile, le focus DOM ou les safe areas.
Le plan de validation combine :

| Situation | Preuve à obtenir |
|---|---|
| PWA, 360 et 412 CSS px ; desktop au clavier | Captures déterministes, ordre du focus, accès à toute action, absence de chevauchement |
| APK, navigation gestuelle puis trois boutons | Retour, swipe épisode, barre basse et safe areas ; aucune modification d'icône/signature |
| TalkBack, texte agrandi, mouvement réduit | Actions nommées et activables, contenu lisible, animation non nécessaire à la compréhension |
| Épisode de fin de saison, première saison, données absentes | Transition exacte ou maintien de l'épisode courant ; aucun marquage vu involontaire |
| Action lente/échouée et double activation | Une seule intention, feedback correct et possibilité de reprise |
| Retour de fiche et d'une application externe | Contexte et position conservés, pas de listener ou action dupliqués |
| Dialogue et clavier ouvert | Footer visible, focus contenu puis restitué, fond non activable |

Les fixtures des tests sont locales et ne sollicitent pas les services personnels. Les contrôles ciblés
rapides suivent les PR concernées ; les validations Android lourdes restent groupées avec les releases.
Une capture initiale n'est pas automatiquement une baseline approuvée : corriger les défauts connus
avant de verrouiller les images. Les tests de présence de chaînes dans la SPEC ne prouvent pas l'UX.
## 8. Fiche série — cible livrée #216 / #217

La fiche série privilégie une lecture courte et utile sur mobile. Les quatre captures terrain du
9 septembre 2026 ont servi de référence de cadrage ; la règle durable est le comportement ci-dessous,
pas les pixels d'une capture particulière.

- **Où regarder** conserve son titre stable. L'actualisation Plex est une icône attenante au titre,
  avec pictogramme discret mais cible de **44 × 44 CSS px**, nom accessible, `title`, état désactivé
  et rotation pendant l'actualisation. Le comportement réseau reste celui de #214/#206.
- L'en-tête d'une saison est lui-même le contrôle d'ouverture/fermeture. La flèche dédiée disparaît
  afin de libérer la largeur ; l'état reste annoncé par `aria-expanded`.
- L'action de masse emploie **Tout marquer vu** ou **Tout marquer non vu** selon l'intention réelle.
  Elle reste secondaire et compacte visuellement sans réduire sa compréhension.
- Les portraits du casting gardent `object-fit: cover` avec un cadrage vertical orienté vers le haut
  (`50% 25%`) plutôt qu'une détection de visage. Noms et rôles peuvent occuper deux lignes ; le compteur
  d'épisodes est visuellement secondaire.
- Les genres TMDB restent visibles en premier. Les mots-clés/thèmes supplémentaires sont repliés par
  défaut derrière **+N thèmes** et le contrôle de dépliage conserve une cible d'au moins 44 px.
- Une classification d'âge courte reste l'information principale. Lorsqu'une provenance US doit être
  conservée pour audit, elle est affichée en information secondaire et reste disponible au lecteur
  d'écran ; elle n'est jamais présentée comme une certification française.
- Les notes visibles utilisent **TMDB uniquement** conformément à `SEENIT-RATING-001`. La fiche ne
  préchauffe plus IMDb/OMDb et n'affiche plus de badge IMDb. Le graphique détaillé des épisodes vit dans
  l'onglet **Épisodes**, utilise `vote_average` TMDB, se parcourt horizontalement pour les longues saisons
  et conserve des cibles de 44 px. L'onglet **À propos** n'affiche pas un second résumé de ces notes.

Ces règles décrivent le runtime commun PWA/APK. Les captures 360/412 px, le clavier, le texte agrandi
et TalkBack restent des preuves à produire sur la candidate de release, pas des règles alternatives.
