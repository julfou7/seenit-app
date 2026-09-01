# Spécifications vivantes SeenIt

La source de vérité fonctionnelle et technique est [`seenit.md`](./seenit.md). Le fichier
[`requirements.json`](./requirements.json) relie chaque exigence non négociable à au moins
un test automatisé précis.
[`android-contract.json`](./android-contract.json) fige les invariants indispensables aux mises à
jour APK : identité, signature, icônes, version, permissions et configuration native.

## Cycle obligatoire pour toute évolution

1. Lire la SPEC avant de modifier le code et qualifier la demande dans
   [`../requests/registry.md`](../requests/registry.md) si elle introduit une règle durable.
2. Modifier ou ajouter l'exigence concernée dans `seenit.md`.
3. Mettre à jour `requirements.json` avec l'identifiant, les plateformes et le test associé.
4. Écrire le test avant ou en même temps que l'implémentation.
5. Exécuter `npm test`, puis le build PWA, la synchronisation Capacitor Android et de nouveau
   `npm run test:android` afin de détecter une mutation native générée.
6. Incrémenter la version SeenIt et livrer la PWA et l'APK ensemble.

Un audit suit en plus le protocole de [`../audits/README.md`](../audits/README.md) : rapport daté,
preuves reproductibles et matrice exhaustive vers des issues GitHub priorisées ou des risques
explicitement acceptés.

La CI refuse désormais une modification comportementale de `src/`, `server.ts`, du service
worker ou du code Android si la même livraison ne contient pas une mise à jour de la SPEC et
des tests. Les alignements de version purs, la documentation et la CI sont exemptés.

La CI ne répare jamais une version et ne pousse aucun commit. Le développeur incrémente
`versionName`, lance `npm run version:sync`, puis livre un arbre déjà cohérent. Une release APK
contient l'APK exact et son fichier SHA-256.

## Convention des exigences

- Format : `SEENIT-<DOMAINE>-<NUMÉRO>`.
- Une exigence décrit un résultat observable ou un invariant, jamais un détail provisoire.
- Un test référencé doit exister et son intitulé doit correspondre au catalogue.
- Les validations terrain impossibles à automatiser restent explicites dans la SPEC.
