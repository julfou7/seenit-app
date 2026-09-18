# SeenIt — Contrôle natif de préparation et publication APK

Statut : **extension normative de `SEENIT-RELEASE-005`** pour l’orchestration d’une release APK depuis un client ne disposant que du connecteur GitHub.

Cette spécification complète `seenit.md`. Elle ne remplace aucun invariant APK, aucune protection de branche ni le processus de publication immuable. Le chemin de release complète conserve ses contrôles historiques ; le chemin terrain rapide réutilise la validation canonique déjà verte du SHA `main` et retire du chemin critique uniquement les validations redondantes et les smokes émulateur avant le test sur téléphone réel.

## Objectif

Une conversation autorisée à écrire des commentaires GitHub doit pouvoir préparer puis publier une release SeenIt sans `gh`, sans `GH_TOKEN`/`GITHUB_TOKEN` dans son shell, sans workspace local obligatoire et sans navigateur authentifié.

L’issue de contrôle est **#102**. Le connecteur GitHub publie une commande exacte ; GitHub Actions effectue lui-même les contrôles et les écritures distantes nécessaires.

Pour un correctif APK explicitement destiné à une validation sur le téléphone du propriétaire, la cible supplémentaire est **correctif prêt/mergé → mise à jour installable via SeenIt en moins de 10 minutes**, sans téléchargement manuel ni deuxième demande « publie APK ».

## Commandes acceptées

Quatre commandes seulement sont reconnues, sans espaces ni options supplémentaires :

- `/prepare-release-apk` — crée ou réutilise la prochaine candidate `release/vX.Y.Z` et sa PR ;
- `/release-terrain` — publie la prochaine version officielle en mode terrain rapide, après preuve d’une validation `main` verte du SHA exact, sans smoke émulateur bloquant ;
- `/release-apk` — publie depuis `main` en release complète, smoke Android 12 désactivé ;
- `/release-apk android12_smoke=true` — même release complète avec le TNR Android 12 activé.

Seul le propriétaire du dépôt, avec `author_association=OWNER`, est autorisé à déclencher ces commandes sur #102.

## Préparation connector-only de la candidate

Quand aucune candidate compatible n’existe, `/prepare-release-apk` devient le chemin prioritaire. L’absence d’un workspace, de `gh`, d’un token shell ou d’un navigateur authentifié **n’est pas un blocage** et ne justifie plus une reproduction manuelle des huit fichiers. Cette reproduction n’est admise qu’en secours après panne prouvée du contrôleur.

Le job `Prepare Release Candidate` possède `actions: write`, `contents: write`, `pull-requests: write` et `issues: write`. `actions: write` sert exclusivement à déclencher la validation canonique non-release de la candidate ; il n’autorise pas ce job à publier une APK et ne lui donne aucun accès aux secrets de signature Android.

Avant toute création, il doit :

1. vérifier issue #102, auteur propriétaire, association `OWNER` et commande exacte ;
2. checkout explicitement le `main` canonique et vérifier que son SHA local correspond au SHA GitHub ;
3. lire la dernière release SemVer officielle ;
4. si `main` porte cette dernière version, calculer exactement le patch suivant ;
5. si `main` porte déjà exactement ce patch suivant, ne créer aucune nouvelle candidate et répondre qu’une commande de publication (`/release-terrain` ou `/release-apk` selon le besoin) est la prochaine action ;
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
- elle possède au plus une PR ouverte vers `main` ; une PR manquante peut être créée.

Une candidate incompatible reste bloquante par défaut et n’est jamais réécrite silencieusement. Il existe une unique récupération automatique pour la course **candidate créée → handoff PR connector-only → `main` avance** : le contrôleur peut recycler la branche canonique seulement s’il prouve simultanément que :

- la version de branche est exactement la prochaine version attendue et aucun tag/release cible n’existe ;
- la branche contient exactement **un commit propre** (`ahead_by=1`) et le `main` a avancé (`behind_by>0`) ;
- le diff propre à cette branche contient exactement les huit surfaces de version et aucun fichier métier ;
- le commit de tête est auteur **et** committer `github-actions[bot]`, porte le titre canonique `chore(release): préparer SeenIt X.Y.Z`, `Changelog: aucun` et le marqueur `Préparation créée par le contrôleur connector-only #102.` ;
- aucune PR, ouverte ou fermée, n’existe pour cette branche ;
- le SHA de la ref distante est relu immédiatement avant mutation et correspond toujours au SHA inspecté.

