const fs = require('fs');

function replaceOnce(content, from, to, label) {
  if (!content.includes(from)) throw new Error(`Introuvable: ${label}`);
  return content.replace(from, to);
}

// --- UI téléchargements ---
{
  const path = 'src/screens/DownloadsScreen.tsx';
  let s = fs.readFileSync(path, 'utf8');
  s = replaceOnce(s,
    'bg-gradient-to-br from-zinc-900/95 to-zinc-950/90 p-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)]',
    'bg-gradient-to-br from-zinc-900/95 to-zinc-950/90 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.18)]',
    'padding carte');
  s = replaceOnce(s, '<div className="flex gap-3.5">', '<div className="flex gap-3">', 'gap carte');
  s = replaceOnce(s,
    'className="relative w-16 aspect-[2/3] shrink-0 self-start overflow-hidden rounded-[14px] border border-white/10 bg-zinc-950 shadow-md flex items-center justify-center"',
    'className="relative w-16 aspect-[2/3] shrink-0 self-center overflow-hidden rounded-[14px] border border-white/10 bg-zinc-950 shadow-md flex items-center justify-center"',
    'centrage poster');
  s = replaceOnce(s,
    '<h3 className="text-[15px] font-black leading-tight text-white line-clamp-2">{cleanTitle}</h3>',
    '<h3 className="text-[15px] font-black leading-tight text-[#E5A93D] line-clamp-2">{cleanTitle}</h3>',
    'titre doré');
  s = replaceOnce(s,
    '{subTitle && <p className="mt-1 text-[11px] font-semibold text-zinc-400">{subTitle}</p>}',
    '{subTitle && <p className="mt-0.5 text-[11px] font-semibold text-zinc-400">{subTitle}</p>}',
    'espacement sous-titre');
  s = replaceOnce(s, '<div className="mt-2 flex flex-wrap gap-1.5">', '<div className="mt-1.5 flex flex-wrap gap-1">', 'espacement badges');
  s = replaceOnce(s,
    "'border-cyan-400/25 bg-cyan-400/10 text-cyan-200'",
    "'border-cyan-400/15 bg-cyan-400/[0.06] text-cyan-300/80'",
    'badge résolution atténué');
  s = replaceOnce(s, '<div className="mt-3 flex items-end justify-between gap-3">', '<div className="mt-2 flex items-end justify-between gap-3">', 'espacement statut');
  const dots = `          {isPending && progress <= 0 ? (\n            <div className="mt-2 flex h-2 items-center gap-1.5" aria-label="Activité en cours">\n              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90 animate-pulse" />\n              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/65 animate-pulse [animation-delay:160ms]" />\n              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/40 animate-pulse [animation-delay:320ms]" />\n            </div>\n          ) : (\n            <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.03]">`;
  const line = `          {isPending && progress <= 0 ? (\n            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.05]" aria-label="Activité en cours">\n              <div className="h-full w-1/3 rounded-full bg-cyan-400/35 animate-pulse" />\n            </div>\n          ) : (\n            <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.03]">`;
  s = replaceOnce(s, dots, line, 'indicateur recherche');
  s = replaceOnce(s, '<div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-zinc-400">', '<div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] text-zinc-400">', 'espacement métadonnées');
  fs.writeFileSync(path, s);
}

