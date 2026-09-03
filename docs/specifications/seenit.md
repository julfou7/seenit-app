# SeenIt — Spécification fonctionnelle et technique vivante

Dernière mise à jour : 2 septembre 2026
Version applicative : **1.4.111**
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

- **SEENIT-PLATFORM-001** — La PWA canonique servie depuis `seenit.ai.studio` conserve les routes
  SeenIt relatives au même domaine. L'APK et tout preview AI Studio dont un label d'hôte commence
  par `ais-dev-*` ciblent explicitement `https://seenit.ai.studio` pour les routes `/api/*` afin de
  partager le même backend canonique. Un comportement commun partage la même logique métier, mais
  le transport et l'ouverture d'applications peuvent être adaptés par la plateforme.
- La PWA doit fonctionner installée ou dans un navigateur mobile/desktop.
- L'APK doit gérer explicitement reprise d'activité, bouton Retour Android, safe areas,
  notifications FCM et intents vers les applications natives.
- Les liens Plex privilégient Plex Android dans l'APK et conservent un fallback Web dans la PWA.
- La status bar Android est edge-to-edge : la WebView s'étend derrière une barre transparente avec
  icônes claires, tandis que le contenu principal et le login respectent `env(safe-area-inset-top)`.
  Avec `@capacitor/status-bar`, ce rendu clair sur fond sombre exige explicitement `Style.Dark` / `DARK` ;
  `Style.Light` / `LIGHT` est interdit car il produit des icônes sombres. La barre de navigation basse
  reste sombre et conserve les safe areas CSS.

### 2.1 Contrat APK immuable

- **SEENIT-APK-001** — Une mise à jour APK conserve obligatoirement `applicationId=com.seenit.app`,
  le schéma `com.seenit.app`, le nom SeenIt et la même clé de signature. La clé historique est
  contrôlée par empreinte SHA-256. Toute rotation de clé nécessite un plan de migration testé sur
  une installation existante ; elle ne peut jamais être réalisée comme un correctif ordinaire.
- **SEENIT-APK-002** — L'icône SeenIt ne peut être supprimée, remplacée ou vidée par une évolution,
  une résolution de conflit ou `cap sync`. Le manifeste conserve les références `ic_launcher` et
  `ic_launcher_round`, toutes les densités Android existent avec leurs dimensions attendues et les
  icônes Web canoniques conservent leur empreinte. Une refonte volontaire doit régénérer toutes les
  densités, mettre à jour le contrat et obtenir une validation visuelle explicite.
- **SEENIT-APK-003** — Avant toute publication APK, la CI télécharge la dernière release stable
  strictement antérieure depuis le dépôt SeenIt officiel et vérifie sa paire APK/SHA-256. Sur un
  émulateur propre correspondant à la cible Android courante, elle installe cette version N, initialise
  des sentinelles dans le stockage privé de l'application et de session, accorde les notifications si
  nécessaire, puis installe N+1 avec `adb install -r`, sans désinstallation. Le test compare
  `applicationId`, signature et versions, puis prouve la conservation des sentinelles, de l'icône,
  de la permission de notification, du launcher et du deep link. Il exécute enfin démarrage à froid,
  reprise et Retour et archive les diagnostics. Android 12 reste un TNR de compatibilité explicite,
  déclenchable manuellement ou périodiquement et recommandé pour tout changement natif à risque ; il
  n'est pas une seconde matrice bloquante par défaut à chaque release. Aucun compte Google personnel
  ni service externe privé n'est utilisé par les smokes. La compilation du harnais cible exclusivement
  le module Gradle `:app` afin de ne pas fabriquer les APK de test des plugins Capacitor. Le préflight
  extrait chaque métadonnée sans pipeline interrompu et lit les attributs `aapt` par leur nom exact :
  `name` ne doit notamment jamais correspondre au suffixe de `compileSdkVersionCodename`. Il archive
  les sorties brutes de `aapt`/`apksigner`, les valeurs package/version/signature et nomme précisément
  l'invariant fautif avant toute installation.
- **SEENIT-APK-004** — L'identité Firebase Android est immuable au même titre que l'identité APK.
  `docs/specifications/android-contract.json` est la source canonique suivie ; `android/app/google-services.json`
  est git-ignoré et matérialisé de façon déterministe avant les contrôles/builds avec le `project_id`
  `gen-lang-client-0201895414`, le package `com.seenit.app` et le `mobilesdk_app_id` publié. Une suppression
  ou régénération AI Studio ne peut donc plus devenir une migration implicite. Le même matérialiseur
  normalise `android/gradlew` exécutable avant validation/Gradle. Toute modification des valeurs canoniques
  du contrat reste une migration Firebase Android explicite et testée.
