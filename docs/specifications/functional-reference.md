# SeenIt — Référence fonctionnelle canonique

Dernière vérification : 6 septembre 2026  
Baseline observée : **1.4.118**, `main` `3c3055dad08210132cc6e427a469836f1a85a403`  
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
2. **TMDB** fournit l'identité canonique, les fiches, saisons, épisodes, personnes, dates et
   disponibilités éditoriales.
3. **Plex** fournit seulement des preuves de watchlist, visionnage/non-vu et disponibilité, jamais
   l'identité finale par titre ou année.
4. **Sonarr, Radarr et qBittorrent** fournissent l'état réel des téléchargements ; C411 fournit les
   résultats de recherche.
5. Les stockages locaux servent à accélérer, fonctionner hors-ligne ou porter un état propre à
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
| Intentions de téléchargement | Compte, partagées PWA/APK |
| News lues et rappels métier | Compte, partagés PWA/APK |
| Token FCM, permission système, installation notification | Appareil, rattachés au UID courant |
| Cache TMDB/OMDb/Plex, clés anti-doublon de notification | Appareil et UID |
| Logs techniques | Appareil et UID ; export volontaire seulement |
| Personnes favorites | Doivent être partagées ; écart actuel suivi par #95 |

Le bouton « Sauvegarder » des réglages pousse l'état local courant et les réglages vers Firestore ;
« Recharger » redemande l'état serveur. La synchronisation temps réel reste le fonctionnement normal,
ces boutons sont des actions de récupération explicites.

## 4. Navigation globale

La barre basse possède quatre destinations stables, dans cet ordre :

1. **À Voir** : accueil opérationnel ;
2. **Profil** : statistiques, Ma Liste et accès Réglages ;
3. **Explorer** : recherche et découverte TMDB ;
4. **Télécharger** : suivi et lancement des téléchargements.

L'onglet actif et ses glyphes utilisent l'or SeenIt. Le badge Télécharger compte les transferts actifs
ou qui demandent une attention. Un appui sur l'onglet actif ferme le niveau courant ; un double appui
réinitialise/ramène le contenu en haut lorsque l'écran l'implémente.

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
- Les recommandations combinent genres regardés et personnes favorites, puis excluent les médias
  déjà vus/terminés ou abandonnés.
- « Au cinéma » exige une sortie théâtrale française TMDB type 2/3 dans la fenêtre J-75 à J+10 ; une
  sortie streaming/VOD seule n'est jamais « au cinéma ».

Depuis une carte, l'utilisateur peut ouvrir la fiche, suivre/retirer, ou marquer un film vu. Les cartes
qui disposent de la preuve détaillée utilisent le même résolveur parental que la fiche et Explorer.
Toute création de suivi sans progression converge vers `plan_to_watch`, quel que soit le point d'entrée.
Les anciens documents `watching` sans progression sont normalisés de façon bornée et idempotente sans
réécrire les favoris, notes, rappels ni l'archive ; le parcours explicite « Revoir » reste préservé.

## 8. Fiche média et détails associés

### 8.1 Contenu commun

La fiche combine les détails TMDB, notes TMDB/IMDb (OMDb), disponibilité streaming en France,
présence Plex/Arr, bande-annonce, âge conseillé, casting, recommandations, collection/franchise
et discussions Reddit. Les modals personne et épisode restent dans la pile Retour.

L'âge conseillé automatique affiche la certification US TMDB originale, sa provenance et sa traduction
lisible, par exemple `PG-13 · US · 13+`. « Tous publics » n'est affiché que lorsqu'une certification US
explicite le prouve ; sinon SeenIt affiche « Âge à vérifier ». Une correction personnelle par média peut
être choisie ; elle est synchronisée par UID, prioritaire, et clairement marquée « Choix personnel ».
Cette correction est identifiée uniquement par type de média + TMDB ID et ne réécrit pas TMDB.

Actions transverses : suivre/retirer, favori, note utilisateur, partage, archive lorsque disponible,
ouverture fournisseur et téléchargement. Un favori active les notifications du média sans créer de
progression. Une note/favorite/archive est une intention distincte du statut de visionnage.

### 8.2 Films

- Ajouter à « Films à voir » suit sans marquer vu.
- « Film vu » crée `seenEpisodes=['movie']`, un `episodeRecords.movie.watchedAt` et `completed`.
- Repasser non vu retire cette progression et revient à « À voir ».
- Le téléchargement rapide privilégie Radarr ; C411/magnet sert de parcours manuel de repli.

### 8.3 Séries et épisodes

- Suivre sans visionner crée « À voir ».
- Marquer un épisode vu/non vu met à jour `seenEpisodes`, `episodeRecords`, `lastWatchedAt` et le
  prochain épisode à voir.
- Marquer une saison cible uniquement les épisodes déjà diffusés lorsque TMDB les distingue.
- Une série complète devient `completed`; si TMDB la déclare Ended/Canceled elle peut être archivée
  automatiquement.
- Abandonner conserve l'historique ; Reprendre le conserve et recalcule l'état actif.
- Revoir réinitialise la progression et propose S1E1 comme prochain épisode.
- Les téléchargements Sonarr existent au niveau série, saison ou épisode ; le détail affiche aussi
  la disponibilité par saison/épisode.

### 8.4 Sagas, univers cross-media et médias similaires

La fiche peut afficher trois sections distinctes, dans cet ordre de priorité :

1. **Ordre de visionnage** pour une saga explicite et ordonnée ;
2. **Dans le même univers** pour une continuité narrative vérifiée, y compris entre films, séries et
   spin-off ;
3. **Séries similaires** ou **Films similaires** pour les recommandations contextuelles TMDB.

