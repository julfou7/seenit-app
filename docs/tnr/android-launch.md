# TNR Android — lancement SeenIt

Ce TNR protège des régressions déjà observées sur appareil réel. Il est obligatoire pour toute modification du splash, de la status bar, des thèmes Android, de Capacitor ou du premier rendu WebView.

## Invariants bloquants

1. **Un seul splash brandé visible.** Le seul branding de lancement est l'animation Web `src/components/SplashScreen.tsx`. Le splash système Android 12+ reste neutre : fond `#040406`, icône transparente, aucune animation native distincte.
2. **Aucun flash intermédiaire.** Entre le launcher et le premier rendu Web, aucune surface blanche, noire vide ou logo statique SeenIt supplémentaire ne doit apparaître.
3. **Status bar réellement edge-to-edge.** La status bar reste transparente avec heure, réseau, Wi-Fi et batterie clairs sur le contenu SeenIt. Sur Android 15/16, le contrat repose sur l'edge-to-edge natif `WindowCompat.setDecorFitsSystemWindows(..., false)` et sur le `SystemBars` intégré à Capacitor 8 configuré avec `insetsHandling: 'disable'` et `style: 'DARK'`. Le plugin historique `@capacitor/status-bar` reste un garde de compatibilité pour les versions Android plus anciennes ; `setOverlaysWebView()` seul n'est jamais une preuve suffisante sur Android récent.
4. **Aucun padding natif de la WebView.** Capacitor `SystemBars` ne doit pas convertir l'inset supérieur en padding du parent WebView, car cela révèle le fond de fenêtre `#040406` sous la status bar et recrée une bande sombre. SeenIt récupère directement les insets système/cutout en natif et les expose via `--seenit-safe-area-*` ; les utilitaires CSS utilisent ces variables avec `env(safe-area-inset-*)` en fallback.
5. **Safe area stable.** Le contenu principal et l'écran de connexion gardent la compensation haute sans saut au handoff natif → Web, et la navigation basse conserve sa compensation inférieure.
6. **Handoff après paint.** `CapSplashScreen.hide()` intervient après le rendu du splash Web, pas avant.

## Contrôles automatisés

- `node --test tests/androidLaunchChrome.test.ts`
- `npm run test:android`
- `npm test`
- à la release : smoke d'upgrade bloquant sur Android 36 ; le smoke Android 12 reste optionnel/manual mais est recommandé pour toute modification native à risque.

Le TNR doit explicitement interdire le retour de `@drawable/seenit_splash_icon`, de `Style.Light` / `LIGHT`, d'une status bar opaque, de `SystemBars.insetsHandling='css'` pour le shell SeenIt, de la suppression de l'edge-to-edge natif ou du double `requestAnimationFrame` précédant le masquage du splash Capacitor. Il doit aussi vérifier que les safe areas restent appliquées sans padding natif de la WebView.

## Validation terrain avant fermeture de l'issue

1. Installer N+1 **par-dessus** la dernière release N, sans désinstaller l'application.
2. Fermer complètement SeenIt puis réaliser un démarrage à froid depuis le launcher en enregistrant l'écran.
3. Vérifier la séquence : launcher → fond neutre éventuel très bref → **animation SeenIt**, sans logo SeenIt natif/statique distinct avant elle.
4. Vérifier l'absence de flash blanc ou noir vide entre les surfaces.
5. Vérifier dès la première image applicative que l'heure et les icônes système sont claires/blanches et que le contenu SeenIt se prolonge visuellement derrière la status bar, sans bande `#040406` séparée.
6. Vérifier qu'aucun décalage de safe area n'apparaît au début ou à la fin du splash, dans Explorer et sur la navigation basse.

## Historique de régression

- **v1.4.106 / PR #43** : suppression d'un flash de lancement et transparence de la status bar, mais introduction d'un pictogramme SeenIt dans le splash système Android, créant ensuite un double splash avec l'animation Web.
- **v1.4.107 / PR #44** : correction de la sémantique Capacitor de la status bar vers `Style.Dark` / `DARK` après apparition d'icônes système sombres sur le fond SeenIt.
- **13/09/2026 / issue #42** : une nouvelle preuve terrain a montré le retour d'une bande sombre en haut de l'APK alors que le TNR était vert. La cause est un contrat incomplet : le test ne verrouillait que l'ancien plugin StatusBar et ignorait le gestionnaire `SystemBars` de Capacitor 8, capable d'ajouter un padding supérieur à la WebView sur Android récent selon la version WebView. Le TNR couvre désormais les deux couches et l'absence de padding natif.
- **Issue #42** : point de suivi durable de ces TNR de lancement et de la validation terrain après publication.