- **SEENIT-APK-005** — Le lancement Android n'affiche qu'un seul branding de démarrage : le splash
  animé Web `src/components/SplashScreen.tsx`. Le splash système imposé par Android 12+ reste
  visuellement neutre, avec fond `#040406`, icône transparente et animation native nulle ; il n'est
  masqué qu'après le premier rendu du splash Web afin d'éviter tout flash vide. Après lancement, la
  status bar overlay la WebView avec un fond transparent et des icônes claires ; les écrans racine
  compensent cette superposition par la safe area haute. La réintroduction d'un logo natif distinct,
  de `Style.Light` / `LIGHT`, de `overlaysWebView=false` ou d'une status bar opaque constitue une
  régression TNR bloquée par les tests.
- Le fichier `docs/specifications/android-contract.json` fixe les invariants natifs vérifiables :
  identité, signature, version, icônes, permissions, deep link, origine API, safe areas et canal APK.
- Lors d'une release APK, le contrôle Android s'exécute avant et après `npx cap sync android` afin de
  détecter une mutation générée par Capacitor avant la compilation.

### 2.2 Cycle de vie Android obligatoire

- Un démarrage à froid, une reprise après mise en arrière-plan et une reconnexion réseau ne doivent
  pas dupliquer les listeners, polls, notifications ou mutations.
- Le bouton Retour ferme d'abord le dialogue ou la fiche courante, revient ensuite à l'onglet racine,
  puis quitte seulement depuis la racine. Un changement d'onglet ne doit jamais quitter l'application.
- Les intents Plex, Reddit, Magnet et installateur APK utilisent les API Capacitor natives, avec un
  message lisible lorsqu'aucune application ne peut traiter l'intent.
- Les validations terrain couvrent Android cible à chaque release et Android 12 lors des TNR manuels,
  périodiques ou des changements natifs à risque.

### 2.3 Runtime backend canonique

- **SEENIT-RUNTIME-001** — `/api/health` reste une route légère et indépendante des services privés,
  désactive le cache et identifie explicitement le backend `canonical`. Une réponse API SeenIt `2xx`
  en `text/html` est considérée comme une panne de routage et jamais comme un succès métier.
- Les handlers Express asynchrones transmettent leurs rejets au middleware d'erreur API ; une erreur
  Firebase ou service externe répond en JSON générique sans laisser la requête tomber dans le fallback
  SPA et sans terminer le process backend.
- Une bascule de runtime est non destructive : déployer le remplaçant, vérifier `/api/health`, exécuter
  un smoke métier, basculer le mapping/domaine, revalider les transports Sonarr/Radarr/qBittorrent/Plex,
  puis seulement retirer l'ancien runtime. L'ancien service n'est jamais supprimé avant preuve du
  remplaçant. Le runbook `docs/runtime-cutover.md` décrit ce séquencement et son rollback.

## 3. Compte, données et isolation

- **SEENIT-DATA-001** — Tout cache local contenant des données utilisateur est indexé par UID.
  Un cache ancien sans propriétaire prouvé est supprimé, jamais attribué au compte courant.
- **SEENIT-DATA-002** — Les téléchargements, intentions partagées, réglages Sonarr/Radarr/
  qBittorrent, sessions et états hors ligne sont isolés par UID et identité de configuration.
- **SEENIT-DATA-003** — Les journaux techniques persistés localement sont partitionnés par UID.
  L'ancien journal global est supprimé et aucun log collecté avant authentification n'est persisté.
- **SEENIT-DATA-004** — Lorsqu'une assertion interne Firestore indique une corruption de la
  persistance IndexedDB, SeenIt cible exclusivement la base locale correspondant au `projectId` et au
  `databaseId` réellement configurés. Une seule tentative automatique est autorisée pendant cinq
  minutes et son état est partagé par `localStorage` : en PWA, les autres onglets libèrent leur client
  Firestore avant la suppression puis ne rechargent qu'après le signal de succès ; dans l'APK, la même
  garde s'applique à l'unique WebView. Un diagnostic visible précède tout rechargement et une seconde
  erreur dans la fenêtre de garde interrompt l'automatisme afin d'éviter une boucle. Les autres bases
  IndexedDB de l'origine ne sont jamais supprimées.
