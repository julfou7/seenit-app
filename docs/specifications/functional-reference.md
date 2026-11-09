# SeenIt — Référence fonctionnelle canonique

## Extension Samsung TV — V4, 27 octobre 2026 (#295)

Le runtime isolé `tv-samsung/` présente trois grandes destinations TV/TNT, Films et Sport,
huit favoris maximum sur la rangée, Ajouter/Toutes, puis les sources réellement détectées.
La roue mène aux réglages de la partie basse, sous un en-tête fixe. Retour remonte d'abord
l'accueil avant de proposer de quitter. Les apparences Brume/Crépuscule/Auto sont conservées.
Les profils sont centrés, avec marque et police locales ; l'en-tête montre heure, profil
et réglages. Brume et Crépuscule couvrent aussi fiches et messages. La tuile Sport montre
le prochain événement sans clic. Les composants techniques reconnus restent dans Système,
Apple TV/Paramount+ détectés sont ajoutables. Les réglages indisponibles proposent le chemin
Samsung sans promettre un faux accès direct.
L'inventaire complet garde USER/SYSTEM/UNKNOWN et toutes les variantes, sans table d'IDs
universelle. Une épingle explicite conserve son ID ; Milo n'affiche que sa sélection locale,
Invité ne persiste rien. Les anciennes épingles ne sont pas effacées par la limite V4.
Le menu d'une variante utilisateur peut retenir sa version pour cette TV : choix
explicite entre IDs inventoriés de même nom, partagé entre profils, favoris conservés.
Une cible supprimée ou système n'est jamais utilisée. Netflix a été confirmé à l'écran
le28octobre avec sa variante native ; aucun ID matériel n'est ajouté au code de lancement.

Le compte adulte s'associe par QR : consentement explicite du téléphone authentifié, code
valable dix minutes, session TV limitée à trente jours. La TV ne reçoit aucun jeton Firebase,
consulte uniquement une liste bornée et n'écrit aucun visionnage. Les autres profils restent
locaux. Dissociation confirmée, cache privé effacé et révocation rejouée si le réseau manque.
Les images, timers et requêtes de pairing s'arrêtent hors premier plan. L'absence d'association
ou de réseau laisse le launcher et ses apps utilisables.

Films & séries reprend le contenu du compte, sans rangée d'apps : grand visuel du titre
sélectionné, métadonnées réelles, Pour toi/Séries/Films et rail paysage de quatre contenus
par page. Le focus change le hero sans reconstruire le rail, OK ouvre une fiche en lecture
seule et Retour conserve le focus. Les chemins TMDB et URLs TMDB complètes enregistrés par
le mobile sont normalisés ; un visuel absent conserve sa place. Aucun « Reprendre » ou
« Épisodes » de maquette n'est promis sans contrat de lecture implémenté. Les apps restent
sur Home et Toutes les apps. Hors écran : cinq images maximum libérées et aucune requête
de métadonnées supplémentaire pour réparer les visuels existants.

HDMI transmet le descripteur natif Tizen exact, sans reconstruction JS. Les réglages natifs
utilisent un handler découvert ; sans handler exploitable, expliquer la touche Réglages/Home
plutôt que lancer aveuglément un menu système. Un callback d'app accepté ne prouve pas
l'affichage : Netflix noir depuis le launcher reste un écart terrain, malgré son fonctionnement
via Samsung. Le basculement Home natif et le gain RAM global restent
suivis séparément ; aucun root ni faux calendrier. Les logos des équipes viennent des données
explicites avec initiales en secours. Voir [la référence V4](tv-samsung-launcher-v4.md).

