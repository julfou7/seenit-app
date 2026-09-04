# Spécifications vivantes SeenIt

La source de vérité fonctionnelle et technique est composée de [`seenit.md`](./seenit.md), qui porte
les invariants et machines d'états, et de la
[`référence fonctionnelle`](./functional-reference.md), qui décrit le produit écran par écran.
[`requirements.json`](./requirements.json) relie les exigences non négociables à des tests précis et
[`android-contract.json`](./android-contract.json) fige les invariants natifs indispensables.

La mécanique CI/CD, la classification `light/backend/apk`, la cadence de version et les déclencheurs
de release vivent désormais dans [`../process/delivery.md`](../process/delivery.md). Ce document de
processus prévaut sur les anciennes descriptions procédurales de la SPEC lorsqu'elles détaillent des
triggers ou des jobs de CI ; la SPEC reste autoritative pour le comportement produit et les invariants.

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

Chaque push/PR suit la validation rapide décrite dans `docs/process/delivery.md`. La publication APK
n'est plus automatique : les changements APK sont regroupés, la version est synchronisée une seule
fois quand le lot est prêt, puis la release est déclenchée manuellement.

Pour une demande explicite de **publication APK seule**, le fast path décrit dans `AGENTS.md` et
`docs/process/delivery.md` est l'orchestration canonique de `SEENIT-RELEASE-002` : `release:status`
retourne l'état et l'action suivante, `release:prepare` réutilise ou prépare atomiquement la candidate
par `version:sync`, puis `release:dispatch` constitue le fallback borné de `workflow_dispatch` quand
aucun outil GitHub direct n'est disponible. Cette accélération ne change aucun invariant de
`seenit.md` : signature, immuabilité, contrôles Android et smoke cible restent intégralement exécutés
par la release.

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