- **SEENIT-DATA-005** — La base Firestore applicative SeenIt est exactement `default`. Le client
  PWA/APK la sélectionne explicitement et Firebase Admin utilise explicitement `getFirestore('default')`.
  Le dépôt canonique ne déclare aucun champ `firestoreDatabaseId` dans `firebase-applet-config.json` ;
  toute réinjection de cette métadonnée par AI Studio est rejetée et ne peut jamais piloter le runtime.
  `(default)`, une initialisation Admin implicite ou tout autre databaseId sont refusés hors migration
  de données explicitement approuvée, sauvegardée, testée et réversible.
- **SEENIT-DATA-006** — La base Firestore canonique `default` conserve Delete Protection activée afin
  d’empêcher sa suppression accidentelle. Aucun import/sync AI Studio, script ou agent ne désactive
  automatiquement cette protection. Une désactivation exige une opération de migration/suppression
  explicitement approuvée par l’utilisateur, précédée d’une sauvegarde et accompagnée d’un rollback.
- Une réponse asynchrone capture l'UID et un epoch ; elle est ignorée si le compte change avant
  son écriture.
- La PWA et l'APK d'un même UID partagent Firestore et convergent vers les mêmes données, sans
  partager les secrets ou caches avec un autre UID.
- La déconnexion arrête les listeners, polls et abonnements, révoque l'appareil de notification
  courant et purge l'état mémoire du compte précédent.

## 4. Identité des médias

- **SEENIT-IDENTITY-001** — Une identité de film ou série SeenIt est canonique par **TMDB ID**.
  TVDB/IMDb peuvent exister comme métadonnées techniques, mais doivent être résolus vers TMDB avant
  toute association média. Le titre, le titre original, l'année, la popularité, le nom de fichier,
  le nom de release ou la position d'un résultat ne sont jamais une preuve d'identité.
- Pour les téléchargements, un transfert physique ne se fusionne que par `requestId`, infohash/downloadId
  ou alias exact, ou chemin de transfert exact. Une taille, un titre ou un nom de release, même combinés,
  ne suffisent jamais ; une ambiguïté reste non résolue.
- Pour un épisode Plex, l'identité de série provient exclusivement de la série parente.

## 5. Bibliothèque et progression

- Films et séries proviennent de TMDB et sont stockés sous une clé stable liée au type et au
  TMDB ID.
- Une synchronisation externe ne déduit jamais une suppression depuis une simple absence. Une source
  explicitement bidirectionnelle peut toutefois appliquer un état contraire lorsqu’elle fournit une preuve
  autoritative ; pour Plex, seul un `viewCount=0` observé pendant un full scan vaut dé-vu.
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
- **SEENIT-PLEX-005** — Un média Plex ne devient vu qu'avec une preuve de visionnage autoritative.
  Une activité `cloud` qui porte exactement la même identité technique qu'un film de la watchlist
  reste ambiguë. L'appartenance au **Watch History du compte Plex est elle aussi historique et ne
  représente jamais, à elle seule, l'état courant** : en full scan, chaque entrée `account-history`
  doit être validée par le `userState` provider de la même identité Plex. Seul un `viewCount > 0`
  explicite permet son import comme vu ; un `viewCount = 0` explicite alimente la réconciliation
  non-vue, et un état courant indisponible n'ajoute aucune progression. L'historique PMS récent et
  les états `viewCount` explicites restent des preuves selon leur contrat. Le rapprochement ne se
  fait jamais par titre ou année ; en cas d'ambiguïté SeenIt conserve l'état non vu.
