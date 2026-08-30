const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceOnce(content, before, after, label) {
  const index = content.indexOf(before);
  if (index < 0) throw new Error(`Motif introuvable: ${label}`);
  if (content.indexOf(before, index + before.length) >= 0) throw new Error(`Motif non unique: ${label}`);
  return content.slice(0, index) + after + content.slice(index + before.length);
}

// 1) Corrélation explicite d'une demande SeenIt entre *Arr et qBittorrent.
{
  const path = 'src/features/downloads/downloadIdentity.ts';
  let content = read(path);
  content = replaceOnce(
    content,
    `  isOptimistic?: boolean | null;\n}`,
    `  isOptimistic?: boolean | null;\n  /** Identifiant interne de la demande SeenIt ayant créé ce transfert. */\n  requestId?: string | null;\n}`,
    'requestId DownloadIdentityLike'
  );
  content = replaceOnce(
    content,
    `export function mergeDownloadIdAliases(...items: Array<DownloadIdentityLike | null | undefined>): string[] {\n  const aliases = new Set<string>();\n  for (const item of items) {\n    for (const id of getPhysicalDownloadIds(item)) aliases.add(id);\n  }\n  return Array.from(aliases);\n}\n`,
    `export function mergeDownloadIdAliases(...items: Array<DownloadIdentityLike | null | undefined>): string[] {\n  const aliases = new Set<string>();\n  for (const item of items) {\n    for (const id of getPhysicalDownloadIds(item)) aliases.add(id);\n  }\n  return Array.from(aliases);\n}\n\n/**\n * Corrélation interne sûre : le requestId n'est attribué qu'à la demande créée\n * par SeenIt et aux représentations distantes qui lui ont été rattachées.\n */\nexport function sameDownloadRequest(\n  a?: DownloadIdentityLike | null,\n  b?: DownloadIdentityLike | null\n): boolean {\n  const aRequestId = typeof a?.requestId === 'string' ? a.requestId.trim() : '';\n  const bRequestId = typeof b?.requestId === 'string' ? b.requestId.trim() : '';\n  return Boolean(aRequestId && bRequestId && aRequestId === bRequestId);\n}\n`,
    'sameDownloadRequest'
  );
  write(path, content);
}

// 2) Helper testable : une intention optimiste enrichit les métadonnées mais ne
// touche jamais à la télémétrie d'un transfert distant déjà observé.
{
  const path = 'src/features/downloads/downloadReconciliation.ts';
  write(path, `import type { LiveDownloadItem } from '../../services/sonarrRadarr';\nimport { mergeDownloadIdAliases } from './downloadIdentity';\n\n/**\n * Fusionne une mutation optimiste arrivée pendant un poll avec un snapshot distant.\n * Le distant reste l'unique source de vérité pour progress/status/débit/ETA.\n */\nexport function mergeLateOptimisticMetadata(\n  remote: LiveDownloadItem,\n  optimistic: LiveDownloadItem\n): LiveDownloadItem {\n  return {\n    ...remote,\n    requestId: remote.requestId || optimistic.requestId || optimistic.id,\n    tmdbId: remote.tmdbId || optimistic.tmdbId,\n    tvdbId: remote.tvdbId || optimistic.tvdbId,\n    imdbId: remote.imdbId || optimistic.imdbId,\n    posterPath: remote.posterPath || optimistic.posterPath,\n    backdropPath: remote.backdropPath || optimistic.backdropPath,\n    movieTitle: remote.movieTitle || (remote.mediaType === 'movie'\n      ? (optimistic.movieTitle || optimistic.title)\n      : undefined),\n    seriesTitle: remote.seriesTitle || (remote.mediaType === 'tv'\n      ? (optimistic.seriesTitle || optimistic.title)\n      : undefined),\n    seasonNumber: remote.seasonNumber ?? optimistic.seasonNumber,\n    episodeNumber: remote.episodeNumber ?? optimistic.episodeNumber,\n    addedAt: remote.addedAt || optimistic.addedAt,\n    downloadIdAliases: mergeDownloadIdAliases(remote, optimistic),\n    isOptimistic: false,\n    isRestored: false\n  };\n}\n`);
}

// 3) LiveDownloadItem transporte la corrélation SeenIt.
{
  const path = 'src/services/sonarrRadarr.ts';
  let content = read(path);
  content = replaceOnce(
    content,
    `  isRestored?: boolean;\n  isOptimistic?: boolean;\n}`,
    `  isRestored?: boolean;\n  isOptimistic?: boolean;\n  /** Demande SeenIt d'origine, utilisée pour corréler *Arr et qBittorrent sans le nom. */\n  requestId?: string;\n}`,
    'requestId LiveDownloadItem'
  );
  write(path, content);
}

