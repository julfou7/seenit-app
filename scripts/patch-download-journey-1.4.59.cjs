const fs = require('fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, before, after, label) {
  const index = content.indexOf(before);
  if (index < 0) throw new Error(`Motif introuvable: ${label}`);
  if (content.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Motif non unique: ${label}`);
  }
  return content.slice(0, index) + after + content.slice(index + before.length);
}

// 1) Le poll central ne doit jamais écraser une demande optimiste créée ou mise à jour
// pendant qu'une requête réseau était déjà en vol.
{
  const path = 'src/store/liveDownloadStore.ts';
  let content = read(path);
  const before = `          for (const finalItem of finalItems) {\n            if (!isTerminalDownload(finalItem)) continue;`;
  const after = `          // Un poll peut avoir capturé currentDownloads juste AVANT qu'une nouvelle\n          // demande optimiste soit créée/acceptée. Sans cette seconde lecture, le set()\n          // final réécrit alors un snapshot périmé et la carte disparaît quelques secondes.\n          // On réconcilie uniquement les demandes optimistes réellement modifiées pendant\n          // le fetch ; une représentation distante garde son identité physique, mais hérite\n          // immédiatement du TMDB/poster/titre SeenIt.\n          const latestDownloadsAfterFetch = get().downloads || [];\n          const latestOptimisticRequests = latestDownloadsAfterFetch.filter(item =>\n            item.isOptimistic && !removedSet.has(item.id)\n          );\n\n          for (const latestOptimistic of latestOptimisticRequests) {\n            const snapshotOptimistic = currentDownloads.find(item => item.id === latestOptimistic.id);\n            if (snapshotOptimistic === latestOptimistic) continue;\n\n            const existingIndex = finalItems.findIndex(existing => sameDownloadIdentity(existing, latestOptimistic));\n            if (existingIndex < 0) {\n              finalItems.unshift(latestOptimistic);\n              continue;\n            }\n\n            const existing = finalItems[existingIndex];\n            if (existing.id === latestOptimistic.id || existing.isOptimistic) {\n              finalItems[existingIndex] = {\n                ...existing,\n                ...latestOptimistic,\n                id: existing.id,\n                downloadId: existing.downloadId || latestOptimistic.downloadId,\n                downloadIdAliases: mergeDownloadIdAliases(existing, latestOptimistic),\n                transferPath: existing.transferPath || latestOptimistic.transferPath,\n                posterPath: latestOptimistic.posterPath || existing.posterPath,\n                backdropPath: latestOptimistic.backdropPath || existing.backdropPath\n              };\n              continue;\n            }\n\n            finalItems[existingIndex] = {\n              ...existing,\n              tmdbId: existing.tmdbId || latestOptimistic.tmdbId,\n              tvdbId: existing.tvdbId || latestOptimistic.tvdbId,\n              imdbId: existing.imdbId || latestOptimistic.imdbId,\n              posterPath: existing.posterPath || latestOptimistic.posterPath,\n              backdropPath: existing.backdropPath || latestOptimistic.backdropPath,\n              movieTitle: existing.movieTitle || (existing.mediaType === 'movie'\n                ? (latestOptimistic.movieTitle || latestOptimistic.title)\n                : undefined),\n              seriesTitle: existing.seriesTitle || (existing.mediaType === 'tv'\n                ? (latestOptimistic.seriesTitle || latestOptimistic.title)\n                : undefined),\n              seasonNumber: existing.seasonNumber ?? latestOptimistic.seasonNumber,\n              episodeNumber: existing.episodeNumber ?? latestOptimistic.episodeNumber,\n              addedAt: existing.addedAt || latestOptimistic.addedAt,\n              downloadIdAliases: mergeDownloadIdAliases(existing, latestOptimistic)\n            };\n          }\n\n          for (const finalItem of finalItems) {\n            if (!isTerminalDownload(finalItem)) continue;`;
  content = replaceOnce(content, before, after, 'réconciliation optimistic après poll');
  write(path, content);
}

// 2) La page Téléchargements devient le vrai centre de contrôle : carte entière ouvrable,
// poster prioritaire pendant un transfert actif.
{
  const path = 'src/screens/DownloadsScreen.tsx';
  let content = read(path);

  content = replaceOnce(
    content,
    `  const posterSrc = item.posterPath\n    ? item.posterPath.startsWith('http')\n      ? item.posterPath\n      : \`https://image.tmdb.org/t/p/w185\${item.posterPath}\`\n    : null;`,
    `  const posterSrc = item.posterPath\n    ? item.posterPath.startsWith('http')\n      ? item.posterPath\n      : \`https://image.tmdb.org/t/p/w185\${item.posterPath}\`\n    : null;\n  const canOpenDetails = Boolean(item.tmdbId && onShowClick);\n  const openDetails = () => {\n    if (!item.tmdbId || !onShowClick) return;\n    onShowClick(item.tmdbId, item.mediaType);\n  };`,
    'helper ouverture fiche'
  );

  content = replaceOnce(
    content,
    `    <div\n      className={\`relative overflow-hidden rounded-[22px] border bg-gradient-to-br from-zinc-900/95 to-zinc-950/90 p-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)] \${`,
    `    <div\n      onClick={canOpenDetails ? openDetails : undefined}\n      className={\`relative overflow-hidden rounded-[22px] border bg-gradient-to-br from-zinc-900/95 to-zinc-950/90 p-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)] \${canOpenDetails ? 'cursor-pointer transition-transform active:scale-[0.995]' : ''} \${`,
    'carte téléchargement cliquable'
  );

  content = content.replace(
    `          onClick={() => item.tmdbId && onShowClick?.(item.tmdbId, item.mediaType)}\n          className="relative w-16`,
    `          onClick={(event) => {\n            event.stopPropagation();\n            openDetails();\n          }}\n          className="relative w-16`
  );

  content = content.replace(
    `              loading="lazy"\n            />`,
    `              loading={isCompleted ? 'lazy' : 'eager'}\n            />`
  );

  content = content.replace(
    `              onClick={() => item.tmdbId && onShowClick?.(item.tmdbId, item.mediaType)}\n              className="min-w-0 flex-1 text-left"`,
    `              onClick={(event) => {\n                event.stopPropagation();\n                openDetails();\n              }}\n              className="min-w-0 flex-1 text-left"`
  );

  content = content.replace(
    `              onClick={() => onRemove(item)}\n              className="-mr-1`,
    `              onClick={(event) => {\n                event.stopPropagation();\n                onRemove(item);\n              }}\n              className="-mr-1`
  );

  write(path, content);
}

// 3) Dans la fiche, le téléchargement n'est plus un second écran de monitoring.
// Il devient un simple état contextuel, puis la disponibilité Plex est rafraîchie
// agressivement quelques secondes après l'import pour le parcours "Téléchargement -> fiche -> Plex".
{
  const path = 'src/screens/ShowDetailScreen.tsx';
  let content = read(path);

  content = replaceOnce(
    content,
    `import { LiveDownloadBanner } from '../components/LiveDownloadBanner';\nimport { useDownloadConfigStore } from '../store/downloadConfigStore';`,
    `import { useDownloadConfigStore } from '../store/downloadConfigStore';\nimport { useMediaPresenceStore } from '../store/mediaPresenceStore';`,
    'imports statut téléchargement simplifié'
  );

  const oldDownloads = `  const activeDownloads = isSeries\n    ? getShowDownloads(effectiveTmdbId, tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId, tmdbDetails?.name || show?.title)\n    : (getMovieDownload(effectiveTmdbId, tmdbDetails?.title || show?.title) ? [getMovieDownload(effectiveTmdbId, tmdbDetails?.title || show?.title)!] : []);`;
  const newDownloads = `  const mediaDownloads = isSeries\n    ? getShowDownloads(effectiveTmdbId, tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId, tmdbDetails?.name || show?.title)\n    : (getMovieDownload(effectiveTmdbId, tmdbDetails?.title || show?.title) ? [getMovieDownload(effectiveTmdbId, tmdbDetails?.title || show?.title)!] : []);\n\n  const hasActiveDownload = mediaDownloads.some(item =>\n    item.status !== 'completed'\n    && item.status !== 'error'\n    && Number(item.progress || 0) < 100\n  );\n  const hasCompletedDownload = mediaDownloads.some(item =>\n    item.status === 'completed' || Number(item.progress || 0) >= 100\n  );\n  const hasDownloadError = !hasActiveDownload\n    && !hasCompletedDownload\n    && mediaDownloads.some(item => item.status === 'error' || Boolean(item.errorMessage));`;
  content = replaceOnce(content, oldDownloads, newDownloads, 'état téléchargement fiche');

  const plexAnchor = `  const plexMediaInfo = presence.plexInfo || null;`;
  const plexRefresh = `  const plexMediaInfo = presence.plexInfo || null;\n\n  // Après un import terminé, le cache négatif Plex de 30 s est trop long pour le\n  // parcours principal de SeenIt. Tant que la fiche est ouverte, on force quelques\n  // vérifications rapprochées afin que "Disponible sur Plex" apparaisse dès que le\n  // serveur a indexé le fichier, sans attendre un full scan ou l'expiration du cache.\n  useEffect(() => {\n    if (!hasCompletedDownload || hasActiveDownload || !effectiveTmdbId || plexMediaInfo?.available) return;\n\n    let cancelled = false;\n    let retryTimer: ReturnType<typeof setTimeout> | null = null;\n    let attempts = 0;\n\n    const refreshPresenceAfterImport = async () => {\n      attempts += 1;\n      const refreshed = await useMediaPresenceStore.getState().checkPresence({\n        tmdbId: effectiveTmdbId,\n        tvdbId: tmdbDetails?.external_ids?.tvdb_id || (show as any)?.tvdbId,\n        imdbId: tmdbDetails?.external_ids?.imdb_id || (show as any)?.imdbId,\n        title,\n        originalTitle: tmdbDetails?.original_title || tmdbDetails?.original_name || (show as any)?.originalTitle,\n        year: releaseYear ? parseInt(releaseYear) : undefined,\n        mediaType: isSeries ? 'tv' : 'movie',\n        forceRefresh: true\n      });\n\n      if (!cancelled && !refreshed.plexInfo?.available && attempts < 4) {\n        retryTimer = setTimeout(() => void refreshPresenceAfterImport(), 4000);\n      }\n    };\n\n    void refreshPresenceAfterImport();\n    return () => {\n      cancelled = true;\n      if (retryTimer) clearTimeout(retryTimer);\n    };\n  }, [\n    hasCompletedDownload,\n    hasActiveDownload,\n    effectiveTmdbId,\n    isSeries,\n    title,\n    releaseYear,\n    tmdbDetails?.external_ids?.tvdb_id,\n    tmdbDetails?.external_ids?.imdb_id,\n    tmdbDetails?.original_title,\n    tmdbDetails?.original_name,\n    show,\n    plexMediaInfo?.available\n  ]);`;
  content = replaceOnce(content, plexAnchor, plexRefresh, 'rafraîchissement Plex après import');

  const oldBanner = `          {/* Bandeau de téléchargement en direct (Sonarr/Radarr/qBittorrent) */}\n          {activeDownloads.length > 0 && (\n            <div className="mt-4 px-1">\n              <LiveDownloadBanner items={activeDownloads} />\n            </div>\n          )}`;
  const newBanner = `          {/* Statut contextuel uniquement : le détail complet vit dans Téléchargements. */}\n          {mediaDownloads.length > 0 && (\n            <div className="mt-4 px-1">\n              <div className={cn(\n                "flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-xs font-bold backdrop-blur-md",\n                hasActiveDownload\n                  ? "border-cyan-500/20 bg-cyan-500/[0.08] text-cyan-200"\n                  : hasCompletedDownload\n                    ? "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300"\n                    : "border-red-500/20 bg-red-500/[0.08] text-red-300"\n              )}>\n                {hasActiveDownload ? (\n                  <>\n                    <Download size={16} className="shrink-0" />\n                    <span>Téléchargement en cours</span>\n                  </>\n                ) : hasCompletedDownload ? (\n                  <>\n                    <CheckCircle2 size={16} className="shrink-0" />\n                    <span>Téléchargement terminé</span>\n                  </>\n                ) : hasDownloadError ? (\n                  <>\n                    <X size={16} className="shrink-0" />\n                    <span>Téléchargement interrompu</span>\n                  </>\n                ) : null}\n              </div>\n            </div>\n          )}`;
  content = replaceOnce(content, oldBanner, newBanner, 'bandeau fiche simplifié');


  write(path, content);
}

// 4) Version 1.4.59.
{
  const gradlePath = 'android/app/build.gradle';
  let gradle = read(gradlePath);
  gradle = replaceOnce(gradle, 'versionCode 104058', 'versionCode 104059', 'versionCode 1.4.59');
  gradle = replaceOnce(gradle, 'versionName "1.4.58"', 'versionName "1.4.59"', 'versionName 1.4.59');
  write(gradlePath, gradle);

  const updatePath = 'src/store/updateStore.ts';
  let update = read(updatePath);
  update = replaceOnce(update, "CURRENT_APP_VERSION = '1.4.58'", "CURRENT_APP_VERSION = '1.4.59'", 'CURRENT_APP_VERSION 1.4.59');
  write(updatePath, update);
}

console.log('Patch parcours téléchargement 1.4.59 appliqué.');
