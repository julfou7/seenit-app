# Audit des builds et de la chaîne CI/CD — 4 septembre 2026

- **Identifiant :** AUDIT-2026-09-04-CI-RECENT-BUILDS
- **Date :** 4 septembre 2026
- **Baseline :** SeenIt 1.4.112, commit `3e46bc2036abc6aef17b4fcfec05cf446fa47ae2`
- **Périmètre :** GitHub Actions, validations PR/main, releases APK manuelles, temps d'installation, causes d'échec et gouvernance des pushes
- **Fenêtre mesurée :** 100 runs, du 2 septembre 2026 à 16:44:57 UTC au 4 septembre 2026 à 07:17:15 UTC
- **Statut :** audit terminé ; actions ouvertes dans les issues #83, #84 et #85
- **Dernière vérification :** 4 septembre 2026

## Conclusion exécutive

L'industrialisation précédente a corrigé son défaut le plus dangereux : un push ne construit et ne
publie plus automatiquement une APK. Les releases sont manuelles, immuables et conservent le smoke
Android 36 N → N+1. Cette architecture doit rester.

Elle n'a toutefois pas encore atteint l'objectif de débit et de fiabilité attendu :

- 62 des 100 runs sont réussis, 30 échouent et 8 sont annulés ;
- le workflow canonique représente 74 runs : 51 succès, 15 échecs et 8 annulations ;
- 26 runs proviennent de workflows temporaires propres à une issue : seulement 11 succès pour
  15 échecs ;
- 42 validations PR ont été lancées pour 23 branches, puis 24 validations supplémentaires sur
  `main` et 8 releases manuelles ;
- le dernier `Validate Change` dure 7 min 41 s, dont 7 min 03 s dans `npm ci`.

La chaîne actuelle sécurise mieux les releases, mais elle laisse encore la CI servir de boucle de
développement distante et elle dépend trop fortement d'une installation npm variable. Il faut
désormais optimiser le temps jusqu'au premier vert sans supprimer les TNR.

## Méthode et limites

Les preuves proviennent de l'API GitHub Actions, des jobs et des journaux des runs concernés, ainsi que
du workflow `.github/workflows/build-apk.yml` présent sur `main`.

Limites :

- l'échantillon est volontairement borné aux 100 derniers runs, soit environ 38 h 32 ;
- le connecteur GitHub ne possède pas le droit d'administration nécessaire pour lire la protection
  classique de branche ; l'API des rulesets accessibles renvoie une liste vide ;
- les temps de run incluent l'infrastructure GitHub et ne mesurent pas le temps humain entre deux
  corrections ;
- la corrélation avec une version d'image runner n'établit pas seule une causalité.

## Chiffres globaux

| Population | Runs | Succès | Échecs | Annulés | Non aboutis |
|---|---:|---:|---:|---:|---:|
| Ensemble | 100 | 62 | 30 | 8 | 38 % |
| Workflow canonique | 74 | 51 | 15 | 8 | 31 % |
| Workflows temporaires | 26 | 11 | 15 | 0 | 58 % |

Sur les 100 runs, la durée médiane est 53 s, le p90 240 s et le maximum 463 s. Ces valeurs mélangent
validations, releases et workflows historiques ; le détail ci-dessous isole leurs causes.

Les huit annulations ne sont pas des erreurs produit : `cancel-in-progress` a correctement arrêté un
run devenu obsolète après un nouveau push. Leur nombre révèle néanmoins une cadence de commits
intermédiaires trop forte.

## Analyse de la validation continue

### Temps d'installation

48 jobs `Validate Change` disposent d'une mesure détaillée exploitable :

| Mesure `npm ci` | Temps |
|---|---:|
| minimum | 15 s |
| médiane | 18 s |
| p75 | 25 s |
| p90 | 134 s |
| maximum | 423 s |

