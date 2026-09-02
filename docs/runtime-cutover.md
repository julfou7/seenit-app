# Runbook — bascule du runtime SeenIt

Ce runbook formalise une bascule non destructive du backend canonique `seenit.ai.studio`.

## Principe

L'ancien runtime reste disponible tant que le remplaçant n'a pas été prouvé. Une suppression ou un arrêt de l'ancien service avant validation du nouveau est interdit.

## Procédure

1. Déployer le nouveau runtime sans modifier le mapping de production existant.
2. Vérifier le nouveau runtime avec `/api/health` : HTTP 200 JSON, `status=ok`, `service=seenit-backend`, `identity=canonical`, header `X-SeenIt-Backend: canonical` et `Cache-Control: no-store`.
3. Exécuter un smoke authentifié sur les transports réellement utilisés : Plex, Sonarr, Radarr et qBittorrent. Une réponse HTML sur une route `/api/*` est un échec de routage, même avec un statut HTTP 2xx.
4. Basculer le mapping/domaine `seenit.ai.studio` vers le runtime validé.
5. Rejouer `/api/health` puis les smokes métier depuis la PWA canonique, un preview AI Studio `ais-dev-*` et l'APK lorsque la livraison le concerne.
6. Observer les erreurs backend et confirmer qu'un rejet asynchrone retourne une erreur JSON sans terminer le process.
7. Seulement après ces preuves, retirer l'ancien runtime.

## Rollback

Si le health-check, le mapping ou un smoke métier échoue après la bascule :

1. rétablir immédiatement le mapping vers l'ancien runtime encore intact ;
2. confirmer `/api/health` et un smoke métier sur l'ancien runtime ;
3. conserver le nouveau runtime pour diagnostic ;
4. ne supprimer aucun service ni donnée pendant l'incident.

## Preuves à conserver

- commit/release du runtime ;
- résultat du health-check avant et après mapping ;
- résultat des smokes Plex, Sonarr, Radarr et qBittorrent ;
- heure de bascule et, si nécessaire, heure du rollback ;
- lien vers l'issue GitHub de changement.
