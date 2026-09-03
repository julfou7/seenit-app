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
exiger le fichier privé de keystore : le secret de signature n'est jamais exposé aux PR ni aux pushes
ordinaires. Si un fichier `android/app/debug.keystore` est présent localement, son empreinte est toutefois
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
6. vérifier que le secret de dépôt `SEENIT_ANDROID_KEYSTORE_B64` contient **exactement** le keystore
   historique SeenIt encodé en Base64 ;
7. déclencher manuellement `Validate & Release SeenIt` avec `release_apk=true` depuis `main`.

Le déclenchement manuel de release ne relance pas d'abord le job de validation continue puis un second
job identique. Le job de candidate exécute lui-même, **une seule fois sur le même runner**, le contrat
de changement, SPEC, TypeScript, tests unitaires, contrat Android, garde d'immuabilité, audit de
dépendances et build Web avant Gradle. Le contrôle reste complet, mais `npm ci` et le build Web ne sont
plus payés deux fois pour la même release.

Avant les tests Android de release, la CI décode `SEENIT_ANDROID_KEYSTORE_B64` dans
`android/app/debug.keystore`, refuse un secret absent ou un Base64 invalide puis compare le SHA-256 aux
octets historiques verrouillés dans `docs/specifications/android-contract.json`. Le fichier généré est
local au runner et n'est jamais commité. Une empreinte différente bloque la release **avant Gradle**.
Après `npx cap sync android`, le contrat Android est rejoué avec la présence du keystore obligatoire.

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

Le smoke N → N+1 conserve l'installation par-dessus la dernière release, la signature, les données,
le deep link, le launcher et les preuves archivées. L'externalisation du keystore n'est validée qu'une
fois ce smoke passé avec le **même certificat réel** entre N et N+1.

Pour éviter de payer un cold boot complet à chaque release, l'AVD Android 36 et son snapshot propre
sont mis en cache entre les runs. Le snapshot n'est généré qu'en cas de cache miss ; le smoke bloquant
réutilise ensuite cet AVD avec `force-avd-creation: false` et `-no-snapshot-save`. Cette optimisation ne
change ni la baseline N, ni l'APK N+1, ni les assertions du TNR : elle ne fait qu'éviter de recréer
l'environnement virtuel déjà validé.

## Gestion et récupération de la clé historique

`android/app/debug.keystore` est un **artefact généré**, pas une source Git. Les sources de confiance sont :

- l'empreinte SHA-256 publique verrouillée par le contrat Android ;
- le secret de dépôt `SEENIT_ANDROID_KEYSTORE_B64`, qui fournit les octets au runner de release ;
- une sauvegarde hors ligne opérateur des mêmes octets, conservée séparément de GitHub.

Cette externalisation ne constitue pas une rotation de sécurité : le keystore a existé dans l'historique
public du dépôt. Une future rotation doit suivre son propre plan Android, prouver la compatibilité avec
les installations existantes et ne peut jamais être introduite en remplaçant simplement le secret.

## Protections qui restent non négociables

La simplification ne réduit pas les garde-fous sur :

- `applicationId=com.seenit.app` ;
- signature APK historique ;
- icônes/launcher et deep link ;
- projet Firebase Android canonique ;
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
