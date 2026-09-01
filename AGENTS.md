# Instructions pour l'Assistant de Codage AI (AGENTS)

Vous devez suivre strictement ces règles lors de toutes vos interventions sur le projet **SeenIt**.

## 0. Première action obligatoire — avant toute analyse ou modification
- **Lisez ce fichier intégralement avant toute autre action sur le dépôt.** Ne commencez ni analyse, ni édition, ni synchronisation, ni proposition de commit avant cette lecture complète.
- Lisez ensuite intégralement `docs/specifications/seenit.md` et `docs/specifications/README.md` avant toute modification.
- Si l'environnement agent précharge `.agents/AGENTS.md`, ce fichier est uniquement un bootstrap : le présent `AGENTS.md` racine reste la source de vérité complète des règles de développement SeenIt.
- Un workspace importé ou synchronisé depuis AI Studio n'est **jamais** une source de vérité supérieure à GitHub. L'état de la branche GitHub de référence doit être vérifié avant d'accepter un diff généré automatiquement.
- Si un import/sync AI Studio ouvre le workspace avec des fichiers déjà modifiés sans demande utilisateur correspondante, **ne les commitez pas** : comparez-les à GitHub, restaurez l'état canonique et n'intégrez que les changements explicitement voulus.

## 1. Langue de communication et de livraison
- **Langue de l'interface & de la discussion :** Toutes vos réponses et explications à l'utilisateur doivent être rédigées exclusivement en **français**.
- **Messages de Commit Git :** Tous vos messages de commit (titre et corps de commit) doivent être rédigés exclusivement en **français**.
- **Changelog & Release Notes :** Le générateur de notes agrège tous les commits de la version depuis le dernier tag SemVer strictement antérieur. Chaque commit doit donc conserver un corps en français, structuré en puces claires et lisibles pour l'utilisateur final ; aucun dernier commit ne doit résumer ou écraser à lui seul le reste de la version.

## 2. Versioning & Git Automatisé
Avant toute livraison, laissez `npm run delivery:classify` qualifier le diff :
- Le parcours **light** est réservé automatiquement à la documentation, aux tests sans code livré,
  aux commentaires/formatages, aux textes de présentation JSX explicitement reconnus et aux littéraux
  non JSX déjà marqués par `uiCopy(...)`. Ce marqueur est interdit pour une URL, route, clé, identité
  ou valeur logique. Le parcours exécute les validations JavaScript et le build Web, mais ne modifie
  aucune version et ne publie aucun APK.
- Tout fichier natif, serveur, dépendance, configuration, changement comportemental ou diff ambigu
  utilise par défaut le parcours **APK complet**. Il est interdit de forcer le mode light ; seul le
  parcours APK peut être forcé manuellement.
- Pour chaque parcours APK complet, incrémentez la version dans `android/app/build.gradle`
  (`versionName` et `versionCode`), puis exécutez `npm run version:sync` pour aligner `package.json`,
  la SPEC, le catalogue, le contrat Android, `CURRENT_APP_VERSION` et `X-Plex-Version`.
- Un changement light est immédiatement disponible dans la PWA après son déploiement, mais reste
  volontairement absent de l'APK embarqué jusqu'à la prochaine release APK complète.
- Rédigez un message de commit propre au format Conventional Commits (`fix:`, `perf:`, `feat:`) incluant le détail des modifications sous forme de liste à puces **en français**.
- Effectuez le `git push` sur la branche principale (`main`) à la fin de chaque tâche : GitHub Actions
  valide toujours le changement, mais ne construit et ne publie l'APK que pour le parcours complet.
- La CI vérifie et publie ; elle ne corrige, ne commit et ne pousse jamais automatiquement `main`.
- Un rollback APK se livre avec un nouveau patch et un `versionCode` supérieur. Ne tentez jamais de
  republier un ancien numéro de version ou d'abaisser `versionCode`.
- Conservez la construction dans un job CI en lecture seule et la publication dans un job dépendant
  qui possède seul `contents: write`. Le garde d'immuabilité s'exécute avant le build et avant la
  publication ; ne le contournez jamais et n'autorisez jamais l'écrasement des assets d'une release.

