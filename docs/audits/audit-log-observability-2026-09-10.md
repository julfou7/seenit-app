# Audit — observabilité et transformation des logs en backlog

- **Identifiant** : AUDIT-2026-09-10-LOG-OBSERVABILITY
- **Date** : 10 septembre 2026
- **Dernière vérification** : 10 septembre 2026
- **Statut** : implémentation prête — replay dry-run et TNR ciblés verts, validation complète/CI à confirmer dans #27
- **Baseline dépôt** : SeenIt 1.4.134
- **Commit observé** : `575c02c6b520add641d51840abedf90dd7099628`
- **Périmètre** : erreurs backend Express, journaux Cloud Run, redaction, règles déterministes,
  fingerprint, déduplication GitHub, rate limiting, kill switch, indisponibilités et coût.
- **Suivi** : [issue #27](https://github.com/julfou7/seenit-app/issues/27).

## Synthèse

SeenIt contient déjà un point de capture global des erreurs API et un garde de démarrage backend, mais
leurs lignes console ne forment pas encore un contrat d'événement exploitable automatiquement. Les
journaux fonctionnels restent majoritairement du texte libre et peuvent contenir des noms de serveurs,
de médias ou des messages tiers : ils ne doivent pas alimenter directement GitHub.

La cible retenue est un lot GitHub Actions sans service permanent. Le backend émet une enveloppe JSON
minimale pour trois codes stables. Le moteur ignore tout champ non explicitement autorisé, agrège par
fingerprint et n'écrit dans GitHub que pour le sous-ensemble haute confiance après seuil. Le token
GitHub éphémère n'existe que dans le job CI. Cloud Logging est lu par un compte WIF dédié avec un rôle
read-only et aucune permission de déploiement.

## Preuves de baseline

- `apiErrorMiddleware` journalise déjà la méthode et un code borné, sans message ni en-têtes ; il est
  le point d'émission adapté à `API_UNHANDLED_ERROR`.
- Le garde `startServer().catch(...)` journalise déjà un code de démarrage borné ; il est le point
  d'émission adapté à `BACKEND_STARTUP_FAILED`.
- La synchronisation Plex produit explicitement `integrity.collectionComplete=false` et un nombre de
  sources incomplètes ; ce signal peut être agrégé sous `PLEX_SYNC_PARTIAL`, mais reste report-only car
  une indisponibilité Plex ponctuelle est attendue.
- L'export Cloud Logging du 2 septembre 2026, conservé hors dépôt, a fourni un cas historique réel et
  redigé `PERMISSION_DENIED`/rejet backend. Sa forme redigée est répétée artificiellement cinq fois
  pour exercer le seuil du prototype ; ce replay n'est pas présenté comme le comptage de l'incident.
- Le compte WIF de déploiement ne doit recevoir aucun rôle de lecture des logs. Un compte séparé
  `seenit-log-auditor` reçoit uniquement `roles/logging.viewer` ; aucun rôle de logs privés, d'écriture
  ou de déploiement n'est nécessaire.

## Décisions

1. `API_UNHANDLED_ERROR` et `BACKEND_STARTUP_FAILED` sont les seules règles initialement autorisées à
   proposer une issue ; `PLEX_SYNC_PARTIAL` reste dans le rapport.
2. Une occurrence isolée ne crée jamais d'issue. Les seuils, fingerprints et champs de contexte sont
   versionnés dans le code et testés.
3. Le fingerprint exclut titre, route, UID, corrélation et texte libre. Il repose uniquement sur
   domaine, code stable et contexte technique allowlisté.
4. Le mode du dépôt vaut implicitement `dry-run` tant que la variable
   `SEENIT_LOG_AUDITOR_MODE` ne vaut pas explicitement `live`. La valeur `off` est le kill switch.
5. Le lot plafonne le volume lu, le nombre de créations par run et par 24 heures, et l'enrichissement
   d'une issue existante par cooldown. Il ne ferme jamais d'issue.
6. Le fichier Cloud brut reste temporaire au runner. Seul le rapport agrégé et redigé est archivé.
7. Une panne Cloud Logging ou GitHub rend le job observable, mais n'entre jamais dans le chemin de
   réponse du backend et ne déclenche aucun retry applicatif.

## Matrice exhaustive des constats

| Constat | Priorité | Impact | Décision / critère de sortie | Suivi |
|---|---|---|---|---|
| Événements backend non contractuels | P2 | détection fragile sur texte libre | enveloppe JSON stable et TNR | #27 |
| Risque de fuite par dump brut | P1 | secret ou donnée personnelle dans GitHub | contexte allowlisté, redaction défensive, aucun brut archivé | #27, #30 |
| Une issue par exception | P2 | tempête et backlog inutilisable | seuil, fingerprint, déduplication, cooldown, plafonds | #27 |
| Dépendance runtime à GitHub | P1 | panne applicative en cas d'indisponibilité GitHub | traitement exclusivement batch CI | #27 |
| Collecte permanente payante | P2 | contradiction avec l'objectif 0 € | lot périodique borné, aucune ressource GCP supplémentaire | #27, #23 |
| Synchronisation Plex partielle ambiguë | P2 | faux positif pendant une panne attendue | report-only jusqu'à preuve d'un seuil haute confiance | #27 |

## Points solides à préserver

- Aucun message d'erreur, en-tête, route, token, UID complet ou payload utilisateur dans les événements.
- Les logs techniques locaux restent isolés par UID et volontairement exportables par l'utilisateur.
- L'identité média n'utilise jamais un titre pour classifier ou dédupliquer une anomalie.
- Le backend répond indépendamment du lot d'audit et de GitHub.
- GitHub `main` reste la source canonique des règles et du workflow.

## Limites et preuves restant à compléter

- Le replay historique est redigé et dérivé d'un export réel documenté ; le brut reste volontairement
  hors dépôt et ne sera pas archivé par la CI.
- Le compte dédié et son rôle `roles/logging.viewer` doivent être appliqués une fois via le bootstrap
  GCP avant le premier lot Cloud réel. Cette permission est read-only mais porte sur les logs standards
  du projet ; le compte de déploiement reste inchangé.
- La création live restera désactivée tant que le dry-run et les TNR ne sont pas verts. La preuve du
  premier run Cloud sera ajoutée à #27 sans y copier d'événement brut.

## Preuves d'implémentation

- Replay local du fixture historique redigé : 5 entrées acceptées, 0 rejetée, 1 fingerprint
  `25b973e705fbdfae1589`, décision `dry_run_would_create`, aucune écriture GitHub.
- TNR ciblés : erreur isolée ignorée, 20 occurrences regroupées en un candidat, deux contextes en deux
  fingerprints, bug existant enrichi, cooldown, plafonds run/jour, tempête de 5 500 événements tronquée
  à 5 000, source/GitHub indisponibles contenus et champs sensibles absents.
- Contrat runtime : erreurs API, boucle de démarrage et collecte Plex partielle émettent uniquement
  l'enveloppe `seenitEvent` allowlistée. La règle Plex reste report-only.
- Validation ciblée du 10 septembre 2026 : TypeScript, SPEC et 6 tests backend/auditeur verts.