- **SEENIT-PLEX-006** — Un scan Plex complet réconcilie l’état vu et le dé-vu **sans donner à Plex
  l’autorité sur les progressions créées hors Plex**. Un `viewCount > 0` peut ajouter une progression et
  celle-ci est alors marquée par une provenance technique Plex explicite. Un `viewCount = 0` ne retire
  que ce même film/épisode si sa progression SeenIt courante porte encore cette provenance Plex. Un
  visionnage manuel SeenIt, importé depuis une autre source ou legacy sans provenance certaine reste
  vu, même si Plex l’observe non vu ou l’avait également observé vu auparavant. Une simple absence dans
  l’historique incrémental ne vaut jamais dé-vu. En présence de plusieurs copies du même média, une copie
  vue gagne sur une copie non vue. La mise à jour du miroir `plexWatchState` seule est silencieuse : elle
  n’est ni comptée ni notifiée comme un dé-vu. Les clients antérieurs au protocole de provenance sûre ne
  reçoivent pas d’états `watched=false`. L’écriture Firestore applique uniquement les mutations Plex
  réellement possédées afin de ne jamais écraser une action SeenIt ou tierce.
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
  par titre, titre original, année ou nom de release. L'association média requiert un **TMDB ID exact** ;
  TVDB/IMDb seuls ne suffisent pas. La corrélation d'un même transfert sans TMDB n'est permise que par
  une preuve physique exacte (`requestId`, infohash/downloadId/alias ou chemin). Sinon le transfert reste
  visible et non rattaché plutôt que produire un faux positif.
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

### 8.1 Mise à jour intégrée

- **SEENIT-UPDATE-001** — La détection de mise à jour interroge d'abord la release GitHub puis le
  backend SeenIt. Dans l'APK, le fallback est obligatoirement
  `https://seenit.ai.studio/api/update` et jamais `/api/update` sur la WebView locale. Seuls un tag
  sémantique `vX.Y.Z`, l'asset exact `SeenIt-vX.Y.Z.apk` et une URL HTTPS du dépôt officiel
  `julfou7/seenit-app` sont acceptés.
- **SEENIT-UPDATE-002** — Lorsque GitHub fournit l'empreinte SHA-256 de l'asset, l'APK téléchargé
  est vérifié avant l'ouverture de l'installateur. Un écart supprime le fichier et bloque
  l'installation. Android réalise ensuite son propre contrôle de package et de signature.
- Le téléchargement n'efface aucune donnée applicative et utilise le cache temporaire. Une erreur
  laisse l'application courante utilisable et propose le lien officiel comme solution de secours.

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
- **SEENIT-UX-003** — La première navigation vers un écran privé chargé paresseusement ne
  remplace jamais l'écran courant par un écran vide ou noir. Les chunks des onglets et des fiches
  média restent séparés du bundle initial, sont préchargés en arrière-plan pendant le splash et les
  changements d'écran sont engagés dans une transition React afin de conserver le contenu déjà
  affiché jusqu'à ce que la prochaine vue soit prête.
- **SEENIT-UX-004** — Un toast mobile long utilise toute la largeur utile disponible, revient à la
  ligne sans troncature et reste au-dessus de la navigation basse et de la safe area. La règle vaut
  pour la PWA et l'APK, notamment pour le bilan détaillé d'une synchronisation Plex.
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

## 11. Sécurité opérationnelle

- **SEENIT-SECURITY-003** — Avant toute persistance ou export de log, les champs sensibles et les
  secrets reconnaissables dans les chaînes sont masqués. La profondeur, la taille et le nombre
  d'éléments sérialisés sont bornés.
- Les clés de service TVDB/OMDb/TMDB actuellement nécessaires au client sont considérées comme des
  identifiants exposés : elles ne doivent disposer d'aucun privilège d'écriture. Leur migration vers
  le backend est suivie comme dette de sécurité prioritaire.
- La clé de signature APK historique est un actif de continuité, pas un secret neuf. Son empreinte
  est figée pour empêcher une rotation accidentelle ; sa migration vers une signature protégée doit
  préserver la possibilité de mise à jour des APK déjà installés.
- Les logs de production ne contiennent jamais jeton Firebase, Plex, C411, clé *Arr/qBittorrent,
  secret webhook, SID ou payload personnel complet.

## 12. Versionnement et déploiement

- **SEENIT-RELEASE-001** — Une publication APK incrémente le patch SemVer. Plusieurs commits
  applicatifs peuvent être regroupés sous une même candidate non publiée : le bump Android et
  `npm run version:sync` sont effectués une seule fois quand le lot est prêt. La même version apparaît
  dans `versionName`, `package.json`, la SPEC, le catalogue, le contrat Android,
  `CURRENT_APP_VERSION` et `X-Plex-Version`. `versionCode = major*100000 + minor*1000 + patch` et
  doit être strictement supérieur à la dernière release installable.
