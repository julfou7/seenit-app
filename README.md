# SeenIt

SeenIt est une application personnelle de suivi de films et séries livrée en PWA et en APK Android via Capacitor.

## Prérequis

- Node.js 22 à 24
- npm 10 (gestionnaire de paquets canonique)
- Java 21 et Android SDK uniquement pour les builds/tests Android

## Installation et développement

```bash
npm ci
cp .env.example .env
npm run dev
```

Les secrets réels restent hors Git. Consulte `.env.example` pour le contrat d'environnement serveur/client attendu.

## Vérifications

```bash
npm test
npm run build
```

Le test global vérifie la SPEC, le contrat Android, TypeScript et les tests unitaires. Avant toute livraison, le diff doit également être classé avec `npm run delivery:classify`.

## PWA

```bash
npm run build
npm run preview
```

Le build Web est produit dans `dist/`. En production, le backend compilé est `dist/server.cjs`.

## APK Android

Pour vérifier localement un changement classé `apk` sans consommer de version :

```bash
npm test
npm run build
npx cap sync android
npm run test:android
```

Le bump via `npm run version:sync`, Gradle et les smokes N → N+1 appartiennent à la préparation de la
release APK groupée décrite par le processus canonique. Sous Windows, utilise `gradlew.bat` à la place
de `./gradlew` lorsque Gradle est explicitement requis.

## Release

Le processus n'est pas dupliqué ici. Les sources de vérité sont :

- [`AGENTS.md`](./AGENTS.md) pour les règles obligatoires de l'agent ;
- [`docs/specifications/seenit.md`](./docs/specifications/seenit.md) pour les invariants ;
- [`docs/specifications/functional-reference.md`](./docs/specifications/functional-reference.md) pour la
  **référence fonctionnelle** écran par écran ;
- [`docs/process/delivery.md`](./docs/process/delivery.md) pour les parcours `light`, `backend`, `apk`
  et la release APK groupée.

Un push valide le changement mais ne publie jamais automatiquement une APK. La version Android est
incrémentée une seule fois lorsque le lot APK est prêt, puis la release est déclenchée manuellement.

