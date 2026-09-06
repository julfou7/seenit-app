# Runbook — bascule du runtime SeenIt

Ce runbook formalise une bascule non destructive du backend canonique `seenit.ai.studio`.

## Principe

L'ancien runtime reste disponible tant que le remplaçant n'a pas été prouvé. Une suppression ou un arrêt de l'ancien service avant validation du nouveau est interdit.

La **sync Git AI Studio** et le redémarrage éventuel de son serveur de développement sur le port 3000 ne constituent pas un déploiement du backend canonique. GitHub `main` est la source de vérité ; la publication runtime est un chemin Cloud Run séparé.

## Déploiement automatique depuis `main`

Le workflow `.github/workflows/deploy-backend.yml` écoute les zones susceptibles de modifier le runtime, attend d'abord la CI canonique du même SHA, puis calcule le graphe local réellement importé par `server.ts`. Un changement de source sans lien avec ce graphe est explicitement ignoré ; une dépendance serveur partagée, telle que `src/features/release/releaseUpdatePushBackend.ts`, déclenche bien le déploiement.

Le build et le déploiement sont volontairement séparés. Cloud Build construit d'abord une image avec les Buildpacks Google et `project.toml`, la pousse dans Artifact Registry puis le workflow résout son digest SHA-256. Cloud Run reçoit ensuite cette référence immuable `image@sha256:...` comme nouvelle révision candidate. Le workflow ne réutilise pas `gcloud run deploy --source` ni `gcloud run deploy --image` : les métadonnées source héritées d'un déploiement AI Studio ne doivent pas piloter ni bloquer le runtime canonique GitHub.

`project.toml` force `NODE_ENV=development` uniquement pendant le **build** afin que les outils de compilation présents dans `devDependencies` soient installés. La révision Cloud Run candidate est, elle, toujours matérialisée avec `NODE_ENV=production` au runtime avant son `replace`. Le backend compilé démarre ainsi via le script `start` de `package.json` sans initialiser le serveur Vite de développement. Cette séparation build/runtime est un invariant du chemin canonique.

Pour préserver tous les réglages existants du service, le workflow lit d'abord l'état Cloud Run et exige qu'une seule cible recevant du trafic pointe vers la révision actuellement servie à 100 %. Il ne lance aucune mutation `update-traffic` avant l'export : une ancienne candidate échouée peut rester référencée à 0 % avec un tag et ne doit pas être réactivée ou réconciliée par une commande préparatoire. L'export `--format=export` est ensuite normalisé localement : les anciennes cibles à 0 % sont retirées, la cible servie à 100 % est conservée, puis la nouvelle candidate est ajoutée à 0 % avec son tag déterministe. Les métadonnées source incompatibles avec une image autonome (`run.googleapis.com/sources`, `run.googleapis.com/base-images` et le `runtimeClassName` associé aux mises à jour d'image de base) sont retirées. Les éventuels `command` et `args` hérités du conteneur source sont également retirés afin que l'image Buildpacks conserve son propre process de lancement, dérivé du script `start` de `package.json`; les autres réglages du conteneur sont conservés. L'image du conteneur unique est remplacée par le digest GitHub, `NODE_ENV=production` est forcé et un nouveau nom de révision est injecté. La configuration préparée passe un `gcloud run services replace --dry-run` avant son application. Après création, le workflow attend de façon bornée la readiness de la nouvelle révision en revérifiant à chaque tentative que l'ancienne révision reste seule à 100 % du trafic. Le tag candidat, déjà créé dans ce même `replace`, est ensuite seulement vérifié : aucune seconde mutation de trafic n'est faite avant les smokes. Si la candidate ne devient pas prête, ses conditions Cloud Run sont exposées et la procédure s'arrête sans promotion.

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
3. Lire le routage Cloud Run et vérifier qu'une seule révision reçoit 100 % du trafic ; exporter le service sans mutation préalable.
4. Normaliser localement l'export en supprimant les anciennes cibles à 0 %, conserver la révision servie à 100 %, retirer les métadonnées source incompatibles ainsi que les éventuels `command`/`args` hérités, injecter le digest candidat, forcer `NODE_ENV=production` au runtime et ajouter la candidate à 0 % avec son tag ; valider avec `services replace --dry-run`.
5. Créer la nouvelle révision avec ce même `replace`, conserver l'ancienne à 100 % du trafic et attendre bornément sa readiness tout en revérifiant ce routage et le tag candidat.
6. Vérifier le nouveau runtime avec `/api/health` : HTTP 200 JSON, `status=ok`, `service=seenit-backend`, `identity=canonical`, header `X-SeenIt-Backend: canonical` et `Cache-Control: no-store`.
7. Pour le parcours de notification de release, vérifier aussi que `POST /api/releases/notify` est réellement servi avec une requête volontairement invalide qui doit être rejetée avant tout accès FCM.
8. Basculer 100 % du trafic vers la révision candidate uniquement après ces preuves.
9. Rejouer `/api/health` et le smoke métier depuis l'origine canonique `seenit.ai.studio`.
10. Observer les erreurs backend et confirmer qu'un rejet asynchrone retourne une erreur JSON sans terminer le process.
11. Conserver l'ancienne révision tant que la validation terrain utile au changement n'est pas terminée.

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