Quand toutes ces preuves sont réunies, le contrôleur supprime explicitement la ref obsolète avec l’API GitHub, trace l’ancien SHA, l’ancienne base et le nouveau `main` sur #102, puis recrée `release/vX.Y.Z` depuis le `main` courant par le préparateur atomique normal. **Aucun force-push n’est autorisé.** Si une seule preuve manque ou si la ref change entre inspection et suppression, le recyclage est refusé et l’incompatibilité reste bloquante.

Le contrôleur poste sur #102 la version, la base `main`, la branche, le commit, la PR, la portée release-only et la mesure « demande → PR » lorsqu’elle est disponible.

### Validation canonique explicite des PR créées par `GITHUB_TOKEN`

Une PR créée par un workflow avec son `GITHUB_TOKEN` ne doit pas dépendre d’un nouvel événement `pull_request` : GitHub protège contre les boucles récursives et ce chemin a produit des runs `action_required` sans job exploitable sur les candidates v1.4.154 à v1.4.156.

Après création ou réutilisation d’une PR candidate, le contrôleur déclenche donc explicitement `Validate & Release SeenIt` via `workflow_dispatch` sur **la branche candidate exacte**, avec `release_apk=false` et `android12_smoke=false`. Le job `Validate Change` retrouve le merge-base du `main` grâce au checkout complet et exécute le même `npm run validate:change` canonique que la CI de PR. Le contrôleur mémorise les runs précédents, recherche pendant au plus 30 secondes le nouveau run `workflow_dispatch` dont `head_sha` est exactement le SHA candidat, puis publie son lien sur #102.

Cette validation explicite est un garde obligatoire : une PR candidate créée/réutilisée par le contrôleur n’est **jamais considérée prête ni fusionnable** tant que ce run précis n’est pas terminé en succès. Si le dispatch est accepté mais que le run n’est pas retrouvé dans la fenêtre bornée, le contrôleur échoue et interdit tout redéclenchement aveugle ; l’état GitHub doit d’abord être relu.

### Policy du dépôt interdisant la création de PR par GitHub Actions

GitHub peut accorder `pull-requests: write` au `GITHUB_TOKEN` du job tout en refusant `POST /pulls` lorsque le réglage du dépôt **« Allow GitHub Actions to create and approve pull requests »** est désactivé. Le message API canonique est alors :

`GitHub Actions is not permitted to create or approve pull requests.`

Ce cas précis n’invalide pas une candidate déjà préparée. Après preuve que la branche respecte strictement les invariants ci-dessus (base exacte, version cible, un commit, huit surfaces et aucun fichier métier), le contrôleur effectue un **handoff connector-only** :

- il conserve la branche telle quelle et ne reproduit jamais les huit fichiers ;
- il publie sur #102 la branche, le SHA de candidate et la prochaine action exacte ;
- il termine sans faux échec avec l’action machine-readable `connector_pr_required` ;
- le client connecté ouvre alors la PR `release/vX.Y.Z` → `main` via le connecteur GitHub, puis reprend la CI/merge normale.

La tolérance est volontairement étroite : un autre `403`, une erreur d’API différente ou une candidate incompatible hors du recyclage strict ci-dessus restent bloquants. Le contrôleur ne doit jamais convertir une panne générique en succès ni affaiblir les validations de candidate.

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

Après CI verte et merge de la candidate, `/release-terrain`, `/release-apk` ou `/release-apk android12_smoke=true` passe par le job `Release Control`, dont les permissions restent séparées et minimales : `actions: write`, `contents: read`, `issues: write`.

Avant dispatch, le contrôleur vérifie :

1. issue #102 et auteur propriétaire `OWNER` ;
2. commande exacte ;
3. branche par défaut `main` et checkout égal au SHA `main` ;
4. version `main` exactement égale au patch suivant la dernière release officielle ;
5. aucun tag/release identique ;
6. aucun run `workflow_dispatch` actif sur le même SHA ;
7. options terrain/Android 12 strictement conformes à la commande.

### Release complète

Pour `/release-apk`, le contrôleur appelle `build-apk.yml` sur `main` avec `release_apk=true`, `android12_smoke=false`. La variante `android12_smoke=true` active en plus le TNR Android 12. Le workflow conserve le contrat complet de release, dont les validations de release et le smoke Android 36 bloquant.

### Release terrain rapide

`/release-terrain` est réservé à une **boucle de validation sur téléphone réel après un correctif déjà validé et mergé**. Ce n’est ni une prerelease, ni un second canal, ni un APK manuel : la sortie est une release GitHub normale, immuable, visible par `releases/latest` et donc par l’updater intégré SeenIt.

