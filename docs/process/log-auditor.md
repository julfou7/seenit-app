# Auditeur de logs SeenIt

L'auditeur transforme un petit sous-ensemble d'événements backend structurés en backlog GitHub. Il
s'exécute exclusivement dans GitHub Actions, toutes les six heures ou sur déclenchement manuel. Il ne
fait jamais partie du chemin de réponse PWA, APK ou backend.

## Modes et activation

Le mode vient de la variable de dépôt GitHub `SEENIT_LOG_AUDITOR_MODE` :

- variable absente ou valeur inconnue : `dry-run` ;
- `live` : création ou enrichissement autorisé après tous les garde-fous ;
- `off` : kill switch, aucune authentification Cloud ni écriture GitHub.

Un premier run `dry-run` vert sur `main` est obligatoire avant de définir `live`. Une activation live
ne modifie pas le catalogue de règles : seules `API_UNHANDLED_ERROR` et `BACKEND_STARTUP_FAILED` ont
initialement `autoIssue=true`. `PLEX_SYNC_PARTIAL` reste report-only.

## Accès minimaux

- GitHub : le `GITHUB_TOKEN` éphémère du job possède `contents: read`, `issues: write` et aucun secret
  personnel. L'auditeur ne gère ni code, ni PR, ni fermeture d'issue.
- Google Cloud : le compte dédié
  `seenit-log-auditor@gen-lang-client-0201895414.iam.gserviceaccount.com` reçoit uniquement le rôle
  read-only `roles/logging.viewer` via `scripts/bootstrap-gcp-log-auditor.sh`. Il réutilise le provider
  WIF borné au dépôt et à `main`, sans clé JSON durable ni permission de déploiement.
- Collecte anomalies : uniquement `seenit-app`, `jsonPayload.seenitEvent.schemaVersion=1`, six heures
  et 5 000 entrées au maximum.
- Collecte diagnostics : le même batch peut lire séparément
  `jsonPayload.seenitDiagnostic.code="TMDB_REQUEST_CACHE_SUMMARY"` avec les mêmes bornes. Cette voie
  est **report-only** : elle n'alimente jamais les règles de création d'issue.

Le bootstrap doit être rejoué une fois par un opérateur GCP autorisé après l'introduction du rôle :

```bash
bash scripts/bootstrap-gcp-log-auditor.sh
```

Le pool/provider WIF canonique `seenit-github/seenit-main` est un prérequis déjà administré par le
bootstrap du déploiement backend. Le bootstrap de l'auditeur ne tente pas de le recréer : il cible
explicitement le projet canonique, crée le compte read-only si nécessaire et ajoute seulement sa
liaison au principal GitHub existant. Il peut ainsi être rejoué sans collision `ALREADY_EXISTS`.

## Contrat de confidentialité

Le backend n'émet que domaine, niveau, code stable, timestamp, UUID de corrélation et contexte
allowlisté. Il exclut message, route, URL, en-têtes, UID, email, titre média et payload utilisateur.
L'auditeur applique une seconde normalisation et ignore tous les champs supplémentaires. Le fichier
Cloud brut reste dans `$RUNNER_TEMP`, est supprimé avant l'archivage et n'apparaît jamais dans un
artefact. Seul le JSON agrégé redigé est conservé sept jours.

## Détection et déduplication

| Code | Domaine | Seuil par lot | Création automatique |
|---|---|---:|---|
| `API_UNHANDLED_ERROR` | runtime | 5 | oui |
| `BACKEND_STARTUP_FAILED` | runtime | 2 | oui |
| `PLEX_SYNC_PARTIAL` | plex | 20 | non, rapport uniquement |

Le fingerprint SHA-256 tronqué porte sur version de schéma, domaine, code et contexte technique
allowlisté. Il ne contient pas le timestamp, la corrélation, un utilisateur, une route ou un titre.
Avant création, le job recherche une issue ouverte contenant son marqueur stable. Une issue existante
est enrichie au plus toutes les six heures. Le job crée au plus trois issues par run et trois issues
automatiques par jour UTC. Il ne ferme jamais une issue.

## Baseline TMDB report-only

Le cache TMDB backend émet périodiquement des compteurs **cumulés**. Le batch ne somme donc jamais les
snapshots bruts : `scripts/summarize-tmdb-cache-diagnostics.cjs` groupe les événements par instance
Cloud Run, exclut le premier snapshot de chaque instance puis ne conserve que les **deltas entre deux
snapshots comparables**. Cela évite d'attribuer à la fenêtre courante des appels antérieurs au lot.

Le rapport final contient uniquement des compteurs par famille : requêtes, hits mémoire, requêtes
coalescées, appels upstream et octets upstream. Les identifiants d'instance servent seulement au calcul
en mémoire du runner et ne sont jamais écrits dans l'artefact. Les fichiers Cloud bruts
`seenit-structured-logs.json` et `seenit-tmdb-cache-diagnostics.json` restent dans `$RUNNER_TEMP`
puis sont supprimés avant archivage.

Le statut de baseline est :
- `ready` à partir de deux intervalles comparables et 50 requêtes couvertes ;
- `partial` lorsqu'au moins un delta est mesurable ;
- `insufficient` lorsqu'aucun delta n'est encore comparable ;
- `source_unavailable` si Cloud Logging ne peut pas être lu.

Le workflow se déclenche aussi lors d'une modification de son propre collecteur sur `main`, afin de
valider immédiatement la chaîne réelle après une évolution d'observabilité, puis revient au rythme
périodique de six heures.

## Rejeu local redigé

Le script accepte un tableau JSON d'enveloppes `seenitEvent` ou d'entrées Cloud Logging :

```bash
SEENIT_LOG_AUDITOR_MODE=dry-run node scripts/audit-structured-logs.cjs \
  --input=tests/fixtures/log-auditor-historical-redacted.json \
  --report=build/log-auditor-report.json
```

Le fixture rejoue cinq fois, uniquement pour exercer le seuil, la forme redigée du cas historique
`PERMISSION_DENIED` documenté le 2 septembre 2026. Ce n'est ni un comptage de l'incident ni une copie
du fichier Cloud original. Un run local sans token n'effectue aucune écriture GitHub.

## Pannes

Une lecture Cloud ou un appel GitHub en échec est capturé comme décision dégradée. Le rapport est écrit
avant l'échec final du job lorsque GitHub Actions reste disponible. Aucun retry n'est lancé depuis
l'application et aucun échec de l'auditeur ne modifie les réponses backend.
