# Terrain225 — historique individuel, mouvement et fluidité

Baseline : APK officielle1.4.225, main198c0a71594e6ee7ec64e4e2ea6bb71e5bab7ddc, #729. Retour utilisateur du25octobre : Moi paraît décentré, supprimer×N, rendre Vu progressif, vérifier les saccades. Complément : accélérer les segments du splash et prolonger sa signature sans changer sa durée.

| Surface / symptôme | Cause et portée | Correction / preuve |
| --- | --- | --- |
| Navigation | Deux feuilles définissaient24/28px pour le conteneur/glyphe. L’accueil mesuré avait déjà des centres identiques ; l’ordre des CSS pouvait changer ailleurs. | Une seule géométrie28px centrée en grille ; contrôle de tous les onglets actifs dont Moi,360/412/1280. |
| Historique×N | Le constructeur fusionnait des épisodes voisins, y compris une saison avec le même horodatage. Nouvelle règle produit. | Un record = une ligne ; tri décroissant, périodes, totaux, pagination, actions et Annuler conservés. Deux épisodes Paul, trois consécutifs, douze simultanés et film voisin testés via HistoryFeed. |
| Vu trop instantané | Courte transition de l’anneau, coche déjà présente ; dépendance à un état de rendu précédent. | Keyframes explicites760ms anneau puis240ms coche ;1040ms avant tampon, puis reprise. Vraies animations CSS échantillonnées, échec/Annuler/dernier disponible et reduced-motion conservés. |
| Cartes voisines | Les nouveaux callbacks/tableaux d’actions invalidaient React.memo. | Frontière mémoïsée et callbacks lisant le dernier état commité. Dans le même parcours réel : avant8cartes×3rendus, après2rendus de la seule carte modifiée. TNR navigateur instrumentant uniquement les entrées des composants réels. |
| Cache local pendant clic | updateShowOptimistic sérialisait toute la bibliothèque avant de publier son état. | Snapshot coalescé120ms puis idle borné800ms, UID revalidé, Annuler garde le dernier état, vidage arrière-plan/pagehide, annulation à la déconnexion. TNR exécute le vrai store avec seules frontières externes substituées ; aucun accès Firestore supplémentaire. |
| Résumés historique | La durée d’un épisode reconstruisait tous les records de sa série pour chaque membre du résumé. | Runtime extrait une seule fois dans le record normalisé, puis consultation directe ; aucune durée inventée. |
| Splash illisible | Signature en3300ms, fin de séquence3700ms. | Segments160ms, anneau1280ms, coche1640ms, signature1860ms/300ms puis1540ms lisibles. Durée3700ms et fermeture500ms conservées ; navigateur vérifie le maintien complet avant fermeture. |

Preuves locales : terrain226-browser.log et quality-reports/terrain226-performance.json, captures anneau/splash ; vrais composants et mutation markWatchCardEpisode → markEpisodeWatched. L’échantillon avant comportait une tâche longue57ms ; les trois mesures après n’en comportaient aucune. Cette observation de navigateur est indicative, sans garantie de FPS du téléphone privé. Les compteurs de rendus et la non-sérialisation dans le clic sont les invariants déterministes.

Validation canonique, CI et publication : références finales dans le checkpoint stable #729. Le correctif Plex225 est conservé. Signature/package/installateur non modifiés ; l’incident émulateur#50 reste indépendant. Risque résiduel : performances du téléphone et réseau privés à confirmer par terrain ; cache local retardé de façon bornée, Firestore inchangé et source de vérité.

Difficulté de validation : un bump atomique inclus avec le correctif fait appliquer la règle boy-scout aux deux fichiers où seule la version changeait. Deux annotations catch any ont été resserrées en unknown avec casts de lecture préservant exactement les expressions de message et le comportement ; aucune règle de lint retirée ou contournée.

Le vidage du cache local écoute aussi appStateChange via Capacitor App : il ne dépend pas de visibilitychange seul dans la WebView Android. Le TNR du vrai store couvre ce signal alors que le document reste visible, ainsi que le changement d’UID avant idle et la déconnexion.

Revue PR766 / P2 : la nouvelle frontière mémoïsée bloquait aussi le changement calendaire sans mutation de Show. Une clé de jour locale traverse désormais les deux frontières jusqu’à la progression. Le TNR de production garde strictement la même référence de Show, simule le lendemain puis focus : « aujourd’hui » devient « hier », le segment de l’épisode diffusé se dégrise sans ouverture de fiche. Un focus supplémentaire du même jour ne recalcule aucune carte. Le heartbeat et le retour de visibilité conservent l’actualisation, sans requête ajoutée.
