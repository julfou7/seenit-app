# Audit de couverture des warnings SeenIt — 21/09/2026

- **Identifiant** : AUDIT-2026-09-21-WARNING-COVERAGE
- **Date** : 21 septembre 2026
- **Dernière vérification** : 21 septembre 2026
- **Statut** : terminé et validé en production
- **Baseline / commit final validé** : `194259abc362601d113c66cd827e9ad78224be65`
- **Périmètre** : `server.ts`, runtime backend, providers, classifications, téléchargements, notifications, mise à jour, Firestore client et cache/hydratation
- **Suivi** : issue #27
- **But** : transformer les dégradations répétées utiles en backlog sans exporter les logs bruts ni créer une télémétrie client bavarde

## Preuves reproductibles

- inventaire statique des `console.warn/error`, `appLogger.warn/error`, `seenitEvent` et diagnostics structurés sur le commit observé ;
- comparaison avec le filtre Cloud Logging `jsonPayload.seenitEvent.schemaVersion=1` ;
- TNR `tests/logAuditor.test.ts`, `tests/logAuditorNonPlex.test.ts`, `tests/clientOperationalSignals.test.ts` et `tests/logAuditorWorkflow.test.ts` ;
- validation canonique `npm run validate:change` sur le SHA exact de quarantaine avant toute promotion ;
- lot 2 livré via PR #476 puis déployé Cloud Run avec health-check/promotion production ;
- watchdog livré via PR #477 ; run live `Audit Structured SeenIt Logs` #35587774430 vert sur `main` ;
- preuve réelle : `[AuditorWatchdog] état=sain action=aucune` et création automatique de l'issue #478 sur un signal `RELEASE_UPDATE_PUSH_FAILED` répété.

## Chemin réel des signaux

Les événements backend qualifiés sont écrits en JSON `seenitEvent` dans stderr/stdout Cloud Run. Google
Cloud Logging les collecte. Toutes les six heures, `Audit Structured SeenIt Logs` relit au plus 5 000
événements sur douze heures, applique redaction, seuils, fingerprints et déduplication, puis crée ou
enrichit une issue GitHub seulement lorsqu'une règle fiable franchit son seuil.

Les logs bruts ne sont jamais copiés dans GitHub. L'issue reçoit uniquement domaine, code stable,
compte, première/dernière occurrence et contexte technique allowlisté.

Côté PWA/APK, cinq anomalies seulement alimentent ce chemin. Elles incrémentent d'abord un compteur
local par utilisateur ; aucun warning individuel ne déclenche de requête. Lors d'un futur appel API
SeenIt déjà authentifié, un lot peut être envoyé vers `/api/diagnostics/client-signals` au plus une
fois toutes les trente minutes. Le lot contient uniquement `code + count`, jamais message, stack,
UID, email, titre, URL ni payload. Le backend le transforme ensuite en `seenitEvent`, donc le même
auditeur et les mêmes garde-fous s'appliquent.

## Mesure de l'angle mort initial

La première passe #27 avait mesuré 12 sites `warn` sur la frontière Cloud Run
`server.ts + backendRuntime.ts` et seulement un warning déjà structuré : **11/12 étaient invisibles** à
l'auto-auditeur. La PR #475 a corrigé la première vague Plex.

Cette mesure n'était toutefois pas un inventaire fonctionnel complet. La seconde passe a donc repris
les domaines explicitement demandés par #27 et identifié des frontières stables non-Plex : proxy
TMDB/TVDB, batch de classifications, C411, webhooks Sonarr/Radarr, proxy de services privés,
publication/vérification de mise à jour, erreurs client Firestore, notifications, téléchargements,
installation APK et cache IndexedDB.

## Classement exhaustif par domaine

