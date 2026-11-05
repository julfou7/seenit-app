# Téléchargements — refonte et reprise du backlog

Baseline : main `0be6d45` / 1.4.253. Story #861, proposition PDF et capture propriétaire du 5 novembre.
Le PDF donne une direction visuelle, aucune de ses commandes de démonstration n'est exécutée.

## Lot implémenté

Cartes compactes, erreurs À traiter avant les transferts, attente honnête et terminés repliés.
Titres blancs, progression or, images entières avec repli si échec, contrôles 44 px et espace de fin.
Les épisodes portent leur numéro sur la vignette et disposent de commandes distinctes de Vu/ouverture.
Feature gate personnel, présence exacte, état actif, titre long et épisode futur restent protégés.
La saison ouvre un choix explicite ; le compteur Vu n'est pas détourné en compteur de fichiers manquants.

## Matrice des tickets

| Ticket | Traitement dans ce lot | Validation restante avant clôture finale |
| --- | --- | --- |
| #293 Light/non-Light | Filtre conservateur sur mention explicite, commun aux recherches C411 et aux autres releases. Aucune inférence par taille, aucun repli silencieux. | Deux variantes réelles sur APK/PWA, variante refusée après sélection. |
| #427 pack partiel/import | Les files Arr portent importState=pending. Même à 100 %, l'import n'est confirmé que par l'historique exact ou le fichier cible Sonarr. Pas de manipulation d'un torrent préexistant. | Un pack réel SxxEyy, fichier prioritaire unique, import Sonarr et découverte Plex. Le garde ne répare pas magiquement un import manuel bloqué. |
| #428 convergence | Listener et reprise UID existants conservés, tests du vrai store et snapshots rejoués. Aucun POST depuis un snapshot. | APK/PWA simultanées même compte puis autre UID. |
| #429 fichier présent | Menu film en disponibilité/chargement, auto bloqué pendant vérification ; service interdit le remplacement normal. Un remplacement exige une intention explicite puis un choix qualité. | Film présent dans Radarr et dans Plex sur appareils réels. |
| #430 absence de release | No-release distinct des pannes, parcours existant de notification et attente conservés ; fallback entièrement attendu. | Réception de la notification réelle sur APK/PWA, pas seulement son constructeur. |
| #583 reprise obsolète | Reste couvert par identité physique, persistance et réconciliation ; 100 % import non prouvé reste actif. Espace de fin augmenté. | Fermeture complète avec actif, terminé et supprimé ; une entrée retirée ne doit pas revenir. |
| #591 confirmation | Dialogue centré, safe areas et hauteur bornée ; focus Garder, fond inerte, aucune suppression si abandon. | Android 3 boutons et gestuelle. |
| #637 Referer | Même en-tête dès le premier appel et sur tous les replis, test sur le vrai transport backend. | Déploiement canonique pour effet en production. |
| #638 pannes | Réponses HTTP non-OK et formats invalides ne deviennent plus des catalogues vides ; message et Réessayer dans l'écran. Pas d'expiration silencieuse des intentions. | Indexer réellement KO puis rétabli ; aucune conclusion tirée d'un simple délai. |
| #656 double recherche | Grab de la réponse interactive vérifiée, épisode compris ; pack ou épisodes mappés pour une saison ; aucun autre candidat après POST ambigu. | Profil/priorité et scope sur Sonarr/Radarr réels. |
| #661 VFF/VFQ/autre release | Parcours existant conservé et accessible depuis les cartes, complété par filtres qualité/Light. Aucun lancement à l'ouverture. | Choix réel et annulation sur APK/PWA. |
| #664 attente durable | Stockage UID et surveillance conditionnelle existants conservés ; UI distingue attente non confirmée et surveillance prouvée. | Redémarrage réel puis arrivée de la release et annulation de surveillance. |
| #669 qualité | 1080p/4K choisi avant envoi, qualité conservée dans l'intention ; Changer la qualité depuis erreur/attente, même scope ; aucun repli 4K→1080p. | 4K absente, erreur Not an upgrade puis remplacement explicitement confirmé. |
| #801 reçu/import | Copie Import Plex terminé alignée backend/worker, sans changer la preuve Plex exacte ni l'identifiant. | Le visuel du reçu natif reste à compléter/vérifier : le reçu immédiat actuel est textuel. #801 reste ouvert. |
| #443/#778 images/notifs | Aucun nouveau format bitmap/Binder, pas de modification du cache privé ni des images PMS exactes. Affiche UI contain et repli texte/icône. | One UI compacte/dépliée, cache froid/hors ligne ; la refonte d'écran ne vaut pas validation native. |

## Preuves et limites

Les TNR exécutent les services, le fallback d'épisode, le store de production, les snapshots,
la persistance et les transports avec ports externes contrôlés. Les harnais navigateur montent les
vrais écran, cartes et lignes de saison à 360/412 px, vérifient erreur/recherche, confirmation et actions
séparées. Ils n'envoient aucun téléchargement réel. Captures dans les artefacts quality-reports.
Les essais terrain explicitement demandés par les tickets ne sont pas remplacés par des fixtures.

Contrat : [downloads-2026-11-05.md](../design/downloads-2026-11-05.md), SEENIT-DOWNLOAD-013.
