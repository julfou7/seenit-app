# SeenIt TV Samsung — UX / launcher V2

Statut : **spécification de travail V2**, issue canonique #295, Sport #738.
Matériel terrain : **Samsung QE55Q6FNA, gamme 2018, Tizen 4.0**.
Compatibilité du widget : `required_version="3.0"` reste un **minimum technique**, pas la version réelle de la TV testée.

## Décision propriétaire du 26 octobre 2026 — fidélité aux planches

Les planches réelles de `SeenIt TV (2).html` priment sur les propositions de composition ci-dessous : Home avec quatre destinations **TV · Films · Sport · Réglages**, puis cinq apps favorites + Toutes les apps et deux accès Sources, puis rendez-vous compacts. Aucun grand Hero ne remplace ces destinations ; un événement imminent/direct met en avant la carte Sport en gardant la géométrie et le focus stables. Focus initial TV après choix adulte. Les textes techniques restent dans Diagnostic, pas dans l’accueil.

Logos : petits SVG embarqués homogènes pour les marques reconnues, puis icône native locale si exploitable, puis monogramme. La marque sert uniquement à la présentation : le lancement utilise toujours l’ID réellement inventorié, aucune table d’IDs Samsung supposée universelle. Favoris et dernières apps locales par profil ; toute app utilisateur peut être épinglée depuis la bibliothèque et les nouvelles installations apparaissent après Actualiser/reprise. Home bornée à5apps, bibliothèque18/page.

### Correctif après le terrain KO du 26 octobre

Le navigateur desktop n'a pas prouvé le rendu Samsung. Le Web Inspector du widget installé confirme
Tizen4 et1920×1080/dpr1 ; l'inventaire natif contient254packages, dont trois entrées Netflix visibles.
L'accueil et la bibliothèque Apps regroupent les noms strictement identiques (casse/espaces ignorés)
pour la présentation seulement. L'épingle explicite prime ; sinon le chemin d'icône d'installation
utilisateur `/opt/usr/apps/` prime sur une variante intégrée `/usr/apps/`, puis l'ID tranche de façon
stable. Tous les IDs d'origine restent dans l'inventaire ; les variantes utilisateur restent ouvrables
et épinglables explicitement en avancé, contrairement aux composants système. Masquer une app empêche
sa réapparition automatique sous un autre ID ; une nouvelle épingle explicite la réaffiche.
YouTube et YouTube Kids restent deux apps. Aucune identité média ni cible de lancement n'est inférée.
Les logos connus sont prioritaires sur les icônes natives disparates observées. Les glyphes d'accès
principaux utilisent des SVG locaux, sans emoji dépendant de la police Samsung. La taille des logos,
des sources et des libellés est augmentée pour une lecture à distance ; les bordures hors focus sont
allégées. Aucun nouveau framework, bitmap lourd, effet continu ni contenu Sport fictif n'est ajouté.

