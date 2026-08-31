# SeenIt — Spécification fonctionnelle et technique vivante

Dernière mise à jour : 31 août 2026  
Version applicative : **1.4.80**  
Plateformes : **PWA Web** et **APK Android Capacitor**  
Statut : source de vérité active ; les audits datés restent des archives de décision.

## 1. Vision produit

SeenIt est une application personnelle de suivi de films et séries. Elle centralise la
bibliothèque, la progression, la découverte, la synchronisation Plex et le parcours de
téléchargement C411/Sonarr/Radarr/qBittorrent. Un compte Google SeenIt représente l'unique
propriétaire logique de ses données, quel que soit l'appareil utilisé.

Les objectifs prioritaires sont la fiabilité des identités média, l'absence de fuite entre
utilisateurs, la cohérence PWA/APK, une synchronisation explicable et une interface mobile
rapide. Une donnée incertaine doit rester non résolue plutôt que produire un faux positif.

## 2. Règles de plateforme

- **SEENIT-PLATFORM-001** — La PWA utilise les routes SeenIt relatives au même domaine ;
  l'APK utilise le backend HTTPS de production. Un comportement commun partage la même
  logique métier, mais le transport et l'ouverture d'applications peuvent être adaptés par
  `Capacitor.isNativePlatform()`.
- La PWA doit fonctionner installée ou dans un navigateur mobile/desktop.
- L'APK doit gérer explicitement reprise d'activité, bouton Retour Android, safe areas,
  notifications FCM et intents vers les applications natives.
- Les liens Plex privilégient Plex Android dans l'APK et conservent un fallback Web dans la PWA.
- La status bar Android n'est pas recouverte par la WebView, utilise le fond `#040406` et des
  icônes claires. La barre de navigation conserve les safe areas CSS.

## 3. Compte, données et isolation

- **SEENIT-DATA-001** — Tout cache local contenant des données utilisateur est indexé par UID.
  Un cache ancien sans propriétaire prouvé est supprimé, jamais attribué au compte courant.
- **SEENIT-DATA-002** — Les téléchargements, intentions partagées, réglages Sonarr/Radarr/
  qBittorrent, sessions et états hors ligne sont isolés par UID et identité de configuration.
- Une réponse asynchrone capture l'UID et un epoch ; elle est ignorée si le compte change avant
  son écriture.
- La PWA et l'APK d'un même UID partagent Firestore et convergent vers les mêmes données, sans
  partager les secrets ou caches avec un autre UID.
- La déconnexion arrête les listeners, polls et abonnements, révoque l'appareil de notification
  courant et purge l'état mémoire du compte précédent.

## 4. Identité des médias

- **SEENIT-IDENTITY-001** — Une identité de film ou série ne peut être établie qu'avec un ID
  technique vérifié : TMDB en priorité, puis TVDB/IMDb résolu explicitement vers TMDB quand
  nécessaire. Le titre, l'année, la popularité ou la position d'un résultat ne sont jamais une
  preuve d'identité.
- Les noms de release peuvent servir uniquement à reconnaître deux représentations du même
  transfert si une preuve physique supplémentaire existe (infohash, downloadId, chemin ou
  taille quasi identique). Ils ne créent jamais une identité média.
- Pour un épisode Plex, l'identité de série provient exclusivement de la série parente.

## 5. Bibliothèque et progression

- Films et séries proviennent de TMDB et sont stockés sous une clé stable liée au type et au
  TMDB ID.
- Les actions manuelles SeenIt restent prioritaires : une synchronisation externe est additive
  et ne supprime pas silencieusement une progression saisie par l'utilisateur.
- Les écritures doivent rester idempotentes et la signature de bibliothèque indépendante de
  l'ordre reçu.
- Les écrans lourds sont chargés à la demande ; les listes conservent des clés et un ordre
  visuel stables.

## 6. Synchronisation Plex

- **SEENIT-PLEX-001** — Les événements Plex sont normalisés et résolus sans utiliser leur titre
  comme identité. Une absence d'identifiant vérifiable reste non résolue.
