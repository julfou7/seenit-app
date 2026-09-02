# Audit du processus de livraison SeenIt — 2 septembre 2026

**Identifiant :** `AUDIT-2026-09-02-DELIVERY-PROCESS`  
**Date :** 2026-09-02  
**Baseline observée :** SeenIt 1.4.107  
**Commit audité :** `f18c5adce5aeb701812e042696b6595ba6c5021a`  
**Périmètre :** GitHub Actions, classification de livraison, versionnement, SPEC/processus, Gradle,
smokes Android, cadence de release et interactions AI Studio/GitHub.  
**Statut :** décision appliquée dans la branche de correction 1.4.108 ; validation CI/merge à confirmer.

## Conclusion

Le projet n'est pas devenu instable en lui-même. Le problème principal est le couplage excessif entre
**chaque push**, **la gouvernance**, **le build Android** et **la publication d'une release**. Les garde-fous
ont réduit certains risques réels mais, accumulés sans hiérarchie, ils créent maintenant leurs propres
échecs et incitent à multiplier les commits correctifs et les numéros APK.

La décision est de conserver les protections critiques tout en séparant :

1. la validation rapide et continue du dépôt ;
2. la publication volontaire d'un nouveau binaire Android.

## Preuves chiffrées

Les **preuves** de l'analyse des runs donnent :

| Échantillon | Réussis | Échoués | Annulés | Non aboutis |
|---|---:|---:|---:|---:|
| 20 derniers runs | 10 | 7 | 3 | **50 %** |
| 40 derniers runs | 22 | 14 | 4 | **45 %** |
| 100 derniers runs | 57 | 20 | 23 | **43 %** |

L'estimation ponctuelle de 70 % d'échec n'est donc pas représentative globalement, mais certaines
séquences l'ont dépassée. La réparation Firebase/Gradle a demandé quatre commits dont trois en échec,
soit **75 % d'échec** sur cette séquence.

Un run réussi avec build/release Android prend normalement environ **5 min 48 s**. L'heure perdue
observée venait principalement de plusieurs pushes successifs et non d'un build nominal unique.

## Répartition des 14 derniers échecs étudiés

| Cause | Nombre | Lecture |
|---|---:|---|
| Version APK déjà publiée | 4 | faux blocage sur des changements qui n'auraient pas dû publier d'APK |
| Règles SPEC/processus | 5 | garde documentaire trop large pour certains changements locaux |
| Gradle / wrapper / dépendances Android | 3 | pannes d'outillage ou de normalisation, pas de logique produit |
| Smoke Android / parsing package | 2 | défaut du garde lui-même (`16` lu à la place de `com.seenit.app`) |

Le commit `f18c5ad` est la preuve la plus claire du couplage excessif : il modifie une ligne de CI,
mais l'ancien classificateur le traite comme un changement APK. Le run tente alors une candidate
1.4.107 déjà publiée et échoue pour immuabilité, alors qu'aucun binaire applicatif n'a changé.

## Signaux de sur-processus

Sur quelques jours :

- **71 commits** ajoutés depuis le 31 août ;
- **25 releases APK** publiées ;
- une correction de couleur d'icônes de status bar a nécessité **13 fichiers** entre version, SPEC,
  catalogue, contrat Android, tests et code ;
- des modifications introduites par AI Studio ont supprimé ou altéré `google-services.json`, les
  permissions Gradle et plusieurs invariants Android, générant ensuite plusieurs commits de restauration.

Le parcours `light` existait mais était trop restrictif : `.github/**`, scripts de CI et `server.ts`
pouvaient encore provoquer une release APK. Or `server.ts` est exécuté côté backend et n'est pas
embarqué dans l'application Capacitor.

## Amélioration déjà acquise

Le commit `64c4657` a borné les tests Android à 15 minutes. Les trois releases suivantes ont terminé
entre environ 4 et 6 minutes. Les blocages de près de deux heures sont donc considérés comme traités ;
le chantier présent vise le **nombre de runs lourds**, pas le timeout déjà corrigé.

La dernière APK officielle au moment de l'audit est **SeenIt 1.4.107**, dont le build de release est
vert. Le rouge associé à `f18c5ad` concerne le workflow, pas une régression de cette APK.

## Décisions appliquées

### D1 — Push ≠ release APK

