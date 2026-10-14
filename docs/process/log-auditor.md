# Auditeur de logs SeenIt

L'auditeur transforme un sous-ensemble borné d'événements opérationnels structurés en backlog GitHub.
La source de vérité technique reste **Google Cloud Logging** : les issues GitHub ne reçoivent jamais les
logs bruts. Le job s'exécute dans GitHub Actions toutes les six heures ou sur déclenchement manuel et ne
fait jamais partie du chemin de réponse backend.

## Flux des événements

1. Le backend émet un JSON `seenitEvent` dans Cloud Run avec domaine, niveau, code stable, timestamp,
   corrélation et contexte allowlisté.
2. Certains échecs PWA/APK actionnables incrémentent uniquement un compteur local. Aucun warning
   individuel ne provoque de requête.
3. Quand un appel API SeenIt authentifié a lieu plus tard, un lot en attente peut être envoyé vers
   `/api/diagnostics/client-signals`, au plus une fois toutes les 30 minutes. Le lot contient uniquement
   `code + count`.
4. Le backend transforme ces compteurs en `seenitEvent`. Ils rejoignent donc la même source Cloud
   Logging que les événements backend natifs.
5. `Audit Structured SeenIt Logs` lit au plus 5 000 événements sur douze heures, agrège, redige,
   applique les seuils/fingerprints puis crée ou enrichit une issue uniquement pour les règles
   autorisées.

Aucun message libre, stack, titre média, URL, UID, email, token ou payload client n'est transmis par le
lot de diagnostics client.

## Modes et activation

Le mode vient de la variable de dépôt GitHub `SEENIT_LOG_AUDITOR_MODE` :

- variable absente ou valeur inconnue : `dry-run` ;
- `live` : création ou enrichissement autorisé après tous les garde-fous ;
- `off` : kill switch, aucune authentification Cloud ni écriture GitHub.

L'activation live ne contourne jamais le catalogue. Les codes explicitement report-only restent
report-only même au-dessus de leur seuil.

## Accès minimaux

- GitHub : `GITHUB_TOKEN` éphémère avec `contents: read`, `issues: write` ; aucune fermeture
  automatique et aucune modification de code.
- Google Cloud : compte dédié `seenit-log-auditor` avec uniquement `roles/logging.viewer`, via le
  provider WIF canonique ; aucune clé JSON ni permission de déploiement.
- Collecte anomalies : service Cloud Run `seenit-app`, `jsonPayload.seenitEvent.schemaVersion=1`,
  deux fenêtres de six heures, 5 000 entrées maximum.
- Collecte TMDB cache : `TMDB_REQUEST_CACHE_SUMMARY` séparé, six heures, report-only.

Le bootstrap reste `bash scripts/bootstrap-gcp-log-auditor.sh` et ne recrée jamais le pool/provider
WIF partagé.

Les trois lectures Cloud Logging utilisent une **fenêtre temporelle explicite** : le workflow calcule en
UTC un timestamp de début et de fin, puis les injecte directement dans le filtre Logging avec
`timestamp>=...` et `timestamp<=...`. `--freshness` seul est interdit : il avait permis à une lecture
bornée par `--limit` de restituer des logs vieux de plusieurs semaines. L'ordre reste descendant pour
commencer par les événements les plus récents.

Pour le trafic Cloud Run, les timestamps exacts demandés sont aussi transmis au résumeur. Le rapport
redigé enregistre séparément la fenêtre demandée et la fenêtre réellement observée. Une entrée située hors
de la fenêtre rend le rapport `stale`; l'agrégat hors fenêtre n'est pas utilisé comme preuve FinOps.

## Contrat de confidentialité

Le backend exclut message, route, URL, en-têtes, UID, email, titre média et payload utilisateur des
événements opérationnels. L'auditeur renormalise encore le contexte et masque défensivement les champs
sensibles. Les fichiers Cloud bruts restent dans `$RUNNER_TEMP`, sont supprimés avant archivage et ne
sont jamais joints à une issue. Seul le rapport agrégé redigé est conservé sept jours.

