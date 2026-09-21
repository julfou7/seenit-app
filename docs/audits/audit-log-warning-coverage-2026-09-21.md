# Audit de couverture des warnings SeenIt — 21/09/2026

- **Identifiant** : AUDIT-2026-09-21-WARNING-COVERAGE
- **Date** : 21 septembre 2026
- **Dernière vérification** : 21 septembre 2026
- **Statut** : implémentation #27 en validation
- **Baseline / commit observé** : `faec21af59fe347c7c53a343068274c0cb80c731`
- **Périmètre** : `server.ts` + sources TypeScript `src/**`
- **Suivi** : issue #27
- **But** : étendre l’amélioration continue sans téléverser les warnings PWA/APK

## Preuves reproductibles

- inventaire statique des appels `console.warn`, `appLogger.warn` et événements structurés sur le commit observé ;
- comparaison avec le filtre Cloud Logging `jsonPayload.seenitEvent.schemaVersion=1` ;
- TNR `tests/logAuditor.test.ts` et `tests/logAuditorWorkflow.test.ts` ;
- validation canonique `npm run validate:change` sur le SHA exact de quarantaine.

## Mesure de l’angle mort backend

La frontière Cloud Run contient 12 sites `console.warn` dans `server.ts` et
`src/features/runtime/backendRuntime.ts`. Avant ce changement, seul le warning
`PLEX_SYNC_PARTIAL` était immédiatement suivi d’un `seenitEvent`.

**Résultat : 11/12 sites warning backend étaient invisibles à l’auto-auditeur.**

Cette métrique mesure les warnings de la frontière backend collectable par Cloud Logging sans
télémétrie client ; elle ne prétend pas compter tous les `error` ou logs de l’application.

## Classement par domaine

| Domaine | Signaux constatés | Décision |
|---|---|---|
| Backend/API | exceptions non gérées, démarrage | auto-issue haute confiance déjà existante |
| Plex backend | sync partielle, lecture/écriture snapshot, delta et seed full | première vague structurée + seuils |
| TMDB/providers backend | `TMDB_REQUEST_CACHE_SUMMARY` | report-only agrégé existant |
| Firestore/auth PWA/APK | erreurs de sync, listener, auth | local/report-only ; aucun upload par warning |
| Notifications PWA/APK | planification, cache visuel, permissions | local/report-only |
| Téléchargements | Sonarr/Radarr/qBittorrent/C411 | local/report-only tant qu’aucune frontière backend stable n’est définie |
| Mise à jour APK | téléchargement/installation/check | local/report-only |
| Cache/hydratation/UI | fallbacks et erreurs de chargement | local/report-only |

## Première vague livrée

Les six warnings `Plex Delta Snapshot` de `backendRuntime.ts` sont remplacés par des événements
structurés. Aucun nouvel appel réseau, polling, flush client ou service permanent n’est ajouté.

Règles warning : `PLEX_SYNC_PARTIAL` (20), `PLEX_SNAPSHOT_STORE_FAILED` (6),
`PLEX_DELTA_SNAPSHOT_FAILED` (4) et `PLEX_FULL_SNAPSHOT_SEED_FAILED` (4).

Les codes inconnus restent report-only. Une issue de qualification n’est possible qu’après au moins une
occurrence dans chacune de deux fenêtres consécutives de six heures et huit occurrences cumulées. Le
contexte libre est supprimé et le fingerprint ne dépend que du domaine/code stables.

## Budget

- collecte structurée : 5 000 entrées maximum ;
- cadence : toutes les six heures ;
- lookback : 12 h uniquement pour comparer deux fenêtres de 6 h ;
- nouvelles issues : 3 maximum par run et par jour UTC ;
- cooldown d’enrichissement : 6 h ;
- aucun trafic supplémentaire PWA/APK ;
- aucun log brut archivé.


## Matrice exhaustive des constats

| Priorité | Constat | Impact | Sortie | Suivi |
|---|---|---|---|---|
| P2 | 11/12 warnings de la frontière Cloud Run étaient invisibles à l’auto-auditeur | dégradations répétées non transformées en backlog | première vague Plex structurée + TNR verts | [#27](https://github.com/julfou7/seenit-app/issues/27) |
| P2 | les warnings PWA/APK sont nombreux mais locaux | risque de sur-télémétrie et coût si upload naïf | aucun upload individuel ; classification locale/report-only | [#27](https://github.com/julfou7/seenit-app/issues/27) |
| P2 | un nouveau code warning peut apparaître avant sa règle dédiée | angle mort futur | issue de qualification seulement après 2 fenêtres et 8 occurrences cumulées | [#27](https://github.com/julfou7/seenit-app/issues/27) |

## Points solides à préserver

La redaction, les fingerprints stables, le plafond de trois issues, le cooldown de six heures, le kill
switch et l’absence de dépendance runtime à GitHub restent inchangés.
