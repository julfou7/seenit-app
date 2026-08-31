# Instructions pour l'Assistant de Codage AI (AGENTS)

Vous devez suivre strictement ces règles lors de toutes vos interventions sur le projet **SeenIt** :

## 1. Langue de communication et de livraison
- **Langue de l'interface & de la discussion :** Toutes vos réponses et explications à l'utilisateur doivent être rédigées exclusivement en **français**.
- **Messages de Commit Git :** Tous vos messages de commit (titre et corps de commit) doivent être rédigés exclusivement en **français**.
- **Changelog & Release Notes :** Comme le script de génération de notes de version extrait le corps du dernier commit, le corps de votre message de commit doit être rédigé en français structuré sous forme de puces claires et lisibles pour l'utilisateur final.

## 2. Versioning & Git Automatisé
A chaque correctif ou fonctionnalité ajoutée :
- Incrémentez systématiquement la version dans `android/app/build.gradle` (`versionName` et `versionCode`).
- Exécutez `npm run version:sync` après le bump Android pour aligner `package.json`, la SPEC,
  le catalogue, le contrat Android, `CURRENT_APP_VERSION` et `X-Plex-Version`.
- Rédigez un message de commit propre au format Conventional Commits (`fix:`, `perf:`, `feat:`) incluant le détail des modifications sous forme de liste à puces **en français**.
- Effectuez le `git push` sur la branche principale (`main`) à la fin de chaque tâche pour déclencher automatiquement le build de l'APK sur GitHub Actions.
- La CI vérifie et publie ; elle ne corrige, ne commit et ne pousse jamais automatiquement `main`.
- Un rollback APK se livre avec un nouveau patch et un `versionCode` supérieur. Ne tentez jamais de
  republier un ancien numéro de version ou d'abaisser `versionCode`.

### Contrat APK immuable
- Ne supprimez, ne renommez et ne régénérez jamais silencieusement les icônes du lanceur.
- Ne modifiez jamais `applicationId` (`com.seenit.app`), le nom SeenIt, le deep link ou la clé
  `android/app/debug.keystore` sans plan de migration explicitement validé : Android considérerait
  l'application comme différente ou refuserait la mise à jour sur place.
- Toute modification Android doit mettre à jour `docs/specifications/android-contract.json` uniquement
  si le changement est intentionnel, documenté dans la SPEC et couvert par un test.
- Exécutez `npm run test:android` avant et après `npx cap sync android`. Ce contrôle protège l'icône,
  la signature, le package, les permissions, les safe areas, l'origine backend et le canal de build.
- L'APK publié reste le build `assembleDebug` signé avec la clé historique tant que la migration vers
  une signature de production n'a pas été conçue et testée sur une installation existante.

## 3. Compatibilité PWA et APK Android
- **Double cible obligatoire :** SeenIt doit rester pleinement fonctionnelle en PWA et dans l'APK Android. Toute modification doit prendre en compte et vérifier les deux environnements.
- **Comportements adaptés :** Ne présumez jamais qu'un fonctionnement Web garantit le même résultat dans Capacitor. Utilisez `Capacitor.isNativePlatform()` et les API natives lorsque le comportement Android doit différer.
- **Liens externes :** Dans la PWA, conservez un fallback Web fiable. Dans l'APK, privilégiez les deep links ou les applications Android installées quand cela améliore l'expérience.
- **Plex :** Les liens Plex doivent s'ouvrir dans l'application Plex Android depuis l'APK lorsque c'est possible, avec un fallback vers le site Plex dans la PWA.
- **Rapport de livraison :** Indiquez explicitement ce qui a été vérifié pour la PWA et pour l'APK, ainsi que toute différence de comportement volontaire.

## 4. Développement piloté par spécification (OBLIGATOIRE)
- **Lecture préalable :** Avant toute modification, lisez intégralement `docs/specifications/seenit.md` et `docs/specifications/README.md`.
- **SPEC avant code :** Toute modification comportementale doit mettre à jour la SPEC dans la même livraison, avec un identifiant `SEENIT-<DOMAINE>-<NUMÉRO>`.
- **Traçabilité :** Ajoutez ou actualisez l'entrée correspondante dans `docs/specifications/requirements.json`.
- **Tests obligatoires :** Toute modification comportementale doit ajouter ou adapter au moins un test automatisé précis, référencé par le catalogue.
- **Validation :** Exécutez `npm test`, `npm run build` et `npx cap sync android`. La CI `test:spec:changes` bloque le code applicatif livré sans SPEC et tests.
- **Validation APK :** Exécutez aussi `npm run test:android` après la synchronisation Capacitor.
- **Contexte durable :** Ne laissez jamais la SPEC décrire une ancienne version ou un comportement supprimé. Les audits datés sont historiques ; la SPEC est la source de vérité courante.

## 5. Backlog et autonomie contrôlée
- Les sujets différés vivent dans les issues GitHub avec priorité `[P0]`, `[P1]`, `[P2]` ou `[P3]`
  et domaine `[APK]`, `[PWA]`, `[Sécurité]`, `[Performance]`, `[UX]` ou `[Architecture]`.
- Un agent peut ouvrir une issue lorsqu'un audit révèle un risque réel et la résoudre sans nouvelle
  autorisation si la solution reste dans le périmètre SeenIt, n'efface aucune donnée et respecte SPEC/tests.
- Il est interdit de fermer une issue sans preuves : test automatisé, validation PWA/APK applicable,
  commit et lien de release. Les décisions nécessitant une migration de signature, de données ou une
  baisse de sécurité restent soumises à validation utilisateur.

## 6. Rapport de fin d'intervention (OBLIGATOIRE)
Après chaque modification, concluez TOUJOURS votre réponse par cette structure fixe :

---
### 🛠️ Ce qui a été fait
- Résumé clair des fichiers modifiés et des optimisations apportées.

### 📌 Impact & Mode de déploiement
- Précise si le fix est Web (instantané via Live Web View) ou Natif (nécessite la compilation du nouvel APK sur GitHub Actions).

### 🚀 Action requise de ton côté
- Indique l'action exacte à réaliser (ex : "Ferme et rouvre l'app", "Attends 2 à 3 min puis clique sur Installer la mise à jour").