### Import et synchronisation AI Studio — transport non autoritatif
- Un import, une reconnexion ou une synchronisation AI Studio/GitHub est **un mécanisme de transport**, jamais une migration ni une autorisation de « normaliser » le projet.
- Avant tout commit provenant d'un workspace nouvellement importé, comparez le diff au commit/à la branche GitHub source. Toute modification apparue uniquement à cause de l'import doit être rejetée tant qu'elle n'a pas été demandée et justifiée.
- AI Studio ne doit jamais modifier automatiquement Firebase/Firestore, `android/app/build.gradle`, `docs/specifications/android-contract.json`, la SPEC, `requirements.json`, les versions, les lockfiles, `server.ts`, les secrets ou la configuration Android sous prétexte d'adapter le workspace.
- Ne supprimez pas un fichier suivi par GitHub parce qu'AI Studio le considère obsolète. Une suppression doit répondre à une demande explicite, être comprise, spécifiée et testée.
- La branche GitHub officielle est la référence lors d'un conflit entre fichiers générés/importés et fichiers du dépôt. Une migration volontaire se traite comme un chantier séparé, jamais comme un effet secondaire de synchronisation.

### Contrat APK immuable
- Ne supprimez, ne renommez et ne régénérez jamais silencieusement les icônes du lanceur.
- Ne modifiez jamais `applicationId` (`com.seenit.app`), le nom SeenIt, le deep link ou la clé
  `android/app/debug.keystore` sans plan de migration explicitement validé : Android considérerait
  l'application comme différente ou refuserait la mise à jour sur place.
- Toute modification Android doit mettre à jour `docs/specifications/android-contract.json` uniquement
  si le changement est intentionnel, documenté dans la SPEC et couvert par un test.
- Exécutez `npm run test:android` avant et après `npx cap sync android`. Ce contrôle protège l'icône,
  la signature, le package, les permissions, les safe areas, l'origine backend et le canal de build.
- Ne contournez jamais le job `android_upgrade_smoke` : la publication attend l'installation réelle
  de N puis N+1 sans désinstallation sur Android 12 et Android cible, ainsi que ses preuves archivées.
- L'APK publié reste le build `assembleDebug` signé avec la clé historique tant que la migration vers
  une signature de production n'a pas été conçue et testée sur une installation existante.

### Contrat Firebase / Firestore immuable
- **Base Firestore canonique : `default`, exactement, sans parenthèses.** Le client PWA/APK et Firebase Admin doivent tous deux sélectionner explicitement cette base.
- N'utilisez jamais `(default)`, un `getFirestore()` implicite ni un identifiant de base personnalisé comme remplacement automatique de `default`.
- Le dépôt canonique ne doit déclarer **aucun** champ `firestoreDatabaseId` dans `firebase-applet-config.json`. Toute réinjection de ce champ par AI Studio est un diff non demandé à rejeter ; le databaseId SeenIt reste sélectionné explicitement dans le code.
- La base `default` doit conserver **Firestore Delete Protection activée**. Aucun import AI Studio, script ou agent ne peut la désactiver automatiquement ; toute désactivation exige une migration/suppression explicitement approuvée, avec sauvegarde et plan de rollback.
- Le projet Firebase canonique SeenIt est `gen-lang-client-0201895414`. Ne le remplacez jamais automatiquement à l'import, à la reconnexion ou lors d'une régénération de configuration.
- `android/app/google-services.json` est un fichier Android requis. Ne le supprimez, ne le remplacez et ne changez son `project_id`, son package `com.seenit.app` ou son `mobilesdk_app_id` sans migration Firebase Android explicitement approuvée et testée.
- Ne proposez jamais de changement de databaseId uniquement parce qu'une valeur différente apparaît dans un fichier généré par AI Studio. L'historique SeenIt a déjà démontré que ces bascules provoquent bibliothèque vide, client offline et synchronisation bloquée.
- Toute modification du projet Firebase, du databaseId ou de l'association Android Firebase est une **migration de données/identité** : elle nécessite validation utilisateur explicite, inventaire/backup des données, plan de migration, rollback et tests PWA + APK. Aucun agent ne peut la décider seul.

## 3. Compatibilité PWA et APK Android
- **Double cible obligatoire :** SeenIt doit rester pleinement fonctionnelle en PWA et dans l'APK Android. Toute modification doit prendre en compte et vérifier les deux environnements.
- **Comportements adaptés :** Ne présumez jamais qu'un fonctionnement Web garantit le même résultat dans Capacitor. Utilisez `Capacitor.isNativePlatform()` et les API natives lorsque le comportement Android doit différer.
- **Liens externes :** Dans la PWA, conservez un fallback Web fiable. Dans l'APK, privilégiez les deep links ou les applications Android installées quand cela améliore l'expérience.
- **Plex :** Les liens Plex doivent s'ouvrir dans l'application Plex Android depuis l'APK lorsque c'est possible, avec un fallback vers le site Plex dans la PWA.
- **Rapport de livraison :** Indiquez explicitement ce qui a été vérifié pour la PWA et pour l'APK, ainsi que toute différence de comportement volontaire.

