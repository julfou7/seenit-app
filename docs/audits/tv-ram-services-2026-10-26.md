# AUDIT-2026-10-26-TV-RAM — services facultatifs

Date :26octobre2026,19:13UTC. Cible : Samsung QE55Q6FNA, Tizen4.0.
Baseline : widget0.2.1, commit2565685c0363cc030b18fdd7eb25614ae8bc0bb8, PR760, #295.
Statut : relevé matériel terminé ; désactivations autorisées mais non confirmées, gains individuels non mesurés.

## Méthode et preuves

Le propriétaire demande un audit pour identifier des services facultatifs afin de libérer de la RAM.
Lecture depuis le widget réellement installé : `tizen.systeminfo.getTotalMemory()`,
`getAvailableMemory()`, `tizen.application.getAppsContext()`, `getAppsInfo()` et `VIDEOSOURCE`.
Les contextes sont documentés par l'[API Samsung](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/application-api.html).
L'inspector est attaché ; les menus et apps ouverts pendant les essais influencent ce relevé ponctuel.
La copie brute locale `audit-0.2.1-native.json` est conservée hors Git, sans identifiants de compte.

- Mémoire totale :1 959 391 232octets, environ1,82GiB.
- Mémoire disponible :639 479 808octets, environ610MiB, soit32,6% du total à cet instant.
-38contextes d'applications/services présents, dont SeenIt. Ce nombre n'est pas un total de processus Linux.
- Le bridge déclare `intershell_support:disabled`, `sdbd_rootperm:disabled`, `log_enable:disabled`.
  Aucun shell système, relevé RSS/PSS individuel ou réglage interne n'est disponible dans cet audit.
- L'API vidéo remonte TV1 et HDMI1/2/3/4 ; les quatre HDMI étaient déconnectés. L'accueil n'en
  affichait que deux à cause d'une limite du renderer ; la liste native était complète.

La RAM « non disponible » ne peut pas être assimilée à de la RAM gaspillée : ce relevé ne sépare pas
cache réclamable, mémoire vidéo, services et applications. Il ne justifie pas un root ni un gain promis.

## Matrice des candidats et conséquences

Les priorités indiquent l'ordre d'examen selon l'usage, pas la quantité de RAM récupérable. Les liens
Samsung décrivent les fonctions ; les menus et leur effet sur la résidence mémoire dépendent du firmware.

| Priorité / fonction | Présence réellement relevée | Option à examiner si inutilisée | Conséquence / limite | Suivi |
|---|---|---|---|---|
| P2 AirPlay / partage d'écran | `NRi6kdBYJ0.AirPlayWebApp`, `org.tizen.ScreenMirroring-daemon`, `org.tizen.ScreenMirroring-app-tv` | Désactiver AirPlay dans les réglages utilisateur et limiter les partages non utilisés | Plus de recopie/streaming AirPlay ; désactivation d'AirPlay ne prouve pas l'arrêt de tout le moteur de mirroring | #295, choix propriétaire puis mesure avant/après |
| P2 Voix / réveil vocal | `com.samsung.bixby-agent`, `org.tizen.voice-app`, trois moteurs TTS | Désactiver le réveil vocal si inutile, garder l'accessibilité requise | Perte de l'appel mains libres ; les moteurs d'accessibilité ne doivent pas être arrêtés à l'aveugle | #295, choix propriétaire puis mesure |
| P2 HbbTV | `org.tizen.hbbtv-service`, `org.tizen.hbbtv` | Désactiver les services interactifs HbbTV si le bouton rouge/TNT enrichie est inutilisé | Perte des fonctions interactives de diffusion ; préserver le tuner et le guide TV | #295, choix propriétaire puis mesure |
| P3 Ambient | `org.tizen.ambientapp` | Éviter son lancement automatique si ce mode est inutilisé | Plus d'affichage décoratif automatique ; sa présence ne prouve pas une animation en cours | #295, usage à confirmer |
| P3 Aperçus / recommandations | `org.tizen.content-tiles-provider`, `ContentServiceManager`, `com.samsung.tv.preview-updater`, `rJeHak5zRg.SpotifyService` | Réduire les aperçus et recommandations exposés par les réglages ou apps | Peut retirer des suggestions Smart Hub ; ne pas désinstaller des services partagés par nom | #295, option supportée à vérifier |
| P3 Apps conservées / préchargées | Contextes Netflix, YouTube, Internet et Apple TV présents | Examiner le démarrage automatique des apps et mesurer après un redémarrage normal | Le contexte ne dit pas quelle app consomme le plus ; aucun kill automatique proposé | #295, mesure comparative |
| À préserver | tv-viewer, clavier, btapp, SSO, menus, OSD et composants aux rôles non prouvés (`csfs`, `comss`, `pdss-client`, `CloudServerAgent`) | Aucune désactivation depuis cet inventaire | Risques sur télécommande Bluetooth, saisie, connexion, sources et réglages | Invariant #295 |