// 4) Store : télémétrie distante prioritaire, révisions locales anti-race,
// corrélation requestId et annulation terminale.
{
  const path = 'src/store/liveDownloadStore.ts';
  let content = read(path);

  content = replaceOnce(
    content,
    `import { canAttachRecentOptimisticRequest, getPhysicalDownloadId, getStrongPhysicalDownloadIds, hasConflictingStrongPhysicalIds, mergeDownloadIdAliases, sameLegacyPhysicalTransfer, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';\nimport { fetchRecentDownloadHistory, resolveDownloadHistoryOutcome } from '../features/downloads/downloadHistory';`,
    `import { canAttachRecentOptimisticRequest, getPhysicalDownloadId, getStrongPhysicalDownloadIds, hasConflictingStrongPhysicalIds, mergeDownloadIdAliases, sameDownloadRequest, sameLegacyPhysicalTransfer, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';\nimport { mergeLateOptimisticMetadata } from '../features/downloads/downloadReconciliation';\nimport { fetchRecentDownloadHistory, resolveDownloadHistoryOutcome } from '../features/downloads/downloadHistory';`,
    'imports reconciliation'
  );

  content = replaceOnce(
    content,
    `const optimisticTimestamps: Record<string, number> = {};\nconst missingSince: Record<string, number> = {};\nconst completionNotificationEligibility = new Set<string>();`,
    `const optimisticTimestamps: Record<string, number> = {};\nconst missingSince: Record<string, number> = {};\nconst completionNotificationEligibility = new Set<string>();\nlet localMutationRevision = 0;\nconst localItemMutationRevision: Record<string, number> = {};\n\nfunction markLocalItemMutation(id: string) {\n  localMutationRevision += 1;\n  localItemMutationRevision[id] = localMutationRevision;\n}`,
    'local mutation revision'
  );

  content = replaceOnce(
    content,
    `function isTerminalDownload(item: LiveDownloadItem): boolean {\n  return item.status === 'completed' || Number(item.progress || 0) >= 100;\n}\n\nfunction sameDownloadIdentity(a: LiveDownloadItem, b: LiveDownloadItem): boolean {\n  if (a.id === b.id) return true;\n  if (samePhysicalDownload(a, b)) return true;`,
    `function isCancelledDownload(item: LiveDownloadItem): boolean {\n  return String(item.status || '').toLowerCase() === 'cancelled';\n}\n\nfunction isTerminalDownload(item: LiveDownloadItem): boolean {\n  return isCancelledDownload(item) || item.status === 'completed' || Number(item.progress || 0) >= 100;\n}\n\nfunction sameDownloadIdentity(a: LiveDownloadItem, b: LiveDownloadItem): boolean {\n  if (a.id === b.id) return true;\n  if (sameDownloadRequest(a, b)) return true;\n  if (samePhysicalDownload(a, b)) return true;`,
    'terminal cancelled + request identity'
  );

  content = replaceOnce(
    content,
    `  return Boolean(a.isOptimistic || b.isOptimistic || a.isRestored || b.isRestored);\n}\n\nfunction sendLocalNotification`,
    `  return Boolean(a.isOptimistic || b.isOptimistic || a.isRestored || b.isRestored);\n}\n\nfunction sameCancellationIdentity(cancelled: LiveDownloadItem, remote: LiveDownloadItem, now = Date.now()): boolean {\n  if (sameDownloadIdentity(cancelled, remote)) return true;\n  if (cancelled.mediaType !== remote.mediaType) return false;\n\n  const sameCanonical = Boolean(\n    cancelled.tmdbId && remote.tmdbId && Number(cancelled.tmdbId) === Number(remote.tmdbId)\n  ) || Boolean(\n    cancelled.tvdbId && remote.tvdbId && Number(cancelled.tvdbId) === Number(remote.tvdbId)\n  );\n\n  if (sameCanonical) {\n    if (cancelled.mediaType === 'tv') {\n      if (cancelled.seasonNumber != null && remote.seasonNumber != null\n          && Number(cancelled.seasonNumber) !== Number(remote.seasonNumber)) return false;\n      if (cancelled.episodeNumber != null && remote.episodeNumber != null\n          && Number(cancelled.episodeNumber) !== Number(remote.episodeNumber)) return false;\n    }\n    const cancelledResolution = resolutionBucket(cancelled);\n    const remoteResolution = resolutionBucket(remote);\n    return !(cancelledResolution && remoteResolution && cancelledResolution !== remoteResolution);\n  }\n\n  // Pour une recherche manuelle sans ID canonique, la fenêtre temporelle + type +\n  // scope + résolution suffit, toujours sans utiliser le titre comme identité.\n  return canAttachRecentOptimisticRequest(\n    { ...cancelled, isOptimistic: true },\n    remote,\n    now,\n    5 * 60_000\n  );\n}\n\nfunction sendLocalNotification`,
    'cancellation identity'
  );

  content = replaceOnce(
    content,
    `      addOptimisticDownload: item => {\n        const candidate: LiveDownloadItem = {\n          id: item.id || \`opt_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\`,`,
    `      addOptimisticDownload: item => {\n        const candidateId = item.id || \`opt_\${Date.now()}_\${Math.random().toString(36).slice(2, 8)}\`;\n        const candidate: LiveDownloadItem = {\n          id: candidateId,\n          requestId: item.requestId || candidateId,`,
    'candidate request id'
  );

  content = replaceOnce(
    content,
    `        if (existing) {\n          optimisticTimestamps[existing.id] = Date.now();\n          set(state => ({`,
    `        if (existing) {\n          optimisticTimestamps[existing.id] = Date.now();\n          markLocalItemMutation(existing.id);\n          set(state => ({`,
    'revision existing optimistic'
  );
  content = replaceOnce(
    content,
    `        optimisticTimestamps[candidate.id] = Date.now();\n        set(state => ({ downloads: [candidate, ...state.downloads] }));`,
    `        optimisticTimestamps[candidate.id] = Date.now();\n        markLocalItemMutation(candidate.id);\n        set(state => ({ downloads: [candidate, ...state.downloads] }));`,
    'revision new optimistic'
  );
  content = replaceOnce(
    content,
    `      updateDownloadRequest: (id, patch) => {\n        const existing = get().downloads.find(download => download.id === id);`,
    `      updateDownloadRequest: (id, patch) => {\n        const existing = get().downloads.find(download => download.id === id);\n        markLocalItemMutation(id);`,
    'revision update request'
  );

  content = replaceOnce(
    content,
    `        try {\n          const currentDownloads = get().downloads || [];\n          const rawServerItems = await fetchLiveDownloadsQueue({`,
    `        try {\n          const fetchStartedMutationRevision = localMutationRevision;\n          const currentDownloads = get().downloads || [];\n          const rawServerItems = await fetchLiveDownloadsQueue({`,
    'capture fetch revision'
  );

  content = replaceOnce(
    content,
    `          const removedSet = new Set(prunedRemovedIds);\n          const serverItems = rawServerItems.filter(item => !removedSet.has(item.id));\n          const localShows = useShowsStore.getState().shows || [];`,
    `          const removedSet = new Set(prunedRemovedIds);\n          const cancelledLocals = currentDownloads.filter(isCancelledDownload);\n          const serverItems = rawServerItems.filter(item =>\n            !removedSet.has(item.id)\n            && !cancelledLocals.some(cancelled => sameCancellationIdentity(cancelled, item))\n          );\n          const localShows = useShowsStore.getState().shows || [];`,
    'filter cancelled remotes'
  );

  content = replaceOnce(
    content,
    `              if (!serverItem.addedAt && localMatch.addedAt) serverItem.addedAt = localMatch.addedAt;\n              serverItem.isRestored = false;`,
    `              if (!serverItem.addedAt && localMatch.addedAt) serverItem.addedAt = localMatch.addedAt;\n              if (!serverItem.requestId && localMatch.requestId) serverItem.requestId = localMatch.requestId;\n              serverItem.isRestored = false;`,
    'propagate requestId from previous poll'
  );

  const staleTelemetryBefore = `              // Si qBittorrent est momentanément indisponible, ne jamais faire reculer\n              // la progression physique connue au poll précédent.\n              if ((samePhysicalDownload(localMatch, serverItem) || sameTransferPath(localMatch, serverItem) || sameLegacyPhysicalTransfer(localMatch, serverItem))\n                  && Number(localMatch.progress || 0) > Number(serverItem.progress || 0)) {\n                serverItem.progress = localMatch.progress;\n                if (localMatch.size > 0) serverItem.size = localMatch.size;\n                serverItem.sizeleft = localMatch.sizeleft;\n                if (localMatch.speedBytesPerSec) serverItem.speedBytesPerSec = localMatch.speedBytesPerSec;\n                if (localMatch.speedFormatted) serverItem.speedFormatted = localMatch.speedFormatted;\n                if (localMatch.timeleftSeconds) serverItem.timeleftSeconds = localMatch.timeleftSeconds;\n                if (localMatch.timeleft) serverItem.timeleft = localMatch.timeleft;\n                if (serverItem.status !== 'error' && localMatch.status !== 'error') {\n                  serverItem.status = localMatch.status;\n                  serverItem.statusText = localMatch.statusText;\n                  serverItem.downloadClient = localMatch.downloadClient || serverItem.downloadClient;\n                }\n              }`;
  const staleTelemetryAfter = `              // La progression ne recule pas sur une micro-coupure de source, mais la\n              // télémétrie live (débit/ETA/status) n'est JAMAIS recopiée depuis l'ancien\n              // snapshot. C'est ce recyclage qui figeait visuellement 1 % jusqu'à 100 %.\n              if ((samePhysicalDownload(localMatch, serverItem) || sameTransferPath(localMatch, serverItem) || sameLegacyPhysicalTransfer(localMatch, serverItem) || sameDownloadRequest(localMatch, serverItem))\n                  && Number(localMatch.progress || 0) > Number(serverItem.progress || 0)) {\n                serverItem.progress = localMatch.progress;\n                if (localMatch.size > 0) serverItem.size = localMatch.size;\n                if (serverItem.size > 0 && Number(localMatch.sizeleft || 0) >= 0) {\n                  const remoteLeft = Number(serverItem.sizeleft || serverItem.size);\n                  serverItem.sizeleft = Math.min(remoteLeft, Number(localMatch.sizeleft || remoteLeft));\n                }\n              }`;
  content = replaceOnce(content, staleTelemetryBefore, staleTelemetryAfter, 'do not recycle stale telemetry');

  content = replaceOnce(
    content,
    `            const optimistic = entry.optimistic;\n            if (!serverItem.tmdbId && optimistic.tmdbId) serverItem.tmdbId = optimistic.tmdbId;`,
    `            const optimistic = entry.optimistic;\n            serverItem.requestId = serverItem.requestId || optimistic.requestId || optimistic.id;\n            if (!serverItem.tmdbId && optimistic.tmdbId) serverItem.tmdbId = optimistic.tmdbId;`,
    'handshake requestId'
  );

  content = replaceOnce(
    content,
    `          const mergeRepresentations = (a: LiveDownloadItem, b: LiveDownloadItem): LiveDownloadItem => {\n            const meta = metadataScore(a) >= metadataScore(b) ? a : b;\n            const live = liveScore(a) >= liveScore(b) ? a : b;`,
    `          const mergeRepresentations = (a: LiveDownloadItem, b: LiveDownloadItem): LiveDownloadItem => {\n            const meta = metadataScore(a) >= metadataScore(b) ? a : b;\n            const live = liveScore(a) >= liveScore(b) ? a : b;\n            const identitySource = !a.isOptimistic ? a : !b.isOptimistic ? b : meta;`,
    'remote identity source'
  );
  content = replaceOnce(
    content,
    `              ...meta,\n              id: meta.id,\n              downloadId: strongIds[0] || getPhysicalDownloadId(live) || getPhysicalDownloadId(meta) || undefined,`,
    `              ...meta,\n              id: identitySource.id,\n              requestId: a.requestId || b.requestId,\n              downloadId: strongIds[0] || getPhysicalDownloadId(live) || getPhysicalDownloadId(meta) || undefined,`,
    'merge request id and remote id'
  );

  const raceBefore = `          // Un poll peut avoir capturé currentDownloads juste AVANT qu'une nouvelle\n          // demande optimiste soit créée/acceptée. Sans cette seconde lecture, le set()\n          // final réécrit alors un snapshot périmé et la carte disparaît quelques secondes.\n          // On réconcilie uniquement les demandes optimistes réellement modifiées pendant\n          // le fetch ; une représentation distante garde son identité physique, mais hérite\n          // immédiatement du TMDB/poster/titre SeenIt.\n          const latestDownloadsAfterFetch = get().downloads || [];\n          const latestOptimisticRequests = latestDownloadsAfterFetch.filter(item =>\n            item.isOptimistic && !removedSet.has(item.id)\n          );\n\n          for (const latestOptimistic of latestOptimisticRequests) {\n            const snapshotOptimistic = currentDownloads.find(item => item.id === latestOptimistic.id);\n            if (snapshotOptimistic === latestOptimistic) continue;\n\n            const existingIndex = finalItems.findIndex(existing => sameDownloadIdentity(existing, latestOptimistic));\n            if (existingIndex < 0) {\n              finalItems.unshift(latestOptimistic);\n              continue;\n            }\n\n            const existing = finalItems[existingIndex];\n            if (existing.id === latestOptimistic.id || existing.isOptimistic) {\n              finalItems[existingIndex] = {\n                ...existing,\n                ...latestOptimistic,\n                id: existing.id,\n                downloadId: existing.downloadId || latestOptimistic.downloadId,\n                downloadIdAliases: mergeDownloadIdAliases(existing, latestOptimistic),\n                transferPath: existing.transferPath || latestOptimistic.transferPath,\n                posterPath: latestOptimistic.posterPath || existing.posterPath,\n                backdropPath: latestOptimistic.backdropPath || existing.backdropPath\n              };\n              continue;\n            }\n\n            finalItems[existingIndex] = {\n              ...existing,\n              tmdbId: existing.tmdbId || latestOptimistic.tmdbId,\n              tvdbId: existing.tvdbId || latestOptimistic.tvdbId,\n              imdbId: existing.imdbId || latestOptimistic.imdbId,\n              posterPath: existing.posterPath || latestOptimistic.posterPath,\n              backdropPath: existing.backdropPath || latestOptimistic.backdropPath,\n              movieTitle: existing.movieTitle || (existing.mediaType === 'movie'\n                ? (latestOptimistic.movieTitle || latestOptimistic.title)\n                : undefined),\n              seriesTitle: existing.seriesTitle || (existing.mediaType === 'tv'\n                ? (latestOptimistic.seriesTitle || latestOptimistic.title)\n                : undefined),\n              seasonNumber: existing.seasonNumber ?? latestOptimistic.seasonNumber,\n              episodeNumber: existing.episodeNumber ?? latestOptimistic.episodeNumber,\n              addedAt: existing.addedAt || latestOptimistic.addedAt,\n              downloadIdAliases: mergeDownloadIdAliases(existing, latestOptimistic)\n            };\n          }`;
  const raceAfter = `          // Réconcilie uniquement les mutations locales réellement survenues pendant\n          // ce poll. Une intention optimiste peut apporter identité/poster, jamais écraser\n          // progress/status/débit/ETA d'un snapshot distant déjà observé. Une annulation\n          // locale, elle, gagne toujours afin d'empêcher toute résurrection transitoire.\n          const latestLocalMutations = (get().downloads || []).filter(item =>\n            (localItemMutationRevision[item.id] || 0) > fetchStartedMutationRevision\n          );\n\n          for (const latestLocal of latestLocalMutations) {\n            if (isCancelledDownload(latestLocal)) {\n              for (let index = finalItems.length - 1; index >= 0; index -= 1) {\n                if (sameCancellationIdentity(latestLocal, finalItems[index])) {\n                  finalItems.splice(index, 1);\n                }\n              }\n              finalItems.unshift(latestLocal);\n              continue;\n            }\n\n            if (!latestLocal.isOptimistic || removedSet.has(latestLocal.id)) continue;\n\n            const existingIndex = finalItems.findIndex(existing => sameDownloadIdentity(existing, latestLocal));\n            if (existingIndex < 0) {\n              finalItems.unshift(latestLocal);\n              continue;\n            }\n\n            const existing = finalItems[existingIndex];\n            if (existing.isOptimistic) {\n              finalItems[existingIndex] = {\n                ...existing,\n                ...latestLocal,\n                id: existing.id,\n                requestId: existing.requestId || latestLocal.requestId || latestLocal.id,\n                downloadId: existing.downloadId || latestLocal.downloadId,\n                downloadIdAliases: mergeDownloadIdAliases(existing, latestLocal),\n                transferPath: existing.transferPath || latestLocal.transferPath,\n                posterPath: latestLocal.posterPath || existing.posterPath,\n                backdropPath: latestLocal.backdropPath || existing.backdropPath\n              };\n              continue;\n            }\n\n            finalItems[existingIndex] = mergeLateOptimisticMetadata(existing, latestLocal);\n          }`;
  content = replaceOnce(content, raceBefore, raceAfter, 'race reconciliation 1.4.60');

  const removeBefore = `      removeDownload: async item => {\n        const newRemovedIds = Array.from(new Set([...(get().removedIds || []), item.id]));\n        const config = useDownloadConfigStore.getState();\n\n        set({\n          removedIds: newRemovedIds,\n          downloads: (get().downloads || []).filter(download => download.id !== item.id)\n        });\n\n        delete optimisticTimestamps[item.id];\n        delete missingSince[item.id];\n\n        if (item.isOptimistic || item.id.startsWith('opt_')) return true;\n\n        try {\n          const result = await deleteLiveDownloadItem(item, {\n            sonarrUrl: config.sonarrUrl,\n            sonarrApiKey: config.sonarrApiKey,\n            radarrUrl: config.radarrUrl,\n            radarrApiKey: config.radarrApiKey,\n            qbittorrentUrl: config.qbittorrentUrl,\n            qbittorrentUsername: config.qbittorrentUsername,\n            qbittorrentPassword: config.qbittorrentPassword\n          });\n          return result.success;\n        } catch {\n          return false;\n        }\n      },`;
  const removeAfter = `      removeDownload: async item => {\n        const config = useDownloadConfigStore.getState();\n        const status = String(item.status || '').toLowerCase();\n        const shouldCancelRemote = !isTerminalDownload(item) && status !== 'error';\n\n        // Une seconde action sur un état terminal ne touche plus au client distant :\n        // elle nettoie simplement l'historique SeenIt.\n        if (!shouldCancelRemote) {\n          const newRemovedIds = Array.from(new Set([...(get().removedIds || []), item.id]));\n          set({\n            removedIds: newRemovedIds,\n            downloads: (get().downloads || []).filter(download => download.id !== item.id)\n          });\n          delete optimisticTimestamps[item.id];\n          delete missingSince[item.id];\n          return true;\n        }\n\n        const cancelledItem: LiveDownloadItem = {\n          ...item,\n          status: 'cancelled',\n          statusText: 'Téléchargement annulé',\n          errorMessage: undefined,\n          speedBytesPerSec: 0,\n          speedFormatted: '',\n          timeleft: '',\n          timeleftSeconds: 0,\n          isOptimistic: false,\n          isRestored: false\n        };\n\n        markLocalItemMutation(item.id);\n        set(state => ({\n          downloads: state.downloads.map(download =>\n            download.id === item.id ? cancelledItem : download\n          )\n        }));\n        delete optimisticTimestamps[item.id];\n        delete missingSince[item.id];\n\n        try {\n          const result = await deleteLiveDownloadItem(item, {\n            sonarrUrl: config.sonarrUrl,\n            sonarrApiKey: config.sonarrApiKey,\n            radarrUrl: config.radarrUrl,\n            radarrApiKey: config.radarrApiKey,\n            qbittorrentUrl: config.qbittorrentUrl,\n            qbittorrentUsername: config.qbittorrentUsername,\n            qbittorrentPassword: config.qbittorrentPassword\n          });\n\n          if (!result.success) {\n            markLocalItemMutation(item.id);\n            set(state => ({\n              downloads: state.downloads.map(download =>\n                download.id === item.id\n                  ? {\n                      ...download,\n                      status: 'warning',\n                      statusText: 'Annulation non confirmée • réessaie',\n                      errorMessage: result.message || 'Le client distant n’a pas confirmé l’annulation.'\n                    }\n                  : download\n              )\n            }));\n          }\n          return result.success;\n        } catch {\n          markLocalItemMutation(item.id);\n          set(state => ({\n            downloads: state.downloads.map(download =>\n              download.id === item.id\n                ? {\n                    ...download,\n                    status: 'warning',\n                    statusText: 'Annulation non confirmée • réessaie',\n                    errorMessage: 'Le client distant n’a pas confirmé l’annulation.'\n                  }\n                : download\n            )\n          }));\n          return false;\n        }\n      },`;
  content = replaceOnce(content, removeBefore, removeAfter, 'cancel instead of remove active');

  write(path, content);
}

