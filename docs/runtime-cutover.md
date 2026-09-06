# Runbook — bascule du runtime SeenIt

Ce runbook formalise une bascule non destructive du backend canonique `seenit.ai.studio`.

## Principe

L'ancien runtime reste disponible tant que le remplaçant n'a pas été prouvé. Une suppression ou un arrêt de l'ancien service avant validation du nouveau est interdit.

La **sync Git AI Studio** et le redémarrage éventuel de son serveur de développement sur le port 3000 ne constituent pas un déploiement du backend canonique. GitHub `main` est la source de vérité ; la publication runtime est un chemin Cloud Run séparé.

## Déploiement automatique depuis `main`

Le workflow `.github/workflows/deploy-backend.yml` écoute les zones susceptibles de modifier le runtime, attend d'abord la CI canonique du même SHA, puis calcule le graphe local réellement importé par `server.ts`. Un changement de source sans lien avec ce graphe est explicitement ignoré ; une dépendance serveur partagée, telle que `src/features/release/releaseUpdatePushBackend.ts`, déclenche bien le déploiement.

Le build et le déploiement sont volontairement séparés. Cloud Build construit d'abord une image avec les Buildpacks Google et `project.toml`, la pousse dans Artifact Registry puis le workflow résout son digest SHA-256. Cloud Run reçoit ensuite cette référence immuable `image@sha256:...` comme nouvelle révision candidate. Le workflow ne réutilise pas `gcloud run deploy --source` ni `gcloud run deploy --image` : les métadonnées source héritées d'un déploiement AI Studio ne doivent pas piloter ni bloquer le runtime canonique GitHub.

Pour préserver tous les réglages existants du service, le workflow fixe d'abord explicitement 100 % du trafic sur la révision déjà servie, exporte la configuration Cloud Run courante avec `--format=export`, puis prépare la candidate à partir de ce service exporté. Seules les métadonnées source incompatibles avec une image autonome (`run.googleapis.com/sources`, `run.googleapis.com/base-images` et le `runtimeClassName` associé aux mises à jour d'image de base) sont retirées ; l'image du conteneur unique est remplacée par le digest GitHub et un nouveau nom de révision est injecté. Le bloc de trafic conserve l'ancienne révision à 100 % et référence dès ce même `replace` la candidate à 0 % avec son tag déterministe, afin qu'elle reste active et testable sans servir de trafic de production. La configuration préparée passe un `gcloud run services replace --dry-run` avant son application. Après création, le workflow attend de façon bornée la readiness de la nouvelle révision en revérifiant à chaque tentative que l'ancienne révision reste seule à 100 % du trafic. Si la candidate ne devient pas prête, ses conditions Cloud Run sont exposées et la procédure s'arrête sans promotion.

Cloud Build est soumis en mode asynchrone puis suivi par son statut API avec `gcloud builds describe`. Le compte GitHub n'a donc pas besoin d'un rôle général `Viewer` ni d'un accès au bucket de logs pour attendre la fin d'un build : seul `SUCCESS` autorise la résolution du digest et la suite du déploiement ; tout état terminal d'échec bloque avant Cloud Run.

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
2. Construire l'image du runtime avec Cloud Build/Buildpacks, attendre explicitement le statut `SUCCESS`, la publier dans Artifact Registry et résoudre son digest immuable.
3. Fixer explicitement l'ancienne révision à 100 %, exporter le service, retirer uniquement les métadonnées source incompatibles, injecter le digest candidat et valider la configuration avec `services replace --dry-run`.
4. Créer la nouvelle révision en la déclarant à 0 % avec un tag dédié dans le même `replace`, conserver l'ancienne à 100 % du trafic et attendre bornément sa readiness tout en revérifiant ce routage.
5. Vérifier le nouveau runtime avec `/api/health` : HTTP 200 JSON, `status=ok`, `service=seenit-backend`, `identity=canonical`, header `X-SeenIt-Backend: canonical` et `Cache-Control: no-store`.
6. Pour le parcours de notification de release, vérifier aussi que `POST /api/releases/notify` est réellement servi avec une requête volontairement invalide qui doit être rejetée avant tout accès FCM.
7. Basculer 100 % du trafic vers la révision candidate uniquement après ces preuves.
8. Rejouer `/api/health` et le smoke métier depuis l'origine canonique `seenit.ai.studio`.
9. Observer les erreurs backend et confirmer qu'un rejet asynchrone retourne une erreur JSON sans terminer le process.
10. Conserver l'ancienne révision tant que la validation terrain utile au changement n'est pas terminée.

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
- identifiant et statut terminal du Cloud Build ;
- résultat du health-check avant et après bascule ;
- résultat du smoke spécifique au parcours modifié ;
- heure de bascule et, si nécessaire, heure du rollback ;
- lien vers l'issue GitHub de changement.