Le calendrier Sport gratuit (#738) consomme `/api/tv/sport` : le backend existant normalise
les calendriers officiels Monaco/FFF, cache six heures, sans clé dans le WGT, sans nouveau
service payant ni résultat obligatoire. Sélection locale indépendante par profil, six cartes
par page, heure locale et programmation provisoire explicites, logos de source et initiales
si absents. La tuile Sport anticipe le prochain match. Les événements passés disparaissent
sans récupérer de score. Les concepts live/score restent optionnels hors MVP ; aucune app ou
chaîne n'est suggérée comme diffuseur sans preuve gratuite fiable et lancement réel testé.

Dernière vérification : 14 septembre 2026
Mise à jour ciblée À voir : 23 octobre 2026, corrections de conformité maquettes et gestes (#729).
Mise à jour ciblée Moi : 30 octobre 2026, refonte de l'onglet selon la maquette « SeenIt Moi » ([intégration](../design/moi-2026-10-30.md)).
Baseline observée avant correction : **1.4.150**, `main` `6189bafed525fb510c1a81c87a04e19c01f92393`
Plateformes : **PWA Web** et **APK Android Capacitor**
Statut : composante obligatoire de la SPEC SeenIt

Ce document explique ce que fait SeenIt, où vit chaque fonction et comment les parcours s'articulent.
Les invariants détaillés et la machine d'états autoritative restent dans [`seenit.md`](./seenit.md).
Le processus de livraison reste dans [`../process/delivery.md`](../process/delivery.md). Un agent ne
doit jamais déduire une nouvelle règle depuis le seul comportement accidentel du code : les écarts
connus sont listés à la fin et reliés à GitHub Issues.

## 1. Produit, vocabulaire et sources de vérité

SeenIt est l'application personnelle de suivi de films et séries de son propriétaire. Le même compte
Google doit retrouver sa bibliothèque et ses intentions durables sur PWA et APK. L'application est
d'abord mobile ; l'APK est la plateforme la plus sensible, mais la PWA reste un client complet du même
compte et du même backend.

| Terme | Signification SeenIt |
|---|---|
| Média | Film ou série identifié par son type et son TMDB ID. |
| Suivi | Présence d'un document dans la bibliothèque du compte. |
| Non suivi | Absence de document ; ce n'est pas une valeur de `status`. |
| À voir | Média suivi sans progression, `plan_to_watch`. |
| En cours | Série commencée et non terminée, `watching`. |
| Vu / Terminée | Film vu ou série terminée, `completed`. |
| Abandonnée | Série conservée avec sa progression mais sortie du parcours actif, `dropped`. |
| Archivée | Dimension `isArchived`, indépendante du statut et de la progression. |
| Favorite | Intention `isFavorite`, indépendante du visionnage. L'activation active aussi les notifications du média. |
| À jour | État calculé d'une série dont tous les épisodes diffusés sont vus ; ce n'est pas un `status` persistant. |
| Full Plex | Reconstruction complète de l'état depuis les sources Plex disponibles. |
| Delta Plex | Synchronisation incrémentale depuis la dernière baseline validée. |

Hiérarchie des sources :

1. **Firestore `default` sous le Firebase UID** est autoritatif pour les données durables du compte.
2. **TMDB** fournit l'identité canonique, les fiches, saisons, épisodes, personnes, dates,
   disponibilités éditoriales et l'**Ordre de visionnage des films** via ses collections explicites.
   Une date TMDB `YYYY-MM-DD` est une date calendaire conservée telle quelle : aucun décalage (« +1 jour »)
   n'est déduit du réseau de diffusion (#407, MobLand sur Paramount+). Une série enregistrée avec l'ancien
   décalage est resynchronisée une fois (`SEENIT-DATA-007`), même si son prochain épisode paraît futur.
3. **TVDB** fournit la relation **franchise / univers** des fiches Film et Série, uniquement après
   résolution par identifiant externe exact depuis TMDB et selon `SEENIT-RELATION-001`.
4. **Plex** fournit seulement des preuves de watchlist, visionnage/non-vu et disponibilité, jamais
   l'identité finale par titre ou année.
5. **Sonarr, Radarr et qBittorrent** fournissent l'état réel des téléchargements ; C411 fournit les
   résultats de recherche lorsque la fonctionnalité personnelle Téléchargements est activée.
6. Les stockages locaux servent à accélérer, fonctionner hors-ligne ou porter un état propre à
   l'installation. Ils ne doivent pas devenir une seconde base métier divergente.

## 2. Architecture fonctionnelle en une vue

| Couche | Responsabilité | Points d'entrée principaux |
|---|---|---|
| Shell | Authentification, splash, navigation, deep links, Retour Android, lazy loading | `src/App.tsx`, `src/features/navigation/**` |
| Écrans | Accueil, profil/bibliothèque, Explorer, téléchargements, réglages, fiches | `src/screens/**` |
| État client | Bibliothèque, téléchargements, réglages, disponibilité, toasts, logs | `src/store/**` |
| Métier | Progression, TMDB, Plex, downloads, release, runtime | `src/features/**` |
| Cloud utilisateur | Données isolées sous `users/{uid}/...` dans Firestore `default` | Firebase Web/Admin |
| Backend | Proxy authentifié et borné vers Plex/C411/Arr/qBit, webhooks, appareils, updates | `server.ts` |
| Android | Conteneur Capacitor, intents, notifications, mise à jour sur place | `android/**`, plugins Capacitor |

Les routes backend produit sont :

- `GET /api/health` : identité et santé du backend canonique ;
- `GET /api/media/tmdb/...` et `GET /api/media/tvdb/franchise` : façade métadonnées authentifiée ; TVDB ne reçoit que des identifiants externes exacts ;
- `POST /api/plex/history` (`/api/plex-sync` alias) : full/delta Plex ;
- `POST /api/plex/availability` et `GET|POST /api/plex/resolve-slug` : disponibilité et ouverture ;
- `POST /api/c411/test` et `POST /api/c411/search` : test/recherche C411 ;
- `POST /api/service-proxy` : allowlist Sonarr/Radarr/qBittorrent ;
- `POST /api/devices/register` et `DELETE /api/devices/:installationId` : appareil de notification ;
- `POST /api/diagnostics/plex-availability` : remontée authentifiée et bornée des étapes Android de
  disponibilité Plex, uniquement sous forme redigée/corrélée sans média, UID ni secret ;
- `POST /api/releases/notify` : signal post-release public borné, dont le run, le SHA, le tag, l'APK et
  son SHA-256 sont revalidés auprès du dépôt officiel avant toute notification Android ;
- `GET /api/webhooks/config`, `POST /api/webhooks/config/rotate` et webhooks personnels : réception
  des événements Arr ; un `Download` prouve l'import Arr, puis l'APK vérifie localement Plex avant
  d'afficher « Disponible dans Plex » ;
- `GET /api/update` : dernière release SeenIt officielle.

Toutes les routes métier privées exigent un jeton Firebase du compte. Le health-check, les
métadonnées publiques de mise à jour et le signal post-release sans donnée utilisateur sont les exceptions
prévues ; ce dernier n'accorde aucune confiance à l'appelant et exige les preuves GitHub officielles.

## 3. Compte, démarrage et synchronisation multi-appareils

### 3.1 Connexion

- La PWA utilise la fenêtre Google Firebase.
- L'APK propose d'abord les comptes Android via Credential Manager, échange le même ID token dans
  Firebase Web et conserve donc le **même UID** que la PWA. Le plugin Google historique n'est qu'un
  fallback natif.
- Une annulation utilisateur n'est pas une erreur bloquante.
- Sans compte authentifié, l'utilisateur reste sur l'écran de connexion et les données d'un ancien
  UID ne sont pas exposées.

### 3.2 Démarrage et convergence

- Un splash Web SeenIt unique masque l'initialisation ; le splash système Android reste neutre.
- Fluidité (03/11/2026, 120 Hz) : le splash dure 2,3 s, sa barre se remplit segment par segment, l'anneau du logo est dessiné par le
  compositeur (fluide même pendant le chargement ; depuis la v1.4.249, la coche et l'anneau final aussi, si bien
  que l'anneau ne disparaît plus pendant que l'app se monte dessous), et l'app est montée
  sous le splash avant son fondu de 0,5 s. Les fiches et la page personne entrent comme les écrans Réglages
  (180 ms, opacité et 18 px), et un onglet qui réapparaît fait le fondu de Moi (160 ms). Sur Android, SeenIt
  demande le mode d'affichage le plus rapide de l'écran (`SEENIT-APK-007`). La synchro Plex cède le fil toutes
  les 6 ms (`SEENIT-PLEX-010`). Sur À voir, l'anneau du bouton Vu démarre au tap ; le tampon et l'épisode
  suivant attendent la confirmation de l'écriture, et un échec annule l'anneau (`SEENIT-UX-016`).
- Continuer à regarder affiche en tête la dernière activité : la série vue le plus récemment, ou celle dont un
  nouvel épisode est sorti depuis ton dernier visionnage (un épisode sorti aujourd'hui passe devant ce que tu
  as vu avant). Nouveautés est réservé aux saisons dont tu en es à
  l'épisode 1 (nouvelle saison ou série pas commencée, `SEENIT-UX-021`). Annuler un Vu qui avait fait passer
  une série de Nouveautés à Continuer la ramène aussitôt dans Nouveautés (`SEENIT-UX-018`).
- Une synchro Plex delta sans nouveauté (aucun visionnage, Watchlist identique et déjà suivie) se termine
  juste après la réponse Plex, sans relecture de la bibliothèque (`SEENIT-PLEX-011`).
- Le cache local du bon UID peut produire le premier rendu, puis Firestore serveur remplace ce rendu.
- Un listener Firestore maintient la bibliothèque à jour entre PWA et APK.
- Le serveur gagne après le rendu de cache : un média supprimé sur un autre appareil ne doit pas être
  ressuscité par un cache ancien.
- Les doublons de bibliothèque sont dédupliqués par `mediaType + tmdbId`, et l'ancien document est
  nettoyé en arrière-plan.
- Les actions ordinaires sont optimistes pour rester instantanées ; un échec rétablit l'état depuis
  le Cloud ou propose une annulation lorsque le parcours le permet.

### 3.3 Données partagées et données par appareil

| Donnée | Portée attendue |
|---|---|
| Bibliothèque, progression, note, favori média, archive | Compte, partagée PWA/APK |
| Plateformes de streaming et préférences de notification | Compte, partagées PWA/APK |
| Corrections personnelles d’âge conseillé (`mediaType + TMDB ID`) | Compte, partagées PWA/APK |
| Jeton/curseur Plex et réglages C411/Arr/qBit | Compte, partagés PWA/APK, isolés par UID |
| Activation de la fonctionnalité Téléchargements | Compte, partagée PWA/APK, désactivée par défaut et isolée par UID |
| Intentions de téléchargement | Compte, partagées PWA/APK |
| News lues et rappels métier | Compte, partagés PWA/APK |
| Token FCM, permission système, installation notification | Appareil, rattachés au UID courant |
| Cache TMDB/Plex, clés anti-doublon de notification | Appareil et UID |
| Copie Plex pour vérification Android en arrière-plan | Appareil et UID actifs, stockage privé `noBackup`, jamais Firestore |
| Logs techniques | Appareil et UID ; export volontaire seulement |
| Personnes favorites | Doivent être partagées ; écart actuel suivi par #95 |

Le bouton « Sauvegarder » des réglages pousse l'état local courant et les réglages vers Firestore ;
« Recharger » redemande l'état serveur. La synchronisation temps réel reste le fonctionnement normal,
ces boutons sont des actions de récupération explicites.

## 4. Navigation globale

Les gestes et leur portée exacte sont inventoriés dans la [référence UX](./ux-reference.md).
Le contrat de navigation est `SEENIT-UX-005` : la reconnaissance ne partage aucun tap avec un changement
d'onglet et chaque reset reste strictement limité à l'écran actif.

La barre basse possède trois destinations toujours visibles, dans cet ordre :

1. **À Voir** : accueil opérationnel ;
2. **Explorer** : recherche et découverte TMDB ;
3. **Moi** (`profile`) : Ma liste, Chiffres, Mon année et accès Réglages.

La destination **Télécharger** n'apparaît que lorsque le compte courant a explicitement activé la
fonctionnalité personnelle Téléchargements dans Réglages. Lorsqu'elle est visible, elle s'insère en
**dernière position** après un séparateur, ce qui donne **À Voir → Explorer → Moi │ Télécharger**.
Son point indique en priorité les transferts actifs (or, nombre au-delà de un), une action requise
(rouge), puis un transfert terminé non consulté (vert). Le vert s'efface à l'ouverture sans toucher
aux transferts. Une navigation historique ou directe vers `downloads` alors que la fonctionnalité est
désactivée revient sur « À Voir ».

La [barre 13j](../design/navbar-13j.md) est un îlot verre flottant centré, haut de 60 px, détaché de
10 px plus safe area, avec fondu progressif inférieur de 92 px. Sans Télécharger, seul le dernier
onglet et le séparateur disparaissent. Glyphes rendus26px, libellés10–11px et cibles minimales48 ×68px.
Pas de repli au scroll. Le contenu réserve 84 px plus safe area ; les toasts restent au-dessus à
80 px plus safe area, ou 24 px sur une fiche/dialogue sans barre. La fiche média occupe tout le viewport
et garde la barre, y compris ouverte depuis la recherche d'Explorer (#870).

L'onglet actif et ses glyphes utilisent l'or SeenIt et son bouton expose `aria-current="page"`. Un appui
sur l'onglet actif ferme exactement le niveau courant, ou remonte en haut doucement à la racine sans
vider les filtres. Un double appui à moins de 350 ms ramène la page en haut, ferme ses
panneaux et restaure sa sous-vue, ses recherches, filtres et expansions à leurs valeurs initiales. Explorer,
À Voir, Télécharger et Profil affichent chacun un toast de confirmation propre ; aucune donnée métier
n'est modifiée.
Un appui long (480 ms), un clic droit ou Maj+F10 ouvre Ce soir/À Regarder pour À Voir, la recherche
avec focus pour Explorer, les réglages rapides du compte pour Moi et Recherche C411 pour Télécharger.
Le prototype Ce soir réouvre À Regarder : le raccourci réutilise cette vue réelle sans inventer un
planificateur. Ces raccourcis ont des boutons visibles ; déplacement/annulation/démontage neutralisent
le geste et un appui long ne produit jamais aussi un tap/double tap. L'accès compte de l'en-tête
Accueil est retiré ; les informations de synchronisation restent visibles.
Un raccourci sur l'onglet déjà actif n'ajoute pas d'entrée identique à l'historique. Depuis les
réglages rapides, Tous les réglages réutilise le même niveau modal et conserve l'onglet courant ;
un Retour retrouve ainsi l'écran visible avant la feuille, sans étape fantôme.

L'ouverture d'une fiche est un niveau de navigation au-dessus de l'onglet courant. Le Retour Android
ferme dans l'ordre : dialogue ou modal, fiche, historique interne, retour à À Voir, puis application.
Les deep links de notification acceptent `showId` ou `tmdbId`, `mediaType`, saison et épisode. Une
action notification `mark_watched` peut marquer l'épisode exact après résolution de la fiche.

Les superpositions utilisent `DialogLayer` : Échap, Retour Android et retour depuis l'onglet actif
ferment uniquement le niveau supérieur. Les dialogues sont nommés, le fond est inerte et le focus
reste dans le dialogue puis revient au déclencheur. Une confirmation destructive focalise d'abord
Garder/Annuler. Les panneaux et dialogues réservent les safe areas et le viewport visuel du clavier.
Les dialogues locaux ont leur propre entrée d'historique ; les fiches épisode/personne conservent
leur entrée existante. Les trois familles d'en-têtes restent distinctes : racine, fiche et dialogue.
La fiche média participe à cette pile en tant que panneau non modal plein écran et masque la navigation
basse. Si elle est ouverte depuis une fiche personne de l'onglet, Retour restaure cette personne
et le focus du bouton utilisé ; un dialogue bloquant couvre la navigation et rend le fond inerte.

Un toast fait 76 px de haut ; un toast d'épisode (épisode vu, Plex) fait 104 px pour afficher le titre
entier, l'épisode en pastille or « S01 | E03 » et l'action (`SEENIT-UX-004`). Ce sont des hauteurs
minimales : avec une police Android agrandie, la carte grandit au lieu de rogner le titre.

Les toasts internes qui confirment l'ajout à **À voir** ou le passage à **Vu / Terminée** sont aussi des
raccourcis de navigation : leur surface principale ouvre la fiche Film/Série uniquement avec l'identité
exacte `mediaType + tmdbId`. Aucun titre, année ou texte du toast ne sert de fallback. Un toast de retrait
(`unfollow`) reste non navigable ; ses actions internes comme **Annuler**, les actions Plex comme
**Ignorer les suivants** et un swipe/drag de fermeture ne déclenchent pas la fiche. Le même contrat vaut
en PWA et APK et un toast navigable s'active au clavier avec Entrée/Espace (`SEENIT-UX-006`).

## 5. Écran « À Voir »

Le retour terrain221 impose des titres de section homogènes16–18px non rognés dans les trois panneaux, une réserve basse incluant la zone système, aucun badge dans les anciennes séries et des titres longs lisibles. La frise affiche les heures locales de visionnage réellement connues, jamais « ce soir » à la place d’une heure. Les rappels réagissent immédiatement avec confirmation/échec explicite.

Dans l'en-tête, l'anneau de synchronisation reste visible dès que Plex est connecté ; son point dit l'état de
la dernière synchro (vert < 24 h, orange au-delà, rouge en échec, aucun pendant une synchro). Le toucher ouvre
le panneau de synchro : progression, serveurs et pause pendant une synchro, sinon **Synchro rapide** (delta)
et **Complète** (full). Un appui long de 480 ms lance directement la synchro rapide. Depuis le 03/11/2026
(`SEENIT-PLEX-012`), le panneau affiche un vrai pourcentage en delta comme en complète, une ligne par serveur
(nom, « 1,2 k vus », « 42 % », « hors ligne ») et tient en un écran ; la synchro complète lit les serveurs et
leurs bibliothèques en parallèle, ne se relance plus d'elle-même et s'arrête proprement au bout de 10 min.

L’écran comporte trois panneaux indépendants **À regarder**, **À venir** et **Historique**. Le scroll
ne change jamais d’onglet ; aucun swipe ne navigue entre panneaux. Le header `seenit●` conserve l’état
de synchronisation et ouvre les Notifications avec une cloche et un point or si non lu. Depuis #876,
c’est une page plein écran au contrat des Réglages (navigation conservée, Retour) qui réunit les
preuves Plex en cache, rappels du jour, téléchargements terminés, dates films confirmées, actualités
et mise à jour. Titres de films/séries en or ; une notification non lue a un fond plein et un point or
sur son image. Aucun bouton par notification : toucher ouvre la fiche et marque lu, glisser vers la
droite retire (action Retirer focalisable pour le clavier/TalkBack). Retirer la dernière notification,
Tout marquer lu ou changer d'onglet ferme la page. Tout marquer lu conserve l’état par compte ; les actualités réutilisent
les préférences cloud existantes. Marquer Vu se fait depuis la fiche du média.
La présence globale d’une série dans Plex ne produit pas de notification pour son épisode de reprise :
ce cache ne contient aucune preuve par épisode. Les films disponibles gardent leur notification ; les
rappels et actualités des séries restent visibles.

### 5.1 À Regarder

- **Nouveautés** est prioritaire et réservé aux saisons dont tu en es à l'épisode 1 (nouvelle saison ou série
  pas commencée), sorti depuis 60 jours au plus ; un nouvel épisode d'une saison en cours n'y va jamais ;
- **Continuer à regarder** reçoit les séries commencées vues dans les 60 derniers jours inclus, ou dont un
  nouvel épisode est sorti depuis le dernier visionnage, classées par dernière activité ;
- **Pas vu depuis un moment** reçoit les autres séries encore regardables ;
- **Films à voir** reçoit les films suivis non vus dont la sortie n'est pas future.

Une série n'entre dans **À Regarder** que si SeenIt possède une preuve positive qu'au moins un épisode
a déjà été diffusé : progression déjà enregistrée, `totalAiredEpisodes > 0`, `firstAirDate` passée ou du
jour, ou date passée/du jour du prochain épisode à regarder. Une date d'ajout récente, un nombre total
d'épisodes planifié ou une date d'épisode absente ne prouvent jamais la disponibilité. Une date future
connue relève de **À Venir** ; sans date exploitable, la série reste suivie sans être présentée comme
regardable. Les cartes ne fabriquent donc pas `S01 | E01` / « SAISON DISPO » depuis des métadonnées
inconnues.

La [refonte accueil](../design/home-a-voir.md) conserve les trois sections séries Continuer à regarder,
Nouveautés et Pas vu depuis un moment ; Films à voir précède cette dernière. Chaque section série affiche un rail de six
cartes 8f, puis la bascule à deux icônes ouvre la liste progressive (douze par lot) ou le carrousel.
Les sections vides sont masquées. Les badges statut, sans emoji, sont à côté du code épisode dans la carte compacte ; Vu est centré verticalement. Les séries anciennes conservent leur nombre de jours exact. En liste, le swipe gauche
révèle Archiver/Supprimer ; l’appui long et le clavier ouvrent les mêmes actions avec confirmation et
Annuler. Dans les rails, le glissement fait défiler les cartes sans déclencher de suppression.
Le total confirmé de saison fourni par TMDB reste affiché dans les cartes qui présentent la progression, même pour une
série renouvelée ou sans finale datée. Un ancien indicateur de total inconnu ne masque pas ce nombre.
Sans total fournisseur ni preuve de finale, les épisodes listés restent une borne connue et « ? » est conservé.
Le marquage Vu préserve cette distinction ; les anciennes preuves ambiguës sont réactualisées une fois
par le worker de détails, sans demander une actualisation manuelle.
Cette réparation inclut les anciens booléens false et les séries terminées ou archivées.
Elle conserve le statut de suivi utilisateur, distinct du statut de diffusion TMDB.
Le cadre 8f reste partagé avec À venir. Historique utilise la liste compacte v3. Vu anime la reprise réellement avancée et son
tampon SeenIt ; À jour permet de revenir sur le dernier épisode marqué pendant cette session.
Pendant une écriture Firestore lente, le marquage reste en attente : aucun délai arbitraire
ne provoque de faux échec ni de restauration locale alors que l'écriture peut encore réussir.
Le succès et son animation attendent l'acquittement réel ; seul un rejet définitif restaure
l'état précédent et affiche l'erreur. Un changement de compte ignore le résultat pour le nouvel UID.

Les films sont des billets déchirables en carrousel affiche ou liste horizontale, triés par ajout récent puis identité, sans déplacement lors de l’enrichissement.
Le talon affiche en grand l’heure de fin calculée depuis Maintenant, actualisée chaque minute, orange
après minuit. Sans durée, aucune fin n’est inventée. Six films sont visibles, puis Voir en liste donne accès à la liste paginée par douze. La bascule carrousel/liste conserve le même marquage.
Une coche aboutie déchire le talon et conserve le tampon Vu ; toucher ce tampon ou Annuler recolle
le billet. Le film garde sa place pendant la session et disparaît au prochain retour à À regarder.
Les enrichissements restent passifs,
bornés et fondés sur l'identité canonique. Les préférences de diffuseur et le fallback d'image
Android sont conservés. Les médias archivés/abandonnés ne reviennent pas dans la liste ; l'état
visuel de session est réinitialisé lors d'un changement de compte. Clavier, cibles 44 px, annonces
live et réduction des animations partagent les mêmes actions en PWA et APK.
La reprise et l'action Vu partagent leur résolution : une diffusion future ne remplace pas un pointeur
de reprise absent. Le cache des épisodes déjà diffusés et la progression enregistrée permettent le repli ;
sans preuve suffisante, la carte demande une actualisation et ne propose pas une coche sans effet.

Sur une carte série, un appui long permet de retirer le suivi, archiver ou abandonner la
série (avec confirmation) ; les actions sont aussi accessibles au clavier. Une action destructive possède un toast avec
annulation.

### 5.2 À Venir

- Groupe les prochaines sorties en Aujourd’hui, Cette semaine (les sept jours suivants), Plus tard, selon les jours calendaires locaux.
- Ouvre directement la fiche ou le détail d'épisode.
- Permet d'activer/désactiver un rappel pour l'épisode présenté.
- La carte série 8f, sans badge de statut, affiche J-X (auj. aujourd’hui), une pastille rectangulaire sombre 48×40 dans une cible 52×48 et une cloche or si le rappel est actif ;
  cette cible de rappel est indépendante de l'ouverture de fiche.
- Un rappel spécifique met à jour l'intention de notification du média et son document Firestore.
- Sur Android, un rappel de nouvelle saison affiche aussi « Saison N » et un rappel de nouvel épisode
  affiche son code « Sxx | Eyy ». Si la série est en retard, le contexte visible bascule sur le prochain
  épisode réellement à voir et son compteur de reprise « + X épisode(s) », indépendant de l'affichage
  de la carte À Regarder ; le corps
  peut nommer l'épisode de reprise et l'épisode nouvellement diffusé quand TMDB fournit leurs titres.

### 5.3 Historique et actualités

- L'[historique mixte](../design/history-16d.md) suit la liste compacte de la SPEC accueil v3 : un bloc arrondi, films et épisodes triés depuis leurs `watchedAt`, sans groupes de date ni barres de progression. La date courte apparaît dans chaque ligne (ce soir aujourd’hui) ; une heure inconnue reste inconnue.
- « Marquer non vu » retire uniquement la progression ciblée et propose Annuler. Son enregistrement
  ne dépend d'aucun appel TMDB ; le prochain épisode conserve les compteurs déjà connus de sa saison.
  Un échec d'écriture est signalé explicitement, sans annoncer une suppression réussie.
- Films et épisodes ont la même ligne (minimum 76 px), vignette still/backdrop 92×52, titre or, code/date et titre d’épisode, pastille SeenIt or 26 px. Un film n’affiche ni année ni mention Film. Le tap ouvre
  l'épisode exact ou le film ; la pastille, l'appui long ou le clavier ouvrent un menu ancré sous la ligne
  (encadrée d'or, sans feuille du bas) : Changer la date ou l'heure (« Aujourd'hui à 07:41 », réglée dans
  le menu : Aujourd'hui / Hier / Avant-hier / Autre jour, heure par pas de 15 min ou vide), Revoir, Ouvrir
  la série, puis Marquer non vu en rose, sans confirmation : la ligne disparaît et le toast « Retiré de
  l'historique » propose Annuler, qui restaure la date exacte.
- La liste affiche dix entrées puis Voir plus avec le nombre restant (dix maximum par lot). Les heures connues sont conservées dans les libellés accessibles et l’édition.
- Le fil Actualités, désormais dans la feuille Notifications, affiche les événements non lus de séries encore présentes : nouvelle saison,
  diffusion, renouvellement/annulation et informations générées par le worker de détails.
- Une actualité lue est retirée et son état est partagé entre appareils.

## 6. Profil, statistiques et Ma Liste

L'onglet **Moi** affiche en tête l'identité Google (photo ou initiales locales déterministes dans un
cercle or, jamais une seconde image distante ni une image cassée), l'année d'inscription et le nombre de
titres suivis. Toucher l'avatar ouvre les réglages rapides du compte ; la roue de 44 px à droite ouvre
Réglages et porte un point or lorsqu'une mise à jour de l'application est disponible. Un sélecteur à trois
segments, or quand il est actif, donne accès à :

- **Ma liste** (sous-vue initiale) : une rangée de pastilles défilante, une par section non vide avec son
  nombre de titres, puis la grille trois colonnes des cartes habituelles (note, plateforme, progression,
  bandeau d'action rapide de suivi/visionnage) de la seule section choisie. Les sections restent Favoris,
  En cours, À commencer, À venir, Au cinéma, Films à voir, À jour et Films vus ; une même fiche peut
  apparaître dans les favoris et dans sa section métier. La pastille En cours est choisie par défaut,
  sinon la première section non vide ; si la section choisie se vide, la sélection retombe sur cette règle.
- **Chiffres** : pour l'année choisie (année courante par défaut, « Depuis le 1er janvier » ; le bouton
  année parcourt les années qui ont des visionnages), un grand total « Devant l'écran » en or avec son
  équivalent en jours pleins, épisodes et films vus, puis « Heures par mois » (une barre par mois écoulé,
  le record nommé, la valeur d'un mois au toucher), « Quand tu regardes » (jour × heure sur la fenêtre de
  huit heures la plus regardée, taille = temps, créneau dominant nommé), « Où tu regardes » (Plex pour les
  visionnages importés de Plex, sinon le diffuseur du titre, quatre au plus puis Autres), les badges
  Centenaire, Oiseau de nuit, Grand écran et Binge-Master avec leur progression, et les personnes
  fréquentes, chacune ouvrant sa fiche personne.
- **Mon année** : un titre qui nomme les deux séries les plus regardées, puis le récit mois par mois, du
  plus récent au plus ancien (série dominante ou « Mois cinéma », affiche, heures relatives, record de
  jours consécutifs), et « Et maintenant » : à partir du rythme des quatre dernières semaines, la date
  estimée de fin de la série en cours la plus regardée.

Les durées utilisent la durée réelle connue d'un visionnage, sinon les estimations des statistiques
(45 min par épisode, 110 min par film). Un visionnage n'est daté que sur preuve : date de l'épisode ou du
film, ou pour un film la dernière action « vu » ; jamais la date de modification du document (synchro des
fiches, import). Les visionnages sans date (films importés de TV Time) ne sont pas comptés et leur nombre
est indiqué ; ceux sans heure prouvée comptent dans leur mois mais jamais dans « Quand tu regardes ». Les seuils
des quatre badges restent ceux des statistiques historiques : Centenaire à 100 contenus ou épisodes vus,
Oiseau de nuit à 10 épisodes ou 500 minutes, Grand écran au premier film vu, Binge-Master à une série
terminée ou 20 épisodes. Aucun archétype ni répartition par genre n'est affiché dans Moi.

Pour préserver la navigation sur les grandes bibliothèques, Ma liste ne monte que la section choisie :
douze cartes à l'ouverture puis douze de plus par « Charger plus ». Ma liste, Chiffres et Mon année
conservent leur état après leur première ouverture, tandis que leurs traitements sont suspendus
lorsqu'elles sont cachées ; les statistiques avancées ne démarrent qu'à la première ouverture de Chiffres.

Les statistiques avancées conservent par UID une baseline locale versionnée. Elles réaffichent donc le
dernier résultat complet dès la réouverture de l'application, puis appliquent les changements de la
bibliothèque par delta : compteurs pour une progression, contribution typée pour un média vu ajouté ou
retiré, et rafraîchissement TMDB limité à la seule métadonnée expirée. Firestore reste l'autorité de la
bibliothèque ; cette baseline n'est qu'un cache dérivé commun au comportement PWA/APK.
Le résultat affichable compact est séparé du snapshot de travail IndexedDB : le quota du stockage WebView
ou un enrichissement interrompu ne peut plus laisser un classement partiel comme baseline du redémarrage.

Les diffuseurs des médias suivis occupent un compartiment persistant dédié et borné. Les navigations
Explorer et le recyclage des rangées ne peuvent donc pas chasser les résultats positifs ou négatifs déjà
obtenus pour Ma Liste ; seule l'expiration normale permet leur actualisation silencieuse.
Les badges de cartes privilégient une plateforme de **Mes plateformes** réellement disponible en FR,
puis Plex disponible, puis un autre diffuseur public. Décocher/recocher une plateforme recalcule les
cartes déjà montées immédiatement. L'hydratation cloud démarre avec la session, préserve le miroir local
pendant son attente et ne remplace pas une bascule faite entre-temps. Les anciens réseaux de production
ne remplacent pas une preuve TMDB de streaming ; aucun passage par Réglages ni purge de cache n'est requis.

Le bouton Réglages ouvre un écran superposé refermable par Retour ou swipe depuis le bord gauche.
Le Profil n'expose pas d'action « Partager » : aucun profil public n'existe et aucune donnée de profil
n'est publiée. Cette décision de confidentialité reste en vigueur tant qu'un périmètre public explicite
n'est pas spécifié.
Une fiche Film/Série se partage via l'URL publique canonique
`https://seenit.ai.studio/?tmdbId=<id>&mediaType=<movie|tv>`. Web Share et le fallback presse-papiers
utilisent la même URL ; elle rouvre la fiche exacte après démarrage/authentification, sans UID ni ID
Firestore privé.

## 7. Explorer

Le contrat E-01..33 du [handoff Explorer](../design/explorer-refonte-2026-10-28.md) (#787) remplace les commandes flottantes : loupe et filtres dans la rangée collante, navigation commune inchangée. La recherche est un mode dédié qui masque la nav, y compris clavier fermé avec texte. La sortie restaure la position Explorer. La bibliothèque locale instantanée précède les listes TMDB/personnes ; les filtres ne concernent que TMDB. Le panneau applique chaque choix immédiatement et les pastilles rouvrent le bon onglet. L’aperçu propose trois actions et garde les commandes YouTube natives.

Explorer propose les catégories **Tout**, **Séries**, **Films**, **Top 100**, **Top C411** (sous le réglage
Téléchargements avec une clé C411 : les titres les plus partagés sur C411, rang et seeders sur la carte,
fiches rattachées par l'identifiant TMDB exact fourni par C411, chargées page par page au défilement depuis
la v1.4.280, `SEENIT-C411-004`), **Pépites**,
**Au cinéma**, **Documentaires** et **Personnes**.
- Dans les résultats de recherche, les titres restent blancs et seule la partie qui correspond au texte saisi est en or (exception à la règle des titres en or).
- Recherche multi-pages TMDB en listes : bibliothèque locale, films et séries, puis personnes. La page 1 des films et séries s'affiche sans attendre la page 2. Les en-têtes ne montrent ni source (« TMDB »), ni durée, ni « instantané » ; seul « recherche… » signale une attente.
- Les personnages de fiction de la bibliothèque et des univers prouvés (manifeste, collections TMDB) viennent d'un **index local des distributions** : construit en arrière-plan dès l'ouverture de la recherche, gardé quatorze jours sur l'appareil, puis filtré à chaque frappe sans appel réseau ni anti-rebond. Seuls les titres manquants ou expirés sont lus, par lots, un rôle déjà connu sur l'appareil passant en tête. Un titre non indexé (quota, panne) est signalé « liste incomplète, nouvel essai bientôt » et repris à la réouverture du quota, jamais présenté comme une absence. Un personnage ouvre la fiche dédiée P-01..12 ; la section reste masquée sans source.
- Filtres par plateformes choisies dans les réglages, genres, **Âge conseillé** maximal et note minimale.
- Le filtre **Films · sortis après** accepte une année de 1900 à l'année courante. Choisir `Y` force
  le type **Films** et conserve uniquement les films dont `release_date` est strictement postérieure à
  cette année (donc à partir du 1er janvier `Y+1`). Une date absente est exclue ; le seuil se combine
  avec les autres filtres, reste actif pendant le scroll infini et s'applique aussi aux résultats de
  recherche texte. Changer ensuite vers un autre type de contenu ou réinitialiser Explorer efface ce seuil.
- Avec **Âge conseillé** et le tri Populaires, une carte déjà affichée conserve sa position pendant le chargement : les nouvelles preuves sûres s'ajoutent sans déplacer la grille existante. Les tris explicites par note, date ou titre attendent la page complète avant d'afficher ses nouveaux résultats.
- Le filtre d’âge est cumulatif : `10 ans` accepte seulement les médias dont la preuve résolue vaut
  « Tous publics », `7+` ou `10+`; une certification inconnue est exclue. « Tous » ne filtre pas.
- La classification automatique provient exclusivement de la certification US explicite TMDB. Une
  certification absente ou inconnue s'affiche **« Âge à vérifier »** ; aucun genre n'est utilisé comme
  fallback et le terme PEGI n'est pas employé pour les films/séries.
- L'application du filtre d'âge récupère seulement la preuve de classification nécessaire, réutilise les
  détails ou classifications déjà en cache et transporte jusqu'à une page `Tout` complète (40 identités)
  dans un flux backend unique. Les preuves sûres sont publiées progressivement sur **toutes** les pages de
  pagination ; le backend garde une concurrence fournisseur bornée et peut admettre la queue d'une page
  après une courte attente anti-stall, sans attendre le timeout fournisseur de 10 s. Elle ne charge pas
  les fiches TMDB complètes des résultats Explorer.
- **Top 100** reste une catégorie de la rangée collante, distincte du tri ; le panneau ne duplique plus les types de contenu.
- Tri Populaires, Mieux notés, Plus récents ou Ordre alphabétique.
- Hero Top 10, chargement infini, aperçu long-press et cache utilisable lors d'une panne réseau.
- Le bouton Reprendre du Hero suit les épisodes vus persistés : un ancien pointeur de reprise ne
  réaffiche pas un épisode déjà vu. Un épisode antérieur encore non vu reste proposé si la progression
  contient des trous. Un nouvel épisode disponible prime sur un ancien statut « terminé » ; seule
  une série sans prochain épisode conserve son état À jour sur la diffusion.
  Un épisode annoncé avec une date future ne devient pas une reprise avant sa diffusion ; une série
  terminée sans pointeur de prochain épisode n'en invente pas en attendant sa synchronisation.
  Si la série n'a pas été commencée, un prochain épisode futur affiche À venir avec son numéro exact.
  Le synopsis et Voir plus quittent le hero compact ; le synopsis reste dans l’aperçu et la fiche.
  Les pages Discover récemment obtenues sont réutilisées directement sur l'appareil pour un retour écran,
  une combinaison identique ou une page déjà parcourue. Cela inclut le flux par défaut **Tout**
  (tendances + populaires) ainsi que Top 100, Pépites et Documentaires ; les personnes restent hors
  persistance client. Ces listes expirent rapidement afin de laisser TMDB reprendre la main sur les
  données volatiles.
- Le hero réserve 368 px, avec ses indicateurs à l’intérieur ; les catégories et la grille restent stables au chargement.
- La loupe reste accessible dans la rangée collante à toute profondeur ; aucune recherche ne dépend d’un geste de défilement caché.
- Le scroll infini conserve des clés de cartes stables, évite de rerendre les cartes déjà chargées pour
  un simple changement d'en-tête et ne matérialise que les lignes visibles avec un débord borné. Des
  espaceurs conservent la hauteur logique des pages déjà chargées. La fin de pagination suit les
  métadonnées brutes TMDB (`total_pages` ou, à défaut, la présence d'une page brute) : une page dont tous
  les médias sont déjà connus après dédoublonnage ne termine jamais à elle seule le flux.
- L'enrichissement diffuseur d'une carte est différé hors des frames actives, dédupliqué et borné à quatre
  requêtes simultanées ; Explorer et Ma Liste réutilisent le même cache public de diffuseurs. En l'absence
  de valeur affichable, une carte montre un skeleton compact uniquement pendant une résolution réellement
  armée. Un diffuseur déjà en cache reste affiché pendant un rafraîchissement ; une résolution terminée
  sans diffuseur retire le skeleton sans afficher de faux logo. Le cache persistant regroupe ses écritures
  au lieu de sérialiser tout son snapshot par carte.
- Les recommandations combinent genres regardés et personnes favorites, puis excluent les médias
  déjà vus/terminés ou abandonnés. **Explorer reste le lieu de la découverte approximative** ; ces
  recommandations ne sont pas réinjectées dans les fiches média comme relations.
- « Au cinéma » exige une sortie théâtrale française TMDB type 2/3 dans la fenêtre J-75 à J+10 ; une
  sortie streaming/VOD seule n'est jamais « au cinéma ». Le Discover contraint ne sert que de préfiltre :
  les listes films Explorer sont enrichies en lot avec `release_dates` avant décision, de sorte qu'une
  projection événementielle terminée et un média vu hors du filtre aboutissent au même résultat que la fiche.

Depuis une carte, l'utilisateur peut ouvrir la fiche, suivre/retirer, ou marquer un film vu. Les cartes
qui disposent de la preuve détaillée utilisent le même résolveur parental que la fiche et Explorer.
Toute création de suivi sans progression converge vers `plan_to_watch`, quel que soit le point d'entrée.
Les anciens documents `watching` sans progression sont normalisés de façon bornée et idempotente sans
réécrire les favoris, notes, rappels ni l'archive ; le parcours explicite « Revoir » reste préservé.

## 8. Fiche média et détails associés

### 8.1 Contenu commun

La fiche combine les détails et notes TMDB, disponibilité streaming en France,
présence Plex/Arr, bande-annonce, âge conseillé, casting, ordre de visionnage/franchise et discussions
Reddit. Les recommandations contextuelles restent dans Explorer. Les modals personne et épisode restent
dans la pile Retour.

Depuis le 03/11/2026 (`SEENIT-UX-019`), les fiches série, film et épisode reprennent le prototype : un seul
défilement sans onglets, hero titré en or, carte de progression avec **Marquer SxxEyy vu** et une seule
tuile diffuseur (ta plateforme choisie, sinon Plex), **Moyenne par saison**, pastilles de saison (anneau
Vu pour une saison finie, saison choisie cerclée d'or), barres de notes et lignes d'épisode (numéro
« E02 » coloré, durée ou date, sans note ni repère sur l'image), **Où regarder** en lignes,
**Personnages** (six, puis dix par dix). Le film affiche « Si tu lances maintenant · Fin à HH:MM »,
sa saga en frise et **Similaires, et pourquoi** (raisons prouvées seulement). L'épisode ajoute la soirée de
trois épisodes, la courbe de la saison, un résumé masqué tant que le précédent n'est pas vu, **Vu, puis Ex**
et une réaction 👎 👍 ❤️. Les actions de cycle de vie et l'entrée **Téléchargement** sont dans le menu ⋮,
ancré sous le bouton (290 px, une ligne de détail par action, séparateur avant les actions de cycle de vie,
jamais de feuille du bas) ;
hors du mode téléchargement (#879), aucune ligne ni saison ne porte de bouton de téléchargement. Depuis la v1.4.282,
le mode téléchargement est bleu (bouton, panneau, épisodes cochés, choix de qualité ; `SEENIT-DOWNLOAD-019`) ;
l'or reste au Vu et à la cloche. Le badge du jour de sortie dit « Aujourd’hui » (plus « Ce soir » : l'heure n'est
pas connue). Une série
n'a qu'un bouton ⬇ dans sa carte de progression : il ouvre le mode (épisodes cochés, prochain coché d'office
et amené à l'écran, bandeau de saison dont chaque segment se touche, barre compacte ✕ · 1080p · 4K sur une
ligne à la place de la navigation ; depuis la v1.4.283, son texte se lit en entier — « 2 maintenant · 1 à la
sortie », un titre long passe à la ligne, jamais de points de suspension). La sélection est gardée quand on change de saison (« 5 épisodes · 2 saisons ») et
les saisons partent dans l'ordre. En mode, un épisode à venir se coche en bleu pour être **programmé** :
Sonarr le surveille et le télécharge à sa sortie dans la qualité choisie, sans recherche immédiate ; un
épisode à venir déjà surveillé affiche « Programmé » (horloge bleue, pastille hors mode). Avec un seul épisode sorti
coché, « Version précise › » ouvre une page pleine hauteur : versions C411 filtrables (Toutes, 1080p, 4K, Français, VO),
la conseillée en tête et dépliée (type de release en badges, sources, date, « Nom du fichier » masqué par défaut,
**Télécharger cette version**), et « Chercher sous un
autre nom… ». **Fiche film** (maquette DlFilm, 07/11/2026) : sous le gate et tant que le film n'est pas présent,
un bouton ⬇ de 56 px suit le bouton principal ; il ouvre la même barre (✕, titre et « Version précise › »,
1080p, 4K). Un film sorti part dans Radarr ; un film à venir se programme en bleu (« Programmer · Dès sa
sortie » : Radarr le surveille sans recherche immédiate). Le bouton montre ensuite un anneau « 42 % » ou une
horloge bleue, et la fiche affiche le suivi (téléchargement, « Pas encore trouvé » ou « Programmé pour sa
sortie ») avec **Annuler** (confirmé sur place pour un téléchargement ; déprogrammer ne supprime rien).
Chaque pastille de saison montre sa part vue en mini-barre et, avec
Téléchargements activé, un point bleu quand un téléchargement de cette saison est actif. Un épisode
présent dans Sonarr est reconnu comme téléchargé dans la fiche et la popup. Dans la liste d'une saison, un épisode vu
a sa photo grisée, le tampon VU et son titre barré ; un épisode à venir a un fond hachuré et « Dans X jours »
à droite, sans bouton Vu. Depuis les retours de la v1.4.247, le bouton
or de la série s'appelle **Voir SxxEyy** et ouvre l'épisode, genres et thèmes sont sous le synopsis, tout est
traduit (genres, « Self »), Où regarder n'affiche qu'un Netflix, la barre de navigation reste visible sur la
fiche et une seule fiche acteur est utilisée partout (fiches, Explorer, Moi, À voir).
Depuis les retours de la v1.4.251 (#857) :
- la note TMDB, l'âge et le bouton entier **Bande-annonce** sont en tête de fiche, au-dessus de
  **Marquer vu** (film) ou de la carte de progression (série) ;
- un film se suit et se marque vu en un clic chacun : **Suivre le film** (puis « ✓ Suivi ») est aussi large
  que **Marquer vu** ; un film vu affiche le logo Vu de SeenIt (anneau or et coche, « Vu »), qui annule le
  Vu au toucher (07/11, plus de « ✓ Vu · annuler ») ;
- « Fin à » n'affiche plus l'heure courante ni « Fini X min avant minuit », et la soirée de l'épisode non
  plus l'heure courante ;
- le bouton **Vu** des épisodes, en liste comme dans la fiche épisode, est celui de l'Accueil (anneau SeenIt
  animé) ;
- un épisode à venir reste net et dit quand il sort (« Demain », « Dans 5 jours », « Dans 12 jours ·
  16 nov. ») ; pour une série suivie, sa ligne porte une cloche de rappel (44 px) et sa fiche « Me prévenir
  à la sortie » à la place de « Bientôt disponible » (v1.4.280, `SEENIT-NOTIFICATION-009`) ; depuis la v1.4.281,
  la fiche d'un épisode à venir propose « Télécharger à la sortie » en 1080p ou 4K
  puis « Annuler la programmation » (`SEENIT-DOWNLOAD-018`), et l'épisode suivant n'est plus entouré ; depuis
  la v1.4.282, la cloche reste en or et, dans la fiche épisode, elle est ronde à côté de la croix ; depuis la
  v1.4.283, toute cloche règle les rappels de la série et montre l'état réel (allumée par défaut pour une série
  suivie quand « Sortie du jour » est activée), sans toast de confirmation (seul un échec est signalé) ;
- la fiche épisode charge avec un squelette à son gabarit actuel, garde la barre de navigation (v1.4.282,
  ouverte depuis À voir comme depuis la fiche série) et ne change d'épisode que sur un geste nettement
  horizontal : un défilement vertical en biais n'y change plus d'épisode (`SEENIT-UX-008`).
Depuis les retours de la v1.4.252 (#859), le film n'a qu'un bouton à états (Suivre le film → Marquer vu → ✓ Vu ·
annuler) suivi des tuiles diffuseur et Plex comme la série, et le bouton Vu des fiches anime dès le toucher, de
façon fluide (compositeur), sans s'atténuer pendant l'enregistrement.

Les bandes-annonces Film, Série, saisons, Explorer et actualités utilisent le même lecteur. Le nom courant
et une seule ligne nature/langue restent lisibles dans l'en-tête ; lorsqu'il existe plusieurs vidéos, leur
sélecteur reste dans une ligne dédiée plutôt que de remplacer la barre supérieure. Un simple code TMDB
`fr`/`en` donne Français/Anglais ; VF/VOSTFR/VO nécessitent un libellé explicite non contradictoire. VOST
seul et les paramètres de sous-titres YouTube ne prouvent pas une VOSTFR. Les trailers officiels passent
en premier, les autres vidéos restent accessibles sans être présentées comme des versions du même montage.
Sur téléphone Android, l'ouverture garde la modal normale en portrait et **ne force plus le paysage**.
Le bouton **Plein écran** SeenIt déclenche ensuite, sur action explicite, l'immersion native et le paysage ;
Fermer/Retour restaure les barres système, le portrait et la fiche existante. La PWA suit le même principe :
modal normale à l'ouverture, puis vrai plein écran/paysage seulement depuis l'action utilisateur lorsque les
API navigateur le permettent ; un refus laisse le lecteur utilisable. Le desktop garde sa modal normale.
La lecture automatique dépend toujours de l'autorisation YouTube/WebView. La validation réelle Android
VF/VO/vidéo sans preuve de sous-titres, ouverture portrait, plein écran paysage et Retour reste un TNR terrain
explicite (#447).

Dans une fiche épisode, **Discussions Reddit** reste verrouillé avant visionnage. Après marquage vu, le CTA
ouvre une recherche Reddit volontairement simple de la forme `English title S3 E1`. Le titre affiché dans
SeenIt reste localisé en français ; au moment d'ouvrir Reddit, SeenIt résout séparément le titre TMDB
`en-US` de la série lorsqu'il existe afin de viser le libellé le plus courant dans le corpus Reddit.
Cette résolution ne change ni la fiche ni la bibliothèque. Si TMDB ne fournit pas ce titre ou si l'appel
échoue, la recherche conserve le titre visible puis le titre original comme fallback. Saison et épisode
restent deux termes humains **sans zéro ajouté** : `S2 E1`, `S3 E1`, `S4 E10`. SeenIt n'ajoute ni
`AND` / `OR`, ni `title:`, ni nom d'épisode, ni instruction de résumé. Cette forme naturelle peut
déclencher directement la synthèse IA native sur la surface **Tout** ; sinon les résultats standards restent
immédiatement utilisables. SeenIt ne garantit pas l'affichage du bloc IA, piloté par Reddit, et n'appelle
ni Data API Reddit, ni scraping, ni service IA payant pour le produire.

Dans une fiche **Film**, **Discussions Reddit** privilégie le rappel du corpus plutôt qu'une convention
de thread particulière. Au clic, le TMDB ID exact du film sert à résoudre son titre `en-US`, puis la
recherche native Reddit reçoit uniquement ce titre communautaire anglais, par exemple `The Tinder Swindler`.
Le terrain v1.4.185 a montré que forcer `official discussion` pouvait déclencher la carte IA tout en lui
laissant zéro publication pertinente alors que des discussions existaient dans r/Documentaries,
r/NetflixBestOf ou sous d'autres titres de posts. Le titre français de la fiche reste inchangé. Si la
résolution anglaise échoue ou retourne un titre vide, SeenIt retombe sur le titre visible puis le titre
original. Aucun suffixe `official discussion` / `movie discussion`, cas spécial par film, table de
traduction, `title:`, guillemet, opérateur logique ou scraping n'est ajouté. Les résultats standards
restent le fallback permanent et Reddit décide seul du ranking et de l'affichage de sa synthèse IA.

Le titre affiché privilégie le `title`/`name` de la fiche TMDB récupérée en `fr-FR`. Un ancien titre
enregistré dans la bibliothèque sert seulement de fallback avant ou hors hydratation. Lorsqu'un média
suivi est hydraté par son identité exacte `mediaType + TMDB ID`, SeenIt fait converger uniquement son
champ `title` vers la valeur localisée ; progression, statut, favori, note, provenance et timestamps
métier restent intacts. Sans titre localisé exploitable, aucun nom n'est inventé et aucun matching par
titre n'est introduit.

L'âge conseillé automatique met la traduction lisible au premier plan, par exemple `13+`, et conserve
la certification originale et sa provenance sous une forme secondaire comme `PG-13 · US`, accessible
au lecteur d'écran et au survol. « Tous publics » n'est affiché que lorsqu'une certification US
explicite le prouve ; sinon SeenIt affiche « Âge à vérifier ». Les éventuelles corrections personnelles
historiques déjà enregistrées par type de média + TMDB ID restent lues sous le même UID afin de préserver
les données existantes, mais **aucun contrôle « Corriger l’âge » ni autre éditeur d’âge n’est exposé dans
la fiche**. Ces données legacy ne réécrivent pas TMDB.

Actions transverses : suivre/retirer, favori, note utilisateur, partage et archive lorsque disponible.
Les actions de téléchargement n'existent dans la fiche que lorsque la fonctionnalité Téléchargements est
activée pour le compte courant. Un favori active les notifications du média sans créer de progression.
Une note/favorite/archive est une intention distincte du statut de visionnage.

La section **« Où regarder »** est un repère stable : son titre reste toujours affiché et n'est jamais
remplacé par un skeleton. Tant que Plex et/ou les diffuseurs TMDB sont en résolution, la fiche utilise le
libellé unique **« Recherche Plex & streaming… »**. Les diffuseurs résolus sont conservés dans un cache
borné (120 médias, 6 h frais, réutilisable jusqu'à 7 jours en cas d'indisponibilité du fournisseur).
Une icône **« Actualiser Plex »** adjacente au titre force la redécouverte des serveurs Plex puis revérifie
le média courant, sans effacer le dernier inventaire de serveurs utilisable si la redécouverte échoue.
Le glyph reste compact mais sa cible tactile mesure au moins 44 × 44 CSS px, avec nom accessible, focus
visible et état de chargement. Quand la présence Plex est confirmée, le CTA Plex ouvre la fiche universelle
Discover dont le slug a été résolu strictement depuis le TMDB ID exact ; les locators PMS servent à la
preuve de disponibilité mais ne pilotent plus la navigation.

Pour **CANAL/myCANAL**, SeenIt ne présente aucun lien comme une ouverture de fiche tant qu'une identité
CANAL exacte n'est pas résolue. En l'absence de résolution publique fiable
`mediaType + TMDB ID → identifiant CANAL`, le diffuseur reste affiché simplement **« Canal »** mais reste
ouvrable : l'APK Android lance directement le package officiel `com.canal.android.canal`, et la PWA/Web
ouvre le site CANAL+. Ni une recherche CANAL par titre, ni le lien TMDB `watch/providers` ne servent de
destination média. L'ouverture du service peut donc arriver sur son accueil, mais SeenIt ne la présente
jamais comme une fiche exacte ; l'arrivée Live TV observée avec le lien de recherche reste explicitement
un comportement à ne pas réintroduire. Aucun titre, année ou homonyme n'est accepté comme identité CANAL.

Quand Téléchargements est désactivé, la fiche Film/Série ne montre aucune mention de cette fonction :
le bouton bleu principal/annexe, le fallback « Où regarder », le mode « Téléchargement 1-Clic », les
boutons saison/épisode, les statuts de transfert et surtout l'action **« Téléchargement » du menu « … »
en haut de la fiche** sont tous absents.

### 8.2 Films

- Le chip principal du hero affiche **« AU CINÉMA »** à la place de **« FILM »** lorsque la preuve
  théâtrale France canonique de `SEENIT-DISCOVER-001` est positive, sans second badge cinéma plus bas.
  La durée reste dans ce même chip lorsqu'elle est connue ; un film hors cinéma conserve **« FILM »**.
  Le chip et le badge d'âge peuvent se replier sur une seconde ligne sans troncature ni chevauchement,
  avec la même géométrie froide/chaude en PWA et APK.
- Ajouter à « Films à voir » suit sans marquer vu.
- « Film vu » crée `seenEpisodes=['movie']`, un `episodeRecords.movie.watchedAt` et `completed`.
- Repasser non vu retire cette progression et revient à « À voir ».
- Lorsque Téléchargements est activé, le téléchargement rapide privilégie Radarr ; C411/magnet sert de
  parcours manuel de repli. Quand il est désactivé, aucun bouton ou statut de téléchargement n'est affiché.

### 8.3 Séries et épisodes

Dans le détail d'épisode, le swipe gauche consulte le suivant et le swipe droit le précédent, avec
passage de saison lorsque disponible ; ce geste ne marque jamais vu. Les alternatives précédent/suivant
au bouton et au clavier restent à ajouter dans #179. La référence UX distingue cette consultation des
swipes de suppression/abandon sur les cartes.

- Suivre sans visionner crée « À voir ».
- Marquer un épisode vu/non vu met à jour `seenEpisodes`, `episodeRecords`, `lastWatchedAt` et le
  prochain épisode à voir.
- Marquer une saison cible uniquement les épisodes déjà diffusés lorsque TMDB les distingue.
- Une série complète devient `completed`; si TMDB la déclare Ended/Canceled elle peut être archivée
  automatiquement.
- Abandonner conserve l'historique ; Reprendre le conserve et recalcule l'état actif.
- Revoir réinitialise la progression et propose S1E1 comme prochain épisode.
- Lorsque Téléchargements est activé, Sonarr existe au niveau série, saison ou épisode et le détail
  affiche sa disponibilité par saison/épisode.
- Lorsque Téléchargements est désactivé, le détail d'épisode ne montre ni « Télécharger », ni
  « Télécharger à nouveau », ni badge « Téléchargé », ni bannière de transfert, ni modal de téléchargement.
  La disponibilité Plex reste indépendante et continue d'être affichée normalement.
- Le badge hero ne répète pas le nombre de saisons déjà présent dans la ligne de métadonnées.
- Le titre d'une saison porte lui-même le repli/dépliage avec `aria-expanded`; aucun chevron séparé ne
  réduit sa largeur. L'action de progression reste distincte et se nomme explicitement **« Tout marquer
  vu »** ou **« Tout marquer non vu »**.
- Les genres TMDB restent visibles. Les mots-clés secondaires sont repliés derrière **« +N thèmes »** et
  peuvent être masqués à nouveau sans perdre les genres.
- Les portraits du casting utilisent un cadrage orienté vers le haut, conservent leur fallback et laissent
  le nom et le rôle occuper deux lignes. Le nombre d'épisodes reste une information discrète.
- Les notes d'épisodes utilisent uniquement TMDB. Le graphique complet est affiché exclusivement dans
  l'onglet **Épisodes**, sans légende permanente ni répétition de source/votes, avec nombres visibles,
  scroll horizontal pour les saisons longues et ouverture du détail par une cible de 44 px.
### 8.4 Ordre de visionnage et franchise / univers

La cible produit des fiches est volontairement simple :

- **Film** : **Ordre de visionnage** via TMDB, puis **Dans la même franchise** ou **Dans le même univers** via TVDB ;
- **Série** : uniquement **Dans la même franchise** ou **Dans le même univers** via TVDB ;
- les sections **Films similaires** et **Séries similaires** sont supprimées des fiches. Les recommandations contextuelles restent dans Explorer.

La saga s'affiche en frise numérotée (#871, v3 #885) : « X / N vus » et barre segmentée, repères 1…N alignés
sur les affiches, film affiché encadré d'or avec « TU ES ICI », tampon VU sur l'affiche des films vus et
« À voir » sinon. L'or est réservé au film affiché (repère, segment, titre) ; les autres titres sont clairs,
gris s'ils sont vus, et les repères et traits des films vus sont neutres.

Pour un film, « Ordre de visionnage » provient exclusivement de sa collection TMDB explicite. Aucune
série, liste TVDB, entrée SeenIt ou source secondaire ne complète cette section lorsqu'une collection
TMDB est absente.

Pour la franchise / l'univers, SeenIt part de l'identité exacte `mediaType + TMDB ID`, récupère les
identifiants externes TMDB, puis rejoint TVDB sans recherche du média par titre. Le résolveur examine
uniquement les listes rattachées à l'œuvre TVDB exacte : aucune recherche globale de listes n'est
admise. Il retient au maximum une liste officielle admissible ; plusieurs listes ne sont jamais fusionnées.
Une ambiguïté entre plusieurs listes admissibles masque la section au lieu de choisir arbitrairement.

Le libellé d'une liste TVDB déjà atteinte par identité exacte sert seulement à qualifier l'interface :
**« Dans la même franchise »** pour une franchise et **« Dans le même univers »** lorsqu'il s'agit
explicitement d'un univers. Il ne sert jamais à identifier une œuvre, retrouver un membre ou lancer
une recherche globale. Chaque membre est résolu vers son `movie:<tmdbId>` ou `tv:<tmdbId>` exact avant
affichage.

Sur un film, la priorité est Ordre de visionnage puis section TVDB. **Un média déjà présent dans l'Ordre
de visionnage est retiré de la section TVDB** par `mediaType + tmdbId`, afin d'éviter tout doublon. Une
section qui ne laisserait aucun autre média affichable est masquée.

Wikidata, Kometa, MDBList et les autres pipelines multi-sources ne font plus partie de la stratégie
normale de relations de fiche. Le catalogue relationnel SeenIt historique est hors du chemin runtime normal ;
un éventuel override futur reste exceptionnel, versionné, exact et tracé. Les cas House of the Dragon,
Breaking Bad, Yellowstone, Harry Potter, MCU ou Punisher servent de TNR, jamais de conditions nominatives.

La décision durable complète est figée dans
[`docs/decisions/media-relations-2026-09-06.md`](../decisions/media-relations-2026-09-06.md) et dans
`SEENIT-RELATION-001`. Le runtime normal applique désormais ce contrat : collections TMDB pour l'ordre,
TVDB exact pour franchise/univers et aucune section similaire sur les fiches. Le pipeline relationnel
historique n'est plus une source runtime de la fiche.

Une fiche déjà résolue doit se réafficher depuis le cache chaud sans repasser par un skeleton de deux à
trois secondes. Les détails publics sont également persistés localement : après une réouverture récente de
l'application, SeenIt réhydrate d'abord le snapshot compact `detail_render` depuis IndexedDB en mode
strictement cache-only, puis monte la fiche sans timeout arbitraire ; le détail complet peut ensuite se
rafraîchir silencieusement. Une saison déjà ouverte suit la même logique avec un TTL plus court : les
réouvertures rapprochées n'appellent plus TMDB, tandis qu'une saison en cours peut être rafraîchie après
deux heures. Détails et relations restent indexés par `movie:<id>` / `tv:<id>`, les images principales
gardent une URL stable et aucune donnée utilisateur n'entre dans ce cache public. Le snapshot conserve
aussi un aperçu borné des premiers interprètes. La barre d'une fiche est structurelle dès le premier rendu :
une série réserve toujours `À propos / Épisodes / Casting`, un film `À propos / Casting`, sans dépendre
de la présence immédiate des crédits. La section Casting affiche un skeleton seulement tant que leur
disponibilité est réellement inconnue, puis la grille ou un état vide stable.
Le détail d'épisode réutilise synchroniquement son cache mémoire lorsqu'il est chaud. À froid, la modal
s'ouvre sur une géométrie stable sans afficher un faux titre ou un visuel provisoire, puis révèle le détail
résolu sans remonter toute la modal. Backdrop et contenu entrent ensemble. Depuis cette modal, revenir à
la fiche série dépile l'état historique de l'épisode en conservant la modal à l'écran jusqu'au remplacement
atomique par la fiche : À voir/Historique ne doit pas réapparaître entre les deux niveaux. La fiche média
elle-même n'a qu'une seule animation d'entrée, portée par son conteneur ; le shell froid partagé et la vue
finale ne rejouent pas une seconde animation.

Le loader relationnel
n'est armé que lorsqu'une collection TMDB doit réellement être récupérée ; une série sans relation connue
ne monte aucun faux skeleton. Lorsqu'un chargement relationnel est réel, ses cartes skeleton reprennent la
même largeur et le même ratio que les cartes finales afin de ne pas déplacer les sections voisines.
Pour une série suivie, la progression visible part du dernier état déjà persisté localement et dans la
bibliothèque utilisateur. Cocher/décocher un épisode ou une saison met à jour immédiatement ce delta
(`seenEpisodes`, prochain épisode, statut/archive et temps restant dérivé) sans relancer une collecte
TMDB de toutes les saisons. Les changements réels de diffusion ou de catalogue restent pris en charge par
le worker de métadonnées planifié et par l'actualisation explicite.
Le contrat complet est `SEENIT-PERF-001` et son suivi est
[#146](https://github.com/julfou7/seenit-app/issues/146) pour le premier rendu et
[#445](https://github.com/julfou7/seenit-app/issues/445) pour la progression incrémentale.

La machine d'états exhaustive et le mapping Plex sont autoritatifs dans `seenit.md` §5.3 à §5.5.

### 8.5 Fiche personne et filmographie

La fiche d'une personne conserve les onglets métier Joués, Réalisation et Équipe. Dans **Joués**, elle
sépare la carrière en **Films**, **Séries** et **Apparitions**. Les crédits dont tous les personnages
fusionnés sont explicitement `Self`, `Himself`, `Herself`, `Themself` ou `Themselves` sont relégués dans
Apparitions ; dès qu'un vrai rôle existe, le média reste dans Films ou Séries. Le genre documentaire ne
sert jamais à exclure ou à classer un crédit.

Chaque catégorie conserve le tri chronologique des crédits et ses personnages TMDB. Son compteur, les
filtres Tous/Vus/À voir et la barre Œuvres vues sont calculés uniquement sur la catégorie courante. Films
et séries sont identifiés séparément par `mediaType + TMDB ID`, y compris lorsqu'ils partagent le même ID ;
les anciennes séries suivies sans `mediaType` conservent le fallback historique `tv`. La grille monte au
maximum 48 cartes à l'ouverture et après chaque changement de personne, onglet, catégorie ou filtre ;
« Afficher … de plus » ajoute ensuite une tranche de 48. Ce parcours est commun à la PWA et à l'APK.

La fiche présente le portrait en cadrage vertical, sans masque circulaire. Son activation ouvre une galerie
bornée aux douze premiers portraits TMDB de l'identifiant personne exact ; cette galerie n'est demandée
qu'à la première ouverture. Retour Android et Échap la ferment avant la fiche, et les commandes précédente/
suivante restent accessibles sans geste. Une sélection de quatre crédits au maximum met en avant les
personnages nommés les mieux classés selon popularité, volume de votes et note TMDB ; elle n'affirme pas
qu'une personne est « célèbre pour » ces œuvres. Chaque carte ouvre la fiche par type média et identifiant
TMDB. Les détails biographiques restent disponibles dans un panneau repliable afin de laisser la
filmographie visible plus tôt ; les affiches de la filmographie utilisent deux colonnes sur petit écran.

## 9. Plex
### 9.1 Association et ouverture

- L'association utilise le PIN Plex dans une page externe, sondée toutes les trois secondes jusqu'au
  jeton ou à l'arrêt du parcours.
- Le jeton est sauvegardé pour le même UID ; une synchronisation complète démarre après association.
- Le CTA Plex résout strictement le slug Discover depuis le TMDB ID exact puis ouvre
  `https://watch.plex.tv/movie/<slug>` ou `https://watch.plex.tv/show/<slug>`. Dans l'APK, Android peut
  remettre ce lien universel à l'application Plex ; si elle ne le traite pas, le parcours Web reste le
  repli. Dans la PWA, la même fiche Discover s'ouvre sur le Web.
- Une disponibilité personnelle `serverId + ratingKey` reste une preuve de présence/couverture PMS ;
  elle n'est plus utilisée comme destination de navigation et aucune URL PMS n'est priorisée par le CTA.
- Si le TMDB ID ne peut pas résoudre exactement une fiche Plex, SeenIt n'utilise ni titre/année ni
  redirection aveugle vers l'accueil Plex.

### 9.2 Synchronisation

- **Rapide** utilise la baseline/cursor et les preuves actuelles nécessaires.
- **Complète** reconstruit historique, états vus, watchlist et disponibilité sur les serveurs joignables.
- Un serveur hors ligne est ignoré sans bloquer les autres ; le bilan distingue serveurs scannés,
  vus et non vus.
- Une source incomplète ne provoque aucune suppression et peut empêcher la validation du curseur
  concerné.
- Les deux modes doivent converger au même état final lorsqu'ils disposent de sources complètes.
- Seules les preuves d'identité TMDB ou un identifiant externe technique résolu vers TMDB sont
  acceptées. Titre et année ne servent jamais au mapping.
- Un non-vu Plex ne retire qu'une progression portant encore `plexImported=true`; une action SeenIt
  ou legacy sans provenance prouvée gagne.
- Le cache de disponibilité est reconstruit atomiquement et isolé par UID.
- Les cartes et grilles réutilisent ce cache de disponibilité ; leur simple entrée dans le viewport
  ne déclenche pas un inventaire Plex réseau par média.
- Un contrôle actif de présence, notamment depuis une fiche, peut rafraîchir la disponibilité via le
  backend. Ces vérifications sont bornées à deux appels réseau simultanés et à un budget de 20 secondes.
- Pour réduire le temps de réponse, le backend essaie d'abord les identifiants techniques exacts déjà
  connus (`TMDB`, puis ponts `IMDb`/`TVDB` vérifiés) et rend le premier match exact sans attendre les
  autres recherches rapides. Les connexions alternatives d'un même serveur PMS sont essayées en parallèle
  et arrêtées au premier match exact. L'inventaire paginé `includeGuids=1` reste uniquement le fallback
  borné lorsque Plex n'indexe pas ces GUIDs ; aucun titre ou année n'est ajouté comme raccourci.
- Un timeout, une panne réseau, un `401` ou un `5xx` conserve l’état connu et ne devient jamais une
  absence Plex. Seul un `2xx` explicite contenant `available:false` peut alimenter le cache négatif.

Le retrait d’un média de la Watchlist le ramène à « non suivi » uniquement si SeenIt prouve que cette
Watchlist avait seule créé le document et qu’aucune progression, note, favori, rappel, archive ou autre
intention SeenIt ne s’y est ajoutée. Le full et la delta appliquent la même règle à partir d’un snapshot
Watchlist explicitement complet. Un endpoint partiel, une panne, un timeout, une identité non résolue ou
une provenance absente conserve toujours le suivi.

## 10. Téléchargements

La fonctionnalité Téléchargements média est **personnelle et masquée par défaut**. Après hydratation du
compte courant, elle n'est active que si la préférence `downloadsEnabled` vaut explicitement `true`.
Une préférence absente, invalide ou non encore hydratée échoue fermée. Le commutateur se trouve dans les
Réglages généraux, sans exposer à cet endroit C411, Sonarr, Radarr ou qBittorrent.

Quand la fonctionnalité est désactivée :

- l'onglet et le badge Télécharger sont absents ;
- l'écran Téléchargements n'est pas affiché et une navigation directe/historique revient sur « À Voir » ;
- la fiche Film et la fiche Série n'affichent aucun bouton, libellé, statut ou disponibilité Arr liée
  au téléchargement, y compris l'action **Téléchargement du menu « … »** ;
- le détail d'épisode n'affiche ni bouton Télécharger/re-télécharger, ni badge « Téléchargé », ni
  bannière de transfert, ni modal de téléchargement ;
- le mode téléchargement des épisodes et les boutons saison/épisode sont absents ;
- le polling C411/Sonarr/Radarr/qBittorrent et l'état live de téléchargement sont arrêtés/vidés ;
- Plex et les téléchargements de mise à jour SeenIt restent hors de ce gate.

Quand elle est activée, l'onglet Télécharger possède deux modes : **Mes téléchargements** et
**Recherche C411**. Son en-tête (maquette DlOngletSuivi) porte deux boutons ronds de 44 px :
**Recherche avancée** (ouvre la recherche C411, dont la flèche ‹ ramène au suivi) et
**Réglages**, qui ouvre la configuration C411/Sonarr/Radarr/qBittorrent et webhooks, qui ne doit pas
être dupliquée dans les réglages généraux. Sous le titre, « N en cours · M à régler » (« Rien en cours »
sinon). Il n'y a plus de bouton Actualiser : la liste se met à jour seule, et Programmés/Téléchargés
se rechargent quand un téléchargement change d'état ou que l'app revient au premier plan.

### 10.1 Mes téléchargements

- Réconcilie les intentions SeenIt avec les files Sonarr/Radarr et qBittorrent.
- Pendant le handoff vers le transfert physique, un qBittorrent encore sans identité média n'est pas
  affiché en parallèle d'une intention SeenIt active techniquement compatible. Seule sa représentation
  brute est masquée : aucune identité ne lui est attribuée sans preuve exacte.
- Cartes « billet » comme l'accueil (refonte du 07/11/2026) : affiche inclinée qui déborde en haut à
  gauche, fond teinté par section (rose À régler, ambre En cours, bleu En attente et Programmés), titre or.
- Sections dans l'ordre : **À régler** (erreurs et attentes dont la surveillance n'est pas confirmée, avec
  « Choisir une version » et « Retirer » visibles sans passer par « … »), **En cours** (transferts réels ;
  film : « Film · 1080p », barre or, « 63 % » et « ≈ 25 min » en bas du billet), **En attente** (depuis le
  08/11 : une demande y apparaît tout de suite en « Recherche en cours… »), **Programmés** (calendrier, et
  une demande sans version disponible mais surveillée : « Film · Pas encore de version », « Radarr le récupère
  dès qu'une version sort »), **Téléchargés · 7 derniers jours**, puis Terminés et Annulés. Un lancement
  produit un seul toast (« Téléchargement lancé · 1080p ») ; la suite se lit ici, sans toast. Un lancement
  depuis la fiche pendant la vérification de présence l'attend au lieu d'être refusé. Une erreur explicite d'import reste dans
  « À régler » même si qBittorrent a physiquement atteint 100 %. La fiche Film/Série réutilise la même
  priorité : elle n'affiche jamais « Téléchargement terminé » et ne relance pas la présence Plex pour
  un transfert dont l'import est encore explicitement en erreur.
- Les actifs conservent l'ordre de lancement ; l'historique affiche les plus récents d'abord.
- Plusieurs épisodes d'une même saison d'une même série (TMDB exact, sinon TVDB exact, jamais le titre)
  forment une seule carte (#879, maquette DlOngletSuivi) : affiche, titre, « Saison N · K épisodes », une
  barre (un segment par épisode suivi) avec sa légende, puis une ligne par épisode avec son état
  (« 64 % · ≈ 12 min » et barre, « En attente », « Téléchargé · prêt à regarder ») et ✕ pour l'annuler
  ou le retirer, avec la même confirmation ; la carte n'a pas de balayage qui annulerait toute la saison.
  « Ajouter E6 » propose le premier épisode sorti de la saison, ni vu, ni présent, ni déjà dans la carte :
  « Ajouter E6 en quelle qualité ? » 1080p (« · comme les autres » si c'est la qualité de la carte), 4K,
  Plus tard ou Autres… (Version précise). L'ajout suit la voie et les gardes du mode téléchargement.
- Rangée **Téléchargés · 7 derniers jours** : imports réels de Sonarr/Radarr (historique
  `downloadFolderImported`, y compris ce qu'ils ont récupéré seuls à la sortie ; jamais un grab). Affiches
  de 104 px qui défilent, coche « prêt », pastille « 2 ép. » quand une série a plusieurs épisodes,
  titre or et « 2 épisodes · S02E09–E10 », « S01E03 · hier » ou « Film · lun. ». Toucher une affiche ouvre
  sa fiche. Un terminé déjà dans la rangée (TMDB et épisode exacts) n'est pas répété dans « Terminés » ;
  une source injoignable est signalée.
  Depuis la v1.4.281 : mini-cartes au style d'Explorer (cadre arrondi, « 8 ép. » et coche dans les coins,
  titre or et repère sous l'affiche) et bouton « Vider », qui masque la liste sur l'appareil sans rien supprimer.
  Depuis la v1.4.284 (`SEENIT-DOWNLOAD-021`) : la grille et la carte d'Explorer (note, logo du diffuseur, titre
  or, Série/Film, année), avec « Retirer » sous l'affiche au lieu de « Ajouter ». Retirer sort un film de Radarr
  ou une série de Sonarr en gardant toujours les fichiers (Plex garde le titre) ; une série dont Sonarr attend
  encore un épisode y reste et sort seulement de la liste. Un toast dit ce qui a été fait.
- Section **Programmés** : ce que Sonarr et Radarr récupéreront à la sortie, lu dans leur calendrier
  (120 jours) — épisodes et films surveillés, sans fichier, dont la série est surveillée — regroupés par
  série (identifiant Sonarr exact). Depuis la v1.4.280, chaque carte a une méta grise courte (« Film ·
  Radarr », « Série · Sonarr · 3 épisodes »), une seule pastille de date (« Sortie mar. 10 nov. ») et
  « Annuler » discret sur la même ligne ; les épisodes sont des lignes compactes code · titre · date avec une
  croix (44 px). Annuler retire la surveillance sans rien supprimer. Une source injoignable est signalée, jamais confondue
  avec une liste vide. Depuis la v1.4.281 : aucun texte coupé (date et titres passent à la ligne), qualité
  affichée (« Film · Radarr · 1080p »), date du film selon la sortie (« Sortie numérique… », « Au cinéma… »,
  « Déjà au cinéma · sortie numérique pas encore annoncée »), menu ⋯ sur chaque carte (qualité 1080p/4K,
  annulation). Programmés et Téléchargés affichent l'état Sonarr/Radarr synchronisé (`SEENIT-DOWNLOAD-016`) :
  plus de saut à l'ouverture, et une annulation rend l'épisode aussitôt programmable dans sa fiche. Un
  transfert sans source connectée reste dans « En cours » (« En attente de sources ») ; les messages du client
  sont en français. Programmer un épisode précis ne programme plus le reste de sa saison (`SEENIT-DOWNLOAD-017`).
  Depuis la v1.4.284 (`SEENIT-DOWNLOAD-020`) : les **recherchés** y figurent aussi — surveillés, déjà sortis,
  sans fichier (« Sorti sam. 31 oct. · recherché », « Recherché · pas encore de version »), après les sorties à
  venir ; et la section se lit en **compact** (par défaut : une ligne régulière par titre, épisodes repliés au
  chevron) ou en **détaillé** (cartes), au choix mémorisé par compte ; sous le titre, plus de « Sonarr » ni
  « Radarr » : « Film · 4K », « Série · 4K · 3 épisodes ». Depuis la v1.4.285, en détaillé, les épisodes d'une
  série se replient (« Voir les 9 épisodes · 8 recherchés » / « Masquer les 9 épisodes ») et sont repliés par
  défaut au-delà de 3. Depuis la v1.4.287, un recherché déjà vu dans SeenIt depuis plus de 24 h n'y figure plus, et
  les toasts de Programmés et de Téléchargés gardent l'affiche et ouvrent la fiche au toucher. La synchronisation ne recopie pas toute la
  bibliothèque Sonarr/Radarr : un titre déjà sur le disque se voit sur sa fiche (présence), pas dans cet onglet.
- Un swipe droit supprime une entrée d'historique ou demande confirmation pour annuler un actif.
- L'annulation active retire la demande du client ; les fichiers qBittorrent sont conservés.
- « Vider » ne touche que la section d'historique visée, jamais un actif.
- L'intention Firestore `downloadRequests` ne reste pas une seconde source d'état après le handoff :
  dès qu'un transfert physique exact est rattaché, cette intention transitoire est retirée. Si *Arr
  importe puis déplace le fichier entre deux polls, SeenIt peut terminer la demande depuis l'historique
  *Arr uniquement avec une identité TMDB exacte, le scope TV exact et un événement terminal récent
  non ambigu. La disparition de la queue n'est jamais interprétée comme une nouvelle recherche et un
  ancien document `searching` ne peut pas ressusciter l'entrée après import ou redémarrage.

### 10.2 Recherche et lancement

- Une recherche Sonarr/Radarr sans release admissible après les fallbacks autorisés conserve la demande
  « En attente de disponibilité » et envoie une alerte système unique aux appareils du compte, même si l'écran a été quitté.
  L'alerte nomme le média SeenIt et son scope ; le tap ouvre sa fiche exacte. Une panne, un timeout,
  une réponse invalide ou une recherche interrompue conserve un message distinct et ne produit jamais
  « aucune release ». Une erreur d'envoi vers SeenIt est conservée par UID pour reprise ; les retries
  ne rejouent pas une notification déjà réservée par le backend.
- Une attente persiste localement et dans le compte après fermeture/redémarrage, sans expiration de
  handoff ni relance automatique SeenIt. Sonarr/Radarr surveille le scope canonique demandé :
  « téléchargement automatique dès disponibilité d'une release compatible » n'apparaît qu'après
  confirmation de cette surveillance et du RSS actif. Sans preuve, le message invite à vérifier la
  surveillance ; une recherche interrompue reste en attente de vérification, sans faux zéro résultat.
  Annuler l'attente désactive la surveillance du scope exact et retire l'intention, sans supprimer de
  fichier ni de transfert distant. Une annulation non confirmée conserve la carte. Une arrivée tardive
  de transfert doit rester non ambiguë ; une file vide ne supprime jamais l'attente.
- Une carte terminale ou en attente possédant un TMDB exact propose « Chercher une autre release ». Le dialogue
  consulte les releases du média déjà présent dans Arr, sans ajout ni lancement automatique. Il expose
  audio VFF/VFQ/MULTI, qualité, taille, seeders et refus, avec filtre audio et scope TV exact. L'utilisateur
  confirme le seul candidat sélectionné ; fermer ou revenir annule la consultation. Un échec d'envoi
  n'entraîne jamais le lancement d'une autre release. Les cartes du suivi conservent ces badges audio ;
  MULTI/FRENCH seul reste une variante inconnue.
  Une version actuelle reconnue par hash reste non sélectionnable ; une demande active du même scope
  bloque un nouvel envoi. C411 depuis une fiche Film ajoute si nécessaire le film exact sans recherche
  automatique concurrente, vérifie le parseur Radarr et n'envoie que la release choisie.
- **Recherche avancée** (refonte du 07/11/2026, même langage que « Version précise ») : en-tête ‹ +
  « Recherche avancée », un champ (« Titre, ou titre S02E05 ») avec un bouton loupe de 48 px, puis les
  filtres de version Toutes, 1080p, 4K, Français, VO. Les résultats sont des cartes de version (titre lisible
  de la release, qualité, langue, Light, taille, ↑ seeders en vert et ↓ leechers en rouge — pas de vitesse dans
  cette recherche technique), la conseillée en tête et dépliée ; déplier montre le type de release en badges
  (IMAX, VFF, HDR10, Dolby Vision, Atmos, AC3 5.1, WEB, H.265, Netflix…, sans répéter la langue), le type
  Film/Série quand C411 fournit la sous-catégorie exacte
  (`6` ou `7`), l'âge, « Nom du fichier » (masqué par défaut), « Télécharger » et « Magnet » (copie). Plus
  de filtre Film/Série, de qualité 720p, de liste Light, de tri ni de phrase sous chaque version : le
  caractère manuel est dit par le toast et la carte de suivi. Logo Télécharger : flèche dans un cercle (08/11).
- Depuis cette recherche globale sans fiche associée, un type et une identité ne sont jamais déduits du
  nom de release. Si qBittorrent est configuré et que C411 fournit le type exact, le Magnet BTIH validé
  lui est transmis directement **sans catégorie qBittorrent gérée par Sonarr/Radarr** ; ce téléchargement
  reste manuel et l'interface le signale comme tel. Pour obtenir l'import *Arr/Plex automatique, la release
  doit être lancée depuis une fiche SeenIt exacte qui fournit `mediaType + tmdbId`. Sinon le Magnet est
  remis au client local ; Sonarr/Radarr ne sont jamais contactés à partir du titre brut.
- Les cartes C411 n'ouvrent une fiche SeenIt que si un TMDB ID exact est connu.

### 10.3 Identité et cohérence

- Une fiche/téléchargement est rattaché uniquement par TMDB ID.
- Pour envoyer une release TV externe à Sonarr, SeenIt recalcule le TVDB ID depuis le TMDB ID de la
  fiche, garantit la présence de cette série exacte dans Sonarr et vérifie avec le parseur Sonarr que
  la release pointe vers cette même série. Sans convergence exacte, aucun envoi n'est effectué ; le
  titre, l'année, l'IMDb ID ou le nom de release ne peuvent pas sélectionner une œuvre homonyme.
- Un transfert se réconcilie par `requestId`, infohash/downloadId/alias exact ou chemin exact.
- Un titre, une release, une taille ou une proximité temporelle ne suffisent jamais à fusionner.
- Les mutations sont idempotentes ; un POST Android dont le résultat est ambigu après timeout n'est
  jamais rejoué automatiquement.
- Le polling est borné, paginé et possède un backoff par source.

### 10.4 Configuration personnelle

Chaque compte possède ses URL et identifiants C411, Sonarr, Radarr et qBittorrent. Ils restent conservés
lorsque la fonctionnalité est masquée et réapparaissent inchangés après réactivation. Les boutons de test
emploient le même transport que l'action réelle. Sonarr/Radarr disposent de profils qualité séparés
1080p/4K. SeenIt provisionne automatiquement dans chaque client *Arr configuré un Connect Webhook géré,
à partir de l'URL et de la clé API déjà enregistrées : création s'il manque, réparation idempotente de
l'endpoint, du secret et des déclencheurs Download/Upgrade s'ils dérivent, sans toucher aux autres Connect.
Les valeurs personnelles restent consultables pour diagnostic ; le secret est envoyé dans l'en-tête
`x-seenit-webhook-secret`, sa rotation répare immédiatement les Connect joignables et aucun secret n'est
écrit dans les logs. Une configuration manuelle dans Sonarr/Radarr n'est plus requise dans le parcours normal.

## 11. Notifications, actualités et appareils

Les préférences globales du compte couvrent : nouvel épisode le jour J, première d'une saison à J-7,
sortie cinéma le jour J et sortie DVD/VOD le jour J lorsqu'une date française TMDB explicite existe.
L'horaire de référence est 09:00 locale. Pour les films, la sortie cinéma utilise `release_dates` FR type
3 puis 2 ; la sortie vidéo/VOD/physique utilise la première date FR type 4 ou 5. Sans preuve française
explicite, aucun rappel film n'est programmé et aucune estimation J+120 n'est utilisée.

Dans la page Notifications, le « Rappel de sortie · aujourd'hui » calculé n'apparaît pas si la
notification de cet épisode a déjà été reçue (ou, sans numéro d'épisode, une notification de la série
le même jour) : une sortie ne donne jamais deux cartes. Une notification d'épisode montre l'image de cet
épisode (TMDB), le visuel de la série restant le repli. Une carte « à jour » dont le prochain épisode
est daté affiche « Prochain épisode dans 6 jours » (ou « demain », « aujourd'hui ») au lieu de « bientôt ».

- L'intention est partagée via Firestore ; chaque installation autorisée possède son propre token.
- Un téléphone et une PWA du même compte peuvent recevoir l'événement sans partager un token unique.
- Déconnecter un appareil révoque son installation sans désactiver les autres.
- Les webhooks Sonarr/Radarr ciblent seulement les installations du propriétaire de l'endpoint. Un
  événement `Download` garde un reçu visible « Import terminé » sur PWA/APK legacy. Sur un Android dont
  la copie privée Plex est confirmée, le signal data-only affiche localement le média avec
  « Import terminé » puis réutilise le même identifiant pour passer à
  « Disponible dans Plex » après preuve TMDB exacte (et saison/épisode exacts pour la TV). Le tap ouvre
  la fiche SeenIt exacte ; lorsque le poster PMS exact est disponible, l'état replié le conserve à
  droite en contain sans crop et l'état développé l'affiche une seule fois, entier et centré dans le
  BigPicture. « Ouvrir dans Plex » n'est exposé que lorsqu'un slug Discover strictement résolu par TMDB
  permet l'URL
  `watch.plex.tv/movie|show/<slug>`. Aucun titre/année ni accueil Plex n'est un fallback. Associer ou
  retirer Plex rafraîchit immédiatement l'enregistrement de l'appareil déjà autorisé afin que cette
  capability serveur suive l'état natif sans redémarrage.
  Ce second signal reçoit un `traceId` aléatoire : le backend trace son routage, puis Android journalise de
  façon bornée les étapes réception FCM, enqueue/exécution WorkManager, état du credential, résultat Plex
  et affichage local. Au prochain démarrage authentifié, ces breadcrumbs sont envoyés au backend puis
  acquittés localement ; seuls `traceId`, étape, résultat, tentative et horodatage sont transportés, jamais
  UID/token/titre/TMDB/URL/chemin. Les succès sont conservés en report-only pour permettre un diagnostic
  de bout en bout sans transformer une télémétrie saine en alerte.
- Les notifications profondes ouvrent le média/épisode exact, y compris après un démarrage à froid de
  l'APK ; l'APK peut exposer « Marquer comme vu ».
- Pour « nouvel épisode le jour J », la notification système est l'unique alerte : aucun toast interne
  « disponible aujourd'hui » n'est ajouté au démarrage ou lors d'une reprise. Les rappels saison J-7 et
  film conservent leur feedback interne existant.
- Les clés locales de programmation évitent le doublon sur une même installation et leur schéma peut être
  versionné pour remplacer proprement une alarme persistée quand son payload doit évoluer.
- Le receiver Android hydrate le `largeIcon` compact et le BigPicture depuis le fichier privé borné au
  moment exact de la livraison. Le poster est composé en contain sans crop : carré centré pour l'état
  replié, canevas BigPicture neutre pour l'état développé, où le `largeIcon` est masqué afin de ne montrer
  qu'un seul visuel média. La préparation consulte d'abord ce cache persistant : une image déjà
  matérialisée n'est pas retéléchargée. Un cache miss est retenté de façon bornée et les téléchargements
  concurrents de la même image sont coalescés. Les métadonnées TMDB (dont les chemins d'image) continuent
  de bénéficier du cache public #410 ; ce cache de métadonnées ne duplique pas les octets du fichier image.
  Une alarme future qui n'a pu obtenir aucun visuel reste réparable lors d'un prochain passage avant sa
  livraison. L'alarme planifiée ne transporte jamais le bitmap ; le fallback texte reste valide si le
  fichier a disparu ou ne peut pas être décodé.

Après qu'une release APK officielle a été publiée et vérifiée, SeenIt peut prévenir les installations
Android autorisées du compte :

- l'envoi vise Android uniquement dans la première version ; la PWA ne reçoit pas ce push ;
- une même installation reçoit au plus une notification par version, y compris après une reprise ;
- toucher la notification revient sur l'accueil « À voir », déclenche le contrôle canonique et ouvre
  la fenêtre de mise à jour seulement si une version plus récente est effectivement disponible ;
- la notification ne constitue jamais une source d'installation : l'application revalide la release,
  l'asset exact et son SHA-256 avant tout téléchargement ;
- une panne FCM reste observable et rejouable sans annuler ni altérer la release déjà publiée.

Chaque média est évalué indépendamment : un média archivé/abandonné, sans date exploitable ou sans
prochain épisode est ignoré sans interrompre la programmation des suivants. Aucun rappel n'est programmé
pour l'élément inéligible. Les tests « Tester » des réglages réutilisent le même pipeline de rendu média
que les vrais rappels (visuel, libellé avec emoji et action adaptée au type). Ils prennent en priorité le
prochain événement réel éligible de la bibliothèque ; à défaut, un média actif du bon type sert seulement
d'exemple de rendu. Ils valident l'autorisation et le rendu, pas l'arrivée future d'une donnée TMDB ou
d'un webhook réel.

## 12. Réglages et maintenance utilisateur

L'autorisation « notifications sur cet appareil » couvre aussi l'alerte de nouvelle version sur
Android ; aucun réglage séparé n'est ajouté initialement.

Les Réglages s'ouvrent par la roue de Moi (ou « Tous les réglages » des réglages rapides) avec un
seul en-tête : bouton Retour rond de 44 px et titre. L'accueil tient en cinq lignes, chacune avec son
état réel, puis la déconnexion confirmée et la version installée :

- **carte du compte** (avatar, nom, e-mail, « Synchronisation automatique » ou quota cloud atteint) →
  écran **Compte** : contenu du compte (séries, films, favoris, épisodes vus), « Sauvegarder maintenant »
  et « Recharger depuis le cloud » en secours, déconnexion confirmée ;
- **Mes plateformes** (noms choisis) → tuiles Netflix, Prime Video, Disney+, Canal+, Apple TV+,
  Paramount+, Max, France TV et Arte avec leur vrai logo (logos connus, puis catalogue public TMDB France
  gardé 30 jours ; pastille de secours si un logo manque), un toucher par plateforme ;
- **Notifications** (nombre activé, rappels à 09:00) → état réel de l'autorisation sur l'appareil avec
  « Autoriser les notifications », interrupteurs Séries (nouvel épisode, nouvelle saison J-7,
  actualités) et Films (cinéma, DVD/VOD), puis **Autres alertes** sans préférence SeenIt (Rappels,
  Téléchargements et Plex, Mise à jour de SeenIt) : chaque ligne ouvre son canal Android, réglages
  Android, et « Envoyer une notification test » qui déplie les quatre tests existants ;
- **Connexions → Plex** (point vert si synchro de moins de 24 h, orange sinon) → compte et titres
  reconnus, « Synchroniser maintenant », serveurs du dernier bilan de synchro, synchro complète et
  déconnexion confirmée ; association et annulation inchangées ;
- **Connexions → Appareils** → ce téléphone ou ce navigateur et son autorisation de notifications,
  association SeenIt TV par QR code confirmée sur le téléphone ; la dissociation se fait depuis la TV ;
- **Application** (badge « Mise à jour » si une version est disponible) → version installée ou à
  installer avec progression, « Vérifier les mises à jour », Nouveautés (historique des changelogs),
  Badges animés, **Fonctionnalités → Téléchargements** (interrupteur désactivé par défaut, sans URL ni
  clé C411/Sonarr/Radarr/qBittorrent), puis Avancé : import TV Time CSV, synchro TMDB forcée, interrupteur
  **Journal de diagnostic** (par appareil, activé par défaut ; désactivé, seules les alertes et erreurs
  sont gardées) et « Voir le journal » filtrable, copiable et effaçable.

Chaque écran est un niveau de la pile Retour : Retour, le bouton rond, le bord gauche ou l'appui sur
l'onglet actif ferme seulement cet écran. Les Réglages gardent la barre de navigation : un double appui
sur Moi les ferme et ramène Ma liste, et changer d'onglet les ferme.

Le changelog présenté dans la fenêtre de mise à jour résume les effets visibles sous un titre unique
et quelques phrases courtes par version. Lors d'un saut, il affiche dans l'ordre chaque release
officielle postérieure à la version installée jusqu'à la cible incluse ; un saut d'une seule version
conserve l'affichage compact habituel. Si cet historique n'est pas récupérable, les notes de la cible
restent disponibles et l'installation n'est pas bloquée. Les textes emploient les mots compris dans
l'interface et ne montrent pas les identifiants Plex, UID, noms de cache, fichiers, tests ou détails
de CI réservés aux preuves techniques.

La ligne Nouveautés de l'écran Application charge indépendamment toutes les releases officielles
disponibles, de la plus récente à la plus ancienne. Cette consultation reste paginée et bornée ; une panne
partielle conserve l'historique officiel déjà obtenu ou la dernière version connue.

Une fois l'APK téléchargée et vérifiée, SeenIt affiche une notification locale « Mise à jour
téléchargée » puis « Installeur lancé » pendant que le Package Installer Android prend le relais. Le dialogue Play Protect des applications distribuées hors Play
reste sous le contrôle du système : SeenIt ne le masque pas et ne demande jamais de désactiver cette
protection. La livraison distingue l'enregistrement officiel du développeur/package/certificat de la
réputation Play Protect et consigne le comportement d'une installation propre selon le
[runbook hors Play](../process/play-protect-sideload.md). Aucune disparition du dialogue n'est garantie
pour chaque nouveau binaire.

L'import TV Time résout les entrées vers TMDB avant écriture. Un résultat introuvable reste en échec
modifiable ; il n'est pas inventé. Les actions de maintenance ne changent jamais l'identité Firebase,
le databaseId ou la signature APK.

## 13. Résilience, UX et limites assumées

Le cadrage transversal [UX](./ux-reference.md) couvre les boutons, cartes, en-têtes, superpositions et
gestes spécifiques. Les reliquats encore ouverts de l'audit restent suivis dans
[l'audit UX](../audits/audit-ux-2026-09-06.md) et leurs issues dédiées. `SEENIT-UX-009` impose aux contrôles
isolés une cible 44 px, un focus et un nom accessibles, des états async sérialisés et des cartes dont
l'ouverture clavier reste distincte des actions rapides ; le footer d'action plein largeur d'une carte peut
rester compact, et l'appui long est annulable avec une
alternative de menu contextuel. La fiche épisode applique `SEENIT-UX-008` : swipe, boutons
Précédent/Suivant et ←/→ clavier hors saisie partagent la même navigation locale, franchissent une saison seulement à partir des
données disponibles et ne modifient jamais la progression ; les actions Plex/téléchargement/Vu restent
indépendantes du drag. Le socle #15 fournit désormais une preuve automatisée PWA/APK : rendu navigateur réel
360/412/desktop, clavier, arbre d'accessibilité, cible tactile 44 px, service worker/offline/notification,
budgets bundle et budgets de démarrage/reprise Android. Les essais humains TalkBack et gestes système
restent des TNR terrain lorsque le risque du changement UX l'exige ; ils ne sont pas simulés par la CI.

- Le rendu mobile respecte les safe areas ; la barre basse ne masque ni contenu ni toast.
- Les écrans lourds sont lazy-loadés et préchargés après connexion ; l'écran courant reste visible
  pendant un chargement afin d'éviter un flash noir.
- Les erreurs réseau privées deviennent des messages ou logs bornés, sans secret.
- Les erreurs et warnings backend qualifiés produisent un événement opérationnel structuré sans route,
  message, en-tête, UID ni payload utilisateur. Un lot GitHub Actions les audite périodiquement : il
  n'ouvre ou n'enrichit une issue que pour une règle ayant dépassé son seuil. Les échecs client
  allowlistés (Firestore, notifications, téléchargements, mise à jour APK, cache) sont d'abord comptés
  localement puis envoyés uniquement sous forme `code + count`, par lot opportuniste au plus toutes les
  trente minutes lorsqu'un appel API authentifié a déjà lieu ; aucun warning individuel ne déclenche de
  trafic. Un warning inconnu doit se répéter sur deux fenêtres de six heures avant de devenir une issue
  de qualification. En mode live, une panne de l'auditeur ou de ses sources ouvre/enrichit une issue
  P1 de santé à partir des seuls outcomes/statuts techniques, sans ingérer de logs. Les autres événements
  restent report-only ; l'application ne dépend jamais de GitHub pour répondre aux requêtes.
- Une indisponibilité TMDB peut laisser un écran partiel ou un cache ; elle ne justifie aucun matching
  par titre et ne transforme jamais une classification d'âge inconnue en « Tous publics ».
- Les parcours critiques qualité sont connexion, bibliothèque, Plex, téléchargements, mise à jour et
  notifications. Leur matrice de preuves est versionnée dans `quality-gates.json`. Les tests PWA
  navigateur bloquent toute origine externe : aucune validation CI de ce socle ne contacte les comptes
  personnels Plex, Sonarr, Radarr ou qBittorrent.
- Une indisponibilité d'un serveur Plex/Arr/qBit ne doit pas effacer un état connu.
- SeenIt est pour l'instant un produit personnel mono-propriétaire logique. Il n'existe pas encore de
  profil public, partage social, administration multi-utilisateur ou catalogue éditorial propre.
- Les rappels film reposent uniquement sur des dates de sortie françaises explicites fournies par TMDB ;
  une absence de date reste une absence de rappel. La fenêtre « Au cinéma » n'est pas une programmation
  temps réel de salles ou de distributeurs.

## 14. Matrice PWA / APK

| Parcours | PWA | APK Android |
|---|---|---|
| Auth Google | Popup Firebase | Credential Manager, fallback natif |
| Données compte | Firestore `default` | Même Firestore et même UID |
| Overrides historiques d’âge conseillé | Lecture Firestore du même UID, aucune édition UI | Même comportement |
| Backend | Même origine canonique | `https://seenit.ai.studio` explicite |
| Retour | Historique navigateur | Modals → fiche → historique → À Voir → quitter |
| Toast média À voir / Vu | Ouvre la fiche exacte par `mediaType + tmdbId` | Même comportement dans la WebView ; retrait/suppression non navigable |
| Partage fiche média | URL HTTPS canonique `tmdbId + mediaType` réouvrable | Même URL publique ; jamais d'URL `localhost`/WebView |
| Plex | Fiche Discover Web vérifiée par TMDB | Lien Discover vérifié : application Plex puis Web ; locators PMS réservés à la disponibilité |
| Reddit/autres liens | Nouvel onglet | Application associée, puis Custom Tab |
| Magnet | Gestionnaire navigateur/système si Téléchargements est activé | Intent Android compatible si Téléchargements est activé |
| Notifications | Web Push/service worker ; « Import terminé » reste distinct de Plex | Push + notifications locales ; vérification Plex arrière-plan par identité exacte |
| Mise à jour | Bannière/rechargement PWA | Téléchargement, SHA-256, notification de fin, installateur Android |
| Hors-ligne | Shell/cache et dernier état UID | Même logique dans la WebView |

Dans l'APK, une erreur réseau/DNS temporaire vers `seenit.ai.studio` peut replier une requête Plex
sur l'URL Cloud Run vérifiée du même backend canonique. Les couples origine/transport sont essayés
une seule fois chacun ; une réponse HTTP, même en erreur, arrête ce repli. La PWA conserve ses routes
relatives de même origine.

Un changement commun doit être vérifié sur les deux colonnes. Une divergence n'est acceptable que si
elle est nécessaire à la plateforme et explicitement documentée.

## 15. Écarts connus à ne pas normaliser silencieusement

| Priorité | Écart observé | Décision / issue |
|---|---|---|
| P1 | La classification d’âge actuelle peut préférer une valeur FR permissive, sous-classer des certifications US et inventer un TP par genre. | Appliquer `SEENIT-PARENTAL-001` : [#98](https://github.com/julfou7/seenit-app/issues/98). |
| P1 | Les personnes favorites restent locales et font diverger les recommandations PWA/APK. | Rendre Firestore autoritatif : [#95](https://github.com/julfou7/seenit-app/issues/95). |

## 16. Contrat de maintenance de cette référence

- **SEENIT-FUNCTIONAL-001** — Avant une modification, l'agent lit cette référence avec `AGENTS.md`
  et `seenit.md`. Toute fonction ajoutée, retirée ou dont le résultat observable change met à jour la
  section concernée dans la même livraison.
- Une règle durable nouvelle est enregistrée dans `docs/requests/registry.md`, puis reliée à une
  exigence et un test lorsque la gouvernance de la SPEC l'impose.
- Un écart entre la SPEC et le code n'est jamais résolu en réécrivant la SPEC pour épouser un bug :
  il produit une issue priorisée, ou une décision produit explicite qui modifie ensuite la SPEC.
- Un audit reste une photographie datée. Cette référence décrit toujours le produit voulu/courant et
  retire de sa matrice un écart seulement après preuve de correction.
- Pour chaque changement, vérifier au minimum : écran d'entrée, état avant/après, Firestore et cache,
  PWA, APK/Retour/intents/safe areas, erreurs réseau, isolation UID, notifications et tests.

Clarification terrain v1.4.218 (#729) : Films à voir précède la section Pas vu depuis un moment,
toujours en dernier. Les films démarrent en rail affiche et passent par icône à la liste de billets
horizontaux du prototype. Le header sticky prolonge son flou sous les filtres. Les notifications ont
une vignette et se retirent une par une par swipe/bouton, avec Annuler et persistance locale par UID.
Un compte TMDB provisoire de liste partielle reste inconnu sans preuve de fin/planning complet/total
annoncé au-delà de la liste ; les anciennes preuves sont réactualisées une fois. Aucun override par titre.

Réouverture Plex (#741) : les synchronisations automatiques Plex/détails attendent respectivement 2/5 secondes après retour visible, avec un seul départ malgré focus/visibilité/activité Android. Le travail différé est annulé quand l’app redevient cachée. Une limitation HTTP429, y compris une réponse texte, est une pause compréhensible ; Retry-After ou 60s par défaut est conservé localement par compte après redémarrage. Aucun cache/progrès/curseur n’est remplacé à cause de cette erreur, et aucune nouvelle origine/transport n’est essayé immédiatement. La source distante réelle de la saturation et les temps de frame du téléphone restent à confirmer.


À voir, ZIP(9) (#729) : six cartes par rail puis Voir en liste ; listes par12, toutes accessibles. Films triés par ajout récent et identité, stables pendant enrichissement et navigation. Acteur top10 : favori puis titres vus puis premier rôle, uniquement depuis cache ; mini-fiche avec favoris, titres connus, ajout À voir et filmographie existante. Billets liste104px : titre entier sur2lignes, acteur, diffuseur+année, heure au talon. Actions8f au centre de la zone supérieure (58px), groupes À venir13px neutres, glyphe Vu partagé.


Plex (#744) : le compte capturé est un paramètre obligatoire du transport. Un changement pendant la migration ou les en-têtes annule l’envoi ; la pause d’une réponse déjà en vol reste dans le compte d’origine.


Bascule de vue À voir (#729, vidéo19h32) : la carte affichée reste ancrée à l’écran entre carrousel et liste, même après défilement et au retour depuis un élément au-delà du rail initial. Les données gardent leur ordre ; seul le défilement est restauré. Une icône déjà active ne réinitialise pas la vue. Revenir en carrousel reste accessible en pied de liste films, comme pour les séries. Seul le reset explicite revient au début.


Retour terrain220 du23octobre (#729/#741), utilisateur sans APK pendant la collecte : pagination par6 via bouton pleine largeur avec3affiches et nombre en attente, dans le mode courant. Badges plats et compacts uniquement pour date récente ou finale ; ni Dispo, ni Plus queN, ni Délaissé. Le détail ancien reste un texte secondaire. Barre saison centrée dans l’espace sous l’affiche ; les wrappers swipe ne changent ni la hauteur ni le point d’ancrage des cartes. Film horizontal120px pour titre2lignes, acteur et année sans chevauchement. Après confirmation Vue depuis Nouveautés, conserver la carte pendant son animation puis la faire apparaître en tête de Continuer, avec remontée vers la section ; aucun transfert ni scroll avant acquittement ou après échec. Réduire les animations conserve ce résultat sans mouvement prolongé. Le détail Plex expose uniquement le store existant au tap sur l’anneau : aucun polling ni lecture/écriture Firestore ajouté. Les changements de messages Plex ne rerendent pas les cartes ; hydratation acteurs locale unique par identité/UID, travail découpé et recalculs regroupés hors premier rendu.


V4 canonique reçue le24/10/2026, archive ZIP(10) : voir docs/design/home-a-voir-v4.md. Cette V4 remplace les choix intermédiaires ci-dessus pour badges (emoji22px), cadence/hauteurs170px, titres40px/20px, rail6+tuile puis6, liste3+6 sans bouton Revenir, frise Historique groupée par jour et épisodes consécutifs, acteur directement plein écran sans compteurs doublons. Les exemples de maquette ne sont jamais des identités ou données de production. Les correctifs terrain restent requis : animation acquittée avant déplacement Nouveautés→Continuer, ancrage sans décalage collatéral, swipe sans croissance, lecture Plex sans rerendu des cartes et hydratation locale acteurs découpée. Pas de nom de serveur Plex sur les billets. Totaux : un total déclaré fournisseur supérieur à1 est connu même sans finale datée ;1seul sur la dernière saison en préparation est un placeholder tant que ni finale explicite ni fin/ancienne saison ne le confirment. Réparer les preuves historiques ambiguës de façon ciblée. Les barres des films À venir représentent uniquement la collection TMDB explicitement rattachée, avec identités exactes et ordre fournisseur/date ; aucun nombre déduit du titre ni franchise TVDB/Wikidata substituée. Aucune APK ni bump tant que la collecte des retours n’est pas clôturée par l’utilisateur.

V4, coût au lancement : l’Historique masqué ne normalise ni ne regroupe les visionnages et n’enrichit pas ses lignes ; sa page et ses métadonnées restent en mémoire pour la prochaine ouverture. La fiche acteur réutilise le rappel individuel À venir et suit un projet absent uniquement après le geste explicite sur sa cloche.

Frise V4 : les marquages de saison partagent parfois le même instant ; le tri de production départage alors leurs épisodes numériquement (saison/épisode décroissants), puis groupe et pagine les lignes. Le tri lexical ne doit pas séparer E1, E10 et E2.

Bientôt dans la fiche acteur : le passage d’un projet non suivi à son document de suivi conserve l’état et l’attente de la cloche ; sa clé est l’identité TMDB avec média/épisode, jamais l’identifiant attribué pendant l’ajout.


Mise à jour terrain222 : les règles d’accueil/badges/historique du 24octobre2026 sont définies dans [le handoff intégré](../design/badges-historique-2026-10-24.md) et [les décisions d’intégration](../design/home-a-voir-v4.md). Elles priment sur les anciennes pilules emoji et l’interdiction antérieure de tout badge en pause.

### Marque v3 / terrain223 (25 octobre 2026)
Voir [marque v3](../design/marque-2026-10-25.md) : actifs fournis réutilisés sur accueil/connexion/splash, boutons Vu anneau/coche, navigation sans point inférieur, PWA/launcher/notifications. Le splash termine sa séquence3700ms même si l’app est prête (résultat immédiat avec réduction des animations). Un Vu réussi anime le bouton, puis le tampon sur l’affiche, puis la nouvelle reprise ; dernier disponible tamponné jusqu’au rafraîchissement, Annuler retire ce tampon. Bandeaux compacts au bas des affiches, y compris ×N dans l’historique ; bouton Vu des films sur le talon sombre et métadonnées sous l’affiche. L’extension horizontale remplace la tuile sans changer le scroll. Les preuves de saison reçues par la fiche convergent vers les cartes. Historique sans « ce soir ». Bilan Plex centré et défilable.


Retour terrain225 du25/10/2026 (#729), prioritaire sur les regroupements antérieurs : un visionnage = une ligne, sans ×N ni plage d’épisodes, même pour une saison marquée en une fois. Périodes, totaux, heure et actions par épisode conservés. Navigation : centres du pictogramme et du texte identiques sur tous les écrans. Vu : anneau progressif760ms puis coche240ms, tampon puis reprise ; réduction des animations immédiate. Splash : huit segments160ms, anneau1280ms, coche1640ms, signature1860ms/300ms puis lecture complète pendant1540ms ; durée3700ms et fondu500ms inchangés. Référentiel détaillé : docs/design/marque-2026-10-25.md.

Retour terrain226 du26/10 (#729) : coche entièrement masquée avant son tracé normalisé ; splash à cadence commune160ms par cran, maintien final réduit200ms (3500ms puis fondu500ms). Remplacé le 03/11/2026 : 2 300 ms puis fondu 500 ms, segments conservés, anneau en transforms. Ticket horizontal avec découpes symétriques ; en rail, acteurs alignés par rangées communes aux titres, Vu36px dans cible44px à droite du talon, fin/heure à gauche et année sous le titre. La dernière notification retirée ferme sa feuille avec retour de focus et Annuler conservé. Voir docs/design/marque-2026-10-25.md.

Terrain229 : une réouverture de panneau ne suffit pas à prouver sa fluidité. Les périodes Historique et leurs totaux sont indexés et mémorisés ; aucune création de formateur de date par visionnage ni filtre intégral par période visible pendant le rendu. Le scénario navigateur mesure les composants de production sur6300visionnages, pagination et bascules répétées ; aucun historique utilisateur distant n’est modifié.

### Notifications unifiées #778

Le titre nomme l’œuvre ; le type est dans l’en-tête Android (`subText`), le compact donne un fait et le développé ajoute du contexte. Les téléchargements distinguent envoi au client, import et preuve Plex exacte. Les huit canaux dédiés (dont « Mises à jour de SeenIt », qui sonne et vibre pour une nouvelle version, #909) sont créés au démarrage sans recréer Téléchargements ni écraser les choix Android. Les réglages exposent Actualités et l’accès au panneau système ; la migration v8 reprogramme les rappels. Les images gardent le cache privé borné, contain et l’hydratation à la livraison. Les alertes vues/archivées sont retirées ; une notification Vu peut afficher la reprise suivante avec la même identité sans son. Voir SEENIT-NOTIFICATION-005 à 008 et [contrat](notification-refactor-2026-10-27.md).

Complément Explorer29/10 (#398/#787) : [fiche personnage](../design/explorer-personnage-2026-10-29.md), reprise exacte sur crédits par épisode, cache public borné, calcul au premier accès uniquement ; progression/favoris isolés par UID. Toasts au-dessus du champ et retour aux résultats avec la même requête, clavier fermé. Depuis #872, la fiche personnage défile jusqu'en bas même ouverte clavier tout juste fermé, n'affiche un univers que s'il a un nom exact (sinon « Personnage » seul) et montre « vus par toi » partiel (« ≥ N ») tant que tout n'est pas vérifié.
### Téléchargements — prototype du 5 novembre 2026 (#861)

Notification import #801 : l'affiche du média exact est attachée au reçu « Import Plex terminé »
depuis le cache privé Android, enrichi par le worker sans changer l'identifiant ni sonner à nouveau.
La confirmation « Disponible dans Plex » exige toujours la preuve de copie exacte indépendante.

Correctif terrain v254 : carte sans nom technique ni boutons secondaires permanents ; actions sous
« … ». Sélecteur de qualité à surface unique, sans jargon ou panneau de transfert terminé ; ouverture
et fermeture sans commande. Le téléchargement de saison est une icône dans l'en-tête Saison N,
plus dans la rangée Tout marquer vu / Bande-annonce. Vrais composants vérifiés en 360/412 px.

Les cartes « billet » suivent l'accueil : À régler, En cours, En attente, Programmés, Téléchargés (7 derniers jours), Terminés puis Annulés. Les erreurs explicites restent prioritaires. Dans la fiche série, le numéro occupe la vignette ; téléchargement et Vu sont des commandes séparées, disponibles selon feature gate et présence réelle. Le bouton ouvre le choix de qualité existant avant toute mutation. Voir le [contrat détaillé](../design/downloads-2026-11-05.md).
