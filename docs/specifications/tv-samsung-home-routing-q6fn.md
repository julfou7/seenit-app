# SeenIt TV — qualification du routage Home sur Q6FN / Tizen 4

Décision technique du 30 octobre 2026, issue #295. Cette SPEC borne le diagnostic du
bouton Home sur la Samsung **QE55Q6FNA 2018 / Tizen 4.0 / T-KTM2DEUC 1400.2**.
Elle complète `tv-samsung-launcher-v4.md` sans autoriser de takeover, root ou écriture
native.

## Objectif

SeenIt doit à terme devenir le Home principal sans flash ni son SmartHub, tout en gardant
un retour Samsung et une restauration exacte. Le diagnostic courant ne cherche qu'à
déterminer **quelle primitive est réellement disponible sur ce firmware** avant toute
modification.

## Acquis terrain

- `SeenItTV01.SeenItTV` est installé et lançable.
- Depuis Netflix, Home ramène déjà vers SeenIt via le mécanisme de relais étudié, mais
  SmartHub commence son animation et son son avant le retour : ce relais n'est pas un
  résultat final acceptable.
- L'exécution native Tizen 4 est prouvée via le chemin Nuvio/TPK ; elle ne confère pas de
  droit système supplémentaire.
- La capture exclusive de `XF86Home` a renvoyé `False` en WGT/corerun puis dans un vrai
  TPK natif. Réécrire SeenIt en TPK n'est donc pas une solution au routage Home.
- La route courte est identifiée en lecture dans `/opt/dbspace/.app-context.db`, table
  `key_filter`, ligne 41 : `XF86Home` vise Samsung Home avec
  `entry_point:smarthub_key`. L'appui long à 5300 ms est une route distincte et doit être
  préservé.
- La base appartient à root et n'est pas modifiable par l'identité applicative testée.
  Un snapshot privé et un restore exact ont déjà été préparés hors TV ; aucune écriture
  n'a été appliquée.
- Les interfaces récentes `aul_get_default_app` / `app-operation-tv` n'ont pas été
  trouvées lors de la qualification précédente.

## Références de comparaison

Les Samsung récentes Tizen 9 peuvent affecter Home sans root via
`app_operation_set_current_app`/`app_control_set_defapp` et des setters Vconf. À
l'inverse, le port public QN90A/Tizen 6 décrit une situation proche de la Q6FN :
`aul_get_default_app` absent, préférences Home insuffisantes et routage physique dans une
base app-context séparée ; son correctif final est root-assisté et restaure exactement les
lignes modifiées.

La chaîne moderne `archive-root` n'est pas considérée compatible par défaut avec Tizen 4.
Elle suppose notamment un `/usr/bin/dotnet` Samsung capable de `CAP_SYS_ADMIN`, un
`sdbd-tarlauncher` capable de changer d'UID, un mount namespace et un runtime compatible.
Tizen 4 correspond historiquement à .NET Core 2.0, alors que les ports publics plus récents
utilisent 3.1/6 ; la présence de `corerun` ne prouve donc pas la chaîne moderne.

## Probe Q6FN read-only

`tv-samsung/tools/q6fn-home-route-probe.ps1` est la seule sonde définie par cette étape.
Elle exige une cible SDB déjà connectée et n'ouvre elle-même aucune connexion persistante.
Elle collecte seulement :

1. identité/processus et informations Tizen accessibles ;
2. présence, permissions et file capabilities de `corerun`, `dotnet` et
   `sdbd-tarlauncher` ;
3. arborescences de runtime .NET lisibles, sans lancer de payload ;
4. support `tar --to-command` et existence du mount namespace courant ;
5. bibliothèques natives Home/AppFW/Vconf et symboles pertinents si `strings` existe ;
6. valeurs Vconf Home/startup **par `get` uniquement** ;
7. métadonnées, SHA-256, intégrité, schéma `key_filter`, ligne 41 et lignes
   `XF86Home` de `.app-context.db` via `sqlite3 -readonly` + `PRAGMA query_only=ON` ;
8. lecture de `memory/appfw/app_context_db_change`, dont un refus est conservé comme
   résultat et jamais contourné.

Une commande non disponible ou refusée reste une preuve exploitable ; le probe continue
et imprime son code de sortie. Il ne tente pas de transformer un refus en privilège.

## Interdictions du probe

Le probe ne doit contenir ni exécuter :

- `archive-root probe/root`, exploit, changement UID/GID ou payload privilégié ;
- `sdb connect`, `push`, installation/désinstallation ou changement Developer Mode ;
- `vconftool set/unset/add`, SQL d'écriture, remplacement de base ou de fichier ;
- `mount`/`umount`, bind namespace, changement de capability/SMACK/permissions ;
- reboot, poweroff, kill de service/processus ou modification boot/startup ;
- modification de Home, même temporaire.

Le TNR `tests/tvQ6fnHomeRouteProbe.test.ts` vérifie statiquement ce contrat et la présence
des sondes indispensables.

## Classification après lecture

Le résultat terrain devra être classé sans extrapolation :

- **NO_ROOT_NATIVE_CANDIDATE** : un setter Home réellement disponible sous l'identité SDK
  est prouvé en lecture/symboles. Cela n'autorise pas encore son appel en écriture ; un
  query/readback natif borné et un restore seront conçus séparément.
- **VOLATILE_ROOT_CANDIDATE** : les primitives privilégiées exactes sont présentes avec les
  capabilities/runtime attendus. Un futur essai root aura pour seul objectif `uid=0`, avec
  cleanup et aucune écriture Home.
- **OLD_TIZEN_PORT_REQUIRED** : runtime/launchers modernes absents ou incompatibles, mais
  l'exécution native ancienne reste disponible. La recherche continue alors sur une voie
  Tizen 4 spécifique ; aucun profil d'un autre firmware n'est importé.
- **INSUFFICIENT_EVIDENCE** : accès read-only trop restreint pour trancher. On conserve le
  résultat au lieu de tenter un payload pour découvrir les prérequis.

## Garde avant toute écriture future

Même après un probe favorable, aucun root ou changement Home/startup ne doit partir sans :

1. annonce exacte de l'action et accord explicite du propriétaire ;
2. baseline TV relue immédiatement avant l'essai ;
3. restore vérifié et stocké hors TV ;
4. changement minimal et readback ;
5. rollback automatique borné en cas d'échec/incertitude ;
6. Samsung Home accessible par un chemin de secours ;
7. préservation de l'appui long Home ;
8. validation physique depuis SeenIt et une app tierce, sans flash/son Samsung.

Références publiques de méthode : `NelsonEU/arn0-tv`, `splitcipher/couchroot` (S90D et
QN90A) et `chris-ritsen/samsung-tv-root`. Leurs valeurs, firmwares, payloads et profils ne
sont jamais des valeurs à recopier sur la Q6FN.