- **SEENIT-RELEASE-002** — La CI est un contrôleur, jamais un auteur de code : elle ne commit ni ne
  pousse sur `main`. Chaque push/PR exécute une validation rapide avec cache npm, tests et build, sans
  publier automatiquement d'APK. Le contrat Android n'est exécuté sur un push que si le diff affecte
  l'APK. L'audit des dépendances de production est limité aux changements de dépendances, au contrôle
  périodique et aux releases. La construction Gradle, le smoke N → N+1 et la publication APK sont
  déclenchés explicitement depuis `main`. La release produit l'APK et son SHA-256 depuis le même
  commit ; le tag `vX.Y.Z` désigne exactement ce commit.
- **SEENIT-RELEASE-003** — Les notes publiques d'une version agrègent tous les commits compris entre
  le dernier tag SemVer strictement antérieur à la version courante et le commit publié. Un dernier
  commit détaillé ne peut jamais masquer les changements précédents de la même version. Si le tag de
  la version courante existe déjà lors d'une régénération, il est ignoré comme borne de départ afin de
  conserver la totalité de l'historique de cette version.
- **SEENIT-RELEASE-004** — Une release APK publiée est immuable. Le garde compare la candidate à la
  dernière release officielle strictement antérieure et refuse une version régressive, incohérente ou
  dont le tag/release existe déjà. Une candidate **non publiée** peut recevoir plusieurs commits
  correctifs sans consommer un nouveau numéro ; seul un tag ou une release publiée rend le numéro
  définitivement consommé. Le garde s'exécute avant le build puis immédiatement avant publication.
  La validation/construction s'exécute avec des droits de lecture ; seul un job de publication
  dépendant possède `contents: write`. L'APK et son fichier `.sha256` forment un artefact indissociable,
  vérifié après construction et après transfert entre jobs. L'action de publication refuse tout
  écrasement et tout fichier manquant. Une correction d'une version déjà publiée utilise
  obligatoirement un nouveau patch.
- Canal PWA : le déploiement Web peut être instantané et réversible côté hébergeur.
- Canal backend : une modification exclusivement serveur suit sa validation propre sans bump Android.
- Canal APK : une correction d'un binaire déjà publié, y compris un rollback logique, est toujours une
  nouvelle version avec `versionCode` supérieur. On ne remplace jamais silencieusement l'asset publié.
- Le canal personnel actuel publie `assembleDebug` signé par la clé historique afin de préserver les
  mises à jour sur place. Passer à `assembleRelease` ou à une autre clé est un projet de migration.
- Les versions majeures/minor impliquent une décision produit ; les correctifs ordinaires d'une
  release APK incrémentent le patch.

### 12.1 Parcours de livraison proportionnés

- **SEENIT-QUALITY-006** — La CI classe automatiquement chaque diff en `light`, `backend` ou `apk`
  sans accepter de marqueur capable de forcer `light`. La documentation, les tests, `.github/**`,
  les scripts/outillages et les changements de pure copie UI peuvent suivre `light`. Le runtime
  serveur explicitement non embarqué par Capacitor, notamment `server.ts`, suit `backend`. Le frontend
  embarqué, Android, Capacitor, les dépendances, la configuration applicative et tout diff ambigu
  suivent `apk`. Un opérateur peut demander explicitement une release APK, jamais forcer `light`.
  Cette classification indique l'impact du changement, pas une publication : aucun push ne publie
  automatiquement une APK. Le doute conserve la classe `apk` sans contourner les validations critiques.

### Validation continue de référence

1. classification `light` / `backend` / `apk` ;
2. contrat de changement, SPEC, TypeScript et tests unitaires ;
3. contrat Android uniquement pour un diff `apk` ;
4. audit de dépendances uniquement si elles changent, périodiquement ou lors d'une release ;
5. build Web + serveur ;
6. aucune publication APK automatique.

### Release APK groupée de référence

1. regrouper les commits du lot sur `main` ;
2. quand le lot est prêt, bump Android une seule fois puis `npm run version:sync` ;
3. obtenir une validation continue verte ;
4. déclencher manuellement la release depuis `main` ;
5. `npm run test:android`, build Web, `npx cap sync android`, revalidation Android et Gradle ;
6. smoke N → N+1 bloquant sur Android cible ; Android 12 optionnel/manual ou périodique ;
7. publication immuable GitHub de l'APK et du SHA-256 ;
8. validation terrain de la nouvelle APK.

Le détail opérationnel des triggers, classes et jobs est maintenu dans `docs/process/delivery.md`.

## 13. Contrat de développement et définition de terminé

