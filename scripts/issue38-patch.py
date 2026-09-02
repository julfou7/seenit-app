from pathlib import Path
import json


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Motif introuvable: {label}')
    return text.replace(old, new, 1)


# server.ts — expose l'état courant explicite viewCount depuis le FULL.
p = Path('server.ts')
s = p.read_text()
s = replace_once(
    s,
    'import { evaluatePlexSourceCompletion } from "./src/features/plex/plexSyncIntegrity.ts";\n',
    'import { evaluatePlexSourceCompletion } from "./src/features/plex/plexSyncIntegrity.ts";\nimport { buildPlexLibraryWatchState, mergePlexLibraryWatchStates } from "./src/features/plex/plexLibraryWatchState.ts";\n',
    'import watch state'
)
s = s.replace(
    '// 3. Interroger chaque serveur. En FULL, la bibliothèque actuelle gouverne les\n      // imports Plex et la disponibilité, sans effacer les actions manuelles SeenIt. L\'historique PMS n\'est\n      // qu\'un fallback si le Watch History du compte Plex n\'a fourni aucun GUID.',
    '// 3. Interroger chaque serveur. En FULL, la bibliothèque actuelle gouverne les\n      // imports Plex, la disponibilité ET l’état vu/non-vu explicite via viewCount. L’historique PMS n’est\n      // qu’un fallback si le Watch History du compte Plex n’a fourni aucun GUID.'
)
s = replace_once(
    s,
    "      const syncedServers: Array<{ id: string; name: string; watchedItems: number; inventoryItems: number }> = [];\n      const skippedServers: Array<{ id: string; name: string; reason: string }> = [];\n",
    "      const syncedServers: Array<{ id: string; name: string; watchedItems: number; inventoryItems: number }> = [];\n      const skippedServers: Array<{ id: string; name: string; reason: string }> = [];\n      const libraryWatchStateItems: any[] = [];\n",
    'global watch states'
)
s = replace_once(
    s,
    "          const connectionAvailabilityItems: any[] = [];\n          const connectionLibraryGuids = new Set<string>();\n",
    "          const connectionAvailabilityItems: any[] = [];\n          const connectionWatchStateItems: any[] = [];\n          const connectionLibraryGuids = new Set<string>();\n",
    'connection watch states'
)
s = replace_once(
    s,
    "                      for (const movie of movies) {\n                        if (typeof movie?.guid === 'string' && movie.guid) connectionLibraryGuids.add(movie.guid);\n                        connectionAvailabilityItems.push({ raw: movie, serverName, serverId });\n                      }\n",
    "                      for (const movie of movies) {\n                        if (typeof movie?.guid === 'string' && movie.guid) connectionLibraryGuids.add(movie.guid);\n                        connectionAvailabilityItems.push({ raw: movie, serverName, serverId });\n                        const watchState = buildPlexLibraryWatchState(movie, { mediaType: 'movie', serverName, serverId });\n                        if (watchState) connectionWatchStateItems.push(watchState);\n                      }\n",
    'movie states'
)
s = replace_once(
    s,
    "                  if (secType === 'show') {\n                    // 1) Liste des séries = index de disponibilité Plex pour les fiches SeenIt.\n                    try {\n",
    "                  if (secType === 'show') {\n                    const showTmdbByRatingKey = new Map<string, number>();\n                    const showTmdbByGuid = new Map<string, number>();\n                    // 1) Liste des séries = index de disponibilité Plex pour les fiches SeenIt.\n                    try {\n",
    'show maps'
)
s = replace_once(
    s,
    "                      for (const show of shows) {\n                        if (typeof show?.guid === 'string' && show.guid) connectionLibraryGuids.add(show.guid);\n                        connectionAvailabilityItems.push({ raw: show, serverName, serverId });\n                      }\n",
    "                      for (const show of shows) {\n                        if (typeof show?.guid === 'string' && show.guid) connectionLibraryGuids.add(show.guid);\n                        connectionAvailabilityItems.push({ raw: show, serverName, serverId });\n                        const ids = extractPlexExternalIds(show);\n                        const tmdbId = Number(ids.tmdbId);\n                        if (Number.isInteger(tmdbId) && tmdbId > 0) {\n                          const ratingKey = getPlexMetadataLookupKey(show);\n                          if (ratingKey) showTmdbByRatingKey.set(String(ratingKey), tmdbId);\n                          const guidCandidates = [show?.guid, ...(Array.isArray(show?.Guid) ? show.Guid.map((g: any) => typeof g === 'string' ? g : g?.id) : [])];\n                          for (const guid of guidCandidates) if (typeof guid === 'string' && guid) showTmdbByGuid.set(guid, tmdbId);\n                        }\n                      }\n",
    'show map population'
)
s = replace_once(
    s,
    "                      for (const episode of episodes) {\n                        if (typeof episode?.guid === 'string' && episode.guid) connectionLibraryGuids.add(episode.guid);\n                      }\n\n                      const watchedEpisodes = episodes.filter(isPlexLibraryItemWatched);\n",
    "                      for (const episode of episodes) {\n                        if (typeof episode?.guid === 'string' && episode.guid) connectionLibraryGuids.add(episode.guid);\n                        const parentIdentity = buildPlexParentShowIdentityItem(episode);\n                        const directTmdb = Number(extractPlexExternalIds(parentIdentity).tmdbId);\n                        const parentRatingKey = getPlexParentShowMetadataLookupKey(episode);\n                        const parentGuidCandidates = [episode?.grandparentGuid, ...(Array.isArray(episode?.grandparentGuids) ? episode.grandparentGuids.map((g: any) => typeof g === 'string' ? g : g?.id) : [])];\n                        let parentTmdbId = Number.isInteger(directTmdb) && directTmdb > 0 ? directTmdb : null;\n                        if (!parentTmdbId && parentRatingKey) parentTmdbId = showTmdbByRatingKey.get(String(parentRatingKey)) || null;\n                        if (!parentTmdbId) {\n                          for (const guid of parentGuidCandidates) {\n                            if (typeof guid === 'string' && showTmdbByGuid.has(guid)) {\n                              parentTmdbId = showTmdbByGuid.get(guid) || null;\n                              break;\n                            }\n                          }\n                        }\n                        const watchState = buildPlexLibraryWatchState(episode, { mediaType: 'episode', parentTmdbId, serverName, serverId });\n                        if (watchState) connectionWatchStateItems.push(watchState);\n                      }\n\n                      const watchedEpisodes = episodes.filter(isPlexLibraryItemWatched);\n",
    'episode states'
)
s = replace_once(
    s,
    "              libraryAvailabilityItems.push(...connectionAvailabilityItems);\n              connectionLibraryGuids.forEach((guid) => currentLibraryGuids.add(guid));\n",
    "              libraryAvailabilityItems.push(...connectionAvailabilityItems);\n              libraryWatchStateItems.push(...connectionWatchStateItems);\n              connectionLibraryGuids.forEach((guid) => currentLibraryGuids.add(guid));\n",
    'commit watch states'
)
s = replace_once(
    s,
    "      const stats = {\n        ...sourceStats,\n",
    "      const normalizedLibraryWatchStates = delta ? [] : mergePlexLibraryWatchStates(libraryWatchStateItems);\n\n      const stats = {\n        ...sourceStats,\n",
    'normalized watch states'
)
s = replace_once(
    s,
    "        libraryAvailability: normalizedLibraryAvailability,\n        stats,\n",
    "        libraryAvailability: normalizedLibraryAvailability,\n        libraryWatchStates: normalizedLibraryWatchStates,\n        stats,\n",
    'response watch states'
)
p.write_text(s)


