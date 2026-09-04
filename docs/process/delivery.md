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
2. préflight sans dépendances : classification `light` / `backend` / `apk`, contrat de
   changement et intégrité du catalogue SPEC ;
3. restauration éventuelle d'un cache `node_modules` exact ;
4. sur cache absent seulement, `npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund` ;
5. rematérialisation systématique de la configuration Android canonique, y compris sur cache trouvé ;
6. TypeScript puis tests unitaires dans deux étapes séparées ;
7. contrat Android uniquement si le diff touche l'APK ;
8. audit de dépendances lorsqu'il est applicable ;
9. build Web + serveur ;
10. résumé du mode, du cache et des durées principales.

L'intégrité SPEC est volontairement exécutée avant l'installation : son validateur utilise uniquement
Node et les fichiers du dépôt. Une erreur de catalogue, de version ou de référence de test doit ainsi
échouer avant tout coût npm.

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

## Préparation d'une release APK

Les changements `apk` peuvent s'accumuler sur `main` avec plusieurs commits. La version Android n'est
pas incrémentée à chaque commit.

Quand le lot est prêt :

1. choisir le prochain patch SemVer ;
2. modifier `android/app/build.gradle` une seule fois ;
3. lancer `npm run version:sync` une seule fois pour aligner les surfaces de version ;
4. pousser cette candidate ;
5. attendre la validation continue verte ;
6. vérifier que les trois secrets de dépôt `SEENIT_ANDROID_RELEASE_KEYSTORE_B64`,
   `SEENIT_ANDROID_RELEASE_STORE_PASSWORD` et `SEENIT_ANDROID_RELEASE_KEY_PASSWORD` sont présents ;
7. déclencher manuellement `Validate & Release SeenIt` avec `release_apk=true` depuis `main`.

Le déclenchement manuel de release ne relance pas d'abord le job de validation continue puis un second
job identique. Le job de candidate exécute lui-même, **une seule fois sur le même runner**, le contrat
de changement, SPEC, TypeScript, tests unitaires, contrat Android, garde d'immuabilité, audit de
dépendances et build Web avant Gradle. Le contrôle reste complet, mais `npm ci` et le build Web ne sont
plus payés deux fois pour la même release.

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
contrôle Retour n'est pas supprimé.

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
