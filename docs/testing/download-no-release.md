# Notification d'absence de release — #430

Contrat : `SEENIT-NOTIFICATION-004`. Le résultat `no_release` est typé ; aucun message d'erreur ou
timeout n'est analysé comme preuve d'absence. Les TNR `downloadSearchRuntime.test.ts` exécutent les
services Sonarr/Radarr et le fallback de production en remplaçant uniquement leurs transports.

## Vérification terrain PWA / APK

1. Avec les notifications autorisées, lancer depuis une fiche exacte un film sans release admissible.
   Quitter la fiche : la demande doit passer en erreur et une alerte nommer le film. Le tap ouvre
   cette même fiche. Aucun nom brut de torrent n'apparaît.
2. Répéter pour une saison, une série et un épisode sans release isolée ni pack admissible. L'alerte
   précise le scope et n'arrive qu'après le dernier fallback ; une saison 0 conserve `S00Eyy`.
3. Lancer un épisode avec un pack admissible : aucune alerte d'absence pendant le transfert/fallback.
4. Simuler URL inaccessible, authentification refusée ou indexer en panne : erreur de service distincte,
   jamais alerte « aucune release ». Une réponse non JSON n'est jamais assimilée à zéro résultat.
5. Couper uniquement le transport vers SeenIt après une absence confirmée, puis rétablir le réseau ou
   reprendre l'app : le reçu isolé par UID est envoyé une fois. Changer de compte avant la reprise ne
   l'envoie pas au nouveau compte. Réessayer le même `requestId` n'empile pas une seconde alerte.
6. Vérifier réception sur les appareils autorisés du même compte, notamment Android fermé et PWA en
   arrière-plan. Sur PWA au premier plan, le message FCM data-only est affiché via le service worker.

La recherche nécessite des indexers automatiques également observables en interactif, une réponse
valide et un diagnostic santé sans problème. Sinon SeenIt conserve une erreur de recherche distincte.
Fermer le support qui interroge les services privés avant sa conclusion ne prouve aucune absence.
La réservation serveur protège les retries et les réponses perdues ; un envoi FCM ambigu reste
non rejouable afin de ne pas produire un doublon. Cette limite n'est pas une preuve de livraison.

Le rendu post-import/Plex de #611 est déjà dans v1.4.208. Il garde son terrain séparé : icône, affiche,
mise à jour vers « Disponible dans Plex », tap fiche et action Discover exacte.
