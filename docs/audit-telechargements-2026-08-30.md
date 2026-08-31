# Audit de référence — Téléchargements

Date de l'audit : 30 août 2026  
Traitement terminé : 31 août 2026  
Révision auditée : `47bdbcf`  
Livraison corrective : SeenIt `1.4.76`  
Statut : implémentation terminée ; validation CI et tests terrain connectés listés en fin de document.

## Principes non négociables

- Les données d'un même compte SeenIt doivent être identiques et synchronisées entre la PWA, l'APK et les différents navigateurs connectés au même compte Google.
- Deux comptes SeenIt différents ne doivent jamais partager réglages, caches, sessions, téléchargements ou notifications.
- Les identités de médias doivent reposer sur des identifiants techniques vérifiés. Aucun mapping ne doit être déduit d'un titre ou d'une année.
- Toute évolution doit être vérifiée séparément en PWA et dans l'APK Capacitor.

## P0 — Critiques

- [x] Remplacer le secret webhook global par des webhooks personnels rattachés à un UID SeenIt.
- [x] Ne jamais parcourir tous les utilisateurs pour traiter un événement Sonarr/Radarr.
- [x] Supprimer le secret webhook de la query string et n'accepter qu'un secret non journalisé.
- [x] Ne plus journaliser les payloads webhook complets.
- [x] Enregistrer les tokens de notification par installation/appareil et non dans un champ utilisateur unique.
- [x] Permettre à un même UID de recevoir la notification sur sa PWA et son APK, sans notifier les autres UID.
- [x] Gérer la suppression des tokens invalides, la déconnexion et la révocation d'un appareil.
- [x] Rendre la notification distante APK réellement fonctionnelle en arrière-plan avec un vrai token FCM.
- [x] Isoler le SID qBittorrent par UID, URL et identité qBittorrent.
- [x] Purger la session et l'état hors-ligne qBittorrent à chaque changement de compte ou de configuration.

## P1 — Isolation, fiabilité et actions destructrices

- [x] Ajouter un epoch/UID aux chargements asynchrones afin qu'une réponse lancée pour le compte A ne puisse jamais écrire après une connexion au compte B.
- [x] Annuler ou ignorer les polls en vol au changement de compte.
- [x] Protéger de la même façon `downloadConfigStore`, ses snapshots Firestore et ses chargements ponctuels.
- [x] Isoler/réinitialiser `mediaPresenceStore`, `presenceCache`, `radarrMoviesCache` et `sonarrSeriesCache` par UID et configuration.
- [x] Inclure l'UID et l'identité de configuration dans la clé du cache d'historique *Arr.
- [x] Migrer le stockage persistant `seenit_live_downloads_v3` vers une vraie clé par UID et purger tout ancien cache sans propriétaire prouvé.
- [x] Faire en sorte que « Vider » ne traite que les éléments terminés/annulés affichés dans sa section.
- [x] Ne jamais annuler un téléchargement actif depuis « Vider ».
- [x] Ajouter une confirmation explicite avant toute annulation distante active.
- [x] Indiquer clairement que l'annulation qBittorrent conserve les fichiers (`deleteFiles=false`).
- [x] Rendre les mutations POST idempotentes, y compris deux requêtes concurrentes de même identité.
- [x] Ne jamais rejouer automatiquement un POST Android après un timeout ambigu de `CapacitorHttp`.
- [x] Supprimer tous les fallbacks de correspondance par titre dans Sonarr, Radarr, le suivi live, la présence et l'historique.
- [x] Vérifier l'identité exacte des résultats de lookup avant d'accepter un résultat Sonarr/Radarr.
- [x] Pour Sonarr, résoudre au préalable l'identité TMDB vers un identifiant externe vérifié compatible avec Sonarr.

## P1/P2 — Polling et performances réseau

- [x] Remplacer le booléen de verrouillage du poll par une promesse unique ; aucun second poll ne commence tant que le premier est en cours.
- [x] Empêcher une ancienne réponse de poll d'écraser une réponse plus récente.
- [x] Mettre Sonarr, Radarr et qBittorrent en parallèle lorsque leurs collectes sont indépendantes, puis fusionner les résultats.
- [x] Suspendre le polling lorsque l'application ou l'onglet est en arrière-plan.
- [x] Arrêter réellement le polling global lorsque `stopPolling` est demandé.
- [x] Appliquer un backoff progressif par source, de 5 secondes à 5 minutes.
- [x] Passer la cadence active minimale à 3 secondes et la cadence inactive/erreur à 30 secondes.
- [x] Paginer complètement les files Sonarr et Radarr au-delà de 100 éléments.
- [x] Récupérer toute la file qBittorrent sans limite arbitraire à 50 éléments.
- [x] Éviter le double chargement des profils qualité et signaler l'absence de profil compatible.
- [x] Ajouter des timeouts aux trois appels C411 du backend et arrêter le traitement à l'abandon client.
- [x] Corriger le filtre C411 « Tous », sans type Film implicite.
- [x] Utiliser l'année C411 une seule fois lorsqu'elle est fournie.

## P2 — UX

