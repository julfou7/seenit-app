# Fast paths de validation CI

Ce runbook complète `delivery.md` et documente les optimisations de l'issue #85. Elles réduisent les validations redondantes sans contourner le check obligatoire `Validate Change` ni la protection de `main`.

## 1. Preuve exacte `Agent Remote Validate` → PR

En environnement connector-only/no-egress, un changement est d'abord matérialisé sur `agent-staging/**` et validé par `Agent Remote Validate`.

Une PR peut réutiliser cette validation uniquement si toutes les garanties suivantes sont vraies :

- le SHA de tête de la PR est exactement le SHA validé en staging ;
- le merge-base avec `main` est exactement celui enregistré dans la preuve staging ;
- le tree SHA Git est exactement identique ;
- le run `Agent Remote Validate` appartient au même dépôt, provient d'une branche `agent-staging/**`, est terminé avec succès et son job `Validate exact staging SHA` est vert ;
- aucune surface capable de modifier la mécanique de validation n'a changé (`.github/**`, `.devcontainer/**`, `scripts/**`, dépendances/lockfile, configuration TypeScript/Vite ou contrat des quality gates).

Si une seule garantie manque, est ambiguë ou ne peut pas être vérifiée, la PR exécute la validation complète. La preuve n'est donc jamais fondée sur le seul SHA d'un commit ou sur un cache.

Quand la preuve staging est acceptée, le job requis `Validate Change` reste présent et vert : il vérifie la preuve de confiance puis publie la preuve d'arbre normale utilisée après merge. Il ne réexécute pas les dépendances, TypeScript, les tests, le build ou le Browser Quality Gate déjà validés sur le même arbre.

## 2. Fast path documentaire strict

Un diff peut utiliser le scope `docs-only` uniquement s'il contient exclusivement des fichiers Markdown sous :

- `docs/process/**` ;
- `docs/requests/**`.

`AGENTS.md`, `.agents/**`, `docs/specifications/**`, les workflows, scripts, tests, sources, configurations et fichiers de dépendances sont volontairement exclus de ce raccourci.

Pour un vrai diff `docs-only`, restent obligatoires :

- checkout exact et calcul de la plage Git ;
- installation/action de `actionlint` et contrôle de politique des workflows ;
- intégrité SPEC ;
- validation de couverture `Changelog:`.

Sont sautés car aucune surface exécutable ou contractuelle sensible n'est modifiée : restauration/installation de `node_modules`, devcontainer, TypeScript/lint applicatif, tests unitaires, contrat Android, build Web, budget bundle et Browser Quality Gate.

Toute ambiguïté de classification retombe sur le scope `full`.

## 3. Cache `node_modules` du staging

`Agent Remote Validate` lit la même clé exacte `seenit-node-modules-*` que la validation canonique de `main`, basée sur OS, architecture, version Node et empreinte des dépendances/scripts de matérialisation.

Le staging peut restaurer ce cache de confiance, mais ne l'alimente jamais. Seul le chemin de confiance de `main` sauvegarde un cache manquant. Cela permet de sauter `npm ci` sans permettre à une branche de quarantaine d'empoisonner le cache canonique.

## 4. Fail-fast du formatage minimal

Le contrôle `npm run format:check` fait partie du `--preflight`. Il utilise uniquement Node, Git et les fichiers du dépôt : aucune dépendance applicative n'est nécessaire.

Il doit donc échouer **avant** le devcontainer, la restauration/installation de `node_modules`, TypeScript, les tests et le build lorsqu'un diff contient une erreur triviale déjà détectable, notamment :

- espaces ou tabulations résiduels signalés par `git diff --check` ;
- absence de saut de ligne final sur un fichier source/configuration suivi par le formatteur minimal.

Le lint complet conserve son propre `format:check` plus tard dans le parcours. Cette répétition très peu coûteuse est volontaire : le préflight sert au fail-fast, le lint reste le garde canonique de défense en profondeur et continue de fonctionner indépendamment.

TNR terrain à conserver : l'échec du run `41217908650` / job `124586192577` sur la PR #829 provenait uniquement de `src/components/FilterModal.tsx: fin de ligne finale manquante`. Ce type d'erreur ne doit plus attendre le devcontainer puis TypeScript pour être remonté.

## 5. Candidate préparée par GitHub Actions, PR ouverte par le connecteur

Correction du 05/11/2026 (#85, PR #865) : le run candidat `42075664015` était vert,
mais GitHub refusait la fusion avec `Required status check Validate Change is expected`.
GitHub n'évalue pas les checks de jobs `workflow_dispatch` pour les rulesets de PR.
Source : https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks

Le contrôleur prépare toujours un commit avec les huit surfaces. Il n'ouvre plus de PR avec
`GITHUB_TOKEN` : il renvoie `connector_pr_required` au propriétaire connecté, qui ouvre la PR
une seule fois. Le workflow `pull_request` ne possède plus de filtre de chemins ; son vrai
check `Validate Change` doit réussir avant fusion. Aucun bypass, statut fabriqué ou commit
sans objet n'est autorisé. Une PR existante se réutilise, mais le dispatch seul ne suffit pas.
La preuve d'arbre permet ensuite de réutiliser la validation sur main, comme auparavant.

### Historique remplacé : filtre release-only (ne plus appliquer)

Le contrôleur #102 valide déjà chaque candidate `release/vX.Y.Z` avec un `workflow_dispatch` explicite de `build-apk.yml` sur le **SHA exact**, `release_apk=false`. Ce run produit le check GitHub Actions `Validate Change` requis par le ruleset `Protect main`.

Le déclencheur `pull_request` du même workflow ignore donc les huit surfaces canoniques de version. Une PR qui ne contient **que** ces fichiers ne crée plus le run PR redondant que GitHub plaçait en `action_required`/0 job pour `github-actions[bot]`. La candidate conserve son run explicite et son check requis ; aucune validation n'est supprimée.

La liste `paths-ignore` doit rester exactement synchronisée avec `RELEASE_VERSION_FILES` :

- `android/app/build.gradle` ;
- `src/store/updateStore.ts` ;
- `server.ts` ;
- `package.json` ;
- `package-lock.json` ;
- `docs/specifications/requirements.json` ;
- `docs/specifications/android-contract.json` ;
- `docs/specifications/seenit.md`.

La sémantique GitHub est volontairement fail-closed :

- un diff release-only canonique est validé par le dispatch explicite du contrôleur ;
- dès qu'un fichier métier, workflow, script, test ou autre fichier s'ajoute, `paths-ignore` ne couvre plus tout le diff et la CI `pull_request` normale se déclenche ;
- une PR manuelle qui ne modifie qu'une partie des surfaces de version n'obtient pas automatiquement de `Validate Change` : en l'absence du dispatch #102, la protection de `main` bloque sa fusion.

Preuve terrain à l'origine du garde : pour v1.4.242, la PR bot #833 a créé le run PR `41224969341` en échec avec **0 job**, alors que le dispatch candidat `41224967652` avait déjà un `Validate Change` vert sur le même SHA. La PR de reprise #834 ne doit plus être nécessaire pour ce motif.

## 6. Invariants non négociables

- `main` reste protégée : PR obligatoire, branche à jour et `Validate Change` requis ;
- une release manuelle conserve son contrat de release et ses contrôles propres ;
- une modification de l'infrastructure de validation force le parcours complet ;
- aucune preuve rouge, expirée, issue d'un fork ou d'un autre workflow n'est réutilisée ;
- les fallbacks vont toujours vers davantage de validation, jamais vers moins.

Référence : #85, implémentation initiale PR #818 ; orchestration release #102.
