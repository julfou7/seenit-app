# Notifications Android — refonte unifiée du 27 octobre 2026

Issue canonique : #778.

Ce document complète `seenit.md`, `functional-reference.md` et le catalogue pendant le chantier #778. Il ne remplace pas les invariants d'identité, de preuve Plex, d'isolation UID, d'images ni de release déjà définis.

## Décisions durables

### SEENIT-NOTIFICATION-005 — grammaire Android unifiée (N-01…N-10)

- Le titre est l'œuvre. Exceptions : `SeenIt <version>`, `Plex déconnecté`, `Ce soir sur SeenIt`.
- Le type/état de contexte va dans `subText` et non dans `summaryText` : `Nouvel épisode`, `Nouvelle saison`, `Final de saison`, `Final de série`, `Bientôt`, `Rappel`, `Au cinéma`, `Sortie vidéo`, `Sur tes plateformes`, `Résumé`, `Plex`, `À reprendre`, `Actualité`, `Mise à jour`.
- `body` contient un seul fait compact. Un code épisode apparaît au plus une fois et utilise `S05 | E06`.
- Le texte développé contient au plus deux lignes et ajoute une information utile. Avec BigPicture il passe par `summaryText`; sans image par `largeBody`, sans réutiliser `summaryText` comme pseudo-en-tête.
- Aucun emoji dans le titre, l'en-tête ou le texte. Seuls `✓` dans un libellé d'action et `★` devant une note sont admis.
- Trois actions réelles maximum, action principale en premier. Une capacité non prouvée n'est jamais affichée.
- Les actions Capacitor qui changent l'état peuvent ouvrir SeenIt. Un traitement natif sans ouverture n'est annoncé que lorsqu'un receiver dédié le prouve.
- Une notification sans œuvre ni action utile n'est pas produite, hors mise à jour et Plex déconnecté.
- Les formats français utilisent apostrophe typographique, heure `20:30`, date courte française et durée bornée.

### SEENIT-NOTIFICATION-006 — canaux Android et migration non destructive (N-11…N-13, N-50+)

Les canaux sont créés idempotemment au démarrage et chaque notification locale porte son `channelId` :

| Canal | Nom | Importance | Préférence applicative initiale |
| --- | --- | --- | --- |
| `seenit_episodes` | Épisodes et saisons | HIGH | oui |
| `seenit_reminders` | Rappels | HIGH | oui |
| `seenit_movies` | Films | DEFAULT | oui |
| `seenit_summary` | Résumé du soir | DEFAULT | selon le mode résumé |
| `seenit_plex` | Plex | LOW | oui |
| `seenit_news` | Actualités et reprises | LOW | non pour les nouveaux choix ; une migration ne coupe pas silencieusement un comportement existant |
| `seenit_app` | Application | LOW | oui |
| `seenit_downloads` | Téléchargements | canal existant conservé | choix système existant conservé |

L'importance d'un canal Android déjà créé n'est pas réécrite pour tenter de contourner le choix système. Les réglages exposent l'accès aux réglages Android de notifications lorsqu'il est techniquement disponible.

### SEENIT-NOTIFICATION-007 — identité, anti-spam et cycle de vie (N-40…N-45)

- Une œuvre visible ne doit pas empiler plusieurs alertes concurrentes ; les alarmes futures distinctes peuvent toutefois coexister jusqu'à leur livraison.
- Une mise à jour d'une même notification réutilise son identifiant et reste `onlyAlertOnce` afin de ne pas rejouer son/vibration.
- Une action Vu retire l'alerte affichée et les rappels devenus obsolètes. Une série archivée/abandonnée n'émet plus de rappel.
- Les données de notification restent cloisonnées par UID et identité média exacte.
- Le regroupement explicite est appliqué seulement quand le runtime natif peut le garantir ; sinon le regroupement automatique Android reste le repli.
- Les heures calmes 23:00–08:00 ne sont pas inventées côté backend sans mécanisme de file prouvé. Les rappels existants à 09:00 restent inchangés et un rappel explicitement programmé conserve son horaire.

### SEENIT-NOTIFICATION-008 — cas média existants et rappels

Les déclencheurs métier existants restent inchangés. Nouvel épisode/saison, sortie cinéma, sortie vidéo, renouvellement/saison annoncée et mise à jour adoptent la grammaire commune, les canaux dédiés et l'identité stable disponible. Le rappel explicite `Ce soir` est planifié à 20:30 ; s'il est demandé après 20:30, il cible le lendemain 20:30. Les nouveaux cas hebdomadaires ou de résumé ne sont pas inventés tant que leur source/choix produit n'est pas prouvé.

### SEENIT-NOTIFICATION-003 / -004 — extension téléchargements #778