// --- Sonarr : monitoring épisode + nettoyage titre ---
{
  const path = 'src/services/sonarrRadarr.ts';
  let s = fs.readFileSync(path, 'utf8');
  const marker = `    // 1. Vérifier si la série est déjà présente dans la bibliothèque Sonarr\n`;
  const helper = `    const ensureEpisodeMonitored = async (episode: any) => {\n      if (!episode?.id || episode.monitored === true) return;\n      await executePut(\`${'${base}'}/api/v3/episode/\${episode.id}\`, {\n        ...episode,\n        monitored: true\n      }, headers);\n    };\n\n`;
  s = replaceOnce(s, marker, helper + marker, 'helper monitoring épisode');
  s = replaceOnce(s,
    `          if (targetEp && targetEp.id) {\n            if (targetEp.hasFile) {`,
    `          if (targetEp && targetEp.id) {\n            await ensureEpisodeMonitored(targetEp);\n            if (targetEp.hasFile) {`,
    'monitor épisode série existante');
  const afterAdd = `          if (targetEp && targetEp.id) {\n            await executePost(\`${'${base}'}/api/v3/command\`, {\n              name: 'EpisodeSearch',`;
  const afterAddNew = `          if (targetEp && targetEp.id) {\n            await ensureEpisodeMonitored(targetEp);\n            await executePost(\`${'${base}'}/api/v3/command\`, {\n              name: 'EpisodeSearch',`;
  s = replaceOnce(s, afterAdd, afterAddNew, 'monitor épisode après ajout');
  s = replaceOnce(s,
    "          title: `${seriesTitle} (${epTitle})`,",
    "          title: `${seriesTitle} ${epTitle}` ,",
    'titre Sonarr sans parenthèses techniques');
  const cleanMarker = `  cleanName = cleanName.replace(/[._]/g, ' ').trim();\n  cleanName = cleanName.replace(/^[-–—\\s]+|[-–—\\s]+$/g, '').trim();\n`;
  const cleanReplacement = `  cleanName = cleanName.replace(/[._]/g, ' ').trim();\n  cleanName = cleanName.replace(/^[-–—\\s]+|[-–—\\s]+$/g, '').trim();\n  // Les releases TV utilisent souvent \"Titre.(2022).S01E01\". Une coupe avant\n  // l'épisode ne doit pas laisser \"(2022)\" ou une parenthèse orpheline à l'écran.\n  cleanName = cleanName.replace(/\\s*\\((?:19|20)\\d{2}\\)\\s*$/i, '').trim();\n  cleanName = cleanName.replace(/[([{]+\\s*$/g, '').trim();\n`;
  s = replaceOnce(s, cleanMarker, cleanReplacement, 'nettoyage parenthèses titre');
  fs.writeFileSync(path, s);
}