Le run [#550](https://github.com/julfou7/seenit-app/actions/runs/33847456193) dure 461 s au total.
Son job `Validate Change` dure 459 s :

| Étape | Temps |
|---|---:|
| checkout | 2 s |
| setup Node/cache | 7 s |
| `npm ci --legacy-peer-deps` | **423 s** |
| contrat de changement | 1 s |
| SPEC + TypeScript + tests unitaires | 13 s |
| build Web + serveur | 9 s |

L'installation consomme donc environ **92 %** du job. La PR correspondante
[#549](https://github.com/julfou7/seenit-app/actions/runs/33847067500) consomme déjà 358 s dans
`npm ci` sur 388 s.

Une contre-mesure réalisée après la fenêtre principale confirme le phénomène : la PR documentaire
[#551](https://github.com/julfou7/seenit-app/actions/runs/33849323003) a passé **385 s** dans `npm ci`
sur un job de 406 s. Elle a ensuite échoué en 11 s parce que cet audit employait initialement le
libellé `ID` au lieu du libellé contractuel `Identifiant`. Ce défaut, reproductible localement sans
installation supplémentaire, illustre simultanément CI-01 et CI-04.

Dans les deux cas :

- le cache npm est trouvé et restauré avec la même clé ;
- 764 paquets sont installés ;
- l'image est `ubuntu-24.04` version `20260831.293.1` ;
- deux régions Azure différentes sont concernées.

Le run précédent [#548](https://github.com/julfou7/seenit-app/actions/runs/33817758498), avec le même
cache logique mais l'image `20260823.283.1`, installe les mêmes 764 paquets en 15 s. Le changement
d'image est donc un signal fort de variabilité externe, sans constituer encore une preuve causale.

Le cache `actions/setup-node` actuel ne restaure que le cache de téléchargement npm. Il ne restaure
pas `node_modules` et laisse `npm ci` extraire et exécuter le postinstall à chaque run. Il ne protège
donc pas SeenIt contre ce type de dérive.

### Ordre des contrôles

L'installation se produit avant la classification et le contrat de changement. Cinq échecs récents
étaient pourtant détectables par ces scripts sans dépendance. Ils ont payé l'installation avant
d'échouer en moins d'une seconde sur le vrai contrôle.

Les commandes SPEC, TypeScript et tests unitaires sont regroupées dans une étape générique
`Fast Automated Tests`. Cela ne ralentit presque pas le run, mais rend le diagnostic initial moins
lisible.

### Échecs du workflow canonique

| Cause | Nombre | Nature |
|---|---:|---|
| contrat de changement/SPEC | 5 | déterministe et détectable localement |
| TypeScript, import ESM ou test unitaire | 8 | déterministe et détectable localement |
| smoke Android 36 | 2 | release, signature/émulateur |

Les 13 échecs hors release incluent notamment :

- import ESM sans extension vers `logPrivacy` ;
- propriété TypeScript absente et fixtures non alignées ;
- test attendu non ajouté ;
- SPEC/catalogue non alignés ;
- assertion de présentation devenue obsolète ;
- disparition de `google-services.json` lors d'un import AI Studio historique.

Aucun de ces 13 échecs n'exigeait GitHub pour être découvert. Ils prouvent que les commandes locales
utilisées avant push ne reproduisent pas encore de façon simple et certaine la validation distante.

## Analyse des workflows temporaires

26 des 100 runs appartiennent à des workflows spécifiques à une issue, aujourd'hui absents de
`main`. Ils ont produit 15 échecs, dont plusieurs workflows invalides sans aucun job, des installations
incompatibles et des scripts de correction incomplets.

Cette pratique contrevient au principe déjà documenté : la CI vérifie, construit et publie ; elle ne
corrige, ne commit et ne pousse jamais le code. Elle multiplie les surfaces privilégiées, les runs et
les diagnostics sans apporter de garantie supplémentaire.

Le dépôt `main` ne contient plus qu'un seul workflow canonique. Ce point est solide mais doit être
verrouillé pour éviter le retour des workflows correctifs temporaires.

## Analyse du doublon PR puis main

Le workflow canonique a lancé :

- 42 validations `pull_request` sur 23 branches ;
- 24 validations `push` sur `main` ;
- 8 releases manuelles.

Une PR est donc normalement validée puis son résultat est recalculé après merge. Le dernier changement
cumule 6 min 31 s en PR et 7 min 41 s sur `main`, soit près de 13 minutes pour les mêmes contrôles et
le même lockfile.

La suppression brute du run `main` serait dangereuse tant que la protection de branche et l'identité
exacte de l'arbre validé ne sont pas prouvées. La bonne cible est une preuve attachée à l'arbre Git :
une validation PR ne peut être réutilisée que si elle a testé le merge ref à jour, dans un contexte de
confiance, et si l'arbre livré est strictement identique. Tout push direct ou sans preuve doit rester
entièrement validé.

## Analyse des releases APK

Les cinq releases manuelles réussies de l'échantillon durent entre 5 min 28 s et 7 min 42 s, avec une
médiane de 6 min 07 s. Sur le run réussi
[#531](https://github.com/julfou7/seenit-app/actions/runs/33809261658) :

- build et validations de la candidate : 2 min 19 s ;
- smoke Android 36 : 2 min 59 s ;
- Android 12 optionnel, exécuté en parallèle : 2 min 26 s ;
- publication immuable : 28 s.

Les runs de release [#523](https://github.com/julfou7/seenit-app/actions/runs/33792979439) et
[#528](https://github.com/julfou7/seenit-app/actions/runs/33806746182) ont échoué sur le smoke
Android 36 : cache AVD instable, disparition de l'émulateur et transition de signature incompatible.
Ces échecs ont déclenché #50/#72/#75. Après retrait du cache AVD bloquant, création d'un AVD neuf et
bornage mémoire, le run #531 a publié `v1.4.112` correctement.

À la date de l'audit, aucune preuve postérieure ne montre une nouvelle régression du chemin de release.
Le smoke reste coûteux mais légitime : il protège l'installation N → N+1, la signature, les données,
le launcher et les deep links. Sa suppression n'est pas recommandée.

## Points solides à conserver

- aucune APK automatique sur push ou PR ;
- release manuelle depuis `main` seulement ;
- build en lecture seule et écriture réservée au job de publication ;
- immuabilité du tag, de l'APK et du SHA-256 ;
- contrat Android avant/après `cap sync` ;
- smoke Android 36 N → N+1 bloquant ;
- Android 12 optionnel et parallélisé ;
- audit de dépendances conditionnel ;
- classification `light/backend/apk` ;
- annulation automatique des runs PR obsolètes ;
- workflow canonique unique sur `main`.

## Objectifs mesurables proposés

| Indicateur | Cible |
|---|---:|
| validation PR médiane | ≤ 45 s |
| validation PR p95 sur 20 runs | ≤ 90 s |
| détection d'un échec de préflight | ≤ 15 s |
| première validation PR verte | ≥ 95 %, hors incident externe/annulation |
| release APK médiane | ≤ 6 min 30 s |
| release APK p95 | ≤ 8 min |
| première tentative de release verte | ≥ 95 %, hors incident GitHub documenté |
| workflows correctifs temporaires | 0 |
| validations complètes nominales par arbre livré | 1 |

« Toujours vert » ne peut pas être garanti contre une panne GitHub, npm ou Android Emulator. La chaîne
peut en revanche rendre ces incidents exceptionnels, bornés, diagnostiqués et séparés des défauts du
code SeenIt.

## Plan priorisé

1. **#84 — stabiliser et mesurer `Validate Change`.** Préflight avant installation, cache exact
   `node_modules`, installation de secours déterministe, étapes séparées et budget de temps.
2. **#83 — rendre le vert local obligatoire et identique à la CI.** Une commande unique déduit la
   baseline et orchestre les mêmes contrôles ; aucun workflow correctif temporaire n'est autorisé.
3. **#85 — supprimer le recalcul PR/main prouvé redondant.** Cette optimisation ne vient qu'après
   preuve de protection de `main` et identité exacte de l'arbre validé.
4. **Conserver le chemin APK actuel.** Ne réoptimiser l'émulateur qu'avec une preuve de fiabilité
   supérieure au fresh AVD actuel.

## Matrice exhaustive des constats

| ID | Constat | Priorité | Décision / critère de sortie | Suivi |
|---|---|---|---|---|
| CI-01 | `npm ci` varie de 15 à 423 s malgré un cache hit | P1 | cache exact, préflight et p95 ≤ 90 s | [#84](https://github.com/julfou7/seenit-app/issues/84) |
| CI-02 | les contrôles sans dépendance s'exécutent après l'installation | P1 | fail-fast avant installation | [#84](https://github.com/julfou7/seenit-app/issues/84) |
| CI-03 | l'étape de tests agrège plusieurs causes | P2 | étapes et résumé de durée séparés | [#84](https://github.com/julfou7/seenit-app/issues/84) |
| CI-04 | 13 échecs canoniques étaient reproductibles avant push | P1 | commande locale identique à la CI et ≥ 95 % premier vert | [#83](https://github.com/julfou7/seenit-app/issues/83) |
| CI-05 | 26 runs de workflows temporaires ont produit 15 échecs | P1 | workflows correctifs interdits et allowlist testée | [#83](https://github.com/julfou7/seenit-app/issues/83) |
| CI-06 | PR et `main` recalculent nominalement la même validation | P2 | réutilisation uniquement d'une preuve d'arbre exacte | [#85](https://github.com/julfou7/seenit-app/issues/85) |
| CI-07 | protection de branche non vérifiable par le connecteur | P2 | preuve/configuration explicite avant toute suppression de contrôle | [#85](https://github.com/julfou7/seenit-app/issues/85) |
| CI-08 | un workflow unique affiche quatre jobs de release ignorés à chaque validation | P3 | séparer visuellement validation et release | [#85](https://github.com/julfou7/seenit-app/issues/85) |
| CI-09 | actions majeures et runner restent des références mutables | P2 | verrouiller les références ou documenter leur mise à jour contrôlée | [#83](https://github.com/julfou7/seenit-app/issues/83) |
| CI-10 | le fresh AVD allonge la release mais a restauré sa fiabilité | accepté | conserver le smoke ; budget p95 de 8 min | [#50](https://github.com/julfou7/seenit-app/issues/50) clôturée |
| CI-11 | checkout complet de validation coûte seulement 2–7 s | accepté | ne pas complexifier avant nouvelle mesure | risque faible accepté |
| CI-12 | tests + build prennent environ 20–25 s | solide | conserver intégralement les contrôles | aucune action |
| CI-13 | la PR documentaire de l’audit a attendu 6 min 25 s avant un échec local trivial | P1 | préflight local obligatoire et fail-fast distant | [#83](https://github.com/julfou7/seenit-app/issues/83) et [#84](https://github.com/julfou7/seenit-app/issues/84) |

## Mise en œuvre de #84 — PR #87

La première implémentation du chemin rapide est portée par la
[PR #87](https://github.com/julfou7/seenit-app/pull/87).

| Run | Résultat | Cache | Installation | Job | Preuve |
|---|---|---|---:|---:|---|
| [#554](https://github.com/julfou7/seenit-app/actions/runs/33852234487) | échec de conception | non atteint | 0 s | 13 s | la classification chargeait TypeScript avant le cache ; l'échec est apparu sans installation |
| [#558](https://github.com/julfou7/seenit-app/actions/runs/33852570774) | succès | miss | 15 s | 45 s | SPEC, classification, contrat, TypeScript, 256+ tests et build verts |

Le run #554 a permis de corriger le contrat : l'intégrité SPEC reste entièrement indépendante des
dépendances ; la classification de pure copie, qui utilise l'analyseur TypeScript, s'exécute après la
restauration du cache et après l'installation uniquement lors d'un bootstrap `miss`. Le run #558
passe déjà sous la cible de 90 s malgré un cache `node_modules` encore absent.

La preuve d'écriture du cache depuis `main`, d'un hit ultérieur et la série de 20 validations réelles
restent à collecter dans #84. Aucun run artificiel n'est lancé uniquement pour améliorer la métrique.

## Décision

Le chantier n'est pas de retirer des tests. Il consiste à déplacer les contrôles les moins coûteux
avant l'installation, réutiliser uniquement des artefacts déterministes, empêcher les pushes
intermédiaires rouges et éviter une seconde validation quand la première constitue une preuve exacte.

Les issues #83 et #84 sont P1 et peuvent être traitées immédiatement. #85 reste P2 car son
implémentation dépend d'une preuve de protection de branche ; elle ne doit jamais devenir un
contournement des contrôles de `main`.
