# Spécifications vivantes SeenIt

La source de vérité fonctionnelle et technique est [`seenit.md`](./seenit.md). Le fichier
[`requirements.json`](./requirements.json) relie chaque exigence non négociable à au moins
un test automatisé précis.

## Cycle obligatoire pour toute évolution

1. Lire la SPEC avant de modifier le code.
2. Modifier ou ajouter l'exigence concernée dans `seenit.md`.
3. Mettre à jour `requirements.json` avec l'identifiant, les plateformes et le test associé.
4. Écrire le test avant ou en même temps que l'implémentation.
5. Exécuter `npm test`, puis le build PWA et la synchronisation Capacitor Android.
6. Incrémenter la version SeenIt et livrer la PWA et l'APK ensemble.

La CI refuse désormais une modification comportementale de `src/`, `server.ts`, du service
worker ou du code Android si la même livraison ne contient pas une mise à jour de la SPEC et
des tests. Les alignements de version purs, la documentation et la CI sont exemptés.

## Convention des exigences

- Format : `SEENIT-<DOMAINE>-<NUMÉRO>`.
- Une exigence décrit un résultat observable ou un invariant, jamais un détail provisoire.
- Un test référencé doit exister et son intitulé doit correspondre au catalogue.
- Les validations terrain impossibles à automatiser restent explicites dans la SPEC.
