# Processus de livraison SeenIt

Statut : **source de vérité opérationnelle pour la CI/CD et les releases**.

Ce document décrit la mécanique de livraison. La SPEC produit conserve les invariants fonctionnels,
de sécurité, de données et d'identité ; elle ne doit plus recopier chaque détail de pipeline. En cas
de conflit entre une ancienne description procédurale de `docs/specifications/seenit.md` et ce fichier,
ce document prévaut pour les déclencheurs CI, la classification de livraison et la cadence des releases.

## Objectif

Un push doit prouver rapidement que le dépôt reste sain. Il ne doit pas être transformé automatiquement
en nouvelle release APK. Les releases Android sont des jalons explicites et regroupés.

## Trois classes de changement

### `light`

Aucun binaire Android n'est affecté. Cela couvre notamment :

- documentation et audits ;
- tests ;
- `.github/**` ;
- scripts de CI, validation ou gouvernance ;
- changements de texte d'interface reconnus comme pure copie.

La validation exécute les tests rapides et le build, sans bump Android, Gradle, émulateur ni release.

### `backend`

Le runtime serveur change, mais pas le bundle embarqué par Capacitor. `server.ts`,
`src/lib/firebase-admin.ts`, `src/features/runtime/**`, `src/backend/**` et `src/server/**` sont les
zones explicitement reconnues comme backend-only.

La validation exécute les tests et le build serveur/Web. Aucun bump APK ni smoke Android n'est requis
pour un changement exclusivement backend.

### `apk`

Tout changement du frontend embarqué, d'Android, de Capacitor, des dépendances ou d'une configuration
applicative reste `apk`. Le doute reste conservateur et choisit `apk`.

La classe `apk` signifie seulement « devra entrer dans la prochaine APK ». Elle ne signifie plus
« publier une APK sur ce push ».

## Validation continue

Chaque push ou pull request exécute, dans cet ordre :

1. configuration de Node sans installation applicative ;
2. préflight sans dépendances : intégrité du catalogue SPEC ;
3. restauration éventuelle d'un cache `node_modules` exact ;
4. sur cache absent seulement, `npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund` ;
5. rematérialisation systématique de la configuration Android canonique, y compris sur cache trouvé ;
6. classification `light` / `backend` / `apk` et contrat de changement ;
7. TypeScript puis tests unitaires dans deux étapes séparées ;
8. contrat Android uniquement si le diff touche l'APK ;
9. audit de dépendances lorsqu'il est applicable ;
10. build Web + serveur ;
11. résumé du mode, du cache et des durées principales.

L'intégrité SPEC est volontairement exécutée avant le cache et l'installation : son validateur utilise
uniquement Node et les fichiers du dépôt. Une erreur de catalogue, de version ou de référence de test
échoue ainsi avant tout coût npm. La classification sûre des changements de pure copie s'appuie en
revanche sur l'analyseur TypeScript. Elle s'exécute donc sans installation lorsque le cache exact est
trouvé ; lors du bootstrap exceptionnel d'un cache absent, l'installation déterministe précède ce
contrôle sans le supprimer ni l'assouplir.

Le cache `node_modules` est strictement exact. Sa clé comprend le système, l'architecture, la version
Node réellement résolue, `package.json`, `package-lock.json`, le patch des notifications locales et
le matérialiseur Android. Aucun préfixe de restauration approximatif n'est autorisé. Les PR peuvent
lire le cache de la branche par défaut selon les règles de portée GitHub Actions, mais ne le sauvegardent
jamais. Seul un push vert sur `main` ou `master` peut créer le cache de référence, après tous les
tests et le build. Le fichier `android/app/google-services.json` reste hors cache et est régénéré à
chaque validation depuis le contrat suivi.

Le cache npm de téléchargement de `actions/setup-node` reste actif comme secours d'une installation
froide. `npm audit` n'est jamais mélangé à `npm ci` : il conserve son étape conditionnelle et son
niveau bloquant existant.

Le job `Validate Change` possède un plafond dur de 10 minutes. Ce plafond n'est pas le budget nominal :
la cible reste une médiane maximale de 45 secondes et un p95 maximal de 90 secondes sur 20 validations
consécutives. Un cache froid après changement de lockfile peut dépasser cette cible ponctuellement ;
il doit être visible comme `miss` dans le résumé puis alimenter le cache de référence depuis
`main`. Une installation qui approche le plafond est traitée comme un incident d'infrastructure :
ne pas retirer de test, vérifier le statut GitHub/npm, relancer une seule fois sur le même commit et
ouvrir/actualiser une issue si la dérive se répète.

