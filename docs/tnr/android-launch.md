# TNR Android — lancement SeenIt

Ce TNR protège des régressions déjà observées sur appareil réel. Il est obligatoire pour toute modification du splash, de la status bar, des thèmes Android, de Capacitor ou du premier rendu WebView.

## Invariants bloquants

1. **Un seul splash brandé visible.** Le seul branding de lancement est l'animation Web `src/components/SplashScreen.tsx`. Le splash système Android 12+ reste neutre : fond `#040406`, icône transparente, aucune animation native distincte.
2. **Aucun flash intermédiaire.** Entre le launcher et le premier rendu Web, aucune surface blanche, noire vide ou logo statique SeenIt supplémentaire ne doit apparaître.
3. **Status bar lisible.** La status bar reste transparente/edge-to-edge avec heure, réseau, Wi-Fi et batterie clairs sur le fond sombre. Avec Capacitor, l'invariant est `DARK` / `Style.Dark`; `LIGHT` / `Style.Light` est une régression.
4. **Safe area stable.** Le contenu principal et l'écran de connexion gardent la compensation haute sans saut au handoff natif → Web.
5. **Handoff après paint.** `CapSplashScreen.hide()` intervient après le rendu du splash Web, pas avant.

## Contrôles automatisés

- `node --test tests/androidLaunchChrome.test.ts`
- `npm run test:android`
- `npm test`
- pipeline APK N → N+1 sur Android 31 et Android 36 avant publication.

Les tests doivent explicitement interdire le retour de `@drawable/seenit_splash_icon`, de `Style.Light` / `LIGHT`, d'une status bar opaque ou de la suppression du double `requestAnimationFrame` précédant le masquage du splash Capacitor.

## Validation terrain avant fermeture de l'issue

1. Installer N+1 **par-dessus** la dernière release N, sans désinstaller l'application.
2. Fermer complètement SeenIt puis réaliser un démarrage à froid depuis le launcher en enregistrant l'écran.
3. Vérifier la séquence : launcher → fond neutre éventuel très bref → **animation SeenIt**, sans logo SeenIt natif/statique distinct avant elle.
4. Vérifier l'absence de flash blanc ou noir vide entre les surfaces.
5. Vérifier dès la première image applicative que l'heure et les icônes système sont claires/blanches.
6. Vérifier qu'aucun décalage de safe area n'apparaît au début ou à la fin du splash.

## Historique de régression

- **v1.4.106 / PR #43** : suppression d'un flash de lancement et transparence de la status bar, mais introduction d'un pictogramme SeenIt dans le splash système Android, créant ensuite un double splash avec l'animation Web.
- **v1.4.107 / PR #44** : correction de la sémantique Capacitor de la status bar vers `Style.Dark` / `DARK` après apparition d'icônes système sombres sur le fond SeenIt.
- **Issue #42** : point de suivi durable de ces deux TNR de lancement.
