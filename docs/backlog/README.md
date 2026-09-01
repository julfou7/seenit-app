# Backlog d'ingénierie SeenIt

Les issues GitHub sont la source de vérité du travail restant. Le
[registre des audits](../audits/README.md) conserve les preuves, la SPEC définit le comportement
courant et une issue décrit le prochain incrément livrable.

## Convention

Titre : `[P1][APK] Verbe + résultat observable`.

- `P0` : sécurité ou perte de données active, traitement immédiat.
- `P1` : fiabilité APK, sécurité ou régression probable.
- `P2` : maintenabilité, performance, couverture et UX.
- `P3` : amélioration non urgente.

Chaque issue contient : contexte, risque utilisateur, périmètre, critères d'acceptation, exigences
SPEC concernées, source traçable, tests automatisés, validations PWA/APK et exclusions explicites.
Avant toute création, les issues ouvertes et fermées sont recherchées pour éviter un doublon.

## Autonomie de l'agent

Un agent peut ouvrir une issue à partir d'une preuve d'audit et résoudre une issue existante sans
nouvelle autorisation si le travail :

- reste dans SeenIt et ne contacte aucun tiers au nom de l'utilisateur ;
- ne supprime pas de données et ne modifie pas identité/signature APK sans plan validé ;
- met à jour SPEC, catalogue et tests ;
- conserve la compatibilité PWA/APK ;
- livre une version patch et attend la CI jusqu'à la release.

La fermeture nécessite le lien du commit/de la release et les preuves de tests. Une issue nécessitant
un choix de produit, une migration de données ou de signature reste ouverte avec le label décision.

## Backlog initial issu de l'audit global

- [#9 — migration de la signature APK](https://github.com/julfou7/seenit-app/issues/9)
- [#10 — récupération Firestore IndexedDB — livrée en 1.4.84](https://github.com/julfou7/seenit-app/issues/10)
- [#11 — allowlist administrateur pour les opérations Git](https://github.com/julfou7/seenit-app/issues/11)
- [#12 — clés TVDB/OMDb derrière le backend](https://github.com/julfou7/seenit-app/issues/12)
- [#13 — test de mise à jour APK sur place — livré en 1.4.91](https://github.com/julfou7/seenit-app/issues/13)
- [#14 — découpage des modules volumineux](https://github.com/julfou7/seenit-app/issues/14)
- [#15 — E2E, accessibilité et budgets de performance](https://github.com/julfou7/seenit-app/issues/15)
- [#16 — immuabilité des releases APK — livrée en 1.4.87](https://github.com/julfou7/seenit-app/issues/16)
- [#17 — assainissement du dépôt, des dépendances et de la configuration](https://github.com/julfou7/seenit-app/issues/17)
- [#18 — durcissement TypeScript, lint et formatage](https://github.com/julfou7/seenit-app/issues/18)
- [#19 — en-têtes HTTP et service worker](https://github.com/julfou7/seenit-app/issues/19)
