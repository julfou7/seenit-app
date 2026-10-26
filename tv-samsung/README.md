# SeenIt TV — Samsung Tizen launcher

Launcher SeenIt pour la **Samsung QE55Q6FNA, gamme 2018, Tizen 4.0**.
Issue canonique : #295. Sport : #738.

La V1 a désormais franchi la preuve terrain essentielle : le widget est installable, lançable et fluide sur la TV réelle. La suite est la V2 UX décrite dans `docs/specifications/tv-samsung-launcher-v2.md`, puis le takeover Home/startup après probes et rollback.

## État terrain validé

- package : `SeenItTV01` ;
- application : `SeenItTV01.SeenItTV` ;
- `required_version="3.0"` = minimum de compatibilité du widget, pas version réelle de la TV ;
- matériel : `QE55Q6FNA` ;
- runtime : Tizen 4.0 ;
- installation réelle : **OK** ;
- lancement réel : **OK** ;
- retour propriétaire : navigation fluide, UX V1 trop brute / trop noire et à rapprocher des maquettes V2.

## Signature terrain

L'installation sur cette génération a nécessité une chaîne distributeur legacy :

- auteur SeenIt TV : `CN=SeenIt TV` -> `Tizen Developers CA` ;
- distributeur accepté : `CN=Tizen Public Distributor Signer` -> `Tizen Public Distributor CA` ;
- la chaîne plus récente `Tizen Studio Public Signer` avait échoué avec `118012` sur cette TV.

L'identité auteur utilisée pour la première installation réussie doit être **conservée pour les futures mises à jour**. Aucun certificat, mot de passe ou chemin personnel ne doit être commité.

## Ce que fait le runtime actuel

- choix de profil au démarrage : Julian, Camille, Milo, Invité ;
- Home launcher : raccourcis TV / Films / Sport / Réglages, cinq apps + bibliothèque au premier plan, sources directes ;
- applications installées détectées via `tizen.application.getAppsInfo()` ;
- lancement d'une application via `tizen.application.launch()` ;
- `TV` sélectionne la source tuner détectée avant d'ouvrir le viewer Samsung ;
- HDMI via `VIDEOSOURCE` + `tizen.tvwindow.setSource()` ;
- exemples Sport uniquement dans la preview navigateur, aucun calendrier fictif sur Samsung ;
- favoris et dernières apps par profil local, Invité éphémère ; aucune reprise de média déduite d'un lancement ;
- logos natifs, secours SVG locaux puis initiales pour une nouvelle app ;
- organisation des favoris et actualisation de l'inventaire, sans liste fermée d'apps ;
- navigation télécommande, Retour, fonctionnement local sans réseau ;
- écran diagnostic et concept Ambiance statique.

## V2 UX

La V2 ne doit plus ressembler à un prototype technique.

Contrats principaux :

- fond « salle obscure » bleu nuit / prune / lumière chaude, sans grande surface noire pure ;
- quatre raccourcis compacts selon le dernier arbitrage propriétaire, inspiré de Luma sans porter son code Android ;
- rail Apps favorites borné ;
- bibliothèque Apps paginée pour 100+ packages ;
- classification `USER | SYSTEM | UNKNOWN` au lieu de supprimer tôt les apps système ;
- vue Système avancée accessible, mais jamais polluante sur la Home ;
- RAM et stockage disponibles dans Diagnostic, mis à jour en lecture seule ;
- navigation télécommande et focus premium compatibles vieux Chromium ;
- aucun framework, blur, vidéo de fond ou DOM massif.

Appui long OK : favori, déplacement ou masquage de l'accueil. Un OK court ouvre directement l'app.
Les libellés apparaissent au focus. Brume/Crépuscule/Auto et les mouvements sont réglables par profil.
Sport sans calendrier réel reste absent de la Home. L'appairage SeenIt et son vrai contenu restent à connecter.

Les images des grilles et tous les timers sont libérés lorsque le launcher est masqué.
La reprise restaure la grille utile et son focus. Le gain de RAM total et les accès TNT/menu natif
restent à mesurer sur le matériel ; aucun arrêt d'autre app n'est effectué.

Milo est un profil simple sans code : ses apps sont choisies via Organiser, sans ajouts automatiques.
Un profil local ne constitue pas un contrôle parental des apps tierces. Appairage au compte propriétaire
et historique connecté restent suivis dans #295.

Spécification complète : `docs/specifications/tv-samsung-launcher-v2.md`.

## Télémétrie prévue

Sans root :

- RAM totale/disponible : `tizen.systeminfo.getTotalMemory()` / `getAvailableMemory()` ;
- stockage : `tizen.systeminfo.getPropertyValue('STORAGE', ...)` puis `availableCapacity` / `capacity` sur l'unité interne.

Source Samsung :
https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/systeminfo-api.html

## Home principal

SeenIt TV doit devenir le **launcher principal** :

- bouton Home -> SeenIt ;
- démarrage/retour de veille -> SeenIt lorsque le firmware le permet proprement ;
- retour depuis apps/TNT/HDMI -> SeenIt ;
- Home Samsung d'origine toujours récupérable ;
- rollback préparé avant toute écriture native.

Cette étape n'est pas encore appliquée au matériel. Developer Mode seul ne suffit pas forcément à modifier le Home ; toute piste root/native doit d'abord être validée spécifiquement sur QE55Q6FNA/Tizen 4 et rester réversible.

## Pourquoi le code TV reste dans `seenit-app`

Le launcher reste dans `tv-samsung/` tant qu'il partage profils, Plex, Sport et règles produit avec SeenIt.

Un dépôt séparé ne sera créé que si le futur outillage privilégié root/Home-routing devient un composant autonome avec son propre cycle de sécurité et de restauration.

## Performance

Runtime volontairement ES5 et sans framework :

- aucun React/Babel ;
- aucune iframe ;
- aucun CSS Grid ;
- aucun blur/backdrop-filter temps réel ;
- aucune vidéo d'arrière-plan ;
- pas de polling réseau permanent ;
- bibliothèque Apps paginée, pas de 100+ cartes simultanées dans le DOM.

## Build

```bash
python3 tv-samsung/build.py
```

Produit `SeenItTV-tizen.wgt` non signé.

Pour signer ensuite avec un profil Tizen adapté :

```bash
python3 tv-samsung/build.py --sign MON_PROFIL_TIZEN
```

Le certificat reste personnel et n'est jamais commité.

## Installation / mise à jour terrain

Ne rien modifier sur la TV sans accord explicite du propriétaire.

Avant une prochaine mise à jour :

1. préserver l'identité auteur déjà installée ;
2. utiliser la chaîne distributeur legacy terrain tant qu'aucune nouvelle preuve ne justifie de la changer ;
3. construire et signer le WGT ;
4. vérifier le SHA-256 ;
5. vérifier SDB et le modèle cible ;
6. installer comme mise à jour du package existant ;
7. exiger `install completed` avant tout lancement ;
8. tester focus, Apps, TNT, HDMI et Retour ;
9. ne traiter le takeover Home/startup qu'avec une procédure distincte, backup + rollback + accord explicite.

## Références externes étudiées

- `dvnkshl/vibe-coded-custom-launcher-for-samsung-tv` : patterns Tizen Web/HDMI/focus, pas de copie directe sans licence ;
- `jss8649/quiet-tizen` : idées de navigation/performance, MIT mais Tizen 9 natif/root ;
- `berteotti/custom-tv` et `chris-ritsen/samsung-tv-root` : pistes Home-routing/root temporaire, à ne pas appliquer aveuglément à Tizen 4.