Le lot client est encore plus strict : cinq codes connus seulement, un entier `count` et aucun autre
contexte. La persistance locale est par utilisateur ; l'identifiant local ne quitte jamais l'appareil.

## Détection et déduplication

| Code | Domaine | Seuil | Auto-issue |
|---|---|---:|---|
| `API_UNHANDLED_ERROR` | runtime | 5 | oui |
| `BACKEND_STARTUP_FAILED` | runtime | 2 | oui |
| `PLEX_SYNC_PARTIAL` | plex | 20 | oui |
| `PLEX_SNAPSHOT_STORE_FAILED` | plex | 6 | oui |
| `PLEX_DELTA_SNAPSHOT_FAILED` | plex | 4 | oui |
| `PLEX_FULL_SNAPSHOT_SEED_FAILED` | plex | 4 | oui |
| `PROVIDER_UPSTREAM_FAILED` | providers | 10 | oui |
| `PARENTAL_RATING_PROVIDER_FAILED` | providers | 12 | oui |
| `DOWNLOAD_C411_FAILED` | downloads | 10 | oui |
| `DOWNLOAD_SERVICE_PROXY_FAILED` | downloads | 20 | **non** |
| `DOWNLOAD_WEBHOOK_FAILED` | downloads | 3 | oui |
| `RELEASE_UPDATE_PUSH_FAILED` | release | 2 | oui |
| `UPDATE_CHECK_BACKEND_FAILED` | release | 5 | oui |
| `FIRESTORE_CLIENT_SYNC_FAILED` | firestore | 5 | oui |
| `NOTIFICATION_CLIENT_FAILED` | notifications | 5 | oui |
| `DOWNLOAD_CLIENT_SYNC_FAILED` | downloads | 6 | oui |
| `APP_UPDATE_CLIENT_FAILED` | release | 4 | oui |
| `CACHE_CLIENT_STORAGE_FAILED` | cache | 8 | oui |

Les événements batch utilisent `count` comme poids, mais ce compteur n'entre pas dans le fingerprint.
Ainsi un lot de quatre erreurs APK compte quatre occurrences tout en restant rattaché à la même issue.

Un code warning inconnu reste report-only jusqu'à présence dans chacune de deux fenêtres consécutives de
six heures et au moins huit occurrences cumulées. Son contexte est alors volontairement vide.

Le fingerprint SHA-256 tronqué porte sur schéma, domaine, code et contexte technique allowlisté stable.
Avant création, le job cherche une issue ouverte portant le marqueur. Une issue existante est enrichie
au plus toutes les six heures. Le job crée au plus trois issues par run et trois issues automatiques par
jour UTC. Il ne ferme jamais une issue.

## Budget runtime

- TMDB/TVDB upstream : l'événement fournisseur n'est émis que par groupe de cinq erreurs pertinentes ;
  les 404 sont exclus.
- Classifications : un seul événement agrégé au maximum par requête batch.
- Client : cinq compteurs seulement, plafonnés localement ; écriture localStorage débouncée.
- Réseau client : zéro appel par warning, zéro polling, zéro timer réseau ; flush asynchrone seulement
  si un lot existe et au plus une fois par 30 minutes lors d'un futur appel API authentifié.
- Endpoint diagnostics : quatre requêtes maximum par heure et par sujet de rate-limit ; chaque code du
  lot est plafonné à 50 occurrences.
- Cloud/auditeur : 5 000 événements structurés max par lecture et plafonds GitHub inchangés.

## Baseline TMDB report-only

Le cache TMDB backend émet des compteurs cumulés `TMDB_REQUEST_CACHE_SUMMARY`.
`scripts/summarize-tmdb-cache-diagnostics.cjs` calcule uniquement les deltas entre snapshots
comparables par instance, sans archiver les identifiants d'instance ni les événements bruts. Cette voie
reste report-only et ne peut pas ouvrir d'issue.

Le statut de baseline est `ready` à partir de deux intervalles comparables et 50 requêtes couvertes,
`partial` lorsqu'un delta existe, `insufficient` sinon, et `source_unavailable` en cas d'échec de
lecture Cloud.