Une œuvre déjà affichée dans une section prioritaire n'est pas répétée dans les suivantes. Les sagas
et univers sont bidirectionnels : entrer par n'importe lequel de leurs membres restitue le même groupe
et le même ordre, avec seulement le badge « actuel » déplacé. La fiche courante peut servir de repère
dans un vrai groupe, mais une section contenant uniquement ce média est masquée.

SeenIt ne déduit jamais une saga ou un univers d'un titre, d'une année, de la popularité ou d'une
marque. Marvel et DC sont séparés par continuité narrative explicite. Les similaires ne sont pas une
preuve de franchise et ne sont pas nécessairement réciproques.

Un titre cité dans un bug sert uniquement d'exemple de test. Il est interdit d'ajouter dans le résolveur
une condition, une regex ou une exception portant ce nom. Une relation manquante est corrigée dans le
mécanisme commun ou par des identités Film/Série + TMDB exactes dans un groupe versionné et validé ; le
résultat doit alors être identique et réciproque depuis tous les membres du groupe.

L'identité utilisée dans chaque carte et chaque navigation combine toujours le type Film/Série et
l'ID TMDB. Le contrat exhaustif, les sources admises, les budgets de performance et la matrice
Yellowstone, Breaking Bad, Harry Potter, Marvel, DC et House of Guinness sont définis par
SEENIT-RELATION-001. L'écart de l'implémentation actuelle reste suivi dans
[#130](https://github.com/julfou7/seenit-app/issues/130).

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

Le retrait de Watchlist vers « non suivi » reste volontairement ouvert dans #68 ; aucune absence
ambiguë ne doit être interprétée en attendant.

## 10. Téléchargements

L'onglet Télécharger possède deux modes : **Mes téléchargements** et **Recherche C411**. L'icône
Réglages de son en-tête ouvre la configuration C411/Sonarr/Radarr/qBittorrent et webhooks, qui ne doit
pas être dupliquée dans les réglages généraux.

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

Chaque compte possède ses URL et identifiants C411, Sonarr, Radarr et qBittorrent. Les boutons de test
emploient le même transport que l'action réelle. Sonarr/Radarr disposent de profils qualité séparés
1080p/4K. Les webhooks personnels exposent une URL par service et un secret envoyé dans l'en-tête
`x-seenit-webhook-secret`; la rotation invalide l'ancien secret. Aucun secret n'est affiché dans les logs.

## 11. Notifications, actualités et appareils

Les préférences globales du compte couvrent : nouvel épisode le jour J, première d'une saison à J-7,
sortie cinéma le jour J et estimation DVD/VOD à J+120. L'horaire de référence est 09:00 locale.

- L'intention est partagée via Firestore ; chaque installation autorisée possède son propre token.
- Un téléphone et une PWA du même compte peuvent recevoir l'événement sans partager un token unique.
- Déconnecter un appareil révoque son installation sans désactiver les autres.
- Les webhooks Sonarr/Radarr ciblent seulement les installations du propriétaire de l'endpoint.
- Les notifications profondes ouvrent le média/épisode exact ; l'APK peut exposer « Marquer comme vu ».
- Les clés locales de programmation évitent le doublon sur une même installation.

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
pour l'élément inéligible. Les tests « Tester » des réglages valident l'autorisation et le rendu, pas
l'arrivée future d'une donnée TMDB ou d'un webhook réel.

## 12. Réglages et maintenance utilisateur

L'autorisation « notifications sur cet appareil » couvre aussi l'alerte de nouvelle version sur
Android ; aucun réglage séparé n'est ajouté initialement.

Les réglages généraux contiennent :

- compte Google, sauvegarde/rechargement Cloud et déconnexion ;
- plateformes Netflix, Prime Video, Disney+, Canal+/MyCanal, Apple TV+, Paramount+, Max, France TV,
  Arte ;
- préférences et autorisation de notifications ;
- association/déconnexion Plex, synchro Rapide/Complète et purge des slugs Plex ;
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

- Le rendu mobile respecte les safe areas ; la barre basse ne masque ni contenu ni toast.
- Les écrans lourds sont lazy-loadés et préchargés après connexion ; l'écran courant reste visible
  pendant un chargement afin d'éviter un flash noir.
- Les erreurs réseau privées deviennent des messages ou logs bornés, sans secret.
- Une indisponibilité TMDB peut laisser un écran partiel ou un cache ; elle ne justifie aucun matching
  par titre et ne transforme jamais une classification d'âge inconnue en « Tous publics ».
- Une indisponibilité d'un serveur Plex/Arr/qBit ne doit pas effacer un état connu.
- SeenIt est pour l'instant un produit personnel mono-propriétaire logique. Il n'existe pas encore de
  profil public, partage social, administration multi-utilisateur ou catalogue éditorial propre.
- L'estimation DVD/VOD à 120 jours et la fenêtre « Au cinéma » ne sont pas des programmations temps
  réel de salles ou de distributeurs.

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
| Magnet | Gestionnaire navigateur/système | Intent Android compatible |
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
| P1 | Les sagas/univers peuvent dépendre du point d’entrée, accepter des listes ou titres non probants et afficher un groupe auto-référent. | Appliquer `SEENIT-RELATION-001` et ses TNR cross-media : [#130](https://github.com/julfou7/seenit-app/issues/130). |
| P1 | Les personnes favorites restent locales et font diverger les recommandations PWA/APK. | Rendre Firestore autoritatif : [#95](https://github.com/julfou7/seenit-app/issues/95). |
| P1 | Le retrait de Watchlist Plex ne retire pas encore un suivi créé uniquement par cette Watchlist. | Implémentation avec provenance : [#68](https://github.com/julfou7/seenit-app/issues/68). |
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