| Domaine | Signaux actuels | Décision | Justification |
|---|---|---|---|
| Backend/API | exception API non gérée, démarrage backend | **auto-issue haute confiance** | invariants backend ; règles historiques conservées |
| Plex | sync partielle, snapshot, delta, seed full | **auto-issue après seuil** | première tranche #475 conservée |
| TMDB | 429/5xx/timeout sur proxy backend ; cache summary | **auto-issue après agrégation** pour erreurs upstream ; cache **report-only** | un échec upstream n'est journalisé qu'une fois par groupe de 5 ; diagnostic cache reste séparé |
| TVDB | 429/5xx/timeout/login upstream | **auto-issue après agrégation** | même échantillonnage par groupes de 5 |
| OMDb | aucune intégration/runtime OMDb actif trouvé sur la baseline | **ignoré explicitement** | aucun warning orphelin à classifier tant que la source n'existe pas |
| Diffuseurs/providers | appels `watch/providers` passent par le proxy TMDB | **couvert par PROVIDER_UPSTREAM_FAILED** | pas de télémétrie parallèle |
| Explorer/classifications | échecs TMDB du batch `release_dates/content_ratings` | **auto-issue après seuil pondéré** | un seul événement agrégé par batch ; le filtre reste fail-closed |
| Firestore client | sauvegarde Cloud/fetchShows fatals | **auto-issue via lot client** | compteur local uniquement, aucun détail exporté |
| Auth | absence de session, permission refusée, token invalide | **ignorer/report-only** | peut être attendu, provoqué par l'utilisateur ou du trafic invalide ; pas d'auto-issue |
| Sonarr/Radarr/qBittorrent direct | service privé indisponible via `service-proxy` | **report-only** | machine locale éteinte ou hors réseau = situation normale possible |
| Webhooks Sonarr/Radarr | traitement d'un webhook valide en erreur | **auto-issue après seuil** | frontière backend SeenIt stable |
| C411 | test/recherche backend en échec | **auto-issue après répétition** | les erreurs d'auth 401/403 normales ne passent pas par cette règle |
| Notifications client | planification finale ou média après retries bornés | **auto-issue via lot client** | refus de permission, API non supportée et fallback réussi restent ignorés |
| Notifications release | échec de publication de la notification de mise à jour | **auto-issue rapide** | signal CI/backend haute confiance |
| Mise à jour APK | download/vérification/ouverture installateur en échec | **auto-issue via lot client** | échec final uniquement ; progress listener fallback reste local |
| Vérification de mise à jour | backend incapable de lire la dernière release | **auto-issue après seuil** | pas de token ou payload dans l'événement |
| Cache/hydratation | erreurs IndexedDB read/write du cache public | **auto-issue via lot client** | misses, stale et fallback normaux ne sont pas des anomalies |
| Warnings inconnus structurés | code non catalogué | **report-only puis qualification** | candidat seulement s'il existe dans deux fenêtres consécutives et atteint huit occurrences |

## Règles non-Plex ajoutées

| Code | Domaine | Seuil | Auto-issue |
|---|---|---:|---|
| `PROVIDER_UPSTREAM_FAILED` | providers | 10 occurrences pondérées | oui |
| `PARENTAL_RATING_PROVIDER_FAILED` | providers | 12 | oui |
| `DOWNLOAD_C411_FAILED` | downloads | 10 | oui |
| `DOWNLOAD_SERVICE_PROXY_FAILED` | downloads | 20 | **non, report-only** |
| `DOWNLOAD_WEBHOOK_FAILED` | downloads | 3 | oui |
| `RELEASE_UPDATE_PUSH_FAILED` | release | 2 | oui |
| `UPDATE_CHECK_BACKEND_FAILED` | release | 5 | oui |
| `FIRESTORE_CLIENT_SYNC_FAILED` | firestore | 5 | oui |
| `NOTIFICATION_CLIENT_FAILED` | notifications | 5 | oui |
| `DOWNLOAD_CLIENT_SYNC_FAILED` | downloads | 6 | oui |
| `APP_UPDATE_CLIENT_FAILED` | release | 4 | oui |
| `CACHE_CLIENT_STORAGE_FAILED` | cache | 8 | oui |