Chaque push/PR exécute une validation rapide. Le build Gradle, les émulateurs et la publication APK ne
s'exécutent que lors d'un `workflow_dispatch` explicite avec `release_apk=true` depuis `main`.

### D2 — Trois classes de changement

- `light` : docs, tests, CI, scripts/outillage, pure copie UI ;
- `backend` : backend explicitement non embarqué (`server.ts`, Firebase Admin, runtime backend) ;
- `apk` : frontend embarqué, Android, Capacitor, dépendances/configuration applicative.

Un changement `backend` seul n'impose ni bump Android ni smoke Android.

### D3 — Une version par lot

Plusieurs commits APK peuvent être validés et regroupés. La version est incrémentée **une seule fois**
quand le lot est prêt. Le garde de release utilise la dernière release officielle comme baseline et non
le commit immédiatement précédent.

### D4 — Un smoke bloquant par release

Android cible courant (API 36 à la date de l'audit) reste bloquant. Android 12/API 31 devient un TNR
manuel optionnel, à activer périodiquement ou pour les changements natifs à risque.

### D5 — Gouvernance proportionnée

Un changement comportemental garde un test automatisé. SPEC + catalogue restent obligatoires pour les
règles durables et les zones sensibles : sécurité/auth, données/Firestore, identité média/Plex,
identité APK/Firebase Android et configuration native critique.

Une petite correction visuelle ou locale n'introduisant aucune nouvelle règle durable ne doit plus
créer artificiellement une exigence et plusieurs fichiers administratifs.

### D6 — Cache et audit dépendances

Le cache npm est activé. `npm audit` s'exécute uniquement lors d'un changement de dépendances, lors
d'une release manuelle et lors du contrôle périodique hebdomadaire.

## Protections conservées

La simplification ne réduit pas :

- l'identité `com.seenit.app` ;
- la signature APK historique ;
- les icônes, launcher et deep link ;
- l'identité Firebase Android ;
- Firestore `default` et sa Delete Protection ;
- les contrôles de secrets ;
- l'immuabilité des releases déjà publiées ;
- GitHub comme source canonique face à AI Studio.

## Matrice exhaustive des constats

| Constat | Priorité | Décision / sortie | Suivi |
|---|---|---|---|
| Chaque push pouvait déclencher build + release APK | P1 | Publication uniquement manuelle ; validation continue séparée | [Issue #45](https://github.com/julfou7/seenit-app/issues/45) |
| CI/scripts classés APK | P1 | `.github/**` et `scripts/**` passent `light` | [Issue #45](https://github.com/julfou7/seenit-app/issues/45) |
| Backend seul classé APK | P1 | classe `backend` explicite pour le runtime non embarqué | [Issue #45](https://github.com/julfou7/seenit-app/issues/45) |
| Bump/version à chaque correction | P1 | une seule synchronisation de version au moment de la candidate | [Issue #45](https://github.com/julfou7/seenit-app/issues/45) |
| Deux émulateurs bloquants à chaque release | P2 | API cible bloquante ; API 31 manuelle/périodique | [Issue #45](https://github.com/julfou7/seenit-app/issues/45) |
| SPEC/catalogue exigés trop largement | P1 | SPEC complète limitée aux règles durables/zones sensibles ; tests ciblés ailleurs | [Issue #45](https://github.com/julfou7/seenit-app/issues/45) |
| `npm audit` à chaque push | P2 | dépendances/release/hebdomadaire seulement | [Issue #45](https://github.com/julfou7/seenit-app/issues/45) |
| Timeouts Android extrêmes | traité | timeout de 15 min déjà livré par `64c4657` | correction existante, risque clos |

## Critères de vérification après intégration

- un commit uniquement `.github/**` reste `light` et ne tente aucune release ;
- un commit uniquement `server.ts` devient `backend` ;
- un changement Android/frontend structurel reste `apk` ;
- un push `apk` valide mais ne lance ni Gradle ni émulateur ;
- une release manuelle exécute Gradle + API 36 puis publie ;
- API 31 ne s'exécute que si demandée ;
- une candidate peut contenir plusieurs commits après son bump tant que son tag/release n'existe pas ;
- une release déjà publiée reste impossible à écraser.

**Dernière vérification :** 2026-09-02. Les décisions sont implémentées sur la branche de travail ;
la preuve finale sera le run de validation après merge puis la prochaine release APK manuelle.
