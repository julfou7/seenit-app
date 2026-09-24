# SeenIt — Référence UX

Date : 14 septembre 2026. Baseline inspectée : 1.4.150.

Ce document complète `seenit.md` §9 et `functional-reference.md`. Il distingue les comportements
observés des cibles de normalisation encore ouvertes. Il ne certifie ni le rendu sur appareil ni la
conformité accessibilité. Les exigences existantes `SEENIT-UX-001..006`, `SEENIT-FUNCTIONAL-001`,
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
| Navigation basse, autre onglet | Appui | Ouvre l'onglet, ferme les superpositions via l'événement global | Le changement de destination ne compte jamais dans le prochain double appui. |
| Navigation basse, onglet actif | Appui simple | Émet `app-close-modals`, puis recule l'historique si modal, sinon ferme la fiche | Intention de retour utile ; vérifier qu'un seul niveau se ferme. |
| Navigation basse | Deux taps espacés de moins de 450 ms | Le premier appui revient d'un niveau, le second réinitialise la page active | Contrat livré par `SEENIT-UX-005`, avec portée locale et toast propre à l'écran. |
| Double appui Explorer | Reset + remontée | Recherche vide, catégorie Tout, plateformes/genres vides, âge Tous, note Toutes, tri populaire descendant, hero première carte | Préserver ce raccourci volontaire, montrer son effet ; jamais effacer les préférences du compte. |
| Explorer, liste verticale | Swipe / défilement vertical | La descente masque la barre de recherche ; seule une remontée la réaffiche | Le geste tactile et le `scrollTop` réel gardent la même sémantique ; un swipe de descente ne doit jamais rouvrir la recherche. |
| Double appui Profil | Reset + remontée | Ferme Réglages/personne, revient à Statistiques et nettoie l'état local de Ma Liste | Ne modifie aucun suivi ni statistique. |
| Double appui À voir | Reset + remontée | Revient à À Regarder, replie les sections et remet les carrousels au début | Ne modifie aucune progression. |
| Double appui Télécharger | Reset + remontée | Revient à Mes téléchargements, ferme la configuration, vide recherche/filtres/résultats locaux | N'annule ni n'efface aucun transfert. |
| Carrousel réduit « À Regarder » | Glissement horizontal | Parcourt librement les cartes ; la suite est préchargée automatiquement par lots avant la fin du rail, sans marqueur terminal | Aucun scroll-snap. Le vrai bouton « Voir tout » de l'en-tête reste l'alternative accessible vers la liste verticale exhaustive. |
| Modal épisode | Glisser vers la gauche | Épisode suivant, puis saison suivante si disponible | Aucune progression vue ajoutée par la navigation. |
| Modal épisode | Glisser vers la droite | Épisode précédent, puis fin de saison précédente si disponible | Même série exacte ; limites sans bouclage. |
| Modal épisode | Déplacement > 60 px ou vitesse > 200 | Déclenche précédent/suivant si disponible, sinon retour en place | Le swipe reste disponible ; boutons Précédent/Suivant et ←/→ clavier partagent désormais la même intention via `SEENIT-UX-008`. |
| Carte série `SwipeableCard`, par défaut | Gauche / droite | Supprimer / Abandonner, configurables par le parent | Afficher l'action réellement liée, conserver confirmation/annulation du contexte. |
| Carte téléchargement | Droite | Retirer historique ou demander confirmation pour annuler actif | Aucun effacement de fichier implicite ; directions différentes justifiées par le contexte. |
| Grille Explorer | Appui long 500 ms, ou menu contextuel | Aperçu lorsque `onLongPress` existe ; mouvement annule le timer | Ajouter annulation au démontage/pointercancel et alternative accessible : #180. |
| Réglages et personne | Depuis bord gauche (zone 70 px), glissement droit > 90 px | Ferme le panneau | Conflit avec geste système Android à vérifier ; ne pas généraliser à tous les écrans. |
| Fiche média | Handlers de bord actuellement vides | Pas de swipe Retour personnalisé actif | Utiliser Retour visible/natif ; ne pas promettre ce geste partout. |
| Toast média `À voir` / `Vu` | Appui/clic, Entrée ou Espace | Ouvre la fiche Film/Série exacte | Livré par `SEENIT-UX-006` ; exige `mediaType + tmdbId`, jamais titre/année. |
| Toast de retrait du suivi | Appui/clic | Aucun effet de navigation | La suppression reste non navigable ; `Annuler` reste une action distincte. |

Le reset est local à la racine de l'onglet actif. Il ne scrolle jamais un écran caché.

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

Le contrat d'appui/reset de #178 est distinct de cet ordre visuel et désormais livré :

- Une activation d'un autre onglet change de destination sans reset.
- Un appui sur l'onglet actif revient d'un seul niveau visible ; à la racine il n'efface rien.
- Deux appuis sur le même onglet déjà actif constituent un raccourci de reset de sa vue uniquement.
  Le passage A → B → B ne doit pas consommer le premier tap comme un reset inattendu.
- Chaque page restaure sa sous-vue initiale, replie ses panneaux et efface ses recherches, filtres et
  expansions locales, puis affiche un toast reprenant le glyphe SeenIt de l’onglet en **or**, comme la
  navigation active. À voir revient à À Regarder, Profil à Statistiques, Télécharger à Mes téléchargements
  et Explorer à son filtre Tout. Le reset Profil invalide aussi tout l’état UI local de **Ma Liste** même
  si cette sous-vue a déjà été montée puis masquée ; son prochain affichage repart de son état initial.
  Cette couleur de contexte de navigation ne modifie pas les vrais toasts métier de téléchargement, qui
  conservent leur présentation bleue.
