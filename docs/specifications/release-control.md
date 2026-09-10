# SeenIt — Contrôle natif de préparation et publication APK

Statut : **extension normative de `SEENIT-RELEASE-005`** pour l’orchestration d’une release APK depuis un client ne disposant que du connecteur GitHub.

Cette spécification complète `seenit.md`. Elle ne remplace aucun invariant APK, aucune protection de branche, aucun test de release ni le processus de publication immuable.

## Objectif

Une conversation autorisée à écrire des commentaires GitHub doit pouvoir préparer puis publier une release SeenIt sans `gh`, sans `GH_TOKEN`/`GITHUB_TOKEN` dans son shell, sans workspace local obligatoire et sans navigateur authentifié.

L’issue de contrôle est **#102**. Le connecteur GitHub publie une commande exacte ; GitHub Actions effectue lui-même les contrôles et les écritures distantes nécessaires.

## Commandes acceptées

Trois commandes seulement sont reconnues, sans espaces ni options supplémentaires :

- `/prepare-release-apk` — crée ou réutilise la prochaine candidate `release/vX.Y.Z` et sa PR ;
- `/release-apk` — publie depuis `main`, smoke Android 12 désactivé ;
- `/release-apk android12_smoke=true` — même publication avec le TNR Android 12 activé.

Seul le propriétaire du dépôt, avec `author_association=OWNER`, est autorisé à déclencher ces commandes sur #102.

## Préparation connector-only de la candidate

Quand aucune candidate compatible n’existe, `/prepare-release-apk` devient le chemin prioritaire. L’absence d’un workspace, de `gh`, d’un token shell ou d’un navigateur authentifié **n’est pas un blocage** et ne justifie plus une reproduction manuelle des huit fichiers. Cette reproduction n’est admise qu’en secours après panne prouvée du contrôleur.

Le job `Prepare Release Candidate` possède uniquement `contents: write`, `pull-requests: write` et `issues: write`. Il n’a aucun droit de déclenchement de release ni accès aux secrets de signature Android.

Avant toute création, il doit :

1. vérifier issue #102, auteur propriétaire, association `OWNER` et commande exacte ;
2. checkout explicitement le `main` canonique et vérifier que son SHA local correspond au SHA GitHub ;
3. lire la dernière release SemVer officielle ;
4. si `main` porte cette dernière version, calculer exactement le patch suivant ;
5. si `main` porte déjà exactement ce patch suivant, ne créer aucune nouvelle candidate et répondre que `/release-apk` est la prochaine action ;
6. refuser toute autre divergence de version ;
7. refuser un tag ou une release déjà existants pour la cible.

La branche cible est toujours `release/vX.Y.Z`.

### Candidate absente

Le runner exécute `prepareReleaseFiles()` avec `requireAllEight=true`, puis exige :

- exactement les huit surfaces canoniques de version ;
- `git diff --check` vert ;
- alignement final de toutes les surfaces ;
- **un seul commit** release-only ;
- aucun fichier métier.

Il pousse ensuite la branche avec l’identité `github-actions[bot]` et ouvre une PR vers `main`. Le commit porte `Changelog: aucun` afin que la préparation de version n’ajoute pas une fausse note publique.

### Candidate déjà présente

Une branche existante est réutilisable uniquement si :

- son merge-base est exactement le `main` canonique courant ;
- elle est à `ahead_by=1` et `behind_by=0` ;
- sa version est exactement la cible attendue ;
- son diff contient exactement les huit surfaces canoniques ;
- elle possède au plus une PR ouverte vers `main` ; une PR manquante peut être créée, mais une branche incompatible n’est jamais réécrite silencieusement.

Le contrôleur poste sur #102 la version, la base `main`, la branche, le commit, la PR, la portée release-only et la mesure « demande → PR » lorsqu’elle est disponible.

### Policy du dépôt interdisant la création de PR par GitHub Actions

GitHub peut accorder `pull-requests: write` au `GITHUB_TOKEN` du job tout en refusant `POST /pulls` lorsque le réglage du dépôt **« Allow GitHub Actions to create and approve pull requests »** est désactivé. Le message API canonique est alors :

`GitHub Actions is not permitted to create or approve pull requests.`

Ce cas précis n’invalide pas une candidate déjà préparée. Après preuve que la branche respecte strictement les invariants ci-dessus (base exacte, version cible, un commit, huit surfaces et aucun fichier métier), le contrôleur effectue un **handoff connector-only** :

- il conserve la branche telle quelle et ne reproduit jamais les huit fichiers ;
- il publie sur #102 la branche, le SHA de candidate et la prochaine action exacte ;
- il termine sans faux échec avec l’action machine-readable `connector_pr_required` ;
- le client connecté ouvre alors la PR `release/vX.Y.Z` → `main` via le connecteur GitHub, puis reprend la CI/merge normale.

La tolérance est volontairement étroite : un autre `403`, une erreur d’API différente ou une candidate incompatible restent bloquants. Le contrôleur ne doit jamais convertir une panne générique en succès ni affaiblir les validations de candidate.

## Huit surfaces canoniques de version

`npm run release:prepare:files -- X.Y.Z` et le contrôleur natif alignent exactement :

1. `android/app/build.gradle` ;
2. `src/store/updateStore.ts` ;
3. `server.ts` (`X-Plex-Version`) ;
4. `package.json` ;
5. `package-lock.json` ;
6. `docs/specifications/requirements.json` ;
7. `docs/specifications/android-contract.json` ;
8. `docs/specifications/seenit.md`.

