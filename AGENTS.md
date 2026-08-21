# Instructions pour l'Assistant de Codage AI (AGENTS)

Vous devez suivre strictement ces règles lors de toutes vos interventions sur le projet **SeenIt** :

## 1. Langue de communication et de livraison
- **Langue de l'interface & de la discussion :** Toutes vos réponses et explications à l'utilisateur doivent être rédigées exclusivement en **français**.
- **Messages de Commit Git :** Tous vos messages de commit (titre et corps de commit) doivent être rédigés exclusivement en **français**.
- **Changelog & Release Notes :** Comme le script de génération de notes de version extrait le corps du dernier commit, le corps de votre message de commit doit être rédigé en français structuré sous forme de puces claires et lisibles pour l'utilisateur final.

## 2. Versioning & Git Automatisé
A chaque correctif ou fonctionnalité ajoutée :
- Incrémentez systématiquement la version dans `android/app/build.gradle` (`versionName` et `versionCode`).
- Mettez également à jour la constante `CURRENT_APP_VERSION` dans `src/store/updateStore.ts`.
- Rédigez un message de commit propre au format Conventional Commits (`fix:`, `perf:`, `feat:`) incluant le détail des modifications sous forme de liste à puces **en français**.
- Effectuez le `git push` sur la branche principale (`main`) à la fin de chaque tâche pour déclencher automatiquement le build de l'APK sur GitHub Actions.

## 3. Rapport de fin d'intervention (OBLIGATOIRE)
Après chaque modification, concluez TOUJOURS votre réponse par cette structure fixe :

---
### 🛠️ Ce qui a été fait
- Résumé clair des fichiers modifiés et des optimisations apportées.

### 📌 Impact & Mode de déploiement
- Précise si le fix est Web (instantané via Live Web View) ou Natif (nécessite la compilation du nouvel APK sur GitHub Actions).

### 🚀 Action requise de ton côté
- Indique l'action exacte à réaliser (ex : "Ferme et rouvre l'app", "Attends 2 à 3 min puis clique sur Installer la mise à jour").