// --- Synchronisation temps réel des intentions PWA / APK ---
{
  const path = 'src/store/liveDownloadStore.ts';
  let s = fs.readFileSync(path, 'utf8');
  s = replaceOnce(s,
    "import { onAuthStateChanged } from 'firebase/auth';\n",
    "import { onAuthStateChanged } from 'firebase/auth';\nimport { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';\n",
    'imports Firestore');
  s = replaceOnce(s,
    "import { auth } from '../lib/firebase';",
    "import { auth, db } from '../lib/firebase';",
    'import db');

  const globals = `let localMutationRevision = 0;\nconst localItemMutationRevision: Record<string, number> = {};\n`;
  const globalsNew = `let localMutationRevision = 0;\nconst localItemMutationRevision: Record<string, number> = {};\nlet sharedDownloadUnsubscribe: (() => void) | null = null;\nconst SHARED_DOWNLOAD_REQUEST_TTL_MS = 10 * 60_000;\n`;
  s = replaceOnce(s, globals, globalsNew, 'globals sync');

  const afterMark = `function markLocalItemMutation(id: string) {\n  localMutationRevision += 1;\n  localItemMutationRevision[id] = localMutationRevision;\n}\n`;
  const sharedFns = `function markLocalItemMutation(id: string) {\n  localMutationRevision += 1;\n  localItemMutationRevision[id] = localMutationRevision;\n}\n\nfunction sharedRequestDocId(item: Pick<LiveDownloadItem, 'id' | 'requestId'>): string {\n  return String(item.requestId || item.id).replace(/\\//g, '_');\n}\n\nfunction serializeSharedDownloadRequest(item: LiveDownloadItem): Record<string, unknown> {\n  const raw: Record<string, unknown> = {\n    id: item.id,\n    requestId: item.requestId || item.id,\n    mediaType: item.mediaType,\n    title: item.title,\n    seriesTitle: item.seriesTitle,\n    movieTitle: item.movieTitle,\n    tmdbId: item.tmdbId,\n    tvdbId: item.tvdbId,\n    imdbId: item.imdbId,\n    posterPath: item.posterPath,\n    backdropPath: item.backdropPath,\n    seasonNumber: item.seasonNumber,\n    episodeNumber: item.episodeNumber,\n    quality: item.quality,\n    releaseTitle: item.releaseTitle,\n    progress: item.progress || 0,\n    status: item.status,\n    statusText: item.statusText,\n    errorMessage: item.errorMessage,\n    addedAt: item.addedAt || Date.now(),\n    sharedUpdatedAt: Date.now(),\n    sharedExpiresAt: Date.now() + SHARED_DOWNLOAD_REQUEST_TTL_MS\n  };\n  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));\n}\n\nasync function publishSharedDownloadRequest(item: LiveDownloadItem) {\n  const user = auth.currentUser;\n  if (!user || !item.isOptimistic) return;\n  try {\n    await setDoc(\n      doc(db, 'users', user.uid, 'downloadRequests', sharedRequestDocId(item)),\n      serializeSharedDownloadRequest(item),\n      { merge: true }\n    );\n  } catch (error) {\n    console.warn('[Downloads Sync] Impossible de publier la demande partagée:', error);\n  }\n}\n\nasync function removeSharedDownloadRequest(item: Pick<LiveDownloadItem, 'id' | 'requestId'>) {\n  const user = auth.currentUser;\n  if (!user) return;\n  try {\n    await deleteDoc(doc(db, 'users', user.uid, 'downloadRequests', sharedRequestDocId(item)));\n  } catch {}\n}\n\nfunction stopSharedDownloadRequestSync() {\n  if (sharedDownloadUnsubscribe) {\n    sharedDownloadUnsubscribe();\n    sharedDownloadUnsubscribe = null;\n  }\n}\n\nfunction startSharedDownloadRequestSync(uid: string) {\n  stopSharedDownloadRequestSync();\n  sharedDownloadUnsubscribe = onSnapshot(\n    collection(db, 'users', uid, 'downloadRequests'),\n    snapshot => {\n      const now = Date.now();\n      const remoteItems: LiveDownloadItem[] = [];\n      for (const entry of snapshot.docs) {\n        const data = entry.data() as any;\n        if (Number(data.sharedExpiresAt || 0) <= now) {\n          void deleteDoc(entry.ref).catch(() => {});\n          continue;\n        }\n        if (!data.title || (data.mediaType !== 'tv' && data.mediaType !== 'movie')) continue;\n        remoteItems.push({\n          id: String(data.id || entry.id),\n          requestId: String(data.requestId || data.id || entry.id),\n          mediaType: data.mediaType,\n          title: String(data.title),\n          seriesTitle: data.seriesTitle,\n          movieTitle: data.movieTitle,\n          tmdbId: data.tmdbId ? Number(data.tmdbId) : undefined,\n          tvdbId: data.tvdbId ? Number(data.tvdbId) : undefined,\n          imdbId: data.imdbId,\n          posterPath: data.posterPath,\n          backdropPath: data.backdropPath,\n          seasonNumber: data.seasonNumber != null ? Number(data.seasonNumber) : undefined,\n          episodeNumber: data.episodeNumber != null ? Number(data.episodeNumber) : undefined,\n          quality: data.quality,\n          releaseTitle: data.releaseTitle || data.title,\n          size: 0,\n          sizeleft: 0,\n          progress: Number(data.progress || 0),\n          status: data.status || 'searching',\n          statusText: data.statusText || 'Synchronisation du téléchargement…',\n          errorMessage: data.errorMessage,\n          addedAt: Number(data.addedAt || data.sharedUpdatedAt || now),\n          isOptimistic: true,\n          isRestored: false\n        });\n      }\n\n      if (!remoteItems.length) return;\n      useLiveDownloadStore.setState(state => {\n        const downloads = [...(state.downloads || [])];\n        for (const remote of remoteItems) {\n          const index = downloads.findIndex(local => sameDownloadIdentity(local, remote) || sameRequestScope(local, remote));\n          if (index < 0) {\n            downloads.unshift(remote);\n            optimisticTimestamps[remote.id] = Date.now();\n            continue;\n          }\n          const local = downloads[index];\n          if (!local.isOptimistic) continue;\n          downloads[index] = {\n            ...local,\n            ...remote,\n            id: local.id,\n            requestId: local.requestId || remote.requestId,\n            posterPath: remote.posterPath || local.posterPath,\n            backdropPath: remote.backdropPath || local.backdropPath,\n            isOptimistic: true,\n            isRestored: false\n          };\n          optimisticTimestamps[local.id] = Date.now();\n        }\n        return { downloads };\n      });\n\n      const state = useLiveDownloadStore.getState();\n      if (!state.isPolling) state.startPolling(1000);\n      else void state.fetchDownloads();\n    },\n    error => console.warn('[Downloads Sync] Écoute Firestore interrompue:', error)\n  );\n}\n`;
  s = replaceOnce(s, afterMark, sharedFns, 'fonctions sync demandes');

  const existingPublishMarker = `          set(state => ({\n            downloads: state.downloads.map(download =>\n              download.id === existing.id\n                ? {\n                    ...download,\n                    ...candidate,\n                    id: existing.id,\n                    posterPath: candidate.posterPath || download.posterPath,\n                    isOptimistic: true\n                  }\n                : download\n            )\n          }));\n          if (!get().isPolling) get().startPolling(1000);`;
  const existingPublishNew = `          set(state => ({\n            downloads: state.downloads.map(download =>\n              download.id === existing.id\n                ? {\n                    ...download,\n                    ...candidate,\n                    id: existing.id,\n                    posterPath: candidate.posterPath || download.posterPath,\n                    isOptimistic: true\n                  }\n                : download\n            )\n          }));\n          void publishSharedDownloadRequest({\n            ...existing,\n            ...candidate,\n            id: existing.id,\n            requestId: existing.requestId || candidate.requestId || existing.id,\n            posterPath: candidate.posterPath || existing.posterPath,\n            isOptimistic: true\n          });\n          if (!get().isPolling) get().startPolling(1000);`;
  s = replaceOnce(s, existingPublishMarker, existingPublishNew, 'publication demande existante');

  s = replaceOnce(s,
    `        set(state => ({ downloads: [candidate, ...state.downloads] }));\n\n        if (!get().isPolling) get().startPolling(1000);`,
    `        set(state => ({ downloads: [candidate, ...state.downloads] }));\n        void publishSharedDownloadRequest(candidate);\n\n        if (!get().isPolling) get().startPolling(1000);`,
    'publication nouvelle demande');

  const updateMarker = `        set(state => ({\n          downloads: state.downloads.map(download =>\n            download.id === id ? { ...download, ...patch, id: download.id } : download\n          )\n        }));\n      },`;
  const updateNew = `        set(state => ({\n          downloads: state.downloads.map(download =>\n            download.id === id ? { ...download, ...patch, id: download.id } : download\n          )\n        }));\n        if (existing) {\n          const next = { ...existing, ...patch, id: existing.id } as LiveDownloadItem;\n          if (next.isOptimistic) void publishSharedDownloadRequest(next);\n        }\n      },`;
  s = replaceOnce(s, updateMarker, updateNew, 'publication mise à jour demande');

  s = replaceOnce(s,
    `          delete optimisticTimestamps[item.id];\n          delete missingSince[item.id];\n          return true;`,
    `          delete optimisticTimestamps[item.id];\n          delete missingSince[item.id];\n          void removeSharedDownloadRequest(item);\n          return true;`,
    'suppression demande terminale partagée');

  s = replaceOnce(s,
    `        delete optimisticTimestamps[item.id];\n        delete missingSince[item.id];\n\n        try {`,
    `        delete optimisticTimestamps[item.id];\n        delete missingSince[item.id];\n        void removeSharedDownloadRequest(item);\n\n        try {`,
    'suppression demande active partagée');

  s = replaceOnce(s,
    `          delete optimisticTimestamps[item.id];\n          delete missingSince[item.id];\n          if (item.isOptimistic || item.id.startsWith('opt_')) continue;`,
    `          delete optimisticTimestamps[item.id];\n          delete missingSince[item.id];\n          void removeSharedDownloadRequest(item);\n          if (item.isOptimistic || item.id.startsWith('opt_')) continue;`,
    'vider demandes partagées');

  s = replaceOnce(s,
    `    if (user) {\n      useLiveDownloadStore.getState().startPolling(1000);\n    } else {\n      forceStopGlobalPolling();\n    }`,
    `    stopSharedDownloadRequestSync();\n    if (user) {\n      startSharedDownloadRequestSync(user.uid);\n      useLiveDownloadStore.getState().startPolling(1000);\n    } else {\n      forceStopGlobalPolling();\n    }`,
    'abonnement sync auth');

  fs.writeFileSync(path, s);
}

// --- version 1.4.66 ---
{
  const path = 'android/app/build.gradle';
  let s = fs.readFileSync(path, 'utf8');
  s = s.replace(/versionCode\s+\d+/, 'versionCode 104066');
  s = s.replace(/versionName\s+"[^"]+"/, 'versionName "1.4.66"');
  fs.writeFileSync(path, s);
}
{
  const path = 'src/store/updateStore.ts';
  let s = fs.readFileSync(path, 'utf8');
  s = s.replace(/CURRENT_APP_VERSION\s*=\s*'[^']+'/, "CURRENT_APP_VERSION = '1.4.66'");
  fs.writeFileSync(path, s);
}

console.log('Patch téléchargements 1.4.66 appliqué.');