Les compteurs batch sont pondérés par l'auditeur : un événement
`{ code: APP_UPDATE_CLIENT_FAILED, count: 4 }` représente quatre occurrences sans écrire quatre logs
Cloud. Le fingerprint ignore `count` afin qu'une même anomalie enrichisse toujours la même issue.

## Budget performance et volume

- collecte Cloud structurée : 5 000 entrées maximum sur 12 h ;
- cadence auditeur : toutes les six heures ;
- nouvelles issues : 3 maximum par run et 3 par jour UTC ;
- cooldown d'enrichissement : 6 h ;
- TMDB/TVDB upstream : un `seenitEvent` seulement par groupe de **5** erreurs pertinentes ; les 404 ne sont pas comptés ;
- classifications : au maximum un événement structuré par requête batch, avec un compteur interne ;
- client : 5 codes allowlistés, compteurs locaux plafonnés, persistance locale débouncée à 500 ms ;
- client → backend : aucune requête par warning, aucun polling, aucun timer réseau ; au plus un POST opportuniste toutes les 30 min quand un lot est réellement en attente ;
- chaque POST contient au plus 50 occurrences par code et la route backend est elle-même limitée à 4 appels/heure ;
- aucun log brut n'est archivé par GitHub Actions.

Le coût du chemin utilisateur reste donc borné à une incrémentation mémoire/localStorage pour un signal
client et, plus tard, éventuellement un POST asynchrone non bloquant sur un appel API déjà engagé.

## Matrice exhaustive des constats

| Priorité | Constat | Impact | Sortie | Suivi |
|---|---|---|---|---|
| P2 | la première tranche couvrait surtout Plex | dégradations non-Plex non transformées en backlog | instrumentation backend non-Plex + agrégats client bornés | [#27](https://github.com/julfou7/seenit-app/issues/27) |
| P2 | les fournisseurs peuvent produire un volume élevé | tempête de Cloud Logging possible avec un log par échec | échantillonnage par paquets de 5 et seuil pondéré | [#27](https://github.com/julfou7/seenit-app/issues/27) |
| P2 | les erreurs utiles PWA/APK n'existent pas dans Cloud Logging | angles morts Firestore, APK, notifications et cache | cinq compteurs locaux allowlistés, POST opportuniste max 30 min | [#27](https://github.com/julfou7/seenit-app/issues/27) |
| P2 | l'indisponibilité d'un service privé est ambiguë | faux positifs GitHub | `DOWNLOAD_SERVICE_PROXY_FAILED` catalogué report-only | [#27](https://github.com/julfou7/seenit-app/issues/27) |
| P2 | permissions/refus/fallbacks normaux ressemblent à des warnings | bruit | classement explicite ignore/report-only ; seuls les échecs finaux sont comptés | [#27](https://github.com/julfou7/seenit-app/issues/27) |
| P2 | un futur code structuré peut ne pas avoir de règle | angle mort futur | qualification seulement après 2 fenêtres et 8 occurrences | [#27](https://github.com/julfou7/seenit-app/issues/27) |
| P1 | l’auditeur peut lui-même perdre Cloud Logging/WIF ou casser avant l’analyse | l’amélioration continue devient silencieusement aveugle si personne ne regarde Actions | watchdog indépendant, issue santé unique, cooldown 6 h, jamais de logs bruts | [#27](https://github.com/julfou7/seenit-app/issues/27) |

## Points solides à préserver

La redaction, les fingerprints stables, le plafond d'issues, le cooldown, le kill switch, la suppression
des logs bruts et l'indépendance du runtime vis-à-vis de GitHub restent inchangés. L'application ne
bloque jamais un parcours utilisateur pour envoyer ou échouer à envoyer un diagnostic.
