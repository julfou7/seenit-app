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

Chaque push ou pull request exécute :

1. installation avec cache npm ;
2. classification `light` / `backend` / `apk` ;
3. contrat de changement ;
4. SPEC, TypeScript et tests unitaires ;
5. contrat Android uniquement si le diff touche l'APK ;
6. build Web + serveur.

Le contrat Android exécuté en validation continue contrôle l'identité et le contrat de signature sans
exiger le fichier privé de keystore : les secrets de signature ne sont jamais exposés aux PR ni aux
pushes ordinaires. Si `android/app/seenit-release.p12` est présent localement, son empreinte est toutefois
vérifiée et toute divergence est bloquée.

`npm audit --omit=dev --audit-level=high` n'est exécuté que :

- lorsqu'un manifeste/lockfile de dépendances change ;
- lors d'une release APK manuelle ;
- lors du contrôle périodique hebdomadaire.

Un push sur `main` **ne publie jamais automatiquement une APK**.

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

Le smoke compare toujours le package, les versions et les certificats réels. Son comportement dépend
uniquement de la baseline officielle :

- si N et N+1 portent la nouvelle signature release, le smoke N → N+1 reste strictement inchangé :
  installation sur place avec `adb install -r`, conservation des données/session, icône, notifications,
  launcher et deep link ;
- si N porte exactement l'ancienne empreinte historique et N+1 exactement la nouvelle empreinte
  verrouillée, la seule migration autorisée est une désinstallation contrôlée de N puis une installation
  fraîche de N+1. Ce smoke valide le package, la nouvelle signature, l'installation, l'icône, les
  permissions, le launcher, le deep link et le cycle de vie, mais n'exige pas la conservation du stockage
  local puisqu'Android le supprime volontairement à la désinstallation ;
- tout autre changement de signature bloque la publication.

Dès qu'une release officielle avec la nouvelle signature existe, la branche de migration n'est plus
éligible et toutes les releases suivantes doivent repasser par la mise à jour sur place normale.

Le smoke Android 36 privilégie la fiabilité à l'optimisation : chaque release recrée un AVD propre
(`force-avd-creation: true`) et ne réutilise aucun snapshot ou cache `~/.android/avd`. Le run de release
1.4.112 `33806746182` a confirmé que le cache n'était pas la cause racine : l'AVD neuf a validé la
rotation, l'installation fraîche, les contrats natifs, le cold start, la reprise et le deep link avant
de disparaître au contrôle Retour. L'AVD API 36 est donc plafonné explicitement à `2048M`, comme l'API
31 stable, afin de réduire la pression mémoire hôte sans modifier les assertions du TNR. Les preuves du
smoke archivent aussi `free`, les principaux RSS et la fin de `dmesg` pour distinguer un kill QEMU sous
pression d'un défaut applicatif. L'API 36 reste bloquante et le contrôle Retour n'est pas supprimé.

## Gestion et récupération des clés de signature

`android/app/seenit-release.p12` est un **artefact généré**, pas une source Git. Les sources de confiance
de la nouvelle signature sont :

- le SHA-256 du PKCS12 et les empreintes SHA-1/SHA-256 du certificat verrouillés par le contrat Android ;
- le secret `SEENIT_ANDROID_RELEASE_KEYSTORE_B64`, qui fournit les octets au runner de release ;
- les secrets `SEENIT_ANDROID_RELEASE_STORE_PASSWORD` et `SEENIT_ANDROID_RELEASE_KEY_PASSWORD` ;
- une sauvegarde opérateur privée de la clé, conservée séparément de GitHub.

Le keystore historique externalisé lors de la phase précédente reste temporairement conservé comme
rollback de l'ancien canal, avec son ancien client OAuth Firebase. Il ne signe plus les nouvelles
releases. Une fois la première APK nouvelle signature validée sur l'appareil et la stratégie de rollback
jugée suffisante, son secret historique pourra être archivé/supprimé dans un jalon séparé explicitement
tracé dans #9.

## Protections qui restent non négociables

La simplification ne réduit pas les garde-fous sur :

- `applicationId=com.seenit.app` ;
- nouvelle signature APK release après la migration approuvée ;
- icônes/launcher et deep link ;
- projet Firebase Android canonique et double client OAuth temporaire de migration ;
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