// 5) UI Téléchargements : état Annulé terminal + wording cohérent.
{
  const path = 'src/screens/DownloadsScreen.tsx';
  let content = read(path);
  content = replaceOnce(
    content,
    `  const isCompleted = status === 'completed' || item.progress >= 100;\n  const isError = status === 'error' || Boolean(item.errorMessage);\n  const isWarning = status === 'warning';`,
    `  const isCompleted = status === 'completed' || item.progress >= 100;\n  const isCancelled = status === 'cancelled';\n  const isError = !isCancelled && (status === 'error' || Boolean(item.errorMessage));\n  const isWarning = !isCancelled && status === 'warning';`,
    'cancelled card state'
  );
  content = replaceOnce(
    content,
    `  const progressLabel = isCompleted ? '100%' : progress > 0 ? \`\${progress.toFixed(1).replace(/\\.0$/, '')}%\` : '0%';`,
    `  const progressLabel = isCancelled\n    ? (progress > 0 ? \`\${progress.toFixed(1).replace(/\\.0$/, '')}%\` : '—')\n    : isCompleted\n      ? '100%'\n      : progress > 0\n        ? \`\${progress.toFixed(1).replace(/\\.0$/, '')}%\`\n        : '0%';`,
    'cancelled progress label'
  );
  content = replaceOnce(
    content,
    `  const accent = isError\n    ? 'text-red-300'`,
    `  const accent = isCancelled\n    ? 'text-zinc-400'\n    : isError\n    ? 'text-red-300'`,
    'cancelled accent'
  );
  content = replaceOnce(
    content,
    `  const progressBar = isError\n    ? 'bg-red-500'`,
    `  const progressBar = isCancelled\n    ? 'bg-zinc-600'\n    : isError\n    ? 'bg-red-500'`,
    'cancelled progress bar'
  );
  content = replaceOnce(
    content,
    `  const statusLabel = isError\n    ? 'Erreur'`,
    `  const statusLabel = isCancelled\n    ? 'Annulé'\n    : isError\n    ? 'Erreur'`,
    'cancelled status label'
  );
  content = replaceOnce(
    content,
    `        isError\n          ? 'border-red-500/25'`,
    `        isCancelled\n          ? 'border-zinc-600/30'\n          : isError\n          ? 'border-red-500/25'`,
    'cancelled border'
  );
  content = replaceOnce(
    content,
    `<span className={\`h-1.5 w-1.5 shrink-0 rounded-full \${isCompleted ? 'bg-emerald-400' : isError ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-cyan-400'}\`} />`,
    `<span className={\`h-1.5 w-1.5 shrink-0 rounded-full \${isCancelled ? 'bg-zinc-500' : isCompleted ? 'bg-emerald-400' : isError ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-cyan-400'}\`} />`,
    'cancelled dot'
  );
  content = replaceOnce(
    content,
    `\${!isCompleted && !isError ? 'shadow-[0_0_12px_rgba(34,211,238,0.28)]' : ''}`,
    `\${!isCompleted && !isCancelled && !isError ? 'shadow-[0_0_12px_rgba(34,211,238,0.28)]' : ''}`,
    'cancelled no live glow'
  );
  content = replaceOnce(
    content,
    `            {!isCompleted && !isError && !isPending && (`,
    `            {!isCompleted && !isCancelled && !isError && !isPending && (`,
    'cancelled no telemetry'
  );
  content = replaceOnce(
    content,
    `    () => downloads.filter(item => item.status !== 'completed' && item.progress < 100),`,
    `    () => downloads.filter(item => item.status !== 'completed' && item.status !== 'cancelled' && item.progress < 100),`,
    'active excludes cancelled'
  );
  content = replaceOnce(
    content,
    `    () => downloads.filter(item => item.status === 'completed' || item.progress >= 100),`,
    `    () => downloads.filter(item => item.status === 'completed' || item.status === 'cancelled' || item.progress >= 100),`,
    'terminal includes cancelled'
  );

  const handleBefore = `  const handleRemove = async (item: LiveDownloadItem) => {\n    setRemovingId(item.id);\n    const success = await removeDownload(item);\n    setRemovingId(null);\n    showToast({\n      title: item.movieTitle || item.seriesTitle || item.title,\n      action: success\n        ? 'Retiré de la liste'\n        : 'Retiré de la liste • arrêt non confirmé',\n      posterPath: item.posterPath\n    }, success ? 'success' : 'info');\n  };`;
  const handleAfter = `  const handleRemove = async (item: LiveDownloadItem) => {\n    const status = String(item.status || '').toLowerCase();\n    const wasActive = status !== 'completed'\n      && status !== 'cancelled'\n      && status !== 'error'\n      && Number(item.progress || 0) < 100;\n\n    setRemovingId(item.id);\n    const success = await removeDownload(item);\n    setRemovingId(null);\n    showToast({\n      title: item.movieTitle || item.seriesTitle || item.title,\n      action: success\n        ? (wasActive ? 'Téléchargement annulé' : 'Retiré de la liste')\n        : (wasActive ? 'Annulation non confirmée' : 'Retrait non confirmé'),\n      posterPath: item.posterPath\n    }, success ? 'success' : 'info');\n  };`;
  content = replaceOnce(content, handleBefore, handleAfter, 'cancel toast wording');
  write(path, content);
}