# syncPlex.ts — consomme les non-vu explicites après les ajouts vus.
p = Path('src/features/plex/syncPlex.ts')
s = p.read_text()
s = replace_once(
    s,
    "import { mergeAdditivePlexProgress } from './plexAdditiveSync';\n",
    "import { applyExplicitPlexUnwatch, mergePlexProgressMutation } from './plexProgressMerge';\nimport type { PlexLibraryWatchState } from './plexLibraryWatchState';\n",
    'sync imports'
)
s = replace_once(
    s,
    "      const { history = [], watchlist = [], libraryAvailability = [], visitedSources = [] } = plexData || {};\n",
    "      const { history = [], watchlist = [], libraryAvailability = [], libraryWatchStates = [], visitedSources = [] } = plexData || {};\n",
    'sync destructure'
)
s = replace_once(
    s,
    "      const hasWatchlist = Array.isArray(watchlist) && watchlist.length > 0;\n\n      if (!hasHistory && !hasWatchlist) {\n",
    "      const hasWatchlist = Array.isArray(watchlist) && watchlist.length > 0;\n      const hasLibraryWatchStates = Array.isArray(libraryWatchStates) && libraryWatchStates.length > 0;\n\n      if (!hasHistory && !hasWatchlist && !hasLibraryWatchStates) {\n",
    'early return'
)
s = replace_once(
    s,
    "      const totalItemsCount = (history?.length || 0) + (watchlist?.length || 0);\n",
    "      const totalItemsCount = (history?.length || 0) + (watchlist?.length || 0) + (libraryWatchStates?.length || 0);\n",
    'progress total'
)
s = replace_once(
    s,
    "      const showsList: Show[] = authoritativeShows.map((show) => ({ ...show }));\n",
    "      const showsList: Show[] = authoritativeShows.map((show) => ({ ...show }));\n      const baselineShowsById = new Map(authoritativeShows.map((show) => [show.id, { ...show, seenEpisodes: [...(show.seenEpisodes || [])], episodeRecords: { ...(show.episodeRecords || {}) } } as Show]));\n",
    'baseline'
)
s = replace_once(s, "      let repairedCount = 0;\n", "      let repairedCount = 0;\n      let unwatchedCount = 0;\n", 'unwatch count')
marker = '\n      // Process Plex Watchlist items (auto-import to "À Voir" / "Ma Liste")\n'
reconciliation = '''

      // Un FULL Plex contient l'état courant explicite viewCount de la bibliothèque.
      // On applique les non-vu APRÈS les ajouts d'historique afin qu'un viewCount=0
      // courant gagne sur un événement historique plus ancien. Une absence seule ne
      // vaut jamais dé-vu : seuls les états reçus ici peuvent supprimer une progression.
      if (hasLibraryWatchStates) {
        for (const state of libraryWatchStates as PlexLibraryWatchState[]) {
          if (!state || state.watched !== false) continue;
          const mediaType = state.mediaType === 'movie' ? 'movie' : 'tv';
          const matched = showsList.find(show => Number(show.tmdbId) === Number(state.tmdbId) && show.mediaType === mediaType);
          if (!matched) continue;

          const current = mutatedShows[matched.id] || matched;
          const result = applyExplicitPlexUnwatch(current, state);
          if (!result.changed) continue;

          mutatedShows[matched.id] = result.show;
          const listIndex = showsList.findIndex(show => show.id === matched.id);
          if (listIndex >= 0) showsList[listIndex] = result.show;
          unwatchedCount++;
          syncCount++;
          if (mediaType === 'movie') moviesCount++;
          else episodesCount++;

          const identity = state.mediaType === 'movie'
            ? `unwatch:movie:${state.tmdbId}`
            : `unwatch:tv:${state.tmdbId}:${state.seasonNumber}:${state.episodeNumber}`;
          queueSyncedItem(identity, {
            title: result.show.title,
            subtitle: state.mediaType === 'movie'
              ? 'Dé-vu sur Plex'
              : `S${state.seasonNumber} | E${state.episodeNumber} • Dé-vu sur Plex`,
            posterPath: result.show.posterPath,
            mediaType,
            show: result.show
          });
        }
      }
'''
if marker not in s:
    raise SystemExit('Motif introuvable: watchlist marker')
