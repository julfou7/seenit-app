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

Pour une livraison classée `apk` :

```bash
npm run version:sync
npm test
npm run build
npx cap sync android
npm run test:android
cd android
./gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest
```

Sous Windows, utilise `gradlew.bat` à la place de `./gradlew`.

## Release

La source de vérité du processus de livraison est `AGENTS.md` avec la SPEC `docs/specifications/seenit.md`. Une livraison comportementale suit le pipeline complet : SPEC + tests, bump SemVer, synchronisation des versions, validations PWA/Android, commit Conventional Commits en français, push sur `main`, CI, smoke N→N+1 Android 31/36 puis release GitHub immuable.

Les changements reconnus automatiquement comme `light` n'entraînent pas de nouvelle release APK ; ils doivent tout de même passer `npm test`, l'audit des dépendances de production et `npm run build`.
