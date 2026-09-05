# SeenIt — Contrôle natif de publication APK

Statut : **extension normative de `SEENIT-RELEASE-005`** pour l’orchestration d’une publication APK depuis un client ne disposant que du connecteur GitHub.

Cette spécification complète `seenit.md` et précise le mécanisme de déclenchement. Elle ne remplace aucun invariant APK, aucune protection de branche, aucun test de release ni le processus de publication immuable.

## Objectif

Une conversation autorisée à écrire des commentaires GitHub doit pouvoir déclencher une release SeenIt sans `gh`, sans `GH_TOKEN`/`GITHUB_TOKEN` dans son shell et sans navigateur authentifié. Le connecteur GitHub est suffisant : il publie une commande exacte sur l’issue de contrôle #102 et GitHub Actions effectue lui-même les contrôles et le `workflow_dispatch`.

## Commandes acceptées

Deux commandes seulement sont reconnues, sans espaces ni options supplémentaires :

- `/release-apk` — release depuis `main`, smoke Android 12 désactivé ;
- `/release-apk android12_smoke=true` — même release avec le TNR Android 12 activé.

Toute autre forme est refusée. L’issue de contrôle est **#102**. Seul le propriétaire du dépôt, avec `author_association=OWNER`, est autorisé à déclencher le job.

## Contrôles obligatoires avant dispatch

Le workflow `SeenIt Release Control`, exécuté depuis le workflow présent sur la branche par défaut et avec un checkout explicite de `main`, doit vérifier avant toute création de run :

1. le commentaire provient de l’issue #102, qui n’est pas une pull request ;
2. l’auteur du commentaire est exactement le propriétaire du dépôt et son association est `OWNER` ;
3. la commande correspond exactement à l’une des deux formes autorisées ;
4. la branche par défaut est `main` et le checkout local correspond au SHA `main` lu depuis l’API GitHub ;
5. `package.json` porte exactement le patch suivant la dernière release SemVer officielle ;
6. aucun tag `vX.Y.Z` et aucune release `vX.Y.Z` n’existent déjà ;
7. aucun run `workflow_dispatch` de `Validate & Release SeenIt` n’est déjà actif sur le même SHA `main` ;
8. l’option `android12_smoke` transmise au workflow cible correspond strictement à la commande validée.

Si un contrôle échoue, aucun dispatch n’est créé. Les refus sont testés par des fonctions pures, indépendamment du YAML.

## Dispatch natif et anti-doublon

Après validation, le contrôleur appelle directement l’API GitHub Actions :

`POST /repos/{owner}/{repo}/actions/workflows/build-apk.yml/dispatches`

avec `ref=main`, `release_apk=true` et la valeur validée de `android12_smoke`.

Le token utilisé est exclusivement le `GITHUB_TOKEN` du workflow, avec la permission minimale `actions: write`; le job possède `contents: read` et `issues: write` pour lire le dépôt et publier sa preuve sur #102. Aucun secret de signature Android n’est lu par ce contrôleur : ces secrets restent consommés uniquement par `Validate & Release SeenIt`.

Le contrôleur mémorise les IDs des runs existants avant le POST, puis recherche pendant au plus 30 secondes un nouveau run `workflow_dispatch` portant le SHA `main`. S’il ne le retrouve pas, il **ne redéclenche jamais aveuglément** : il trace l’état ambigu sur #102 et s’arrête.

La concurrence `seenit-release-control` est sérialisée (`cancel-in-progress: false`). Deux commandes simultanées ne peuvent donc pas contourner le contrôle anti-doublon ; la seconde doit constater le run actif créé par la première.

GitHub ne permet pas de filtrer `issue_comment` par numéro d'issue ou contenu dans `on:`. Chaque nouveau
commentaire du dépôt peut donc matérialiser un run de contrôle dont l'unique job est immédiatement
ignoré par son `if`. Ce bruit sans build ni test est accepté tant que le connecteur ne fournit pas
directement `workflow_dispatch` : aucune infrastructure ou clé externe n'est ajoutée uniquement pour
le masquer. Le workflow de notification post-release, lui, ne doit pas utiliser ce modèle global.

## Retour immédiat après dispatch

La preuve attendue du contrôleur est le lien du run `workflow_dispatch` portant exactement le SHA de
la candidate. Après cette identification bornée à 30 secondes, l'agent rend la main par défaut : il
n'attend pas la construction Gradle, l'émulateur ou la publication en répétant des lectures toutes les
quelques secondes. La CI et la notification Android poursuivent le parcours de manière autonome.

Un suivi synchrone complet reste possible lorsque l'utilisateur demande explicitement d'attendre le
résultat. Il cible alors uniquement le run identifié, espace ses lectures et traite un échec réel sans
redéclenchement aveugle. « Publie l'APK » seul signifie donc une orchestration autonome et asynchrone ;
« publie et attends le résultat » demande en plus la surveillance de bout en bout.

## Préparation des huit surfaces de version sans `gh`

La génération des surfaces de version est indépendante de toute API GitHub et de GitHub CLI. La commande :

`npm run release:prepare:files -- X.Y.Z`

calcule en mémoire puis aligne exactement les huit surfaces canoniques :

1. `android/app/build.gradle` ;
2. `src/store/updateStore.ts` ;
3. `server.ts` (`X-Plex-Version`) ;
4. `package.json` ;
5. `package-lock.json` ;
6. `docs/specifications/requirements.json` ;
7. `docs/specifications/android-contract.json` ;
8. `docs/specifications/seenit.md`.

Toutes les transformations sont calculées avant écriture. Si une écriture ou la validation finale échoue, les fichiers déjà écrits sont restaurés. Une préparation normale N → N+1 exige que les huit surfaces changent et qu’elles soient toutes cohérentes avant commit. L’orchestration distante de branche/PR peut encore utiliser un connecteur GitHub ou `gh`, mais **la production cohérente des huit fichiers n’en dépend plus**.

## Tests obligatoires

`tests/releaseFastPath.test.ts` couvre réellement :

- le parseur exact des commandes ;
- le refus d’un autre auteur, d’une autre issue et d’une option non autorisée ;
- le refus d’un checkout non `main`, d’une version inattendue, d’un tag/release existant et d’un run actif identique ;
- la construction et l’appel du endpoint natif `workflow_dispatch` avec un client API injecté, sans CLI ;
- la préparation d’un fixture réel contenant les huit surfaces, puis leur cohérence en N+1 sans `gh`.

Les assertions documentaires seules ne suffisent plus pour satisfaire `SEENIT-RELEASE-005`.

## Preuves terrain

La release 1.4.114 a validé le parcours connector-only complet sans GitHub CLI, token shell ni
navigateur authentifié. La release 1.4.115 a confirmé un dispatch en 17,9 secondes, mais son run #619
a aussi révélé près de 6 min 50 d'attente entre deux runners. L'issue #135 traite ce second problème :
le build et le smoke Android 36 partagent désormais le même job de lecture, tandis que le job de
publication conserve seul `contents: write`.