Avant le dispatch terrain, le contrôleur exige en plus un run `push` de `Validate & Release SeenIt` terminé en succès dont `head_branch=main` et `head_sha` est **exactement** le SHA à publier. Il attend ce run pendant au plus 90 secondes. Une validation rouge, l’absence de preuve verte ou un SHA différent refusent le fast path ; aucune release non validée n’est publiée pour gagner du temps.

Une fois cette preuve acquise, le contrôleur appelle `build-apk.yml` avec `release_apk=true`, `fast_terrain=true` et `android12_smoke=false`. Le workflow **réutilise** la validation `main` au lieu de rejouer dans le job de release : classification, contrat SPEC, lint, tests unitaires et audit de dépendances. Il ne construit pas le harness d’instrumentation et ne démarre pas les émulateurs Android 36/12 avant le terrain.

Le fast path conserve néanmoins tout ce qui rend l’APK réellement installable et traçable :

- même `applicationId` et même clé release `seenit` ;
- version/versionCode strictement croissants et garde d’immuabilité ;
- matérialisation du keystore ;
- build Web puis `npx cap sync android` ;
- **revalidation du contrat Android après sync** ;
- Gradle `assembleDebug` signé ;
- asset canonique `SeenIt-vX.Y.Z.apk` et SHA-256 ;
- release GitHub officielle ;
- `repository_dispatch` puis notification Android vers le parcours de mise à jour intégré.

Le smoke Android 36 reste disponible dans `/release-apk` et redevient le choix obligatoire lorsque le chantier modifie précisément la signature, l’identité/package, la migration d’installation N→N+1 ou le mécanisme d’update/install lui-même. Pour les correctifs applicatifs ordinaires, le téléphone réel est la validation terrain prioritaire et l’émulateur ne retarde plus la mise à disposition.

### Anti-doublon et corrélation

Le contrôleur mémorise les runs existants puis recherche pendant au plus 30 secondes le nouveau run portant le SHA `main`. S’il ne le retrouve pas, il ne redéclenche jamais aveuglément.

La concurrence `seenit-release-control` est sérialisée avec `cancel-in-progress: false`, ce qui empêche préparation et publication simultanées de contourner les gardes anti-doublon.

## Checkpoint final automatique

Après succès du workflow de release, `Android APK Update Notification` conserve son rôle de notification des installations et écrit également un **checkpoint final idempotent** sur #102, identifié par le run source.

Le checkpoint doit contenir au minimum :

- version publiée ;
- SHA `main` publié ;
- lien du run release ;
- mode `terrain rapide` ou `release complète` ;
- résultat du smoke Android 36 : réussi pour une release complète, explicitement sauté/non bloquant pour le fast terrain ;
- nom/lien de l’APK officiel ;
- SHA-256 de l’APK lorsqu’exposé par GitHub ;
- résultat de notification Android : envoyées, déjà traitées, tokens invalides.

Si la notification Android échoue après publication de l’APK, le checkpoint est tout de même écrit avec l’état d’échec, puis le workflow reste en échec. La traçabilité ne masque donc jamais une panne opérationnelle.

Un rerun ne doit pas créer une succession de commentaires identiques : le checkpoint est mis à jour via un marqueur stable `seenit-release-summary:<runId>`.

Lors d’une reprise dans un nouveau chat, ce checkpoint est la première preuve à lire avant de reconstruire manuellement l’état d’une release terminée.

## Relais inter-conversations avant déclenchement

Lorsque le propriétaire a explicitement demandé une APK mais délégué sa publication après merge, le chantier release est transmis sur #102 avec le marqueur
`<!-- seenit-apk-release-handoff -->` et un bail `HANDOFF_READY` selon `AGENTS.md` §0.4a. Ce relais
n'est **pas** une commande `/prepare-release-apk`, `/release-terrain` ou `/release-apk` : seul son destinataire, après
relecture de `main`, de la dernière release et des baux, publie ensuite la commande exacte. Un état
`WAITING Terrain` sur l'issue fonctionnelle ne constitue pas une attente de release. Si le SHA visé
est déjà couvert par une release officielle, le relais est clôturé sans nouveau patch ; si `main` a
avancé, son lot et son autorisation sont réconciliés avant toute commande.

## Retour après déclenchement