Le contrat Android exécuté en validation continue contrôle l'identité et le contrat de signature sans
exiger le fichier privé de keystore : les secrets de signature ne sont jamais exposés aux PR ni aux
pushes ordinaires. Si `android/app/seenit-release.p12` est présent localement, son empreinte est toutefois
vérifiée et toute divergence est bloquée.

`npm audit --omit=dev --audit-level=high` n'est exécuté que :

- lorsqu'un manifeste/lockfile de dépendances change ;
- lors d'une release APK manuelle ;
- lors du contrôle périodique hebdomadaire.

Un push sur `main` **ne publie jamais automatiquement une APK**.

### TNR du chemin rapide

Le test `tests/ciValidationPerformance.test.ts` bloque automatiquement toute régression de l'ordre
fail-fast, de la clé de cache exacte, de la confiance d'écriture, des options d'installation, de la
rematérialisation Android, de la séparation des contrôles, du résumé et du plafond. La preuve du SLO
est maintenue dans l'issue #84 à partir de 20 validations réelles consécutives ; elle n'est pas simulée
par des runs artificiels.

## Gouvernance proportionnée

Un changement comportemental doit rester couvert par un test automatisé ciblé.

La SPEC complète + `requirements.json` sont obligatoires lorsqu'une règle durable est créée/modifiée
ou quand le changement touche une zone sensible : sécurité/authentification, données/Firestore,
identité Plex/média, identité APK/Firebase Android, configuration native critique.

Une correction visuelle ordinaire ou un ajustement local sans nouvelle règle durable ne doit plus
produire artificiellement une nouvelle exigence, une entrée catalogue et plusieurs fichiers
administratifs. Le test ciblé et l'issue éventuelle suffisent.

Les décisions de processus sont tracées ici, dans les audits et les issues d'architecture plutôt que
d'être dupliquées dans chaque fiche produit.

## Fast path de correctif ciblé

Ce chemin s'applique à une issue existante dont la cause racine est confirmée et le périmètre borné.
Il ne s'applique pas à un audit global, une migration, une refonte transverse ou un désaccord entre la
SPEC et la décision produit.

1. Vérifier `main`, puis lire l'issue, ses commentaires, la carte fonctionnelle et uniquement les
   sections de SPEC, fichiers et tests utiles au changement. Les documents canoniques restent la
   connaissance complète consultable ; ils ne sont pas tous relus lorsqu'un index et une exigence
   identifient sans ambiguïté le périmètre.
2. Pour une règle durable ou une zone sensible, modifier SPEC et catalogue avant le code, dans le même
   workspace et la même livraison. Aucun commit ou push administratif intermédiaire n'est requis.
3. Développer avec les tests ciblés. Quand ils sont verts, exécuter une seule fois la validation complète
   applicable avant le premier push. Un échec local reproductible est corrigé localement ; la CI distante
   ne devient pas une boucle de mise au point.
4. Produire un commit cohérent et une PR ; un second commit est réservé à une correction réelle. Toute
   réécriture mécanique hors périmètre est retirée avant push. Le contrat de changement refuse notamment
   un churn massif de `requirements.json` disproportionné aux exigences réellement modifiées.
5. Si dix minutes ne produisent ni artefact concret ni blocage précis, publier un jalon sur l'issue et
   cibler le blocage avant de continuer.
6. Après merge, une publication déjà demandée reprend directement le fast path APK ci-dessous.

Ce raccourci porte sur l'orchestration de l'agent, pas sur les preuves : tests, protections de branche,
contrats Plex/identité/données/APK et validations terrain nécessaires restent inchangés.

## Fast path de publication APK

Lorsqu'une demande porte **uniquement** sur la publication d'une APK déjà décidée, le fast path de
`AGENTS.md` est prioritaire. Il remplace la reconstruction manuelle du contexte de release par trois
commandes bornées ; il ne remplace aucun contrôle de GitHub Actions.

### 1. Lire l'état canonique

```bash
npm run release:status -- --json
```

La commande récupère `origin/main` et expose dans un JSON stable :

- SHA et version du `main` canonique ;
- dernière release GitHub publiée ;
- prochaine version attendue ;
- branche/PR candidate éventuelle ;
- compatibilité de la candidate avec le `main` courant ;
- état agrégé des checks (`none`, `pending`, `green`, `failed`) ;
- action suivante exacte (`prepare`, `wait_checks`, `fix_checks`, `merge_then_dispatch`, `dispatch`…).