// 6) Fiche : une annulation n'est ni "en cours" ni une erreur technique.
{
  const path = 'src/screens/ShowDetailScreen.tsx';
  let content = read(path);
  const stateBefore = `  const hasActiveDownload = mediaDownloads.some(item =>\n    item.status !== 'completed'\n    && item.status !== 'error'\n    && Number(item.progress || 0) < 100\n  );\n  const hasCompletedDownload = mediaDownloads.some(item =>\n    item.status === 'completed' || Number(item.progress || 0) >= 100\n  );\n  const hasDownloadError = !hasActiveDownload\n    && !hasCompletedDownload\n    && mediaDownloads.some(item => item.status === 'error' || Boolean(item.errorMessage));`;
  const stateAfter = `  const hasActiveDownload = mediaDownloads.some(item =>\n    item.status !== 'completed'\n    && item.status !== 'cancelled'\n    && item.status !== 'error'\n    && Number(item.progress || 0) < 100\n  );\n  const hasCompletedDownload = mediaDownloads.some(item =>\n    item.status === 'completed' || Number(item.progress || 0) >= 100\n  );\n  const hasCancelledDownload = !hasActiveDownload\n    && !hasCompletedDownload\n    && mediaDownloads.some(item => item.status === 'cancelled');\n  const hasDownloadError = !hasActiveDownload\n    && !hasCompletedDownload\n    && !hasCancelledDownload\n    && mediaDownloads.some(item => item.status === 'error' || Boolean(item.errorMessage));`;
  content = replaceOnce(content, stateBefore, stateAfter, 'show detail cancelled state');

  content = replaceOnce(
    content,
    `                hasActiveDownload\n                  ? "border-cyan-500/20 bg-cyan-500/[0.08] text-cyan-200"\n                  : hasCompletedDownload\n                    ? "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300"\n                    : "border-red-500/20 bg-red-500/[0.08] text-red-300"`,
    `                hasActiveDownload\n                  ? "border-cyan-500/20 bg-cyan-500/[0.08] text-cyan-200"\n                  : hasCompletedDownload\n                    ? "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300"\n                    : hasCancelledDownload\n                      ? "border-zinc-600/30 bg-zinc-500/[0.06] text-zinc-400"\n                      : "border-red-500/20 bg-red-500/[0.08] text-red-300"`,
    'show detail cancelled style'
  );
  content = replaceOnce(
    content,
    `                ) : hasDownloadError ? (\n                  <>\n                    <X size={16} className="shrink-0" />\n                    <span>Téléchargement interrompu</span>\n                  </>\n                ) : null}`,
    `                ) : hasCancelledDownload ? (\n                  <>\n                    <X size={16} className="shrink-0" />\n                    <span>Téléchargement annulé</span>\n                  </>\n                ) : hasDownloadError ? (\n                  <>\n                    <X size={16} className="shrink-0" />\n                    <span>Téléchargement interrompu</span>\n                  </>\n                ) : null}`,
    'show detail cancelled label'
  );
  write(path, content);
}

