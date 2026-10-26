# AUDIT-2026-10-26-TV-RAM — services facultatifs

Date :26octobre2026,19:13UTC. Cible : Samsung QE55Q6FNA, Tizen4.0.
Baseline : widget0.2.1, commit2565685c0363cc030b18fdd7eb25614ae8bc0bb8, PR760, #295.
Statut : relevé matériel terminé ; aucune désactivation effectuée, gains individuels non mesurés.

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