## 4. Développement piloté par spécification (OBLIGATOIRE)
- **Lecture préalable :** Avant toute modification, lisez intégralement `docs/specifications/seenit.md` et `docs/specifications/README.md`.
- **Demande durable :** Comparez chaque règle produit, UX, sécurité, plateforme ou développement
  donnée par l'utilisateur à la SPEC. Si elle est absente ou différente, inscrivez-la dans la SPEC,
  le catalogue et `docs/requests/registry.md` avant ou avec l'implémentation. Une question ponctuelle,
  une demande de statut ou un log de diagnostic ne devient pas une exigence durable.
- **SPEC avant code :** Toute modification comportementale doit mettre à jour la SPEC dans la même livraison, avec un identifiant `SEENIT-<DOMAINE>-<NUMÉRO>`. Une correction de texte strictement présentational classée light ne crée pas artificiellement une nouvelle exigence.
- **Traçabilité :** Ajoutez ou actualisez l'entrée correspondante dans `docs/specifications/requirements.json`.
- **Tests obligatoires :** Toute modification comportementale doit ajouter ou adapter au moins un test automatisé précis, référencé par le catalogue.
- **Validation :** Exécutez toujours `npm test` et `npm run build`. La CI `test:spec:changes` bloque le code applicatif livré sans SPEC et tests, sauf diff light revérifié automatiquement.
- **Validation APK :** Pour le parcours APK complet, exécutez aussi `npx cap sync android` puis `npm run test:android`. Ces étapes sont volontairement omises du parcours light.
- **Contexte durable :** Ne laissez jamais la SPEC décrire une ancienne version ou un comportement supprimé. Les audits datés sont historiques ; la SPEC est la source de vérité courante.

## 5. Backlog et autonomie contrôlée
- Tout audit doit être enregistré dans `docs/audits/`, indexé dans `docs/audits/README.md` et préciser
  sa date, la version et le commit audités, le périmètre, les preuves et la décision pour chaque constat.
- Chaque constat ouvert d'un audit doit être relié à une issue GitHub priorisée, ou marqué comme risque
  explicitement accepté avec sa justification. Un audit sans cette matrice n'est pas terminé.
- Les sujets différés vivent dans les issues GitHub avec priorité `[P0]`, `[P1]`, `[P2]` ou `[P3]`
  et domaine `[APK]`, `[PWA]`, `[Sécurité]`, `[Performance]`, `[UX]` ou `[Architecture]`.
- Un agent peut ouvrir une issue lorsqu'un audit révèle un risque réel et la résoudre sans nouvelle
  autorisation si la solution reste dans le périmètre SeenIt, n'efface aucune donnée et respecte SPEC/tests.
- **Suivi continu des issues :** dès qu'une intervention est reliée à une issue, maintenez son corps
  à jour pendant toute l'exécution et pas uniquement au moment de la résolution. Après chaque jalon
  prouvé (implémentation, tests, intégration sur `main`, CI, release ou blocage), actualisez l'état,
  les commits/runs concernés et la prochaine étape utile.
- Cochez chaque checkbox d'un critère d'acceptation dès que ce critère est réellement prouvé, jamais
  par anticipation. Si une information du corps devient obsolète, remplacez-la afin que l'issue reste
  la source de vérité opérationnelle ; utilisez les commentaires pour conserver les preuves ou jalons
  chronologiques sans laisser deux états contradictoires dans le corps.
- Il est interdit de fermer une issue sans preuves : test automatisé, validation PWA/APK applicable,
  commit et lien de release. Les décisions nécessitant une migration de signature, de données ou une
  baisse de sécurité restent soumises à validation utilisateur.

## 6. Rapport de fin d'intervention (OBLIGATOIRE)
Après chaque modification, concluez TOUJOURS votre réponse par cette structure fixe :

---
### 🛠️ Ce qui a été fait
- Résumé clair des fichiers modifiés et des optimisations apportées.

### 📌 Impact & Mode de déploiement
- Précise si le fix suit le parcours light Web, le parcours APK complet, ou si le rendu APK attend volontairement la prochaine release groupée.

### 🚀 Action requise de ton côté
- Indique l'action exacte à réaliser (ex : "Ferme et rouvre l'app", "Attends 2 à 3 min puis clique sur Installer la mise à jour").
