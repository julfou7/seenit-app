# Workspace agent distant et quarantaine

Ce document complète `AGENTS.md` et matérialise `SEENIT-QUALITY-004` / l'issue #195 pour les environnements où le shell ne peut pas accéder à GitHub ou au registre npm.

## But

Le développement SeenIt ne doit pas dépendre du fait qu'un sandbox ChatGPT possède une sortie réseau. Un environnement sain conserve le chemin local normal. Un environnement réellement privé d'egress dispose d'un chemin distant borné qui valide exactement le même contrat avant toute branche de chantier ou livraison.

Ce mécanisme ne rend pas le sandbox persistant. Il évite en revanche de payer inutilement un nouveau clone, une nouvelle découverte de contexte ou un `npm ci` complet lorsque GitHub, Codespaces ou un workspace déjà matérialisé peuvent conserver l'état utile.

## Chemin local prioritaire

1. Vérifier `main` par l'API GitHub.
2. Réutiliser le workspace SeenIt existant lorsqu'il est propre et cohérent avec le SHA du chantier.
3. Dans le devcontainer canonique, `scripts/bootstrap-agent-workspace.cjs` calcule une empreinte à partir de Node, npm, `package.json`, `package-lock.json` et des scripts de postinstall. Le volume `node_modules` est réutilisé uniquement si cette empreinte et les modules sentinelles sont exacts.
4. Si l'empreinte change, lancer une seule installation canonique `npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund`, puis enregistrer la nouvelle empreinte.
5. Exécuter les tests ciblés pendant la mise au point puis `npm run validate:change` sur l'arbre exact avant le premier push vers la branche de chantier.

Le devcontainer épingle Node 22, npm 10.9.3 et actionlint 1.7.12. Les volumes nommés du devcontainer conservent `node_modules` et le cache npm entre reconstructions compatibles. GitHub Codespaces peut utiliser directement `.devcontainer/devcontainer.json`; un prebuild Codespaces est recommandé lorsque les réglages du dépôt le permettent, mais son absence ne change pas le contrat de validation.

## Détection d'un runtime sans egress

Le fallback distant est autorisé uniquement lorsque l'exécution locale nécessaire est impossible à cause du runtime lui-même : par exemple GitHub et/ou le registre npm sont injoignables et aucun workspace/cache exact ne permet d'exécuter `validate:change`.

L'absence seule de `gh`, d'un PAT shell ou d'un clone local n'est pas suffisante si le connecteur GitHub et un workspace sain permettent le chemin normal. Inversement, un refus réseau du sandbox n'est pas un blocage utilisateur tant que le connecteur GitHub et GitHub Actions permettent le chemin ci-dessous.

## Quarantaine `agent-staging/**`

1. Relire le bail de l'issue et le `main` courant immédiatement avant l'écriture.
2. Créer une branche `agent-staging/<issue>-<slug>` exactement depuis le SHA `main` retenu.
3. Matérialiser le changement par le connecteur/API GitHub uniquement sur cette branche. `agent-staging/**` est une **quarantaine technique**, pas une branche de chantier ou de livraison, et elle n'est jamais mergée directement dans `main`.
4. Le push de quarantaine déclenche `Agent Remote Validate`. Le workflow checkout explicitement `github.sha`, vérifie que `HEAD == github.sha`, récupère le `main` courant et calcule `git merge-base HEAD refs/remotes/origin/main`.
5. Ce merge-base devient `SEENIT_VALIDATE_BASE_SHA`. La validation exécute le préflight canonique, construit réellement le devcontainer, restaure ou installe les dépendances, puis exécute `npm run validate:change -- --postinstall`.
6. Un SHA rouge reste en quarantaine. Les logs servent à diagnostiquer ce SHA distant parce que le chemin local est matériellement indisponible ; ce fallback n'autorise pas à utiliser la CI comme debugger lorsque le chemin local fonctionne.
7. Un SHA vert peut être **promu sans réécriture** : créer la branche réelle du chantier en la faisant pointer vers le **même SHA exact**. Ne pas cherry-pick, squasher, amender ou reconstruire le commit entre la preuve distante et la promotion.
8. Ouvrir la PR de la branche de chantier vers `main`. La CI normale de PR reste obligatoire. Si `main` a avancé, cette CI recalcule le contrat contre la nouvelle base ; un conflit ou un nouveau rouge interdit le merge.
9. Après merge, vérifier le SHA de `main`, mettre l'issue à jour et supprimer/archiver la quarantaine selon les possibilités de l'outil. La branche de staging n'est jamais une preuve de livraison à elle seule.

## Sécurité et permissions

`Agent Remote Validate` possède uniquement `contents: read`. Il ne commit, ne pousse, ne crée pas de PR et ne modifie aucune issue. Les seules écritures Git sont réalisées explicitement par l'agent via le connecteur, sous le bail de l'issue.

La politique `scripts/validate-workflow-policy.cjs` borne le workflow à `agent-staging/**`, impose le checkout du SHA exact, le merge-base de `main`, les deux phases de `validate:change`, la construction du devcontainer et interdit les mutations Git directes en CI. `git merge-base` est explicitement autorisé ; `git merge`, `git commit` et `git push` restent interdits.

La protection serveur de `main` doit exiger une PR et le check canonique **Validate Change** avant fusion, sans push direct de l'agent. Cette protection GitHub complète la quarantaine : la CI de staging prouve l'arbre, la PR prouve son intégration au `main` courant.

## Reprise sans travail redondant

Une reprise identifiée repart du checkpoint de l'issue/PR et de la branche existante. Elle ne relance pas une recherche globale et ne recrée pas de workspace par principe. Ordre de préférence :

1. workspace local/devcontainer déjà sain ;
2. Codespace existant ou préconstruit ;
3. branche de chantier déjà validée ;
4. quarantaine `agent-staging/**` lorsqu'un runtime sans egress doit produire ou corriger un arbre ;
5. nouvelle acquisition minimale seulement si aucune surface précédente n'est exploitable.

Le critère n'est pas « un nouveau prompt » mais l'état réel du workspace, du lockfile, du SHA et des preuves déjà enregistrées.