- **SEENIT-QUALITY-001** — Toute modification comportementale ajoute ou adapte un test automatisé
  précis. La SPEC et le catalogue sont mis à jour lorsqu'une règle durable est créée/modifiée ou quand
  une zone sensible est touchée : sécurité/authentification, données/Firestore, identité média/Plex,
  identité APK/Firebase Android ou configuration native critique. Une correction locale ordinaire qui
  n'introduit aucune nouvelle règle durable ne crée pas artificiellement une exigence administrative.
- **SEENIT-QUALITY-002** — Tout audit est conservé comme rapport daté et indexé, avec version,
  commit, périmètre et preuves. Chaque constat ouvert renvoie vers une issue GitHub portant une
  priorité, ou vers une décision de risque accepté justifiée ; aucun point ne reste uniquement dans
  une conversation.
- **SEENIT-QUALITY-003** — Toute demande utilisateur qui introduit ou modifie une règle durable de
  produit, UX, sécurité, plateforme ou développement est comparée à la SPEC. Si elle n'y figure pas,
  elle est ajoutée à la SPEC, au catalogue, aux tests et au registre des demandes. Le travail différé
  possède une issue GitHub ; les questions ponctuelles et les éléments de diagnostic restent hors SPEC.
- **SEENIT-QUALITY-004** — Dès qu'un travail est relié à une issue GitHub, son corps reste la source
  de vérité opérationnelle pendant toute l'intervention : l'agent l'actualise aux jalons significatifs
  prouvés (implémentation prête, validation/CI, intégration sur `main`, release ou blocage), coche chaque
  critère dès qu'il est réellement satisfait et remplace les informations devenues obsolètes. Les
  micro-commits intermédiaires n'imposent pas une mise à jour administrative séparée.
- **SEENIT-QUALITY-005** — Un import, une reconnexion ou une synchronisation AI Studio/GitHub est un
  transport non autoritatif. Avant tout commit depuis un workspace importé, le diff est comparé à la
  branche GitHub source et toute mutation automatique non demandée de Firebase/Firestore, Android,
  versions, lockfiles, SPEC ou fichiers suivis est rejetée. Les règles sont préchargées via
  `.agents/AGENTS.md` puis complétées par la lecture intégrale du `AGENTS.md` racine ; les invariants
  critiques restent en plus protégés par des tests afin qu'une omission de lecture ne puisse pas les
  réintroduire silencieusement. Les fichiers Android canoniques suivis (`google-services.json`, clé de
  signature historique) doivent rester présents et les scripts Unix requis au build doivent conserver
  leur bit exécutable ; une normalisation AI Studio de ces éléments est une régression bloquante.
- **SEENIT-QUALITY-006** — Les contrôles sont proportionnés au risque selon la classification de la
  section 12.1 et `docs/process/delivery.md`. Le doute ne réduit jamais les protections critiques :
  un changement non reconnu comme `light` ou `backend` reste `apk`, sans pour autant déclencher une
  publication automatique.
- **SEENIT-QUALITY-007** — La synchronisation du code entre AI Studio et GitHub est une
  responsabilité externe au runtime SeenIt, assurée uniquement par l’intégration GitHub native
  d’AI Studio. La PWA, l’APK et le backend n’exposent aucune route `/api/git/*`, aucun bouton de
  pull et aucun script `scripts/pull.sh`. `GITHUB_PAT` reste réservé à la consultation des
  releases via `/api/update` tant que ce fallback existe.

Une modification est terminée lorsque les validations applicables à sa classe sont vertes, son test
ciblé existe si le comportement change, toute règle durable/zone sensible est reflétée dans la SPEC et
le registre, et la différence PWA/APK/backend est explicitée. Une classe `light` ou `backend` n'attend
pas artificiellement une nouvelle APK.

Une release APK est terminée uniquement si :

1. le lot est versionné et toutes les surfaces de `SEENIT-RELEASE-001` sont alignées ;
2. les tests et le build sont verts ;
3. `cap sync android` et le contrat Android passent ;
4. le smoke Android cible N → N+1 est vert ;
5. l'APK et son SHA-256 sont publiés immuablement ;
6. les TNR terrain nécessaires sont exécutés, notamment Android 12 pour un changement natif à risque.

Le contrôle CI `test:spec:changes` exige un test pour un changement comportemental et exige en plus
SPEC + catalogue pour les règles durables/zones sensibles. `test:spec` vérifie la version, les
identifiants, les plateformes et l'existence exacte des tests référencés. `test:android` protège
l'identité de l'APK et ses actifs.