RAM : fond coloré léger, pas de grande image plein écran ni vidéo/blur ; libérer les images et grilles invisibles, arrêter horloge et télémétrie en arrière-plan, restaurer le dernier focus et seulement les éléments utiles. Aucune fermeture automatique d’une autre app et aucun gain global de RAM annoncé sans mesure matérielle. Sources : [guide mémoire Samsung](https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html), [multitâche Samsung](https://developer.samsung.com/smarttv/develop/guides/fundamentals/multitasking.html).

Accès permanents aux Réglages SeenIt, aux Réglages Samsung lorsqu’un handler/app installé est vérifié et à une sortie explicite avec confirmation. Aucun takeover Home/startup tant que l’échappatoire Samsung et le rollback ne sont pas prouvés sur la TV. Le root reste une décision ultérieure.

Profils : compte SeenIt propriétaire envisagé pour relier le foyer, profils TV Julian/Camille/Milo séparant d’abord favoris et dernières apps locales. Une app partagée Netflix ou autre ne fournit pas à SeenIt l’identité du spectateur ni une preuve de visionnage ; ouvrir une app ne crée jamais un épisode vu ni une reprise de média inventée. L’appairage et les historiques connectés doivent être conçus/testés avant toute mutation de données ; Invité ne persiste pas d’historique. Les exemples Sport/Films restent limités à la preview tant qu’aucune donnée réelle n’est reliée.

## 1. Objectif produit

### Complément du 26 octobre — sources, logos et audit matériel

Le propriétaire demande les logos des équipes dans le calendrier et signale une troisième entrée HDMI.
Le relevé natif0.2.1 expose TV1 et HDMI1/2/3/4, ces derniers tous déconnectés à cet instant. Le défaut
de l'accueil était sa limite de deux cartes, pas une perte de données de l'adapter. Rendre jusqu'à
quatre sources triées par connexion, garder Tout pour la liste complète ; partager la ligne basse
en deux rails840px, sources et Sport. Afficher au plus deux rendez-vous sur Home, le raccourci Sport
du haut ouvre le calendrier complet.

Chaque événement Sport transporte explicitement `home`/`away` avec `id`, `name`, `logo`. Le renderer
accepte un petit asset local ou une URL HTTPS de la source, affiche les noms même sans logo et utilise
des initiales en cas d'échec. Les images sont bornées à48px, libérées avec les cartes hors écran.
Aucune table de rapprochement par nom ni faux match en production : le flux réel reste à connecter
dans #738. Les logos embarqués des événements de démonstration restent des exemples de preview.

L'audit RAM/services demandé reste read-only : relever mémoire totale/disponible et contextes natifs,
proposer les fonctions facultatives avec leurs conséquences, sans kill, désinstallation, root ou
désactivation. Un contexte d'app n'est ni un relevé RSS ni une preuve de consommation CPU. Le modèle,
la session inspectée et les limites sont documentés dans l'audit daté.

### Référence complémentaire Luma — décision du 26 octobre

Le propriétaire demande de mélanger ses planches avec [Luma](https://github.com/0xProbabillity/luma-tv),
référencé par [ce post](https://x.com/0xProbabillity/status/2112177721245659590). Les captures et le README
ont été examinés. Retenir la respiration, les logos dominants, les libellés au focus, l'organisation
par appui long OK, et une apparence claire/sombre sélectionnable. Conserver les quatre destinations,
les profils locaux, les sources et les fonctions SeenIt. Les sections sans donnée ne prennent pas
un grand bloc vide sur la Home. Aucune maison 3D ni connexion domotique simulée.

Précision propriétaire : **cela reste un launcher TV**, pas une application de catalogue. Les apps
et les sources passent au premier plan ; les quatre destinations deviennent des raccourcis compacts.
SeenIt et Sport forment des enrichissements contextuels, sans imposer un écran de contenu avant de
lancer une app. Ce dernier arbitrage prime sur les quatre grandes cartes des planches initiales.

Implémentation Tizen : fonds statiques par dégradés locaux (Brume, Crépuscule ou automatique selon
l'heure locale 07h–20h), pas de coucher de soleil prétendument géolocalisé. Animation du focus
désactivable, respect de la préférence de réduction des mouvements. L'appui OK court lance l'app,
l'appui long (550 ms) ouvre Favori / Déplacer / Masquer sans lancement accidentel ; Organiser reste
l'alternative visible. Ces choix restent locaux au profil, Invité éphémère.

Luma cible Android TV et ses API Continue Watching ; cela ne prouve aucune disponibilité sur Tizen.
Les instructions d'installation ADB/launcher de l'article sont des exemples tiers, jamais des actions
autorisées sur la Samsung. Aucun code Java, image, animation ou procédure d'installation Luma n'est
copié dans le widget ; inspiration visuelle uniquement, compatibilité et RAM vérifiées séparément.

SeenIt TV n'est pas une application secondaire : la cible est d'en faire le **Home/launcher principal** de la TV.

Le Home doit permettre, sans passer par l'interface Samsung courante :

- revenir à la TNT ;
- ouvrir les applications réellement installées ;
- ouvrir les sources HDMI réellement détectées ;
- reprendre Films & séries / Plex lorsque la cible est fiable ;
- afficher les rendez-vous Sport utiles au profil ;
- changer de profil ;
- accéder aux réglages et diagnostics SeenIt ;
- garder un chemin de secours explicite vers le Home/réglages Samsung d'origine.

Le takeover Home/startup est traité séparément du rendu UX : **aucune écriture native, root ou Home/startup n'est nécessaire pour développer la V2 visuelle**. Toute modification native reste soumise au probe read-only, à la baseline de restauration et à l'accord explicite du propriétaire.

## 2. Décision de dépôt

La V2 reste dans le monorepo `seenit-app`, sous `tv-samsung/`.

Raisons :

- les profils, Plex, Sport, règles SeenIt et contrats produit sont partagés ;
- #295 et #738 restent les issues canoniques ;
- une seule CI et une seule histoire produit évitent la dérive entre app mobile/PWA et TV ;
- créer un dépôt TV maintenant augmenterait le coût de synchronisation sans isoler une vraie frontière technique.

Un dépôt séparé n'est envisagé que pour un futur composant **privilégié et autonome** de type root/Home-routing si ce code devient indépendant du launcher web. Ne pas créer ce dépôt avant d'avoir choisi et validé la méthode sur QE55Q6FNA/Tizen 4.

## 3. Références de maquette

La V2 reprend la logique des maquettes utilisateur `SeenIt TV (2).html`, en particulier les états 1920 × 1080 :

- V2-01 · Home Julian · focus TV ;
- V2-02 · Home Julian · focus Netflix ;
- V2-03 · Monaco dans 23 min · focus Sport ;
- V2-04 · Monaco en direct · sans spoiler ;
- V2-05 · Home Camille ;
- V2-06 · Films ;
- V2-07 · TV = antenne TNT ;
- V2-08 · Home hors ligne ;
- V2-09 · Sport · diffuseur dynamique ;
- V2-10 · Composants et règles V2 ;
- V2-11 · Ambiance.

Le bundle de maquette n'est **pas** exécuté sur la TV. Il sert de référence visuelle et fonctionnelle ; la réalisation terrain reste HTML/CSS/JS ES5 borné.

## 4. Direction visuelle — « Salle obscure, pas écran noir »

### 4.1 Intention

Le fond V1 `#050507` est trop noir et donne un rendu de prototype technique. La V2 doit évoquer une salle obscure premium : sombre, calme, mais avec de la profondeur et une lumière douce.

### 4.2 Palette proposée

Ces valeurs sont des **tokens d'implémentation proposés pour la V2**, pas une extraction exacte des CSS internes du bundle Claude :

- fond principal : `#11141B` ;
- profondeur bleu nuit : `#171C27` ;
- profondeur prune : `#241B24` ;
- carte : `#1A1D24` ;
- carte élevée : `#20242D` ;
- texte principal : `#F4F0E8` ;
- texte secondaire : `#B7B2AA` ;
- texte discret : `#7F818A` ;
- accent SeenIt / focus : `#DDBA70` ;
- accent chaud secondaire : `#9C6B43` ;
- direct / alerte : `#E0524D`.

Règle : **aucune grande surface `#000` ou quasi noire pure**.

### 4.3 Construction du fond compatible Tizen 4

Pas de vidéo, pas de `backdrop-filter`, pas de blur temps réel.

Le fond utilise uniquement :

1. un aplat `#11141B` ;
2. un `radial-gradient` bleu nuit très large en haut/droite ;
3. un `radial-gradient` prune derrière la zone hero ;
4. une lueur chaude très faible en bas/gauche ;
5. éventuellement une texture statique légère embarquée, sans animation.

La profondeur vient des gradients, bordures et ombres statiques, pas d'effets GPU coûteux.

## 5. Home V2 — composition 1920 × 1080

### 5.1 Safe area

- canvas logique : `1920 × 1080` ;
- marge gauche/droite : `72 px` ;
- marge haute : `48 px` ;
- aucune donnée critique dans les 48 px externes ;
- le stage continue à se scaler uniformément sur la résolution réelle.

### 5.2 Header

Hauteur cible : 64 px.

À gauche :

- logo SeenIt ;
- salutation courte, ex. `Bonsoir Julian`.

À droite :

- télémétrie système discrète ;
- heure ;
- pastille profil ;
- accès Réglages.

Ordre visuel proposé :

`RAM 612 Mo  •  STOCK 1,8 Go`    `20:41`    `[J]`    `⚙`

La télémétrie ne doit jamais être un élément de focus sur la Home.

### 5.3 Zone principale

La Home abandonne les quatre grands blocs V1 de même poids au profit d'une composition éditoriale :

- **Hero contextuel** à gauche : environ `1090 × 420` ;
- **4 raccourcis** à droite en matrice 2 × 2 : TV, Films, Sport, Sources ;
- Réglages reste dans le header ;
- le Hero change de contenu sans déplacer la géométrie générale.

Priorité du Hero :

1. événement Sport `LIVE` ;
2. événement Sport imminent (fenêtre configurable, ex. moins de 60 min) ;
3. reprise Plex/SeenIt fiable ;
4. contenu éditorial local ;
5. défaut calme : `Que voulez-vous regarder ?` + état TV/source actuel si disponible.

Le Hero doit rester utile hors ligne : dans ce cas il indique la dégradation mais laisse les apps, la TNT et les sources locales accessibles.

### 5.4 Rail Apps favorites

Sous la zone principale :

- titre `Apps favorites` ;
- maximum **7 applications** + une tuile `Toutes les apps` ;
- cartes environ `200 × 116` ;
- ordre : épingles locales explicites, puis favoris reconnus, puis derniers choix stables ;
- une app système n'apparaît jamais ici par défaut, sauf promotion explicite.

### 5.5 Barre basse

Barre discrète, non dominante :

- source actuelle si connue ;
- raccourcis HDMI détectés ;
- état réseau local / hors ligne ;
- aide télécommande contextuelle uniquement lorsque nécessaire.

## 6. Focus télécommande

Le focus V2 doit être visible à 3 mètres sans ressembler à un contour d'accessibilité brut.

État focus :

- scale `1.035` à `1.05` selon le composant ;
- translation verticale maximale `-5 px` ;
- bordure claire 2 à 3 px ;
- `box-shadow` chaud discret ;
- texte secondaire légèrement éclairci ;
- animation 120 à 160 ms ;
- aucune animation continue.

Le focus ne doit jamais dépendre de `outline` seul, les vieux moteurs Samsung pouvant rendre les coins de manière incohérente.

Anti-double navigation : filtrer les répétitions de touche rapprochées autour de **160–180 ms** si le terrain confirme des doubles déplacements.

## 7. Bibliothèque Apps — 100+ applications sans pollution système

### 7.1 Principe

La découverte Tizen peut remonter **plus de 100 packages**, dont de nombreux composants Samsung. La V2 ne doit plus supprimer ces résultats tôt dans l'adapter : elle doit les **inventorier puis les classifier**.

Aucune application détectée n'est perdue uniquement parce qu'elle ressemble à une app système.

### 7.2 Modèle de classification

Chaque entrée normalisée contient au minimum :

- `id` ;
- `title` ;
- `show` lorsque fourni par Tizen ;
- `classification`: `USER | SYSTEM | UNKNOWN` ;
- `favorite` ;
- `hidden` ;
- `launchable` lorsque prouvé ;
- source d'icône/fallback.

Règles initiales :

- `USER` : app visible (`show !== false`), titre exploitable, non reconnue comme composant technique ;
- `SYSTEM` : `show === false`, service/daemon/helper, package Samsung interne connu, viewer/menu système, ou autre signature technique ;
- `UNKNOWN` : résultat ambigu. Ne jamais le jeter ; le ranger dans la vue avancée tant qu'il n'est pas promu.

Les regex existantes de `isSystemApp()` deviennent des **indices de classification**, pas un filtre destructif.

### 7.3 Home

La Home affiche uniquement les favoris utiles, maximum 7.

### 7.4 Écran `Applications`

Onglets :

1. `Favoris` ;
2. `Apps` ;
3. `Système`.

`Système` est visuellement signalé comme vue avancée mais reste accessible, car certaines apps internes peuvent être utiles au diagnostic ou à l'intégration Home.

Grille cible : **6 colonnes × 3 lignes = 18 cartes par page**.

Pour 100+ apps :

- garder l'inventaire en mémoire ;
- rendre uniquement la page courante (18 cartes) et ses éléments de chrome ;
- pagination stable ;
- compteur `Page 2/6` ;
- tri alphabétique dans chaque catégorie ;
- retour à la position précédente après lancement/retour si possible.

Ne jamais injecter 100+ cartes simultanément dans le DOM de la QE55Q6FNA.

### 7.5 Icônes

Ordre de préférence :

1. SVG local homogène pour quelques services connus ;
2. icône native uniquement si son chemin est réellement lisible depuis la Web App sur la QE55Q6FNA ;
3. monogramme/initiales déterministes.

Ne pas coder une table universelle `appId Samsung -> marque`. L'ID détecté reste la vérité terrain.

## 8. Télémétrie RAM + stockage

### 8.1 UX Home

La Home affiche en haut/droite une seule ligne discrète :

`RAM 612 Mo  •  STOCK 1,8 Go`

- taille environ 14–16 px ;
- couleur texte discret ;
- aucune jauge animée ;
- aucune alerte permanente ;
- si une valeur n'est pas disponible, masquer ce segment au lieu d'afficher `?` ou `0`.

### 8.2 UX diagnostic

L'écran Réglages > Diagnostic peut détailler :

- `RAM disponible / totale` ;
- `stockage interne disponible / capacité` ;
- nombre d'apps `USER / SYSTEM / UNKNOWN` ;
- nombre de sources ;
- online/offline ;
- runtime / user-agent.

### 8.3 API Tizen

Source officielle :
https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/systeminfo-api.html

RAM :

- `tizen.systeminfo.getTotalMemory()` ;
- `tizen.systeminfo.getAvailableMemory()`.

Ces méthodes existent depuis Tizen 2.3 et sont donc compatibles avec la cible Tizen 4 sous réserve du comportement réel du firmware.

Stockage :

- `tizen.systeminfo.getPropertyValue('STORAGE', ...)` ;
- sélectionner l'unité interne non amovible principale ;
- utiliser `availableCapacity` / `capacity`.

Rafraîchissement proposé :

- RAM : toutes les **15 s** lorsque SeenIt est visible ;
- stockage : toutes les **60 s** lorsque SeenIt est visible ;
- arrêter les timers lorsque l'app passe en arrière-plan ;
- mise à jour immédiate au retour au premier plan.

Aucun root n'est nécessaire pour cette télémétrie.

## 9. Écrans V2

### 9.1 `Qui regarde ?`

Conserver le choix explicite au lancement tant que la politique d'appairage foyer n'est pas finalisée.

- Julian ;
- Camille ;
- Milo ;
- Invité.

Fond identique à la Home, cartes plus légères que V1, focus chaud.

### 9.2 Home Julian / Camille

Même architecture, contenu différent par profil.

La personnalisation ne doit jamais modifier la géométrie ni rendre la navigation imprévisible.

### 9.3 Milo

Décision propriétaire du 26 octobre : **profil local simple, apps choisies pour lui, aucun code**.
La Home et Films présentent uniquement ses apps sélectionnées. La bibliothèque ouvre sa sélection ;
Organiser permet de choisir parmi les apps utilisateur détectées, sans PIN. La vue Système est masquée.
Il ne s'agit pas d'un verrou parental : changer de profil ou accéder aux réglages reste possible.
Les favoris Julian/Camille restent indépendants ; aucun historique de visionnage n'est inféré.

### 9.4 TV / Sources

`TV` reste exclusivement **antenne/TNT**.

Écran Sources séparé :

- TNT ;
- HDMI détectés ;
- libellés personnalisables plus tard ;
- état `connecté / signal inconnu / indisponible` lorsque prouvable.

### 9.5 Films & séries

- reprise fiable en Hero ;
- Plex exact lorsque l'identité est prouvée ;
- pas de faux CTA média exact vers Netflix/CANAL+/autres ;
- fallback `Ouvrir <app>` explicitement distingué de `Reprendre`.

### 9.6 Sport

- Monaco et France selon profil ;
- horaire `CONFIRMED` vs `PROVISIONAL` visible ;
- mode sans spoiler ;
- diffuseur dynamique ;
- `Regarder` uniquement avec target réel `APP | HDMI | EXTERNAL_DEVICE` ;
- sinon `Ouvrir <diffuseur>` ou information seule.

### 9.7 Réglages / Diagnostic

Sections :

- Profil ;
- Apps favorites ;
- Sources ;
- Diagnostic ;
- SeenIt / réseau ;
- Accès Samsung d'origine ;
- futur état Home takeover / restauration lorsque cette couche sera réellement implémentée.

### 9.8 Hors ligne

Pas de bannière d'erreur rouge persistante.

Préférer une information calme du type `Hors ligne · apps et sources locales disponibles` dans la barre d'état. Le Hero réseau se dégrade sans bloquer le launcher.

### 9.9 Ambiance

Reste un concept secondaire. Aucun effet ne doit sacrifier la fluidité du Home principal.

## 10. Navigation

- `← ↑ ↓ →` : déplacement déterministe ;
- `OK` : action ;
- `Retour` : écran précédent ou Home SeenIt selon profondeur ;
- futur `Home` natif : SeenIt, après takeover validé ;
- pas de wrap vertical surprenant ;
- wrap horizontal autorisé uniquement dans un rail clairement horizontal ;
- retour depuis une app tierce doit restaurer la Home et le dernier focus si le runtime le permet.

## 11. Performance / budget QE55Q6FNA

Contrats :

- ES5 strict pour `tv-samsung/*.js` ;
- aucun React/Babel/framework ;
- aucune iframe ;
- aucun CSS Grid ;
- aucun blur/backdrop-filter ;
- aucune vidéo d'arrière-plan ;
- pas de polling réseau permanent ;
- pas de 100+ cartes app dans le DOM ;
- horloge : 30 s ;
- RAM : 15 s visible uniquement ;
- stockage : 60 s visible uniquement ;
- animations de focus courtes et finies ;
- les données Sport/SeenIt réseau ne doivent jamais bloquer les apps, TNT ou HDMI locaux.

## 12. Architecture de rendu recommandée

Séparer :

- `TVDevice` : API Tizen, apps, sources, télémétrie, lancement ;
- `AppCatalogue` : classification, favoris, pagination ;
- `HomeModel` : priorité du Hero et contenu profil ;
- `FocusManager` : navigation télécommande ;
- `Renderer` : DOM borné ;
- `Storage` : préférences locales versionnées.

Ne pas introduire de framework pour obtenir cette séparation.

## 13. Références techniques externes étudiées

- `dvnkshl/vibe-coded-custom-launcher-for-samsung-tv` : idées de bridge HDMI et focus Web ; **aucune copie directe de code sans licence explicite** ;
- `jss8649/quiet-tizen` : idées de pagination/cache/focus ; projet MIT mais Tizen 9 natif/root, donc non transposable tel quel ;
- `berteotti/custom-tv` / `chris-ritsen/samsung-tv-root` : piste Home-routing/root temporaire pour générations récentes ; non appliquée à la QE55Q6FNA tant que compatibilité et rollback ne sont pas prouvés.

## 14. Critères d'acceptation V2 UX

La V2 UX est considérée prête terrain quand :

- [ ] le fond n'utilise plus de grande surface noire pure ;
- [ ] Home 1920 × 1080 correspond à la direction V2 des maquettes ;
- [ ] Julian et Camille partagent la même géométrie mais un contenu personnalisé ;
- [ ] Monaco imminent/live peut devenir le Hero sans spoiler ;
- [ ] TNT est clairement distincte des HDMI ;
- [ ] 100+ apps n'entraînent ni mur d'apps système sur Home ni DOM massif ;
- [ ] Apps `USER / SYSTEM / UNKNOWN` restent toutes inventoriées ;
- [ ] la vue `Système` est masquée du flux normal mais accessible en avancé ;
- [ ] RAM disponible est affichée en direct et se dégrade proprement si indisponible ;
- [ ] stockage interne disponible est affiché en direct et se dégrade proprement si indisponible ;
- [ ] navigation télécommande reste fluide ;
- [ ] le launcher reste utilisable hors ligne ;
- [ ] aucun effet visuel lourd n'est introduit ;
- [ ] la V2 peut être installée avec la même identité `SeenItTV01.SeenItTV` et le même certificat auteur que la première version terrain.

## 15. Ordre d'implémentation

1. refondre palette + fond + header + focus ;
2. implémenter le nouveau Home sans changer les actions Tizen ;
3. remplacer le filtre destructif des apps par l'inventaire classifié ;
4. ajouter pagination 18 cartes et vue Système ;
5. ajouter télémétrie RAM/stockage ;
6. brancher Diagnostics ;
7. valider en preview desktop ;
8. construire/signature avec l'identité terrain existante ;
9. après accord propriétaire, mise à jour sur la QE55Q6FNA et tests focus/apps/TNT/HDMI/Retour ;
10. seulement ensuite poursuivre le takeover Home/startup/root.