// 7) Tests de non-régression : requestId + télémétrie distante prioritaire.
{
  const path = 'tests/downloadIdentity.test.ts';
  let content = read(path);
  content = replaceOnce(
    content,
    `  sameLegacyPhysicalTransfer,\n  samePhysicalDownload,\n  sameTransferPath`,
    `  sameDownloadRequest,\n  sameLegacyPhysicalTransfer,\n  samePhysicalDownload,\n  sameTransferPath`,
    'import sameDownloadRequest test'
  );
  content = replaceOnce(
    content,
    `} from '../src/features/downloads/downloadIdentity.ts';`,
    `} from '../src/features/downloads/downloadIdentity.ts';\nimport { mergeLateOptimisticMetadata } from '../src/features/downloads/downloadReconciliation.ts';`,
    'import reconciliation test'
  );
  content += `\n\ntest('corrèle *Arr et qBittorrent par la demande SeenIt même si leurs IDs distants divergent', () => {\n  const requestId = 'opt_1700000000000_test';\n  assert.equal(sameDownloadRequest(\n    { requestId, downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },\n    { requestId, downloadId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }\n  ), true);\n});\n\ntest('une mutation optimiste tardive ne peut jamais figer la télémétrie distante', () => {\n  const remote = {\n    id: 'radarr_42',\n    requestId: 'opt_42',\n    mediaType: 'movie',\n    title: 'Michael',\n    size: 4_800_000_000,\n    sizeleft: 3_000_000_000,\n    progress: 37.5,\n    speedBytesPerSec: 8_000_000,\n    speedFormatted: '7.6 Mo/s',\n    timeleft: '6m 15s',\n    timeleftSeconds: 375,\n    status: 'downloading',\n    statusText: 'Téléchargement 37.5%',\n    isOptimistic: false\n  };\n  const lateOptimistic = {\n    id: 'opt_42',\n    requestId: 'opt_42',\n    mediaType: 'movie',\n    title: 'Michael',\n    tmdbId: 1234,\n    posterPath: '/poster.jpg',\n    size: 0,\n    sizeleft: 0,\n    progress: 0,\n    status: 'searching',\n    statusText: 'Recherche en cours',\n    isOptimistic: true\n  };\n\n  const merged = mergeLateOptimisticMetadata(remote, lateOptimistic);\n  assert.equal(merged.progress, 37.5);\n  assert.equal(merged.status, 'downloading');\n  assert.equal(merged.speedBytesPerSec, 8_000_000);\n  assert.equal(merged.timeleftSeconds, 375);\n  assert.equal(merged.tmdbId, 1234);\n  assert.equal(merged.posterPath, '/poster.jpg');\n  assert.equal(merged.isOptimistic, false);\n});\n`;
  write(path, content);
}

// 8) Version 1.4.60.
{
  const path = 'android/app/build.gradle';
  let content = read(path);
  content = replaceOnce(content, 'versionCode 104059', 'versionCode 104060', 'versionCode 1.4.60');
  content = replaceOnce(content, 'versionName "1.4.59"', 'versionName "1.4.60"', 'versionName 1.4.60');
  write(path, content);
}
{
  const path = 'src/store/updateStore.ts';
  let content = read(path);
  content = replaceOnce(content, "CURRENT_APP_VERSION = '1.4.59'", "CURRENT_APP_VERSION = '1.4.60'", 'CURRENT_APP_VERSION 1.4.60');
  write(path, content);
}

console.log('Patch suivi/annulation 1.4.60 appliqué.');
