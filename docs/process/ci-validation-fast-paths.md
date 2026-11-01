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

## 5. Invariants non négociables

- `main` reste protégée : PR obligatoire, branche à jour et `Validate Change` requis ;
- une release manuelle conserve son contrat de release et ses contrôles propres ;
- une modification de l'infrastructure de validation force le parcours complet ;
- aucune preuve rouge, expirée, issue d'un fork ou d'un autre workflow n'est réutilisée ;
- les fallbacks vont toujours vers davantage de validation, jamais vers moins.

Référence : #85, implémentation initiale PR #818.