## 14. Backlog et autonomie des agents

- Les issues GitHub constituent le backlog actif ; les audits datés expliquent les constats et la
  SPEC décrit uniquement le comportement courant attendu.
- Le registre des demandes conserve l'origine des décisions durables et leur lien vers les exigences,
  sans recopier les conversations ni stocker de secret ou de donnée personnelle.
- Une issue porte une priorité `[P0]` à `[P3]`, un domaine, le risque, les critères d'acceptation,
  les exigences concernées, les tests attendus et la matrice PWA/APK.
- Une issue en cours est maintenue à jour aux jalons significatifs ; ses checkboxes reflètent
  l'avancement réellement prouvé sans imposer un commentaire ou une édition après chaque micro-commit.
- Un agent peut ouvrir et traiter automatiquement une issue sûre dans le périmètre SeenIt. Il ne peut
  pas décider seul d'une migration de signature, d'une suppression de données, d'un affaiblissement
  de sécurité ou d'un changement d'identité média.
- Fermer une issue exige un commit, des tests et les validations applicables à sa classe. Un lien de
  release n'est obligatoire que si l'issue exige explicitement un binaire publié.

## 15. Validations terrain conservées

- Envoyer un webhook Sonarr puis Radarr et confirmer la réception sur la PWA et l'APK du même UID.
- Tester un client BitTorrent installé puis absent sur Android pour le fallback Magnet.
- Tester une annulation active, un échec distant et deux téléchargements simultanés.
- Parcourir les cartes et dialogues au clavier en PWA, puis avec TalkBack dans l'APK.
- Vérifier l'ouverture de l'élément exact dans Plex Android, puis le fallback Web.
- Installer la nouvelle version par-dessus l'APK précédente et confirmer que compte, données,
  icône du lanceur, raccourci, notifications et deep links sont conservés.
- **TNR lancement Android — mono-splash :** sur un démarrage à froid après mise à jour N → N+1,
  enregistrer l'écran et confirmer qu'aucun logo SeenIt natif/statique distinct n'apparaît avant
  l'animation `SplashScreen.tsx`, qu'aucun flash blanc/noir intermédiaire n'est visible et que le fond
  de transition reste `#040406`.
- **TNR lancement Android — status bar :** dès la première image de l'application, confirmer que
  l'heure, le réseau, le Wi-Fi et la batterie restent clairs/blancs sur le fond sombre, que la barre
  reste transparente/edge-to-edge et que la safe area ne saute pas. Les invariants `DARK` / `Style.Dark`
  et mono-splash sont en plus bloqués automatiquement par `tests/androidLaunchChrome.test.ts` et
  `npm run test:android`.
- Démarrer l'APK à froid, le reprendre après veille, tester Retour depuis chaque niveau puis vérifier
  qu'aucun listener ou téléchargement n'est dupliqué.


### **SEENIT-AUTH-001** — Connexion Google native Android via Credential Manager

- Dans l'APK Android, le bouton **Continuer avec Google** utilise en priorité Android Credential Manager / Sign in with Google afin d'afficher le sélecteur de comptes Google natif, selon le même parcours que l'application ATHIA.
- Le client OAuth est lu depuis `default_web_client_id` généré par le `google-services.json` canonique de `com.seenit.app`; aucun nouvel identifiant utilisateur SeenIt n'est créé par la couche native.
- Le Google ID token obtenu n'est qu'un transport : il est échangé via `GoogleAuthProvider.credential(...)` puis `signInWithCredential(...)` dans le Firebase Web SDK déjà utilisé par SeenIt, afin de conserver le même Firebase UID et les mêmes données Firestore pour les comptes existants.
- `setFilterByAuthorizedAccounts(false)` permet une reconnexion / un nouveau consentement lorsque nécessaire et `setAutoSelectEnabled(false)` conserve un choix explicite du compte.
- Une annulation utilisateur du sélecteur est une sortie normale et ne doit afficher aucune erreur bloquante.
- Si Credential Manager est indisponible ou échoue pour une raison de compatibilité, l'ancien flux natif Google Auth reste un fallback; la PWA conserve `signInWithPopup`.
- TNR : toute régression vers le flux legacy comme parcours Android primaire, ou toute rupture de l'échange vers le Firebase UID existant, est interdite.
