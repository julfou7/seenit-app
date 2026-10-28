# SeenIt — Référence UX

Date : 14 septembre 2026. Baseline inspectée : 1.4.150.

Ce document complète `seenit.md` §9 et `functional-reference.md`. Il distingue les comportements
observés des cibles de normalisation encore ouvertes. Il ne certifie ni le rendu sur appareil ni la
conformité accessibilité. Les exigences existantes `SEENIT-UX-001..006`, `SEENIT-FUNCTIONAL-001`,
`SEENIT-QUALITY-002/003` et les règles métier restent autoritatives. Les cibles non encore livrées
ci-dessous restent des propositions de réalisation dans les issues liées ; les règles explicitement
marquées comme livrées décrivent le comportement attendu du runtime courant.

## 1. Principes à préserver

Explorer (#774) : pendant la saisie, champ à 8 px au-dessus du clavier, navigation basse masquée.
Fermeture du clavier/blur : retour à la disposition normale sans vider la recherche ni les filtres.
Une loupe à gauche de la navigation Explorer rouvre la recherche et le clavier sans déplacer les résultats.
Cette action explicite reste accessible après repli de la barre, avec cible tactile >=44 px et nom accessible.

### Bandes-annonces — contrat #447

Un appui ouvre le lecteur partagé ; choisir une vidéo ne change que l'identité YouTube de l'iframe.
Le nom réel, le type et la langue sont visibles, chaque vidéo reste sélectionnable au clavier.
Fermer, Échap et Retour dépilent uniquement le lecteur puis restaurent le focus et la fiche.
Android téléphone utilise immersion/paysage natifs, avec restauration portrait et barres système.
La PWA conserve le plein écran navigateur manuel lorsque l'ouverture automatique est refusée.
Ce contrat automatisé ne vaut pas preuve de lecture ou de rotation sur un téléphone réel.

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
| Navigation basse | Deux taps espacés de moins de 350 ms | Le premier appui revient d'un niveau ou remonte à la racine, le second réinitialise la page active | Contrat `SEENIT-UX-005`, portée locale et toast propre à l'écran ; A → B → B exclu. |
| Double appui Explorer | Reset + remontée | Recherche vide, catégorie Tout, plateformes/genres vides, âge Tous, note Toutes, tri populaire descendant, hero première carte | Préserver ce raccourci volontaire, montrer son effet ; jamais effacer les préférences du compte. |
| Explorer, liste verticale | Swipe / défilement vertical | La descente masque la barre de recherche ; une remontée la réaffiche | La loupe à gauche de la navigation permet aussi de la rouvrir sans défilement ; un swipe de descente ne doit jamais rouvrir la recherche. |
| Double appui Profil | Reset + remontée | Ferme Réglages/personne, revient à Statistiques et nettoie l'état local de Ma Liste | Ne modifie aucun suivi ni statistique. |
| Double appui À voir | Reset + remontée | Revient à À Regarder, replie les sections et remet les carrousels au début | Ne modifie aucune progression. |
| Double appui Télécharger | Reset + remontée | Revient à Mes téléchargements, ferme la configuration, vide recherche/filtres/résultats locaux | N'annule ni n'efface aucun transfert. |
| Carrousels séries réduits « À Regarder » | Glissement horizontal | Avance carte par carte avec snap horizontal obligatoire ; la suite reste virtualisée/préchargée sans marqueur terminal | Chaque carte est un arrêt. Le rail Films à voir conserve son défilement libre. La bascule à deux icônes Carrousel/Liste de l’en-tête reste l’alternative accessible vers la liste verticale exhaustive (#729). |
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

La [navigation 13j](../design/navbar-13j.md) remplace la barre pleine largeur :

- sans Téléchargements : **À Voir → Explorer → Moi** ; avec : **À Voir → Explorer → Moi │ Télécharger** ;
- îlot centré en verre de 60 px, détaché de 10 px plus safe area, boutons 48 × 68 px minimum,
  glyphes rendus26px, libellés10–11px, fondu inférieur progressif de92px ; pas de repli au défilement ;
- le dernier onglet et son séparateur disparaissent selon le réglage personnel existant ;
- point Télécharger actif or (nombre au-delà de un), attention rouge, puis terminé non consulté vert,
  acquitté à l'ouverture sans modifier les transferts ; aucun polling supplémentaire ;
- appui long 480 ms/clic droit/Maj+F10 : Ce soir/À Regarder, recherche Explorer avec focus,
  réglages rapides Moi, Recherche C411 ; le mouvement/cancel/démontage annule le geste et son clic final ;
- fiches/dialogues plein écran masquent la barre ; contenu à 84 px plus safe area et toasts à
  80 px avec barre, 24 px sans barre. L'avatar de l'accueil disparaît, les informations de sync restent ;
- l'onglet actif est annoncé par `aria-current` en plus de son état visuel or.

Le contrat d'appui/reset de #178 est distinct de cet ordre visuel et désormais livré :

- Une activation d'un autre onglet change de destination sans reset.
- Un appui sur l'onglet actif revient d'un seul niveau visible ; à la racine il remonte doucement sans effacer les filtres.
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

- Cible tactile au moins 44 × 44 CSS px pour les contrôles isolés et actions ordinaires ; la taille du
  pictogramme peut rester plus petite. Exception produit : un footer d'action rapide plein largeur intégré
  à une carte média peut rester visuellement compact avec sa hauteur historique `py-1`, puisque toute la
  largeur est interactive et qu'il n'empiète sur aucune action voisine.
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

La [refonte À voir](../design/home-a-voir.md), #729 / `SEENIT-UX-018`, sépare trois panneaux
sans scrollspy ni swipe entre panneaux. À regarder retrouve ses trois sections séries, chacune
en rail de six cartes puis Voir en liste avec bascule à icônes vers la liste. Le carrousel affiche six films et la liste de billets horizontaux progresse
par douze ; toucher Vu ou Annuler recolle le billet. L’historique progresse par dix, les sorties
par Aujourd’hui/Cette semaine/Plus tard (jusqu’à J-7 inclus). Les badges sans emoji sont près du code épisode, la cloche
du header ouvre les notifications ; les commandes et confirmations métier restent partagées.

### Carte série 8f — #690

La [carte 8f](../design/card-8f.md) devient le socle partagé des séries dans À voir,
À venir : affiche débordante, fond teinté, titre sur deux lignes,
code saison/épisode explicite et saison segmentée. À venir n’a pas de badge de statut et utilise une pastille rectangulaire J-X (auj. aujourd’hui) avec rappel indépendant, sans cercle de progression. La date courte n’ajoute pas de jour de semaine. Historique suit désormais la liste compacte v3 : une seule liste sans groupes de date ni progression, vignette 92×52, date dans chaque ligne, dix puis Voir plus. Les opérations réversibles et les actions clavier restent partagées.
Les trois carrousels séries réduits de À Regarder restent virtualisés mais avancent désormais
carte par carte avec snap horizontal obligatoire et arrêt sur chaque carte ; le rail Films à voir
conserve son défilement libre. Les cartes séries utilisent la largeur mobile utile pour conserver
la lisibilité de la composition. Les listes utilisent la même carte.
Les films ne sont pas migrés dans ce lot. Les états de diffusion inconnus, les absences
d'image et les saisons longues gardent un rendu honnête et accessible. Le traitement
local de couleur utilise l'affiche déjà chargée et un cache borné, sans appel fournisseur.

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
ne doivent plus réintroduire de petit contrôle isolé sans cible 44 px, d'état async non sérialisé ou de
conteneur cliquable sans sémantique clavier. Le footer plein largeur de `GridMediaCard` conserve
volontairement sa hauteur compacte historique.

Le quality gate navigateur construit uniquement pendant la CI un harness #180 hors bundle applicatif. Il
rend la fixture réelle « avant » et le composant courant côte à côte à **360 px et 412 px**, capture les deux
rendus et vérifie réellement cible 44 px, focus, nom accessible, action inverse, `pending/disabled` et
sérialisation d'un double clic sur les contrôles pilotes isolés. Cette preuve ne force pas la hauteur du
footer d'action plein largeur de `GridMediaCard`. La fixture avant doit reproduire la cible <44 px et deux
intentions afin que la preuve avant/après reste discriminante.

## 6. En-têtes, dialogues et safe areas — proposition #181

Le Hero Explorer (#665) calcule son CTA Reprendre depuis la progression persistée avant les pointeurs
dérivés devenus obsolètes. Le code d'épisode reste explicite ; À jour sur la diffusion n'est pas remplacé
par un faux prochain épisode lorsque tous les épisodes disponibles sont vus. Le synopsis conserve une
hauteur compacte, coupe à une fin de mot et propose Voir plus/Voir moins sans déclencher l'ouverture de
la fiche ou modifier le suivi.

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
4. #181 : pile Retour et socle `DialogLayer` partagés ; fermeture d'un seul niveau, focus contenu/restauré,
   fond inerte et safe areas communes. Les essais TalkBack et clavier Android restent des preuves terrain.
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

## Téléchargements — choix d'une autre release (#661)

La section **En attente** (#664) conserve les demandes sans transfert, y compris après redémarrage.
Un zéro résultat confirmé affiche **En attente de disponibilité**, avec une horloge et aucun faux
pourcentage/spinner de téléchargement. Le message de lancement automatique est réservé à une
surveillance Sonarr/Radarr et RSS confirmée ; sinon la carte indique que la surveillance reste à vérifier.
Une recherche interrompue affiche **En attente de vérification** et ne promet pas de lancement futur.
La section suit l'ordre des demandes ; elle est séparée d'En cours et d'En erreur.
**Chercher une autre release** reste disponible et ouvre une consultation sans mutation. Une confirmation
manuelle remplace l'attente par une seule intention. **Annuler l'attente** ouvre une confirmation,
nomme le média, conserve les fichiers existants et ne retire la carte qu'après arrêt de la surveillance
exacte si nécessaire. Retour/Garder ferme la confirmation sans effet. Le texte d'attente doit revenir
à la ligne sur petit écran, avec des cibles de 44 px, et être accessible sans animation seule.

Une carte terminée, annulée ou en erreur avec TMDB exact propose « Chercher une autre release ».
Le dialogue respecte la pile Retour, le focus et les safe areas existants. Il consulte le client Arr
configuré, affiche VFF/VFQ/MULTI, qualité, taille, seeders et refus, avec filtre audio ; une série entière
permet de choisir sa saison. MULTI/FRENCH seul reste une variante inconnue. Le bouton confirme le seul
candidat sélectionné ; les résultats incompatibles restent non lançables. Pendant l'envoi, la sélection
est verrouillée. Ouvrir, filtrer ou fermer par Retour/Croix ne lance rien et ne modifie aucun profil.
Un résultat ambigu n'entraîne jamais l'envoi d'un autre candidat. Les cartes affichent les badges audio
indépendamment de la vidéo ; une version actuelle reconnue par hash exact reste non sélectionnable.
Une demande active sur le même scope est signalée et bloque l'envoi jusqu'à sa fin ou son annulation.
Les notifications confirment « ✅ Import terminé », puis
« ✅ Disponible dans Plex » uniquement après preuve Plex exacte.


Retour terrain225 du25/10/2026 (#729), prioritaire sur les regroupements antérieurs : un visionnage = une ligne, sans ×N ni plage d’épisodes, même pour une saison marquée en une fois. Périodes, totaux, heure et actions par épisode conservés. Navigation : centres du pictogramme et du texte identiques sur tous les écrans. Vu : anneau progressif760ms puis coche240ms, tampon puis reprise ; réduction des animations immédiate. Splash : huit segments160ms, anneau1280ms, coche1640ms, signature1860ms/300ms puis lecture complète pendant1540ms ; durée3700ms et fondu500ms inchangés. Référentiel détaillé : docs/design/marque-2026-10-25.md.


### SeenIt TV V4 — 27 octobre 2026 (#295)

Trois destinations visuelles, rangée d'apps générique, sources natives et réglages en partie
basse. En-tête fixe, Retour remonte la Home avant de quitter, focus visible et mouvement réduit.
Compte/QR réservé à l'association explicite d'un profil adulte ; aucun visionnage attribué
par un simple lancement d'app. Référence : [TV V4](tv-samsung-launcher-v4.md).

Films & séries, terrain28/10 : grand fond du contenu actif et rail paysage, sans apps.
Pour toi/Séries/Films filtrent localement ; quatre cartes/page. Déplacer le focus actualise
le grand visuel, OK consulte le détail et Retour restaure la carte. Sans image, garder une
carte stable ; sans association, proposer le QR du profil. Aucun contenu/progrès fictif ni
CTA de lecture exacte sans implémentation prouvée. Référence : maquette V3-06 fournie.

Sport, MVP gratuit du28/10 (#738) : sélectionner les équipes localement, calendrier six
cartes/page, heure locale et horaire provisoire explicites, sans résultat. OK sur une carte
donne stade/source/information de diffusion ; aucune ouverture supposée. Précédents/Suivants
et Actualiser restent accessibles à la télécommande. Retour retrouve la tuile Sport, sans
modifier les équipes choisies. La Home anticipe le prochain match sans suivi live.