- **SEENIT-PLEX-002** — Un serveur Plex hors ligne ou en timeout est ignoré pour le scan courant ;
  les autres serveurs continuent et leur résultat est importé. Le bilan nomme les serveurs
  synchronisés et ignorés sans exposer leurs URL ou jetons.
- **SEENIT-PLEX-003** — Le curseur n'est validé qu'après collecte suffisamment complète,
  résolution sans échec transitoire et écritures Firestore réussies.
- **SEENIT-PLEX-004** — Jeton Plex, curseur et caches de résolution/disponibilité sont cloisonnés
  par UID. Le jeton passe uniquement dans `X-Plex-Token`.
- Le full scan est paginé. Un inventaire partiel ne remplace pas un cache complet, sauf si au
  moins un inventaire serveur complet et exploitable a été obtenu conformément à la politique.
- La déduplication finale utilise `movie:<tmdbId>` ou
  `tv:<tmdbId>:S<saison>:E<épisode>`.

## 7. Téléchargements

### 7.1 Configuration et sécurité

- Les URL et secrets C411/Sonarr/Radarr/qBittorrent appartiennent au compte SeenIt et sont
  modifiables depuis l'onglet Téléchargements.
- **SEENIT-SECURITY-001** — Le proxy backend n'autorise qu'une liste minimale de chemins et de
  méthodes nécessaires. La cible réseau est validée contre SSRF et DNS rebinding.
- Le SID qBittorrent est indexé par UID, URL et utilisateur, puis invalidé uniquement sur une
  erreur d'authentification reconnue.

### 7.2 Recherche C411 et lancement

- **SEENIT-C411-001** — Le filtre « Tous » n'impose aucune catégorie ; Film et Série utilisent
  leurs catégories exactes et l'année n'est ajoutée qu'une fois.
- **SEENIT-C411-002** — Un Magnet n'est construit ou transmis que si son BTIH est valide.
  Depuis l'APK il est remis au résolveur d'applications Android ; depuis la PWA il est remis au
  navigateur. Une absence de client produit une erreur lisible.
- Une recherche ou un test C411 possède un timeout et distingue « aucun résultat » d'une panne.
- Un envoi manuel sans type impose de choisir Film ou Série avant de contacter un client.

### 7.3 Identité, réconciliation et sécurité destructive

- **SEENIT-DOWNLOAD-001** — Une intention SeenIt et un transfert distant ne sont jamais reliés
  par titre. Un qBittorrent sans ID reste visible lorsqu'un seul rattachement technique est
  possible et est masqué temporairement quand plusieurs intentions sont compatibles.
- **SEENIT-DOWNLOAD-002** — Deux infohash incompatibles désignent toujours deux transferts,
  même si leurs titres et tailles se ressemblent.
- **SEENIT-DOWNLOAD-003** — Deux mutations concurrentes possédant la même clé idempotente ne
  déclenchent qu'une seule mutation distante.
- **SEENIT-DOWNLOAD-004** — Un timeout Android après un POST ne provoque jamais un rejeu
  automatique ambigu.
- **SEENIT-DOWNLOAD-008** — Le fallback pack saison ne modifie que le torrent nouvellement créé
  et prouvé par un identifiant exact ; un torrent préexistant est intouchable.
- **SEENIT-DOWNLOAD-009** — Les marqueurs techniques `SxxEyy`, `Sxx` et `xYY` peuvent préciser
  le scope transitoire d'un transfert TV, sans identifier la série par son nom.

### 7.4 Polling, état et présentation

- **SEENIT-DOWNLOAD-005** — Un seul poll peut être actif. Les sources indépendantes sont
  interrogées en parallèle, les files *Arr sont entièrement paginées et chaque source applique
  son propre backoff de 5 secondes à 5 minutes.
- L'écran visible interroge toutes les secondes lorsqu'un transfert est actif, toutes les
  30 secondes lorsqu'il est inactif et toutes les 15 secondes après une erreur globale. Le
  polling est suspendu en arrière-plan dans la PWA et l'APK.
- **SEENIT-DOWNLOAD-006** — Les actifs gardent l'ordre de lancement ; les historiques sont
  présentés du plus récent au plus ancien, indépendamment de l'ordre des réponses distantes.