Sources fonctionnelles : [AirPlay Samsung](https://www.samsung.com/fr/support/tv-audio-video/comment-afficher-l-ecran-de-mon-smartphone-ou-de-ma-tablette-sur-mon-televiseur/),
[réveil vocal Bixby](https://www.samsung.com/fr/support/apps-services/utiliser-bixby-sur-une-tv-samsung/).
Les candidats HbbTV/Ambient/recommandations sont des déductions conditionnelles à partir des contextes
observés ; l'existence d'un interrupteur exact et d'un gain RAM sur ce firmware n'est pas encore prouvée.

## Protocole avant toute désactivation

Conserver les réglages initiaux et les usages nécessaires. Choisir une seule fonction facultative,
utiliser son réglage Samsung documenté, relancer normalement puis comparer dans les mêmes conditions
(même source, mêmes apps ouvertes, sans session debug pour la mesure finale). Relever mémoire, reprise
des apps, télécommande, audio, HDMI et réseau ; restaurer si une fonction utile disparaît. Aucune action
de ce protocole n'a été exécutée dans cet audit, qui ne désactive aucun service.

## Accès retrouvé pendant l'audit

La TV a changé d'IP de192.168.1.46 à192.168.1.45. Le PC possède192.168.1.51 et192.168.1.30 :
SDB direct via la première échoue, tandis qu'un relais TCP local lié explicitement à la seconde
permet l'accès. Aucun réglage réseau, firewall ou Developer Mode n'a été modifié. Le relais reste
temporaire et doit être fermé après l'installation. Le WGT0.2.1 a été installé et lancé, identité
et version confirmées depuis Tizen ; le choix Brume du propriétaire est conservé.

## Suivi matériel0.2.2 et autorisation des réglages

Le widget0.2.2, commitc556037c8fcd4a7778d5e4faf5d7cc28ea6dc1c8, a ensuite été installé et lancé.
La version native et le thème Brume conservé ont été relus. Les quatre HDMI tiennent sur l'accueil.
Le reçu privé `install-0.2.2-result.json` conserve l'identité, le digest du WGT et les résultats SDK.

Le propriétaire demande explicitement de désactiver **AirPlay, le réveil vocal et HbbTV**, puis de
mesurer les gains. Cette autorisation est acquise ; leurs états initiaux ne sont toutefois pas connus.
La présence d'un contexte d'application dans l'inventaire ne prouve pas que son interrupteur soit actif.
Les réglages Samsung ont été ouverts par l'adapter de production. Le propriétaire indique ensuite ne
pas trouver le réglage AirPlay. **Aucune désactivation des trois fonctions n'est donc confirmée.**

Avant ces réglages, trois échantillons0.2.2 ont été relevés sur l'accueil visible, thème Brume,
inspector attaché, à deux secondes d'intervalle :343957504,345739264 et347680768octets disponibles
(environ328,0 à331,6MiB). Un relevé ultérieur, sans désactivation, atteint382136320octets
(environ364,4MiB). Ces variations après mise à jour interdisent d'attribuer un gain aux services.
Preuve privée : `ram-before-disabling-0.2.2.json`. Une comparaison utile exige une nouvelle baseline
stabilisée, les mêmes conditions avant/après et les états des interrupteurs réellement vérifiés.

## Vérification du root demandé sous condition

Le propriétaire autorise explicitement le root **si nécessaire pour aller plus loin**. Ce n'est plus
une attente d'autorisation ; l'utilité et la compatibilité doivent être établies. Aucun exploit,
payload root, changement de firmware, NVRAM, Home/startup ou arrêt arbitraire de service n'a été exécuté.
Les réglages utilisateur ordinaires restent la voie applicable aux trois fonctions demandées.

| Piste vérifiée | Preuve et limite | Décision / suivi |
|---|---|---|
| Accès matériel actuel | Modèle QE55Q6FNA, plateforme Tizen4.0 confirmés ; photo propriétaire de « À propos de cette TV » : **T-KTM2DEUC-1400.2, BT-S**. L'API réseau seule renvoie `firmwareVersion: Unknown` | Version installée établie par la photo ; aucun numéro de série recopié dans le dépôt ; #295 |
| API Samsung ProductInfo | Bridge officiel chargé temporairement dans la page ; `getFirmware()` renvoie `SecurityError: You do not have the privilege` ; le widget ne déclare pas `productinfo` | Aucun privilège ajouté, aucune réinstallation ; la photo du propriétaire apporte la version manquante ; #295 |
| API BUILD | Requête bornée sans résultat utile ; ne constitue pas une version de firmware | Ne pas déduire la version installée de la dernière mise à jour proposée sur le site Samsung ; #295 |
| `chris-ritsen/samsung-tv-root`, documentation v0.0.12 | Résultats liés aux modèles/firmwares précis ; pas de preuve Q6FN/KTM2 dans la matrice consultée. La route archive attend un runtime3.1 ou6+ et des capacités natives vérifiées | Non exécutée. Le code de `probe` effectue réellement une acquisition root, ce n'est pas une sonde read-only ; #295 |
| Génération2018 | Samsung documente Tizen4.0 et .NET2.0 ; cela ne prouve pas le runtime exact installé ni une compatibilité avec les payloads récents | Écart de génération à vérifier, pas de contournement des gardes ; #295 |
| `pawprnt/tizenMngr` | Recherche sur UN55MU6290/Tizen3.0/FW1410 ; le projet indique que root UID0 n'est pas obtenu | Ne prouve ni une méthode utilisable ni une impossibilité générale pour la Q6FN ; #295 |
| CleanFrame | Home natif observé sur LS03D/Tizen9.0/FW2130, helper SDK sans root ; l'auteur n'annonce pas de compatibilité universelle | Référence d'étude seulement, aucune écriture native sur cette TV ; #295 |
| SamyGO Q6FN | Réponse du modérateur en2022 : pas de root proposé pour Q6FN/T-KTM2UABC-1325.2 | Constat historique sur une autre région/version, pas une preuve d'impossibilité en2026 ; aucune méthode validée pour1400.2 trouvée ; #295 |
| Correctifs Samsung KTM2 | Bulletin d'octobre2018 : SVE-2018-50016, injection SDB, corrigée pour la famille T-KTM2DEUC | Ne pas assimiler cette ancienne faille à SVE-2025-50109 ni affirmer sans preuve que toutes les chaînes récentes sont corrigées sur1400.2 ; #295 |

Sources primaires consultées le26octobre2026 :

- [Samsung ProductInfo](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/productinfo-api.html).
- [Samsung — spécifications par génération](https://developer.samsung.com/smarttv/develop/specifications/general-specifications.html).
- [Samsung TV root — compatibilité et limites](https://github.com/chris-ritsen/samsung-tv-root#tv-compatibility),
  [contrôle effectif des runtimes](https://github.com/chris-ritsen/samsung-tv-root/blob/master/src/samsung_tv_root/archive_root.py).
- [tizenMngr — état de la recherche](https://github.com/pawprnt/tizenMngr).
- [CleanFrame — matériel de référence](https://github.com/nthnclrk/CleanFrame/blob/main/docs/tv-status.md).
- [Samsung — AirPlay sur les modèles2018, conditions et menu absent](https://www.samsungsvc.co.kr/solution/33970).
- [SamyGO — réponse sur Q6FN](https://forum.samygo.tv/viewtopic.php?t=13870).
- [Samsung — bulletins de sécurité](https://samsungtvbounty.com/securityUpdates).

Conclusion : aucune méthode root reproductible validée pour Q6FN/T-KTM2DEUC-1400.2 n'a été trouvée dans
les sources consultées. Ce constat n'affirme pas que le root soit impossible. L'autorisation demeure
conditionnelle à une voie adaptée et à son utilité ; aucun exploit d'un autre modèle n'est lancé.

Prochaine action : utiliser les réglages supportés et mesurer chaque
changement confirmé. AirPlay absent ou déjà désactivé ne produit pas un gain mesuré. L'autorisation
conditionnelle ne transforme pas une méthode non vérifiée sur un autre modèle en procédure fiable.