s = s.replace(marker, reconciliation + marker, 1)
s = replace_once(
    s,
    "              const currentSeenItState = snapshot.exists() ? snapshot.data() : null;\n              const additiveData = mergeAdditivePlexProgress(currentSeenItState, data);\n              const cleanData = cleanShowForFirestore(additiveData, user.uid);\n              transaction.set(ref, cleanData, { merge: true });\n",
    "              const currentSeenItState = snapshot.exists() ? snapshot.data() : null;\n              const baseline = baselineShowsById.get(data.id) || null;\n              const reconciledData = mergePlexProgressMutation(currentSeenItState, baseline, data);\n              const cleanData = cleanShowForFirestore(reconciledData, user.uid);\n              // Remplacement complet : nécessaire pour que les clés episodeRecords supprimées\n              // par un dé-vu disparaissent réellement de Firestore.\n              transaction.set(ref, cleanData);\n",
    'transaction merge'
)
s = replace_once(
    s,
    "      if (cacheModified) {\n",
    "      if (unwatchedCount > 0) {\n        appLogger.info('plex', `[Plex Sync] ${unwatchedCount} dé-vu explicite(s) réconcilié(s) depuis l’inventaire courant.`);\n      }\n\n      if (cacheModified) {\n",
    'unwatch log'
)
p.write_text(s)

