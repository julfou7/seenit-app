# SeenIt — Contrôle natif du déploiement PWA

Ce document complète `docs/process/delivery.md` et `docs/runtime-cutover.md` pour les conversations qui disposent du connecteur GitHub mais pas d'un bouton ou d'une API directe `workflow_dispatch`.

## Objectif

L'image Cloud Run canonique contient le backend **et** le frontend PWA. Un changement exclusivement frontend peut donc être validé et fusionné sur `main` tout en étant volontairement ignoré par la détection d'impact backend du push automatique. Lorsqu'une publication PWA immédiate est demandée, il faut forcer la reconstruction complète via `.github/workflows/deploy-backend.yml` ; AI Studio `Publish` n'est pas le chemin canonique.

Le contrôle natif permet à une conversation autorisée à écrire un commentaire GitHub de provoquer ce `workflow_dispatch` sans `gh` local, sans token shell et sans navigateur authentifié.

## Commande connector-only

L'issue de contrôle runtime est **#57**. Elle peut rester fermée, comme l'issue de contrôle APK #102.

Seule la commande exacte suivante est reconnue :

`/deploy-pwa`

Le workflow `.github/workflows/runtime-control.yml` n'exécute son job que si :

- le commentaire est créé sur l'issue #57 ;
- l'auteur est exactement le propriétaire du dépôt ;
- `author_association=OWNER` ;
- le corps du commentaire est exactement `/deploy-pwa`.

Tous les autres commentaires matérialisent au plus un run de contrôle dont le job est immédiatement ignoré.

## Dispatch et anti-doublon

Le contrôleur lit le SHA courant de `main`, puis recherche les runs `workflow_dispatch` de `Deploy Canonical Backend` pour ce même SHA.

- Un run manuel déjà `queued` ou `in_progress` est réutilisé.
- Un run manuel déjà terminé en `success` pour le même SHA est également réutilisé : reconstruire une deuxième fois la même image n'apporte aucune preuve supplémentaire.
- Un ancien run échoué n'empêche pas un nouveau dispatch.
- Si aucun run réutilisable n'existe, le contrôleur appelle l'API GitHub Actions :

  `POST /repos/{owner}/{repo}/actions/workflows/deploy-backend.yml/dispatches`

  avec `ref=main`.

Le token est exclusivement le `GITHUB_TOKEN` du runner avec `actions: write`. Le contrôleur mémorise les IDs existants avant le POST et recherche pendant au plus 30 secondes le **nouveau** run `workflow_dispatch` portant le SHA `main`. S'il ne peut pas identifier ce run, il échoue sans redéclenchement aveugle.

La concurrence `seenit-runtime-control` est sérialisée avec `cancel-in-progress: false`.

## Ce que déclenche `/deploy-pwa`

`Deploy Canonical Backend` reçoit un événement `workflow_dispatch`. Dans ce mode, `FORCE_BACKEND_DEPLOY=true` : la détection d'impact n'a pas le droit de différer la reconstruction frontend-only. Le workflow suit ensuite intégralement le runbook Cloud Run : Buildpacks/Cloud Build, digest immuable, candidate sans trafic, readiness, `/api/health`, promotion puis smoke sur `seenit.ai.studio`, avec rollback si nécessaire.

Ce contrôle **ne déclenche jamais** `Validate & Release SeenIt` avec `release_apk=true`, ne modifie aucune version Android et ne publie aucune APK.

## Procédure agent

1. Vérifier `main`, la CI du changement et l'absence de déploiement PWA déjà prouvé pour le même SHA.
2. Publier exactement `/deploy-pwa` sur l'issue #57 avec le connecteur GitHub.
3. Identifier le run `Deploy Canonical Backend` renvoyé par le contrôleur.
4. Si la demande utilisateur inclut explicitement le déploiement complet, suivre ce run jusqu'à `success` et conserver les preuves Cloud Run prévues dans `docs/runtime-cutover.md`.
5. Mettre à jour puis fermer l'issue fonctionnelle uniquement après preuve de promotion canonique.

Le contrôle APK reste séparé sur #102 avec `/release-apk` ; ne jamais utiliser cette commande pour publier seulement la PWA.