- **SEENIT-DOWNLOAD-007** — Les sections En cours, En erreur, Annulés et Terminés sont
  distinctes. « Effacer » n'agit jamais sur un transfert actif.
- La progression distante garde ses décimales ; l'interface affiche un entier tronqué. La phase
  de recherche n'invente ni pourcentage ni message technique du client.
- Une annulation active demande confirmation, nomme le client et précise que qBittorrent garde
  les fichiers déjà téléchargés.

## 8. Webhooks et notifications

- **SEENIT-NOTIFICATION-001** — Chaque appareil possède son propre token FCM rattaché à un UID.
  Un webhook personnel notifie tous les appareils PWA/APK de ce UID et aucun autre compte.
- Le secret webhook est personnel, comparé en temps constant, absent des query strings et des
  logs. Les payloads complets et secrets ne sont jamais journalisés.
- Un token FCM invalide est supprimé sans bloquer les appareils valides.
- Les notifications système de fin de téléchargement proviennent des webhooks Sonarr/Radarr.
  Le polling local affiche uniquement un toast SeenIt afin d'éviter les doublons.

## 9. UX, accessibilité et cohérence visuelle

- L'or `#E5A93D` représente l'action principale SeenIt. Les couleurs Plex/Sonarr/Radarr/
  qBittorrent et les badges Film/Série restent des accents secondaires cohérents.
- Les actions essentielles ont une cible tactile d'environ 44 × 44 px, un libellé accessible et
  un état de chargement ou d'erreur explicite.
- **SEENIT-UX-001** — Toute action disponible uniquement par swipe possède un équivalent clavier
  documenté : flèches selon la direction et touche Suppr pour l'action destructive. Un geste
  tactile annulé remet toujours la carte en place.
- **SEENIT-UX-002** — La clé de rendu et l'affiche d'un téléchargement restent stables pendant
  la transition intention → transfert distant afin d'éviter les clignotements.
- Les dialogues critiques utilisent un rôle adapté, sont fermables par Échap, placent le focus
  sur une action et ne déclenchent aucune suppression sans confirmation quand le transfert est
  actif.

## 10. Performance et résilience

- Les appels indépendants sont parallélisés, mais les mutations destructrices restent
  séquentielles et idempotentes.
- Les gros caches sont remplacés par une écriture atomique et partitionnés par UID.
- Les requêtes possèdent des timeouts bornés et distinguent erreur transitoire, absence
  définitive et résultat vide.
- Le service worker PWA est unique pour cache applicatif et FCM. Aucun double enregistrement ne
  doit concurrencer sa mise à jour.
- Le bundle initial doit conserver le découpage paresseux des écrans privés. Toute hausse
  significative doit être expliquée dans la livraison.

## 11. Contrat de développement et définition de terminé

Une modification comportementale est terminée uniquement si :

1. cette SPEC est mise à jour avant ou avec le code ;
2. l'exigence possède un identifiant et une entrée dans `requirements.json` ;
3. au moins un test automatisé précis est ajouté ou adapté ;
4. `npm test`, le build PWA/serveur et `cap sync android` passent ;
5. la version Android, `CURRENT_APP_VERSION` et `X-Plex-Version` sont identiques ;
6. la différence volontaire PWA/APK est documentée ;
7. la CI compile l'APK et publie la release GitHub.

Le contrôle CI `test:spec:changes` refuse une livraison comportementale qui ne contient pas à
la fois la SPEC et des tests. `test:spec` vérifie la version, les identifiants, les plateformes
et l'existence exacte des tests référencés.

## 12. Validations terrain conservées

- Envoyer un webhook Sonarr puis Radarr et confirmer la réception sur la PWA et l'APK du même UID.
- Tester un client BitTorrent installé puis absent sur Android pour le fallback Magnet.
- Tester une annulation active, un échec distant et deux téléchargements simultanés.
- Parcourir les cartes et dialogues au clavier en PWA, puis avec TalkBack dans l'APK.
- Vérifier l'ouverture de l'élément exact dans Plex Android, puis le fallback Web.