- Chaque reset a une alternative visible accessible et ne touche ni bibliothèque, ni progression,
  ni préférences cloud. L'onglet actif est annoncé aux technologies d'assistance.
- Le double appui applicatif ne remplace pas l'activation standard du lecteur d'écran. Les tests
  TalkBack doivent vérifier son comportement réel.

## 3.1 Fiche épisode — navigation accessible livrée #179

- Le swipe horizontal reste inchangé : gauche → épisode suivant, droite → épisode précédent.
- Deux boutons **Précédent** / **Suivant** d'au moins 44 px utilisent exactement les mêmes handlers que le
  swipe. Les touches ←/→ font de même hors `input`, `textarea`, `select`, contenu éditable ou champ
  ARIA de saisie ; les répétitions clavier et combinaisons avec modificateur sont ignorées.
- Le drag horizontal ne démarre que depuis une surface non interactive. Un appui, un petit déplacement ou
  un geste sur Vu/Non vu, Plex, téléchargement, lien ou autre bouton ne peut donc pas déclencher en plus
  une navigation épisode.
- La fin d'une saison rejoint le premier épisode réellement disponible de la suivante ; depuis le premier
  épisode, Précédent rejoint le dernier épisode réellement disponible de la saison précédente. La saison
  spéciale `0` est admise seulement lorsque le parcours courant la rend explicitement accessible.
  Une saison absente ne produit jamais d'épisode synthétique de frontière.
- Une seule transition est active à la fois. Chaque chargement porte un identifiant de requête ; si la
  fiche change avant la réponse, cette réponse est ignorée. Une erreur conserve l'épisode courant et
  affiche un message de reprise.
- Consulter l'épisode précédent/suivant ne modifie ni progression, ni Vu/Non vu, ni Plex, ni transfert.

La reconnaissance tactile réelle et le conflit avec les gestes système Android restent à valider au doigt
sur appareil ; la CI couvre la logique, les surfaces accessibles et les garde-fous déterministes.

## 4. Boutons et retours d'action — contrat SEENIT-UX-009 / #180

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

## 5. Cartes — contrat SEENIT-UX-009 / #180

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
démontage annulent tout timer ; le menu contextuel du contrôle d'ouverture focalisable fournit également
l'aperçu au clavier.

Le socle runtime commun est porté par `ActionButton`, `SeenItCheckButton` et les cartes pilotes
`GridMediaCard` / `EpisodeCard`. Les migrations d'écrans conservent les variantes métier existantes mais
ne doivent plus réintroduire de bouton sans cible 44 px, d'état async non sérialisé ou de conteneur cliquable
sans sémantique clavier.

## 6. En-têtes, dialogues et safe areas — proposition #181

Trois familles suffisent : en-tête d'onglet racine, en-tête de fiche avec Retour et actions, en-tête de
dialogue avec titre et fermeture. Elles partagent tailles de contrôle, espacement, noms accessibles et
safe areas ; le hero d'un film peut conserver sa présentation propre.

La pile visible est la source de l'action Retour : dialogue supérieur → fiche → onglet → accueil →
sortie Android. Chaque activation ferme un seul niveau. L'arrière-plan d'un dialogue modal ne reçoit
ni clic ni focus ; à la fermeture, focus et position reviennent à l'élément déclencheur.

Pour les fiches média et épisodes, la transition visuelle suit la même pile au lieu de révéler les niveaux
intermédiaires. Une fiche Film/Série possède une seule entrée latérale au niveau de son conteneur ; sa vue
interne et son shell froid ne rejouent pas une animation. La modal épisode fait entrer backdrop et panneau
ensemble. Si le détail épisode n'est pas déjà en cache, elle réserve la géométrie finale sans afficher un
titre ou une image provisoire. Le passage épisode → série dépile l'état de modal en la conservant visuellement
jusqu'au remplacement par la fiche, afin que l'onglet/Historique inférieur ne flashe jamais entre les deux.

Les niveaux de superposition ont des rôles nommés et sont rendus dans un contexte maîtrisé. Une valeur
z-index plus grande n'est pas une preuve suffisante si un parent crée un autre stacking context.
Les panneaux bloquants recouvrent la navigation ; une fiche qui conserve la nav réserve son espace.
Le footer doit rester utilisable avec clavier ouvert, texte agrandi et safe area basse. Éviter le
padding supérieur fixe `pt-10` comme compensation universelle des barres système.

Les erreurs inline concernent leur champ/action ; les toasts restent transitoires et lisibles. Une
annulation utilisateur n'est pas affichée comme une panne. L'installateur lancé garde son succès,
conformément à `SEENIT-UPDATE-004`.

### 6.1 Toasts média navigables — livré #319

Les toasts internes qui confirment **l'ajout à À voir** ou le passage à **Vu / Terminée** d'un film ou
d'une série sont des raccourcis de consultation. Leur surface principale ouvre la fiche uniquement si
le toast transporte une identité complète `mediaType + tmdbId` valide. Le titre, l'année et le texte du
toast ne participent jamais à la résolution.

Le toast de retrait/suppression (`unfollow`) reste informatif sur sa surface principale. Les actions
secondaires comme **Annuler** ou **Ignorer les suivants** sont indépendantes et ne déclenchent jamais
l'ouverture de fiche. Un drag/swipe de fermeture neutralise le clic éventuel du relâchement. La même
règle vaut en PWA et dans l'APK. Au clavier, un toast navigable est focalisable, nommé et s'active avec
Entrée/Espace ; TalkBack/tactile restent une preuve terrain de candidate, pas une variante fonctionnelle.

## 7. Preuves UX et ordre de réalisation

1. #178 : ordre, dimensions et contrat d'appui/reset livrés ; validation TalkBack terrain encore suivie.
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