Une candidate existante est toujours réutilisée lorsqu'elle est compatible. Une candidate non basée
sur le `main` courant ou dont les checks échouent provoque une action de correction ciblée, jamais une
seconde branche parallèle. Le fast path n'effectue ni audit global, ni recherche fonctionnelle, ni
recherche Web/plugin.

### 2. Préparer la version si nécessaire

Depuis un workspace **propre**, sur la branche locale `main` exactement égale à `origin/main` :

```bash
npm run release:prepare -- 1.4.113
```

La commande :

1. vérifie que la version demandée est exactement la prochaine version attendue et qu'aucun tag/release
   identique n'existe ;
2. refuse un workspace sale ou un `HEAD` différent du `main` GitHub canonique ;
3. réutilise une branche/PR `release/vX.Y.Z` compatible si elle existe ;
4. sinon crée cette unique branche, modifie uniquement `android/app/build.gradle`, puis exécute
   `npm run version:sync` pour aligner toutes les surfaces canoniques ;
5. refuse tout fichier modifié hors de l'allowlist des surfaces de version ;
6. produit **exactement un commit** `chore: préparer la release APK X.Y.Z`, pousse la branche et ouvre
   une seule PR vers `main`.

Les surfaces autorisées sont celles synchronisées par `version:sync` : Gradle, `updateStore`, en-tête
Plex serveur, `package.json`, `package-lock.json`, catalogue SPEC, contrat Android et version de la SPEC.
Aucun écran, composant, store métier ou autre code fonctionnel ne peut être modifié par cette commande.
`requirements.json` reste dans son format canonique JSON à deux espaces avec fin de ligne terminale ;
la validation SPEC refuse une autre sérialisation. Les champs de version sont remplacés sans toucher
aux autres octets. Une candidate qui reformate massivement le catalogue est invalide.

### 3. Fusionner puis déclencher le workflow

Une fois les checks requis de la PR verts, fusionner selon les protections du dépôt puis relancer
`release:status`. L'état attendu est alors `dispatch`.

Une demande explicite « Publie l'APK », « Lance la release » ou équivalent vaut mandat opérationnel :
l'agent déclenche lui-même la release. Il ne se contente pas de fournir un bouton ou une commande à
exécuter par l'utilisateur. Après identification du run, il rend la main par défaut ; « publie et
attends le résultat » ajoute explicitement un suivi synchrone.

Pour créer le `workflow_dispatch`, l'ordre canonique est :

1. depuis une conversation disposant du connecteur GitHub, publier la commande exacte `/release-apk`
   sur l'issue #102 ; `SeenIt Release Control` applique les contrôles et crée le run nativement ;
2. **outil GitHub direct** de déclenchement de workflow s'il est réellement disponible dans la session,
   avec ref `main`, `release_apk=true` et `android12_smoke=false` par défaut ;
3. sinon fallback local borné :

```bash
npm run release:dispatch
```

Ce wrapper exécute l'équivalent canonique :

```bash
gh workflow run build-apk.yml --repo julfou7/seenit-app --ref main -f release_apk=true -f android12_smoke=false
```

4. si aucune des voies précédentes ne sait créer le run et que `gh` ou son authentification shell manque,
   utiliser l'**interface GitHub Actions via un navigateur authentifié contrôlable par l'agent** : ouvrir
   `Validate & Release SeenIt`, choisir exactement `main`, activer `release_apk`, laisser
   `android12_smoke=false` par défaut, puis déclencher le workflow.

L'absence de `gh`, de `GH_TOKEN` ou de `GITHUB_TOKEN` dans le shell n'est donc pas un blocage tant que
le navigateur GitHub authentifié est pilotable. L'agent ne renvoie pas l'utilisateur vers « un clic
manuel » avant d'avoir réellement épuisé les trois voies. Une intervention humaine n'est demandée que
pour un blocage concret d'accès, d'authentification ou d'autorisation.

Quelle que soit la voie, vérifier avant le dispatch qu'aucun run de release portant le même SHA/version
n'est déjà actif. Le wrapper vérifie d'abord que le workspace est propre et exactement sur `main`, puis
recherche pendant au plus 30 secondes le run `workflow_dispatch` portant le même SHA. Si le run n'est
pas retrouvé, il s'arrête sans relancer aveuglément. Dès que le run est identifié, l'agent publie son
lien et rend la main ; il n'enchaîne pas des attentes et polls rapprochés. Sur demande explicite de suivi,
les lectures sont espacées et ciblent uniquement ce run précis.

### 4. Mesure « demande → workflow »