Path('src/features/plex/plexAdditiveSync.ts').unlink(missing_ok=True)
Path('tests/plexAdditiveSync.test.ts').unlink(missing_ok=True)


# SPEC : corriger la règle SEENIT-PLEX-006, conserver le toast.
p = Path('docs/specifications/seenit.md')
s = p.read_text()
old = "- **SEENIT-PLEX-006** — La synchronisation Plex est explicitement additive : un « dé-vu » Plex,\n  une absence dans l’historique ou un état non vu ne suppriment jamais un visionnage, une progression,\n  une note ou une action manuelle déjà enregistrés dans SeenIt. Plex peut ajouter une preuve de\n  visionnage autoritative, mais seule une action explicite dans SeenIt peut retirer cet état. Les\n  écritures Plex relisent l’état Firestore courant avant commit afin de préserver une action SeenIt\n  concurrente déclenchée pendant une synchronisation longue.\n"
new = "- **SEENIT-PLEX-006** — Un scan Plex complet réconcilie l’état vu **et explicitement non vu**\n  des films et épisodes présents dans l’inventaire courant. Un `viewCount > 0` constitue une preuve vue ;\n  un `viewCount = 0` explicitement observé retire le visionnage SeenIt correspondant. Une simple absence\n  dans l’historique incrémental ne vaut jamais dé-vu. En présence de plusieurs copies du même média, une\n  copie vue gagne sur une copie non vue. L’écriture Firestore applique uniquement les mutations de\n  progression produites par le scan afin de ne pas écraser une action SeenIt concurrente non concernée.\n"
if old not in s:
    raise SystemExit('Ancienne règle SEENIT-PLEX-006 introuvable')
p.write_text(s.replace(old, new, 1))


# Catalogue de tests.
p = Path('docs/specifications/requirements.json')
data = json.loads(p.read_text())
req = next(r for r in data['requirements'] if r['id'] == 'SEENIT-PLEX-006')
req['title'] = 'Synchronisation bidirectionnelle de l’état vu/non-vu Plex autoritatif'
req['targets'] = ['backend', 'pwa', 'apk']
req['tests'] = [
    {'file': 'tests/plexProgressMerge.test.ts', 'contains': 'SEENIT-PLEX-006 un dé-vu Plex retire un film vu dans SeenIt'},
    {'file': 'tests/plexProgressMerge.test.ts', 'contains': 'SEENIT-PLEX-006 un dé-vu Plex retire uniquement l’épisode visé'},
    {'file': 'tests/plexProgressMerge.test.ts', 'contains': 'SEENIT-PLEX-006 une preuve vue ne passe pas par le chemin de dé-vu'},
    {'file': 'tests/plexProgressMerge.test.ts', 'contains': 'SEENIT-PLEX-006 le dé-vu est idempotent'},
    {'file': 'tests/plexProgressMerge.test.ts', 'contains': 'SEENIT-PLEX-006 une copie vue gagne sur une copie non vue du même média'},
    {'file': 'tests/plexProgressMerge.test.ts', 'contains': 'SEENIT-PLEX-006 la transaction conserve une action concurrente SeenIt non visée'},
    {'file': 'tests/plexProgressMerge.test.ts', 'contains': 'SEENIT-PLEX-006 le runtime transmet les états courants et remplace les cartes supprimées'}
]
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


# Registre : corrige la décision erronée plutôt que d'empiler deux règles contradictoires.
p = Path('docs/requests/registry.md')
s = p.read_text()
old = "| USR-2026-09-02-004 | 2026-09-02 | La synchronisation Plex est explicitement additive : un média ou épisode « dé-vu » côté Plex ne supprime jamais un visionnage, une progression ou une action manuelle déjà enregistrés dans SeenIt. | `SEENIT-PLEX-006`, [issue #38](https://github.com/julfou7/seenit-app/issues/38) | active |"
new = "| USR-2026-09-02-004 | 2026-09-02 | La synchronisation Plex complète est bidirectionnelle pour le visionnage : un « vu » Plex ajoute la progression et un `viewCount=0` explicitement observé retire le film/épisode correspondant dans SeenIt ; une simple absence d’historique ne vaut jamais dé-vu. | `SEENIT-PLEX-006`, [issue #38](https://github.com/julfou7/seenit-app/issues/38) | active |"
if old not in s:
    raise SystemExit('Ligne registre #38 introuvable')
p.write_text(s.replace(old, new, 1))
