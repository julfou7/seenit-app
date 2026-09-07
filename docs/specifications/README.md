# Spécifications vivantes SeenIt

Pour toute interface ou geste, la [référence UX](./ux-reference.md) précise les comportements observés,
les conventions et les cibles de normalisation encore ouvertes. Elle complète les invariants de la
SPEC sans annoncer comme corrigé un écart uniquement documenté.

La source de vérité fonctionnelle et technique est composée de [`seenit.md`](./seenit.md), qui porte
les invariants et machines d'états, et de la
[`référence fonctionnelle`](./functional-reference.md), qui décrit le produit écran par écran.
[`requirements.json`](./requirements.json) relie les exigences non négociables à des tests précis et
[`android-contract.json`](./android-contract.json) fige les invariants natifs indispensables.
Pour `SEENIT-RELEASE-005`, [`release-control.md`](./release-control.md) précise le contrat exécutable du
déclencheur GitHub natif utilisable depuis une conversation ne disposant que du connecteur GitHub.

La mécanique CI/CD, la classification `light/backend/apk`, la cadence de version et les déclencheurs
de release vivent désormais dans [`../process/delivery.md`](../process/delivery.md). Ce document de
processus prévaut sur les anciennes descriptions procédurales de la SPEC lorsqu'elles détaillent des
triggers ou des jobs de CI ; `release-control.md` complète cette mécanique pour le déclencheur
`issue_comment` natif, tandis que la SPEC reste autoritative pour le comportement produit et les invariants.

## Qualifier la demande avant de modifier

1. Lire la SPEC et la référence fonctionnelle intégralement.
2. **Qualifier la demande** : règle durable/zone sensible, ou correction locale ordinaire.
3. Toute règle durable produit/UX structurante/sécurité/données/identité/plateforme est inscrite dans
   [`../requests/registry.md`](../requests/registry.md).

## Quand la SPEC complète est obligatoire

Mettre à jour `seenit.md` + `requirements.json` + un test référencé lorsque le changement :

- crée ou modifie une règle durable ;
- touche sécurité/authentification ;
- touche données/Firestore ;
- touche identité média/Plex ;
- touche identité APK/Firebase Android ou configuration native critique ;
- modifie un invariant existant.

Le contrat `npm run test:spec:changes` protège ces zones.

## Quand un test ciblé suffit

Une petite correction visuelle, un bug local, un changement backend non sensible ou un ajustement qui
ne crée aucune nouvelle règle durable ne doit plus générer artificiellement une nouvelle exigence.
Le changement comportemental reste couvert par un test automatisé précis. Une pure modification de
copie reconnue `light` peut être exemptée de nouveau test.

## Validation et release

Une issue dont la cause racine et le périmètre sont déjà établis peut suivre le fast path de correctif
ciblé défini par `SEENIT-QUALITY-009` et `docs/process/delivery.md` : la carte produit et les sections
directement concernées suffisent à l'intervention, SPEC/tests/code restent un seul changement cohérent,
les tests ciblés précèdent une unique validation complète et le catalogue n'est jamais reformaté en masse.
Ce chemin n'exempte aucune preuve sensible ou terrain.

Chaque push/PR suit la validation rapide décrite dans `docs/process/delivery.md`. La publication APK
n'est plus automatique : les changements APK sont regroupés, la version est synchronisée une seule
fois quand le lot est prêt, puis la release est déclenchée explicitement.

Pour une demande explicite de **publication APK seule**, le fast path décrit dans `AGENTS.md` et
`docs/process/delivery.md` reste l'orchestration canonique. Une conversation disposant seulement du
connecteur GitHub n'a toutefois plus besoin de `workflow_dispatch` direct, de `gh` ou d'un navigateur :
elle publie la commande exacte `/release-apk` sur #102, ou `/release-apk android12_smoke=true` lorsqu'un
smoke Android 12 est requis. `SeenIt Release Control` applique le contrat de
[`release-control.md`](./release-control.md), puis déclenche nativement `Validate & Release SeenIt`
après vérification de l'auteur, de `main`, de la version attendue, de l'immuabilité et de l'anti-doublon.

La génération atomique des huit surfaces est elle aussi indépendante de GitHub CLI via
`npm run release:prepare:files -- X.Y.Z`. `release:prepare` peut continuer à assurer l'orchestration
distante historique, mais la production cohérente des fichiers de version n'en dépend plus.

Le contrat Android complet (`npm run test:android` → `npx cap sync android` → `npm run test:android`)
et Gradle s'exécutent lors de la release APK. Android cible reste le smoke bloquant ; Android 12 est
un TNR optionnel/manual ou périodique.

## Audits et incidents

Un audit suit en plus le **protocole de** [`../audits/README.md`](../audits/README.md) : rapport daté,
preuves reproductibles et matrice exhaustive vers des issues GitHub priorisées ou des risques
explicitement acceptés.

Un audit fonctionnel met à jour `functional-reference.md`. Un écart code/SPEC est relié à une issue ;
il n'est jamais transformé silencieusement en comportement voulu pour faire disparaître le constat.

Un import/sync AI Studio n'est jamais une migration implicite. GitHub reste canonique ; Firestore reste
`default` et l'identité Firebase Android reste celle du contrat jusqu'à migration explicitement validée.

## Convention des exigences

- Format : `SEENIT-<DOMAINE>-<NUMÉRO>`.
- Une exigence décrit un résultat observable ou un invariant durable, pas un détail temporaire de CI.
- Un test référencé existe réellement et son intitulé correspond au catalogue.
- Les validations terrain impossibles à automatiser restent explicites dans la SPEC ou un runbook/TNR.