Au début d'une demande release-only, l'agent conserve l'heure dans
`SEENIT_RELEASE_REQUEST_STARTED_AT` (ISO-8601 ou epoch). `release:dispatch` publie alors la durée
**demande → création du workflow** dans `RELEASE_DISPATCH_JSON`. Si un outil direct est utilisé, la
même mesure est calculée entre l'heure de la demande et le `created_at` du run. Cette métrique est
reportée dans l'issue/release concernée ; le temps d'attente des checks de PR n'est pas compté dans le
budget opérateur.

Le workflow de release publie séparément le temps actif du job regroupant contrôles, build et smoke
Android 36. Le passage build → smoke reste à zéro seconde de transition de runner. Le temps total du
run permet de distinguer la file GitHub précédant le job de publication du travail réellement exécuté.

Cibles : ≤ 2 minutes de travail opérateur avec candidate prête et verte ; ≤ 5 minutes hors attente CI
si la candidate doit être préparée.

## Préparation d'une release APK

Les changements `apk` peuvent s'accumuler sur `main` avec plusieurs commits. La version Android n'est
pas incrémentée à chaque commit.

Quand le lot est prêt, le chemin canonique est désormais :

1. lire `npm run release:status -- --json` ;
2. si nécessaire, préparer le prochain patch avec `npm run release:prepare -- X.Y.Z` ;
3. attendre la validation continue verte de l'unique PR de candidate ;
4. fusionner cette candidate ;
5. vérifier que les trois secrets de dépôt `SEENIT_ANDROID_RELEASE_KEYSTORE_B64`,
   `SEENIT_ANDROID_RELEASE_STORE_PASSWORD` et `SEENIT_ANDROID_RELEASE_KEY_PASSWORD` sont présents ;
6. sur demande explicite, laisser l'agent déclencher `Validate & Release SeenIt` avec
   `release_apk=true` depuis `main`, via l'outil GitHub direct, `release:dispatch` ou le navigateur
   GitHub authentifié ;
7. rendre la main dès que le run précis est identifié, sauf demande explicite de suivi synchrone ;
8. après création de la release, le job de publication émet un `repository_dispatch` dédié ; le workflow
   `Android APK Update Notification` attend la terminaison réussie du run source, puis transmet
   uniquement son identité publique au backend canonique. Celui-ci revalide GitHub et diffuse l'alerte
   FCM Android de manière idempotente, sans rendre l'état de la release dépendant de FCM ;
9. valider sur appareil Android réel la réception et l'ouverture de l'alerte lorsque ce parcours change.

Le déclenchement manuel de release ne relance pas d'abord le job de validation continue puis un second
job identique. Le job de candidate exécute lui-même, **une seule fois sur le même runner**, le contrat
de changement, SPEC, TypeScript, tests unitaires, contrat Android, garde d'immuabilité, audit de
dépendances, build Web, Gradle et smoke Android 36. Le contrôle reste complet, mais `npm ci`, le build Web,
la configuration Node/JDK et la transition vers un second runner ne sont plus payés deux fois pour le
chemin Android cible. Le smoke Android 12 optionnel reste un job séparé et démarre après ce chemin critique.

Avant les tests Android de release, la CI décode `SEENIT_ANDROID_RELEASE_KEYSTORE_B64` dans
`android/app/seenit-release.p12`, refuse un secret absent ou un Base64 invalide puis compare le SHA-256
aux octets verrouillés dans `docs/specifications/android-contract.json`. Le contrat exige également le
store PKCS12, l'alias `seenit`, les empreintes du certificat et la présence des deux mots de passe de
release. Le fichier généré est local au runner et n'est jamais commité. Une empreinte différente bloque
la release **avant Gradle**. Après `npx cap sync android`, le contrat Android est rejoué avec la présence
du keystore obligatoire.

Une candidate non publiée peut recevoir plusieurs commits correctifs sans consommer un nouveau numéro.
Une version déjà publiée reste immuable et exige un nouveau patch pour tout correctif ultérieur.

Le garde de release compare la candidate à la dernière release officielle publiée, pas au commit
immédiatement précédent. Ainsi, les commits intermédiaires d'un lot ne créent plus de faux échec de
version.

### Notes de version publiques

Un commit qui modifie l'expérience utilisateur sépare la synthèse publique des preuves internes :

```text
Changelog:
- La synchronisation Plex reste fiable lorsqu'un serveur est indisponible.

Détails techniques:
- Ignore le serveur en timeout et poursuit les autres collectes.
```

`Changelog: aucun` signale explicitement un commit sans effet visible. Le générateur privilégie cette
section, ignore les détails techniques et conserve un fallback pour les anciens commits. Le résultat
utilise un seul titre `### 🛠️ Ce qui a été fait`, avec des phrases françaises courtes, ponctuées et
orientées usage. Pour éviter de surcharger la fenêtre mobile, viser deux à cinq puces et regrouper les
changements liés ; les noms de fichiers, identifiants internes, tests, CI, commits, PR et issues restent
dans les preuves GitHub.