## Agrégat Cloud Run FinOps

La collecte de requêtes Cloud Run couvre six heures et s'arrête à **10 000** entrées. Le résumeur ne
conserve que les buckets de routes redigés, les classes HTTP, les octets de réponse agrégés et les
métadonnées de qualité nécessaires à l'audit.

Le champ `quality.status` du rapport peut être :

- `ok` : données présentes, dans la fenêtre et non saturées ;
- `empty` : aucune requête dans une fenêtre récente valide ; cela reste un rapport complet ;
- `stale` : au moins une requête source tombe hors de la fenêtre demandée ;
- `saturated` : la collecte atteint 10 000 entrées ou le résumeur a dû tronquer l'entrée ;
- `unavailable` : la source Cloud Logging n'est pas lisible ;
- `off` : collecte volontairement désactivée par le kill switch.

Un rapport `stale`, `saturated` ou `unavailable` a `quality.complete=false`. Le résumeur termine alors en
échec contrôlé après avoir écrit l'artefact redigé. Grâce à `continue-on-error`, le workflow conserve la
preuve technique, puis le watchdog voit `SEENIT_AUDITOR_TRAFFIC_SUMMARY_OUTCOME != success` et remonte
l'état dégradé. Un tel rapport ne doit jamais servir à conclure sur le coût ou la répartition du trafic.

## Rejeu local redigé

```bash
SEENIT_LOG_AUDITOR_MODE=dry-run node scripts/audit-structured-logs.cjs \
  --input=tests/fixtures/log-auditor-historical-redacted.json \
  --report=build/log-auditor-report.json
```

Un run local sans token n'effectue aucune écriture GitHub.

## Pannes

Une lecture Cloud, un flush client ou un appel GitHub en échec n'affecte jamais le comportement métier.
Le client conserve ses compteurs pour une tentative ultérieure bornée ; le job CI écrit son rapport
redigé avant de signaler un état dégradé lorsque GitHub Actions reste disponible.

Le workflow surveille aussi **sa propre santé**. En mode `live`, un watchdog indépendant du moteur
d'analyse contrôle uniquement les outcomes des étapes et les trois statuts de source (événements
structurés, baseline TMDB, trafic Cloud Run). Une dégradation ouvre une issue unique
`[P1][Observabilité] Auditeur de logs indisponible` avec un marqueur stable ; les occurrences suivantes
l'enrichissent au plus toutes les six heures. Le watchdog n'ingère aucun log et n'exporte que run, SHA et
états techniques allowlistés. Il ne ferme jamais l'issue automatiquement après récupération.

Ainsi, une panne WIF, Cloud Logging, un agrégat trafic périmé/saturé, une panne du résumeur ou du moteur
d'audit ne dépend plus d'une lecture manuelle des logs ou de GitHub Actions pour être découverte.

## Exports Cloud Logging / Admin Activity hors auditeur

Les exports d'audit Cloud Run ne doivent **jamais** être attachés bruts à GitHub ni conservés comme
artefact : une entrée Admin Activity peut embarquer `containers[].env[].value` avec la configuration
complète d'une révision. Le workflow structuré ci-dessus n'a pas besoin de ces payloads.

Pour un diagnostic ponctuel nécessitant un export GCP, la seule procédure partageable est un flux direct
vers le redactor versionné, sans `tee` ni fichier intermédiaire brut :

```bash
gcloud logging read '<filtre borné>' --project=gen-lang-client-0201895414 --format=json \
  | node scripts/redact-gcp-log-export.cjs --input=- --output=build/gcp-log-redacted.json
```

Le redactor masque **toutes** les valeurs de `env[]` Cloud Run, même lorsqu'une variable n'est pas
classée secrète, puis réapplique la redaction défensive des tokens, clés, emails, UID et chemins.
Seul le fichier redigé peut être copié, joint ou archivé. Pour un simple inventaire runtime, le
déploiement canonique journalise uniquement `nom=plain|secret`, jamais la valeur.
