# SeenIt — Référence fonctionnelle canonique

Dernière vérification : 9 septembre 2026
Baseline observée avant correction : **1.4.125**, `main` `98716256fd046f142031ef8f623eba91f3135fbf`
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
- `POST /api/releases/notify` : signal post-release public borné, dont le run, le SHA, le tag, l'APK et
  son SHA-256 sont revalidés auprès du dépôt officiel avant toute notification Android ;
- `GET /api/webhooks/config`, `POST /api/webhooks/config/rotate` et webhooks personnels : réception
  des événements Arr ;
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
| Logs techniques | Appareil et UID ; export volontaire seulement |
| Personnes favorites | Doivent être partagées ; écart actuel suivi par #95 |

Le bouton « Sauvegarder » des réglages pousse l'état local courant et les réglages vers Firestore ;
« Recharger » redemande l'état serveur. La synchronisation temps réel reste le fonctionnement normal,
ces boutons sont des actions de récupération explicites.

## 4. Navigation globale

Les gestes et leur portée exacte sont inventoriés dans la [référence UX](./ux-reference.md).
Le reset de navigation actuel présente des écarts (#178) : reconnaissance après changement d'onglet
et remontée globale des conteneurs, y compris cachés. Ne pas les prendre comme conventions à reproduire.

La barre basse possède trois destinations toujours visibles, dans cet ordre :

1. **À Voir** : accueil opérationnel ;
2. **Explorer** : recherche et découverte TMDB ;
3. **Profil** : statistiques, Ma Liste et accès Réglages.

La destination **Télécharger** n'apparaît que lorsque le compte courant a explicitement activé la
fonctionnalité personnelle Téléchargements dans Réglages. Lorsqu'elle est visible, elle s'insère en
**troisième position**, ce qui donne **À Voir → Explorer → Télécharger → Profil** : Profil reste donc
toujours la destination la plus à droite. Son badge compte alors les transferts actifs ou qui demandent
une attention. Une navigation historique ou directe vers `downloads` alors que la fonctionnalité est
désactivée revient sur « À Voir ».

Les destinations se partagent toute la largeur utile de la barre au lieu d'être limitées à une petite
largeur fixe. Les glyphes de navigation sont rendus à 28 px, les libellés mobiles à 10 px et chaque
contrôle conserve une cible tactile d'au moins 44 × 44 CSS px ainsi que la safe area basse.

L'onglet actif et ses glyphes utilisent l'or SeenIt et son bouton expose `aria-current="page"`. Un appui
sur l'onglet actif ferme le niveau courant ; un double appui réinitialise/ramène le contenu en haut lorsque
l'écran l'implémente. Les écarts de reconnaissance et de portée du reset restent suivis dans #178.

L'ouverture d'une fiche est un niveau de navigation au-dessus de l'onglet courant. Le Retour Android
ferme dans l'ordre : dialogue ou modal, fiche, historique interne, retour à À Voir, puis application.
Les deep links de notification acceptent `showId` ou `tmdbId`, `mediaType`, saison et épisode. Une
action notification `mark_watched` peut marquer l'épisode exact après résolution de la fiche.

## 5. Écran « À Voir »

L'écran comporte une navigation haute entre **À Regarder**, **À Venir** et **Historique**, ainsi que
le fil d'actualités des médias suivis.

### 5.1 À Regarder

- **Nouveautés** est prioritaire pour une série/nouvelle saison récente ;
- **Continuer à regarder** reçoit les séries commencées vues dans les 60 derniers jours inclus ;
- **Pas vu depuis un moment** reçoit les autres séries encore regardables ;
- **Films à voir** reçoit les films suivis non vus dont la sortie n'est pas future.

Les règles exactes de frontière sont dans `seenit.md` §5.1. Chaque carrousel affiche un premier lot,
peut être étendu par « Voir tout » puis paginé par lots de huit. Les médias abandonnés, archivés ou
terminés ne reviennent pas dans le parcours actif.

Sur une carte série, un swipe permet de retirer le suivi (avec confirmation) ou d'abandonner la
série ; les actions sont aussi accessibles au clavier. Une action destructive possède un toast avec
annulation.

### 5.2 À Venir

- Liste les prochains épisodes connus avec leur date relative.
- Ouvre directement la fiche ou le détail d'épisode.
- Permet d'activer/désactiver un rappel pour l'épisode présenté.
- Un rappel spécifique met à jour l'intention de notification du média et son document Firestore.

### 5.3 Historique et actualités

- L'historique est trié depuis les `watchedAt` des épisodes/films.
- « Marquer comme non vu » retire uniquement la progression ciblée et propose Annuler.
- Le fil Actualités affiche les événements non lus de séries encore présentes : nouvelle saison,
  diffusion, renouvellement/annulation et informations générées par le worker de détails.
- Une actualité lue est retirée et son état est partagé entre appareils.

## 6. Profil, statistiques et Ma Liste

Le profil affiche l'identité Google, l'année d'inscription et deux onglets :

- **Statistiques** : temps de visionnage estimé, volumes, répartitions, personnes fréquentes et badges
  Centenaire, Oiseau de Nuit, Grand Écran et Binge-Master ;
- **Ma Liste** : vue exhaustive de la bibliothèque par intention et progression.

Ma Liste ordonne les favoris en premier puis expose : Séries en cours, Séries à commencer, Séries à
venir, Films au cinéma, Films à voir, Séries à jour et Films vus. Une même fiche peut apparaître dans
les favoris et dans sa section métier. Les grilles sont extensibles et les cartes permettent les
actions rapides de suivi/visionnage.

Pour préserver la navigation sur les grandes bibliothèques, seules les rangées proches de la zone
visible sont matérialisées. Les rangées horizontales et les grilles « Voir tout » progressent par lots
bornés sans masquer les médias restants. Statistiques et Ma Liste conservent leur état après leur
première ouverture, tandis que leurs traitements sont suspendus lorsqu'elles sont cachées.

Le bouton Réglages ouvre un écran superposé refermable par Retour ou swipe depuis le bord gauche.
Le bouton Partager ne doit promettre qu'un lien réellement réouvrable ; l'écart actuel est suivi par
#96.

## 7. Explorer

Explorer propose les catégories **Tout**, **Séries**, **Films**, **Top 100**, **Pépites**,
**Au cinéma**, **Documentaires** et **Personnes**.

- Recherche multi-pages TMDB, regroupée en personnes, séries et films.
- Filtres par plateformes choisies dans les réglages, genres, **Âge conseillé** maximal et note minimale.
- Le filtre d’âge est cumulatif : `10 ans` accepte seulement les médias dont la preuve résolue vaut
  « Tous publics », `7+` ou `10+`; une certification inconnue est exclue. « Tous » ne filtre pas.
- La classification automatique provient exclusivement de la certification US explicite TMDB. Une
  certification absente ou inconnue s'affiche **« Âge à vérifier »** ; aucun genre n'est utilisé comme
  fallback et le terme PEGI n'est pas employé pour les films/séries.
- Le panneau « Type de contenu » permet notamment de choisir **Top 100** ; ce choix change de catégorie et ne constitue pas un tri.
- Tri Populaires, Mieux notés, Plus récents ou Ordre alphabétique.
- Hero Top 10, chargement infini, aperçu long-press et cache utilisable lors d'une panne réseau.
- Le scroll infini conserve des clés de cartes stables, évite de rerendre les cartes déjà chargées pour
  un simple changement d'en-tête et isole le rendu hors écran. L'enrichissement diffuseur d'une carte est
  différé hors des frames actives lorsque possible, dédupliqué et borné à quatre requêtes simultanées ;
  le cache persistant regroupe ses écritures au lieu de sérialiser tout son snapshot par carte.
- Les recommandations combinent genres regardés et personnes favorites, puis excluent les médias
  déjà vus/terminés ou abandonnés. **Explorer reste le lieu de la découverte approximative** ; ces
  recommandations ne sont pas réinjectées dans les fiches média comme relations.
- « Au cinéma » exige une sortie théâtrale française TMDB type 2/3 dans la fenêtre J-75 à J+10 ; une
  sortie streaming/VOD seule n'est jamais « au cinéma ».

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

Le titre affiché privilégie le `title`/`name` de la fiche TMDB récupérée en `fr-FR`. Un ancien titre
enregistré dans la bibliothèque sert seulement de fallback avant ou hors hydratation. Lorsqu'un média
suivi est hydraté par son identité exacte `mediaType + TMDB ID`, SeenIt fait converger uniquement son
champ `title` vers la valeur localisée ; progression, statut, favori, note, provenance et timestamps
métier restent intacts. Sans titre localisé exploitable, aucun nom n'est inventé et aucun matching par
titre n'est introduit.

L'âge conseillé automatique met la traduction lisible au premier plan, par exemple `13+`, et conserve
la certification originale et sa provenance sous une forme secondaire comme `PG-13 · US`, accessible
au lecteur d'écran et au survol. « Tous publics » n'est affiché que lorsqu'une certification US
explicite le prouve ; sinon SeenIt affiche « Âge à vérifier ». Une correction personnelle par média peut
être choisie ; elle est synchronisée par UID, prioritaire, et clairement marquée « Choix personnel ».
Cette correction est identifiée uniquement par type de média + TMDB ID et ne réécrit pas TMDB.

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
visible et état de chargement.

Quand Téléchargements est désactivé, la fiche Film/Série ne montre aucune mention de cette fonction :
le bouton bleu principal/annexe, le fallback « Où regarder », le mode « Téléchargement 1-Clic », les
boutons saison/épisode, les statuts de transfert et surtout l'action **« Téléchargement » du menu « … »
en haut de la fiche** sont tous absents.

### 8.2 Films

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

Une fiche déjà ouverte pendant la session doit se réafficher depuis le cache chaud, sans repasser par
un skeleton de deux à trois secondes. Détails et relations sont indexés par `movie:<id>` / `tv:<id>`,
les images principales gardent une URL stable et les actualisations distantes restent silencieuses.
Le contrat complet est `SEENIT-PERF-001` et son suivi est
[#146](https://github.com/julfou7/seenit-app/issues/146).

La machine d'états exhaustive et le mapping Plex sont autoritatifs dans `seenit.md` §5.3 à §5.5.

## 9. Plex

### 9.1 Association et ouverture

- L'association utilise le PIN Plex dans une page externe, sondée toutes les trois secondes jusqu'au
  jeton ou à l'arrêt du parcours.
- Le jeton est sauvegardé pour le même UID ; une synchronisation complète démarre après association.
- Dans l'APK, une fiche Plex cible d'abord l'application Android Plex, puis l'URL universelle et le
  navigateur. Dans la PWA, elle ouvre l'URL Web officielle.
- Si le TMDB ID ne peut pas résoudre exactement une fiche Plex, SeenIt n'ouvre pas aveuglément
  l'accueil Plex.

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
- l'écran Téléchargements n'est pas affiché et une navigation directe/historique revient à « À Voir » ;
- la fiche Film et la fiche Série n'affichent aucun bouton, libellé, statut ou disponibilité Arr liée
  au téléchargement, y compris l'action **Téléchargement du menu « … »** ;
- le détail d'épisode n'affiche ni bouton Télécharger/re-télécharger, ni badge « Téléchargé », ni
  bannière de transfert, ni modal de téléchargement ;
- le mode téléchargement des épisodes et les boutons saison/épisode sont absents ;
- le polling C411/Sonarr/Radarr/qBittorrent et l'état live de téléchargement sont arrêtés/vidés ;
- Plex et les téléchargements de mise à jour SeenIt restent hors de ce gate.

Quand elle est activée, l'onglet Télécharger possède deux modes : **Mes téléchargements** et
**Recherche C411**. L'icône Réglages de son en-tête ouvre la configuration C411/Sonarr/Radarr/qBittorrent
et webhooks, qui ne doit pas être dupliquée dans les réglages généraux.

### 10.1 Mes téléchargements

- Réconcilie les intentions SeenIt avec les files Sonarr/Radarr et qBittorrent.
- Affiche séparément actifs, erreurs, annulés et terminés.
- Les actifs conservent l'ordre de lancement ; l'historique affiche les plus récents d'abord.
- Un swipe droit supprime une entrée d'historique ou demande confirmation pour annuler un actif.
- L'annulation active retire la demande du client ; les fichiers qBittorrent sont conservés.
- « Vider » ne touche que la section d'historique visée, jamais un actif.

### 10.2 Recherche et lancement

- C411 recherche avec filtres Tous/Film/Série, qualité Toutes/4K/1080p/720p et tri seeders/taille/date.
- Si le type Tous est actif, l'utilisateur doit choisir Film ou Série avant l'envoi.
- Film va à Radarr, Série à Sonarr. qBittorrent ou l'ouverture d'un magnet BTIH validé servent de
  fallback selon la configuration disponible.
- Les cartes C411 n'ouvrent une fiche SeenIt que si un TMDB ID exact est connu.

### 10.3 Identité et cohérence

- Une fiche/téléchargement est rattaché uniquement par TMDB ID.
- Un transfert se réconcilie par `requestId`, infohash/downloadId/alias exact ou chemin exact.
- Un titre, une release, une taille ou une proximité temporelle ne suffisent jamais à fusionner.
- Les mutations sont idempotentes ; un POST Android dont le résultat est ambigu après timeout n'est
  jamais rejoué automatiquement.
- Le polling est borné, paginé et possède un backoff par source.

### 10.4 Configuration personnelle

Chaque compte possède ses URL et identifiants C411, Sonarr, Radarr et qBittorrent. Ils restent conservés
lorsque la fonctionnalité est masquée et réapparaissent inchangés après réactivation. Les boutons de test
emploient le même transport que l'action réelle. Sonarr/Radarr disposent de profils qualité séparés
1080p/4K. Les webhooks personnels exposent une URL par service et un secret envoyé dans l'en-tête
`x-seenit-webhook-secret`; la rotation invalide l'ancien secret. Aucun secret n'est affiché dans les logs.

## 11. Notifications, actualités et appareils

Les préférences globales du compte couvrent : nouvel épisode le jour J, première d'une saison à J-7,
sortie cinéma le jour J et sortie DVD/VOD le jour J lorsqu'une date française TMDB explicite existe.
L'horaire de référence est 09:00 locale. Pour les films, la sortie cinéma utilise `release_dates` FR type
3 puis 2 ; la sortie vidéo/VOD/physique utilise la première date FR type 4 ou 5. Sans preuve française
explicite, aucun rappel film n'est programmé et aucune estimation J+120 n'est utilisée.

- L'intention est partagée via Firestore ; chaque installation autorisée possède son propre token.
- Un téléphone et une PWA du même compte peuvent recevoir l'événement sans partager un token unique.
- Déconnecter un appareil révoque son installation sans désactiver les autres.
- Les webhooks Sonarr/Radarr ciblent seulement les installations du propriétaire de l'endpoint.
- Les notifications profondes ouvrent le média/épisode exact, y compris après un démarrage à froid de
  l'APK ; l'APK peut exposer « Marquer comme vu ».
- Les clés locales de programmation évitent le doublon sur une même installation et leur schéma peut être
  versionné pour remplacer proprement une alarme persistée quand son payload doit évoluer.

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

Les réglages généraux contiennent :

- compte Google, sauvegarde/rechargement Cloud et déconnexion ;
- plateformes Netflix, Prime Video, Disney+, Canal+/MyCanal, Apple TV+, Paramount+, Max, France TV,
  Arte ;
- préférences et autorisation de notifications ;
- association/déconnexion Plex, synchro Rapide/Complète et purge des slugs Plex ;
- **Fonctionnalité personnelle → Téléchargements**, simple interrupteur désactivé par défaut ; aucune
  URL ni clé C411/Sonarr/Radarr/qBittorrent n'est exposée dans les Réglages généraux ;
- import TV Time CSV avec progression, correction des échecs et reprise ;
- actualisation forcée des détails TMDB ;
- version, changelog, recherche et installation d'une mise à jour APK ;
- logs techniques filtrables, copiables/exportables et effaçables.

Le changelog présenté dans la fenêtre de mise à jour résume les effets visibles sous un titre unique
et quelques phrases courtes par version. Lors d'un saut, il affiche dans l'ordre chaque release
officielle postérieure à la version installée jusqu'à la cible incluse ; un saut d'une seule version
conserve l'affichage compact habituel. Si cet historique n'est pas récupérable, les notes de la cible
restent disponibles et l'installation n'est pas bloquée. Les textes emploient les mots compris dans
l'interface et ne montrent pas les identifiants Plex, UID, noms de cache, fichiers, tests ou détails
de CI réservés aux preuves techniques.

Une fois l'APK téléchargée et vérifiée, SeenIt affiche « Installeur lancé » pendant que le Package
Installer Android prend le relais. Le dialogue Play Protect des applications distribuées hors Play
reste sous le contrôle du système : SeenIt ne le masque pas et ne demande jamais de désactiver cette
protection.

L'import TV Time résout les entrées vers TMDB avant écriture. Un résultat introuvable reste en échec
modifiable ; il n'est pas inventé. Les actions de maintenance ne changent jamais l'identité Firebase,
le databaseId ou la signature APK.

## 13. Résilience, UX et limites assumées

Le cadrage transversal [UX](./ux-reference.md) couvre les boutons, cartes, en-têtes, superpositions et
gestes spécifiques. Les constats du code sont suivis dans [l'audit UX](../audits/audit-ux-2026-09-06.md)
et #178 à #181 ; la preuve visuelle/tactile PWA/APK reste à produire avec #15.

- Le rendu mobile respecte les safe areas ; la barre basse ne masque ni contenu ni toast.
- Les écrans lourds sont lazy-loadés et préchargés après connexion ; l'écran courant reste visible
  pendant un chargement afin d'éviter un flash noir.
- Les erreurs réseau privées deviennent des messages ou logs bornés, sans secret.
- Une indisponibilité TMDB peut laisser un écran partiel ou un cache ; elle ne justifie aucun matching
  par titre et ne transforme jamais une classification d'âge inconnue en « Tous publics ».
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
| Âge conseillé personnel | Firestore du même UID | Même Firestore et même UID |
| Backend | Même origine canonique | `https://seenit.ai.studio` explicite |
| Retour | Historique navigateur | Modals → fiche → historique → À Voir → quitter |
| Plex | Nouvel onglet Web | Intent application Plex, puis fallback Web |
| Reddit/autres liens | Nouvel onglet | Application associée, puis Custom Tab |
| Magnet | Gestionnaire navigateur/système si Téléchargements est activé | Intent Android compatible si Téléchargements est activé |
| Notifications | Web Push/service worker | Push + notifications locales Capacitor |
| Mise à jour | Bannière/rechargement PWA | Téléchargement, SHA-256, installateur Android |
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
| P2 | Partager une fiche ou le profil ne garantit pas encore un lien réouvrable conforme. | Décider/corriger : [#96](https://github.com/julfou7/seenit-app/issues/96). |
| P2 | Les parcours fonctionnels réels ne sont pas encore couverts de bout en bout. | Programme E2E/accessibilité/performance : [#15](https://github.com/julfou7/seenit-app/issues/15). |

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