## Smokes Android

À chaque release :

- Android cible courant (API 36 actuellement) : **bloquant** ;
- Android 12 / API 31 : **optionnel manuel** via `android12_smoke=true` et utilisable comme contrôle
  périodique ou lors d'un changement Android à risque.

Depuis la release 1.4.112, la rotation est terminée et la baseline officielle porte la signature
release active. Le smoke compare package, versions et certificats réels puis exige que **N et N+1
portent exactement cette même signature**. Il installe N, pose les sentinelles de données/session,
installe N+1 sur place avec `adb install -r`, puis prouve la conservation des données/session, de
l'icône, des notifications, du launcher et du deep link. Toute divergence de signature et toute
réinstallation par désinstallation sont bloquantes.

Le smoke Android 36 privilégie la fiabilité à l'optimisation : chaque release recrée un AVD propre
(`force-avd-creation: true`) et ne réutilise aucun snapshot ou cache `~/.android/avd`. L'AVD API 36 est
plafonné explicitement à `2048M`, comme l'API 31 stable, afin de réduire la pression mémoire hôte sans
modifier les assertions du TNR. Les preuves du smoke archivent aussi `free`, les principaux RSS et la
fin de `dmesg` pour distinguer un kill QEMU sous pression d'un défaut applicatif. Le run de release
1.4.112 `33809261658` a validé ce parcours sur Android 36 et Android 12. L'API 36 reste bloquante et le
contrôle Retour n'est pas supprimé. Depuis #135, le build et ce smoke partagent le même runner à droits
de lecture ; seul le job de publication séparé conserve `contents: write`.

### Distribution hors Play et Play Protect

SeenIt reste distribuée directement par APK. Le dialogue Android « Analyse d'appli recommandée »
signifie que Play Protect ne connaît pas encore les octets de cette APK sideloadée ; il n'est pas un
état produit par SeenIt et ne peut pas être masqué par son code. Le parcours autorisé conserve la clé
release stable, le contrôle SHA-256 et les permissions minimales, puis laisse l'utilisateur demander
l'analyse système. Aucun workflow, manifeste ou écran SeenIt ne désactive ou ne contourne Play Protect.

Pour améliorer la reconnaissance sans publier sur le Play Store, le propriétaire peut enregistrer son
identité, `com.seenit.app` et le certificat release dans l'Android Developer Console pour la distribution
hors Play, puis soumettre une demande officielle seulement si Google classe à tort l'application comme
potentiellement dangereuse. Une simple demande d'analyse d'une application inconnue n'est pas une telle
classification et aucune disparition du dialogue ne doit être promise pour chaque nouvel APK.

## Gestion et récupération des clés de signature

`android/app/seenit-release.p12` est un **artefact généré**, pas une source Git. Les sources de confiance
de la signature active sont :

- le SHA-256 du PKCS12 et les empreintes SHA-1/SHA-256 du certificat verrouillés par le contrat Android ;
- le secret `SEENIT_ANDROID_RELEASE_KEYSTORE_B64`, qui fournit les octets au runner de release ;
- les secrets `SEENIT_ANDROID_RELEASE_STORE_PASSWORD` et `SEENIT_ANDROID_RELEASE_KEY_PASSWORD` ;
- une sauvegarde opérateur privée de la clé, conservée séparément de GitHub.

Après validation terrain de 1.4.112, la fenêtre de rollback historique a été explicitement fermée dans
#9 : l'ancien secret GitHub et l'ancienne empreinte/client OAuth Android Firebase ont été supprimés.
Ils ne font plus partie du contrat ni du processus de release.

## Protections qui restent non négociables

La simplification ne réduit pas les garde-fous sur :

- `applicationId=com.seenit.app` ;
- signature APK release active et stable ;
- icônes/launcher et deep link ;
- projet Firebase Android canonique et unique client OAuth Android actif ;
- Firestore `default` et sa Delete Protection ;
- absence de secrets dans les logs ;
- immuabilité d'une release publiée ;
- GitHub comme source canonique face à AI Studio.

## Principe de décision

Le but n'est plus de transformer chaque commit en release réglementée. Le pipeline doit répondre à
deux questions séparées :

1. **Le changement est-il sain ?** → validation à chaque push.
2. **Veut-on publier un nouveau binaire Android maintenant ?** → action manuelle explicite, une fois
   le lot prêt.