- [x] Le badge de navigation compte uniquement les téléchargements actifs ou nécessitant une attention.
- [x] Séparer clairement les états « En cours », « En erreur », « Annulés » et « Terminés ».
- [x] Afficher une confirmation et le nom du client distant avant une annulation.
- [x] Ajouter un `aria-label` précis aux boutons icône Actualiser, Réglages, Retour, Effacer et Fermer.
- [x] Donner à la modale principale et aux sélecteurs Saison/Épisode un rôle de dialogue, un titre accessible, une fermeture par Échap et une gestion du focus.
- [x] Porter les cibles tactiles importantes à environ 44 × 44 px.
- [x] Supprimer les textes fonctionnels illisibles de 8 à 10 px dans ce parcours.
- [x] Ajouter des labels persistants aux champs de configuration.
- [x] Ajouter un contrôle afficher/masquer pour les clés API et le mot de passe qBittorrent.
- [x] Empêcher un snapshot Firestore de remplacer silencieusement un formulaire de configuration en cours d'édition.
- [x] Afficher une erreur explicite quand le chargement des profils qualité échoue.
- [x] Harmoniser les actions principales avec l'or SeenIt ; conserver les couleurs de service comme accents secondaires.
- [x] Demander l'autorisation de notification depuis une action explicite ; au démarrage, rafraîchir uniquement un appareil déjà autorisé.
- [x] Corriger la barre de statut APK : icônes claires sur fond `#040406`.
- [x] Conserver la gestion actuelle des safe areas de la barre de navigation.

## P2/P3 — Architecture, sécurité et maintenance

- [x] Restreindre `/api/service-proxy` aux chemins Sonarr, Radarr et qBittorrent nécessaires.
- [x] Ajouter une limitation de débit au proxy, à C411, aux webhooks et à la gestion des appareils.
- [x] Éliminer la fenêtre de DNS rebinding en connectant le backend à l'adresse IP publique validée, avec Host/SNI d'origine.
- [x] Limiter les en-têtes de réponse renvoyés par le proxy ; le cookie qBittorrent reste isolé dans son champ dédié.
- [x] Documenter dans l'interface le modèle de menace des secrets personnels stockés dans le compte SeenIt.
- [x] Supprimer l'ancienne implémentation inutilisée `FreeDownloadScreen.tsx` et son dispatcher backend sans consommateur.
- [x] Découper les écrans lourds avec des imports dynamiques.
- [x] Réduire le bundle initial de l'audit : environ 442 kB gzip pour le principal et Firebase, contre environ 557 kB auparavant ; les écrans privés sont chargés à la demande.
- [x] Corriger `brace-expansion`, `uuid` et toutes les alertes npm restantes : réaudit final à 0 vulnérabilité.
- [x] Réduire les permissions Android ; conserver seulement le réseau, les notifications et la planification nécessaires.
- [x] Conserver explicitement le trust des certificats utilisateur pour les serveurs personnels auto-signés.
- [x] Unifier le service worker PWA : cache applicatif et FCM dans `firebase-messaging-sw.js`, sans double enregistrement concurrent.
- [x] Centraliser la résolution des routes `/api` : relatives en PWA, `https://seenit.ai.studio` dans l'APK.

## Couverture automatisée obtenue

- [x] Webhook : un événement du compte A ne cible que les appareils du compte A.
- [x] Webhook : PWA et APK du même UID sont toutes les deux sélectionnées.
- [x] Webhook : un token expiré est identifié et supprimé sans bloquer les autres appareils.
- [x] Changement de compte pendant un poll lent : aucune donnée de A ne peut être écrite dans B.
- [x] Changement de compte pendant `syncFromCloud` ou un snapshot : epoch et UID sont revérifiés avant chaque écriture.
- [x] Session qBittorrent distincte par UID, URL et utilisateur.
- [x] « Vider » ne sélectionne jamais un téléchargement actif.
- [x] Timeout Android après traitement distant : aucune duplication de POST.
- [x] Deux POST simultanés avec la même identité ne déclenchent qu'une seule mutation distante.
- [x] Aucun mapping Sonarr/Radarr/live/history/presence par titre ou année.
- [x] Poll unique, rejet des réponses d'une ancienne portée et backoff par source.
- [x] Pagination complète Sonarr/Radarr et collecte qBittorrent sans limite artificielle.
- [x] Filtres C411 « Tous », Film et Série, avec année non dupliquée.
- [x] Résolution des routes API différenciée PWA/APK.

## Validations finales

- TypeScript sans erreur.
- 112 tests sur 112 réussis après intégration des tests de fallback pack saison de SeenIt 1.4.75.
- Build PWA de production réussi.
- Bundle serveur réussi.
- `npm audit` : 0 vulnérabilité.
- Synchronisation Capacitor Android réussie avec 11 plugins, dont `@capacitor/push-notifications`.
- Test PWA mobile 390 × 844 : écran public rendu correctement ; les erreurs observées provenaient uniquement du HMR après modifications, pas du build de production.
- Compilation APK locale préparée avec JDK 21 et Gradle 8.14.3 officiels vérifiés, puis arrêtée par l'absence de SDK Android sur ce poste. La compilation complète est déléguée à GitHub Actions, qui possède le SDK.

## Validations terrain après déploiement

Ces contrôles exigent le vrai compte, les services personnels et un appareil Android ; ils ne correspondent plus à un correctif de code restant.

- [ ] Envoyer un webhook de test Sonarr puis Radarr et confirmer la réception sur la PWA et l'APK du même UID.
- [ ] Tester une annulation active puis un échec distant depuis l'écran Téléchargements.
- [ ] Parcourir au clavier les dialogues en PWA et vérifier le focus/lecteur d'écran sur l'APK via TalkBack.
- [ ] Installer l'APK `1.4.76` produit par la CI et valider l'inscription FCM en arrière-plan.
