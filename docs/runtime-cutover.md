# Runbook — bascule du runtime SeenIt

Ce runbook formalise une bascule non destructive du backend canonique `seenit.ai.studio`.

## Principe

L'ancien runtime reste disponible tant que le remplaçant n'a pas été prouvé. Une suppression ou un arrêt de l'ancien service avant validation du nouveau est interdit.

La **sync Git AI Studio** et le redémarrage éventuel de son serveur de développement sur le port 3000 ne constituent pas un déploiement du backend canonique. GitHub `main` est la source de vérité ; la publication runtime est un chemin Cloud Run séparé.

## Déploiement automatique depuis `main`

Le workflow `.github/workflows/deploy-backend.yml` écoute les zones susceptibles de modifier le runtime, attend d'abord la CI canonique du même SHA, puis calcule le graphe local réellement importé par `server.ts`. Un changement de source sans lien avec ce graphe est explicitement ignoré ; une dépendance serveur partagée, telle que `src/features/release/releaseUpdatePushBackend.ts`, déclenche bien le déploiement.

Le build et le déploiement sont volontairement séparés. Cloud Build construit d'abord une image avec les Buildpacks Google et `project.toml`, la pousse dans Artifact Registry puis le workflow résout son digest SHA-256. Cloud Run reçoit ensuite cette référence immuable `image@sha256:...` comme nouvelle révision candidate. Le workflow ne réutilise pas `gcloud run deploy --source` : les métadonnées source héritées d'un déploiement AI Studio ne doivent pas piloter ni bloquer le runtime canonique GitHub.

Le workflow utilise exclusivement Workload Identity Federation. Les identifiants non secrets sont canonisés dans le dépôt :

- projet : `gen-lang-client-0201895414` (`799043440232`) ;
- service : `seenit-app`, région `us-west1` ;
- dépôt Artifact Registry : `cloud-run-source-deploy` ;
- pool/provider : `seenit-github/seenit-main` ;
- compte de déploiement : `seenit-github-deployer@gen-lang-client-0201895414.iam.gserviceaccount.com` ;
- fournisseur OIDC limité au repository ID GitHub `1338192018` et à `refs/heads/main`.

La configuration GCP initiale se fait une seule fois depuis une session `gcloud` déjà autorisée sur le projet :

```bash
bash scripts/bootstrap-gcp-backend-deploy.sh
```

Ce bootstrap n'écrit aucune clé JSON durable. Il configure la fédération GitHub, le compte de déploiement et les rôles minimaux requis par le déploiement Cloud Run depuis les sources. Il peut être relancé sans recréer les ressources déjà présentes.

## Procédure

1. Attendre une validation GitHub verte du même SHA `main`.
2. Construire l'image du runtime avec Cloud Build/Buildpacks, la publier dans Artifact Registry et résoudre son digest immuable.
3. Déployer ce digest comme nouvelle révision sans trafic avec un tag candidat.
4. Vérifier le nouveau runtime avec `/api/health` : HTTP 200 JSON, `status=ok`, `service=seenit-backend`, `identity=canonical`, header `X-SeenIt-Backend: canonical` et `Cache-Control: no-store`.
5. Pour le parcours de notification de release, vérifier aussi que `POST /api/releases/notify` est réellement servi avec une requête volontairement invalide qui doit être rejetée avant tout accès FCM.
6. Basculer 100 % du trafic vers la révision candidate uniquement après ces preuves.
7. Rejouer `/api/health` et le smoke métier depuis l'origine canonique `seenit.ai.studio`.
8. Observer les erreurs backend et confirmer qu'un rejet asynchrone retourne une erreur JSON sans terminer le process.
9. Conserver l'ancienne révision tant que la validation terrain utile au changement n'est pas terminée.

Pour un changement métier qui touche Plex, Sonarr, Radarr ou qBittorrent, compléter cette procédure par un smoke authentifié du transport concerné. Une réponse HTML sur une route `/api/*` est un échec de routage, même avec un statut HTTP 2xx.

## Rollback

Si le health-check, le mapping ou un smoke métier échoue après la bascule :

1. rétablir immédiatement 100 % du trafic vers l'ancienne révision encore intacte ;
2. confirmer `/api/health` et un smoke métier sur l'ancien runtime ;
3. conserver le nouveau runtime pour diagnostic ;
4. ne supprimer aucun service ni donnée pendant l'incident.

Le workflow automatise ce rollback si le smoke de l'origine canonique échoue après la promotion.

## Preuves à conserver

- SHA Git du runtime, digest d'image et révision Cloud Run correspondante ;
- résultat du health-check avant et après bascule ;
- résultat du smoke spécifique au parcours modifié ;
- heure de bascule et, si nécessaire, heure du rollback ;
- lien vers l'issue GitHub de changement.