Une demande « publie l’APK » seule conserve le chemin de release complète et autorise l’agent à laisser GitHub Actions terminer après identification du run exact : il **rend la main par défaut** une fois le run précis identifié et tracé. Si l’utilisateur demande explicitement d’attendre le résultat — notamment avec une formulation comme « publie et attends le résultat » — le suivi reste ciblé sur ce run jusqu’à l’APK signée, au smoke et à la publication.

Lorsqu’une candidate doit d’abord être préparée, l’agent utilise `/prepare-release-apk`, attend la **validation canonique explicite du SHA candidat** publiée par le contrôleur — ou, en cas de handoff policy, ouvre via le connecteur la PR demandée et attend sa CI normale —, fusionne uniquement si elle est verte, puis enchaîne la commande de publication adaptée. Il ne relit pas l’historique fonctionnel complet entre ces étapes.

Lorsqu’un correctif APK a été demandé pour être testé sur le téléphone, le mandat initial couvre aussi sa livraison terrain : après merge et validation `main`, l’agent enchaîne **sans nouvelle demande utilisateur** vers la préparation de version si nécessaire puis `/release-terrain`, et suit le run jusqu’à la release et à la notification installable. Un terrain KO invalide la prétention de correction et reste dans le même chantier ; il ne demande pas à l’utilisateur de relancer séparément « publie APK ».

## Bruit `issue_comment`

GitHub ne permet pas de filtrer `issue_comment` par numéro d’issue ou contenu dans `on:`. Chaque commentaire du dépôt peut donc matérialiser un run de contrôle dont les jobs sont immédiatement ignorés par leurs `if`. Ce bruit sans build ni test est accepté tant que le connecteur ne fournit pas directement les écritures Actions nécessaires.

## Tests obligatoires

Les TNR de release couvrent réellement :

- parseur/autorisation exacte des quatre commandes ;
- refus d’un autre auteur, d’une autre issue et des variantes non autorisées ;
- calcul de la prochaine version et détection « déjà prêt à publier » ;
- compatibilité stricte d’une candidate distante : base exacte, un commit, huit surfaces ;
- recyclage strict d’une candidate contrôleur obsolète sans PR, avec relecture du SHA avant `DELETE` ref et refus de tout force-push ;
- séparation des permissions préparation/publication ;
- préparation atomique N → N+1 et conservation du format des catalogues JSON ;
- reconnaissance stricte du seul `403` de policy GitHub Actions pour le handoff PR, tout autre échec restant bloquant ;
- dispatch explicite de validation non-release sur la branche candidate, corrélation stricte au `head_sha` et refus de considérer une candidate prête sans run identifié ;
- dispatch natif de release et anti-doublon ;
- pour `/release-terrain`, preuve `main` verte sur le SHA exact, conservation de la signature/build/asset/digest/notification et exclusion des validations redondantes/smokes émulateur du chemin critique ;
- compatibilité descendante de `/release-apk`, dont le smoke Android 36 bloquant ;
- format du checkpoint final en succès et en échec de notification ;
- permission `issues: write` limitée au workflow post-release qui produit ce checkpoint.

Les assertions documentaires seules ne suffisent pas : les helpers de décision sont testés comme fonctions pures et le workflow de validation exécute ces TNR, notamment `tests/terrainReleaseFastPath.test.ts` pour #368.

## Preuves terrain

- v1.4.114 : validation du parcours de publication connector-only sans GitHub CLI, token shell ni navigateur authentifié ;
- v1.4.115 : dispatch en 17,9 s ; le problème distinct d’attente runner a été traité par #135 ;
- v1.4.122 : dispatch `/release-apk` en 20,5 s, build/signature, upgrade smoke Android 36, publication et notification tous verts. Cette release a révélé le dernier trou « candidate absente », désormais couvert par `/prepare-release-apk` ;
- v1.4.123 : premier `/prepare-release-apk` terrain ; génération et push de la candidate réussis, puis `POST /pulls` refusé par la policy GitHub malgré `pull-requests: write`. Ce cas est désormais couvert par le handoff connector-only strict sans recréation des huit surfaces ;
- v1.4.154 à v1.4.156 : la création de PR par `github-actions[bot]` a confirmé que l’événement dérivé du `GITHUB_TOKEN` ne déclenche pas la CI de PR attendue. La validation explicite `workflow_dispatch` du SHA candidat devient le garde durable et supprime le besoin de recréer la PR sous l’identité utilisateur.

La première preuve réelle de `/release-terrain` doit être enregistrée sur #368 avec version, SHA, run, durée jusqu’à disponibilité, asset/digest et résultat de notification.