Toutes les transformations sont calculées avant écriture. Si une écriture ou la validation finale échoue, les fichiers déjà écrits sont restaurés. Le format canonique JSON est conservé octet par octet hors valeurs de version attendues.

## Publication connector-only

Après CI verte et merge de la candidate, `/release-apk` ou `/release-apk android12_smoke=true` passe par le job `Release Control`, dont les permissions restent séparées et minimales : `actions: write`, `contents: read`, `issues: write`.

Avant dispatch, le contrôleur vérifie :

1. issue #102 et auteur propriétaire `OWNER` ;
2. commande exacte ;
3. branche par défaut `main` et checkout égal au SHA `main` ;
4. version `main` exactement égale au patch suivant la dernière release officielle ;
5. aucun tag/release identique ;
6. aucun run `workflow_dispatch` actif sur le même SHA ;
7. option Android 12 strictement conforme à la commande.

Le contrôleur appelle ensuite :

`POST /repos/{owner}/{repo}/actions/workflows/build-apk.yml/dispatches`

avec `ref=main`, `release_apk=true` et l’option Android 12 validée. Il utilise exclusivement le `GITHUB_TOKEN` du runner et ne lit aucun secret de signature.

Le contrôleur mémorise les runs existants puis recherche pendant au plus 30 secondes le nouveau run portant le SHA `main`. S’il ne le retrouve pas, il ne redéclenche jamais aveuglément.

La concurrence `seenit-release-control` est sérialisée avec `cancel-in-progress: false`, ce qui empêche préparation et publication simultanées de contourner les gardes anti-doublon.

## Checkpoint final automatique

Après succès du workflow de release, `Android APK Update Notification` conserve son rôle de notification des installations et écrit également un **checkpoint final idempotent** sur #102, identifié par le run source.

Le checkpoint doit contenir au minimum :

- version publiée ;
- SHA `main` publié ;
- lien du run release ;
- confirmation du smoke Android 36 ;
- nom/lien de l’APK officiel ;
- SHA-256 de l’APK lorsqu’exposé par GitHub ;
- résultat de notification Android : envoyées, déjà traitées, tokens invalides.

Si la notification Android échoue après publication de l’APK, le checkpoint est tout de même écrit avec l’état d’échec, puis le workflow reste en échec. La traçabilité ne masque donc jamais une panne opérationnelle.

Un rerun ne doit pas créer une succession de commentaires identiques : le checkpoint est mis à jour via un marqueur stable `seenit-release-summary:<runId>`.

Lors d’une reprise dans un nouveau chat, ce checkpoint est la première preuve à lire avant de reconstruire manuellement l’état d’une release terminée.

## Retour après déclenchement

Une demande « publie l’APK » seule autorise l’agent à laisser GitHub Actions terminer après identification du run exact : il **rend la main par défaut** une fois le run précis identifié et tracé. Si l’utilisateur demande explicitement d’attendre le résultat — notamment avec une formulation comme « publie et attends le résultat » — le suivi reste ciblé sur ce run jusqu’à l’APK signée, au smoke et à la publication.

Lorsqu’une candidate doit d’abord être préparée, l’agent utilise `/prepare-release-apk`, attend uniquement la CI de la PR créée/réutilisée — ou ouvre via le connecteur la PR demandée par un handoff policy explicite —, fusionne si elle est verte, puis enchaîne `/release-apk`. Il ne relit pas l’historique fonctionnel complet entre ces étapes.

## Bruit `issue_comment`

GitHub ne permet pas de filtrer `issue_comment` par numéro d’issue ou contenu dans `on:`. Chaque commentaire du dépôt peut donc matérialiser un run de contrôle dont les jobs sont immédiatement ignorés par leurs `if`. Ce bruit sans build ni test est accepté tant que le connecteur ne fournit pas directement les écritures Actions nécessaires.

## Tests obligatoires

Les TNR de release couvrent réellement :

- parseur/autorisation exacte des commandes ;
- refus d’un autre auteur, d’une autre issue et des variantes non autorisées ;
- calcul de la prochaine version et détection « déjà prêt à publier » ;
- compatibilité stricte d’une candidate distante : base exacte, un commit, huit surfaces ;
- séparation des permissions préparation/publication ;
- préparation atomique N → N+1 et conservation du format des catalogues JSON ;
- reconnaissance stricte du seul `403` de policy GitHub Actions pour le handoff PR, tout autre échec restant bloquant ;
- dispatch natif et anti-doublon ;
- format du checkpoint final en succès et en échec de notification ;
- permission `issues: write` limitée au workflow post-release qui produit ce checkpoint.

Les assertions documentaires seules ne suffisent pas : les helpers de décision sont testés comme fonctions pures et le workflow de validation exécute ces TNR.

## Preuves terrain

- v1.4.114 : validation du parcours de publication connector-only sans GitHub CLI, token shell ni navigateur authentifié ;
- v1.4.115 : dispatch en 17,9 s ; le problème distinct d’attente runner a été traité par #135 ;
- v1.4.122 : dispatch `/release-apk` en 20,5 s, build/signature, upgrade smoke Android 36, publication et notification tous verts. Cette release a révélé le dernier trou « candidate absente », désormais couvert par `/prepare-release-apk` ;
- v1.4.123 : premier `/prepare-release-apk` terrain ; génération et push de la candidate réussis, puis `POST /pulls` refusé par la policy GitHub malgré `pull-requests: write`. Ce cas est désormais couvert par le handoff connector-only strict sans recréation des huit surfaces.