- Le titre est le film ou la série lorsqu'il est connu ; le statut compact est factuel et sans emoji.
- `Grab` signifie uniquement « envoyé au client de téléchargement », jamais « téléchargement démarré ».
- `Download` Sonarr/Radarr signifie uniquement « Import terminé ». Il ne prouve pas Plex.
- `Disponible dans Plex` remplace le reçu d'import avec le même identifiant seulement après preuve exacte TMDB et saison/épisode, saison 0 comprise.
- `seenit_downloads` est conservé avec ses choix Android existants.
- Rejeu webhook/poll/worker ne doit pas créer de doublon ni de nouvelle alerte sonore pour la même demande.
- Aucune progression, vitesse, heure de fin, réussite ou action n'est inventée.
- `Lire sur Plex` n'existe qu'avec une cible Plex Discover exacte ; les actions retry/reprise/annulation seulement si elles sont réellement supportées.
- Les capacités, credentials et traces restent privés et UID-scopés.

## Images et petite icône

Le pipeline `notificationMedia.ts` + patch Capacitor reste inchangé sur ses invariants : fichiers privés persistants, cache valide prioritaire, téléchargements coalescés et bornés, aucun bitmap/Base64 dans Binder/AlarmManager, décodage au moment de la livraison, poster compact en contain, un seul visuel développé, fallback texte sûr.

La petite icône est `ic_stat_seenit`, monochrome blanc/transparent. Elle est imposée pour notifications locales, worker téléchargements/Plex, mises à jour et comme fallback FCM Android. `ic_stat_notification` n'est pas réintroduite.

## Arbitrages conservateurs des six questions ouvertes

1. Renouvellement/saison annoncée : ne pas couper silencieusement les utilisateurs existants ; nouvelle préférence `Actualités` désactivée par défaut seulement lorsqu'elle est effectivement introduite.
2. Actions authentifiées : conserver l'ouverture de SeenIt tant qu'un traitement natif authentifié n'est pas prouvé. Les alarmes locales peuvent recevoir un receiver dédié séparément.
3. Changelog : conserver la source et le transport de release actuels ; ne pas inventer des catégories ni passer data-only sans preuve.
4. Push de nuit : aucune file backend implicite n'est ajoutée dans ce chantier ; la cible d'heures calmes reste une évolution distincte si le transport serveur doit la garantir.
5. Reprise hebdomadaire : ne pas émettre tant que le choix déterministe de la série n'est pas spécifié.
6. Rappel « Ce soir » : 20:30, lendemain 20:30 si l'action est effectuée après cette heure.

## Validation

TNR à enrichir : `notificationMediaRuntime`, `notificationMediaPresentation`, `notificationPosterContain`, `tvReminderCopy`, `notificationTestSample`, `mediaReminderScheduleMigration`, `mediaNotificationActionColdStart`, `notificationInbox`, mise à jour, `downloadWebhookNotification`, `downloadFailureNotification`, `downloadPlexAvailabilityNotification`, `downloadNotificationCapabilityRouting`, `plexDownloadAvailabilityAndroid`.

La validation terrain finale reste une APK réelle One UI : compacte/dépliée, image froide/cache/hors ligne, redémarrage/mise à jour, alarme différée, import puis confirmation Plex avec même identifiant, petite icône réelle dans barre d'état et panneau. Une preview HTML ou le bouton Tester ne remplace pas cette preuve.

## Lot livré dans la prochaine APK (28/10/2026)

Le socle N-01 à N-13, les cas existants N-20a/b/c/d/e/i et N-21j, la migration v8, les téléchargements et l’action Ce soir sont branchés. Les dates et preuves de diffusion ne changent pas. Une plateforme n’est citée/ouverte que sur cache FR frais et abonnement sélectionné ; sinon aucune inclusion n’est affirmée. Les finales utilisent exclusivement le type finale fourni par TMDB. La nouvelle préférence Actualités est non destructive pour les comptes existants. Le bouton Vu cible la reprise exacte, y compris la saison0, et sa mise à jour garde le même ID et reste silencieuse. Les rappels explicites du soir survivent à la purge des rappels ordinaires et sont annulés si vus/archivés.

Les lots suivants de la story restent explicitement non livrés : résumé du soir configurable, détection d’une saison entière, reprises hebdomadaires, arrivée d’un film sur abonnement, déconnexion Plex, regroupement explicite à deux alertes et récepteur de report sans ouvrir l’app. Aucun bouton ou message ne prétend ces déclencheurs opérationnels. Les choix encore ouverts et les nouvelles données backend restent tracés dans #778. Le regroupement Android automatique est le repli actuel. Le push de release conserve son transport FCM classique et son contrôle canonique.
