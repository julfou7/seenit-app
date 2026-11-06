# Affiche du reçu import Android — #801

Baseline : main f9db3015eca08302390c09ebe2f5505c52e1c260, APK 1.4.255.
Terrain propriétaire : l'affiche manque au film dans le reçu « Import Plex terminé ».

Cause prouvée : showImportNotification crée seulement BigTextStyle ; seul le chemin post-preuve PMS
chargeait une affiche. La classe affectée comprend les reçus natifs films et séries, pas un titre isolé.

| Frontière | Correction / preuve | Limite restante |
| --- | --- | --- |
| Webhook → FCM capable | Métadonnée TMDB exacte par type+ID, URL w342 seulement ; cache128/24h, coalescence8 maximum, timeout2,5s, réponse64KiB. Aucun accès Firestore supplémentaire. Tests du vrai dispatcher et du resolver. | Échec fournisseur : reçu texte. PWA/anciens APK inchangés. |
| FCM → reçu | Cache privé partagé notification-media, clé FNV stable ; aucun octet d'image dans payload/WorkManager. Builder réel réutilisé. | Cache froid : enrichissement différé par le worker. |
| Worker → image | HTTPS TMDB allowlist, sans redirection,512KiB, décodage borné et écriture atomique ; cache prioritaire,3 essais maximum ; ajout plafonné32MiB sans purge des rappels programmés. | Réseau/stockage KO : texte conservé. |
| Identité et cycle de vie | UID revérifié après réseau, même ID, onlyAlertOnce ; pas d'enrichissement d'un reçu balayé ni retour en arrière après phase Plex. | One UI réel à confirmer. |
| Preuve Plex | Recherche PMS exacte inchangée ; affiche seule ne change pas la disponibilité ; image reçue réutilisable si l'affiche PMS échoue. | Serveurs réels non contactés pendant les TNR. |
| Rendu natif | Contrôle instrumenté du vrai builder/cache : compact160×160 contain, BigPicture512×288, largeIcon développé nul, titres/texte/intent conservés, cache froid/corrompu/surdimensionné. Appelé par le smoke natif de release complète. | Pas une preuve visuelle One UI propriétaire. |

Risques résiduels : restrictions batterie/réseau peuvent retarder l'enrichissement à froid ; une image
exacte absente chez TMDB reste un fallback texte légitime. Aucun rapprochement par titre, jeton Plex
dans FCM, nouvelle lecture Firestore, changement de canal/identité/signature, ni alerte supplémentaire.
