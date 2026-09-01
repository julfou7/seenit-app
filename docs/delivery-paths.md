# Parcours de livraison SeenIt

La CI choisit automatiquement le niveau de validation à partir du diff. Le doute sélectionne toujours
le parcours APK complet ; aucun auteur ne peut forcer le parcours light.

## Parcours light

Il couvre uniquement les changements sans effet natif ou comportemental : documentation Markdown,
tests seuls, commentaires/formatage et textes d’interface reconnus par le classificateur. Une chaîne
non JSX doit avoir été préparée avec `uiCopy(...)`, exclusivement pour du texte visible.

La CI exécute toujours l’installation verrouillée des dépendances, le contrat de changement, la SPEC,
les tests automatisés, l’audit des dépendances de production et le build Web. Elle ne change pas la
version, ne synchronise pas Capacitor, ne lance ni Gradle ni émulateur et ne publie aucun APK. La PWA
peut recevoir le changement immédiatement ; l’APK l’intègre lors de la prochaine release complète.

## Parcours APK complet

Il s’applique à tout changement de code ou fichier ambigu, ainsi qu’aux sources natives, au serveur,
aux dépendances, à la configuration, aux URL, routes, identités, clés et valeurs logiques. Il peut aussi
être forcé manuellement.

Après le bump Android et `npm run version:sync`, la CI ajoute au socle commun la synchronisation
Capacitor, le contrat Android, la compilation Gradle, les mises à niveau réelles N → N+1 sur Android 12
et Android cible, puis la publication immuable de l’APK et de son SHA-256.

## Vérification locale

```powershell
npm run delivery:classify
npm test
npm run build
```

Si la classification annonce `APK COMPLET`, exécuter également :

```powershell
npx cap sync android
npm run test:android
```

La source de vérité normative reste `SEENIT-QUALITY-006` dans la SPEC vivante.
