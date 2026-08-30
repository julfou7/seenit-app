const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content, 'utf8'); }
function replaceOnce(content, before, after, label) {
  const index = content.indexOf(before);
  if (index < 0) throw new Error(`Bloc introuvable: ${label}`);
  if (content.indexOf(before, index + before.length) >= 0) throw new Error(`Bloc non unique: ${label}`);
  return content.slice(0, index) + after + content.slice(index + before.length);
}
function replaceRegex(content, regex, after, label) {
  const matches = content.match(regex);
  if (!matches) throw new Error(`Regex introuvable: ${label}`);
  return content.replace(regex, after);
}

// ---------------------------------------------------------------------------
// sonarrRadarr.ts : une seule représentation physique + santé des sources
// ---------------------------------------------------------------------------
{
  const path = 'src/services/sonarrRadarr.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    "import { getPhysicalDownloadId, isStrongTorrentHash, mergeDownloadIdAliases, normalizeDownloadClientId, sameLegacyPhysicalTransfer, samePhysicalDownload } from '../features/downloads/downloadIdentity';",
    "import { getPhysicalDownloadId, isStrongTorrentHash, mergeDownloadIdAliases, normalizeDownloadClientId, normalizeQualityLabel, sameLegacyPhysicalTransfer, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';",
    'import identité téléchargements'
  );

  s = replaceOnce(
    s,
    `  /** Tous les identifiants connus du même torrent (hash qBit, infohash v1/v2, alias *Arr). */\n  downloadIdAliases?: string[];\n  isOptimistic?: boolean;`,
    `  /** Tous les identifiants connus du même torrent (hash qBit, infohash v1/v2, alias *Arr). */\n  downloadIdAliases?: string[];\n  /** Chemin de travail remonté par *Arr / qBittorrent, utile comme identité forte de secours. */\n  transferPath?: string;\n  /** Date d'ajout du transfert quand la source la fournit. */\n  addedAt?: number;\n  /** Item réhydraté du stockage local en attente de confirmation serveur. */\n  isRestored?: boolean;\n  isOptimistic?: boolean;`,
    'champs LiveDownloadItem'
  );

  s = replaceRegex(
    s,
    /export function extractQualityFromTitle\(rawTitle\?: string, fallbackQuality\?: string\): string \| undefined \{[\s\S]*?\n\}\n\nexport function formatBytes/,
    `export function extractQualityFromTitle(rawTitle?: string, fallbackQuality?: string): string | undefined {\n  return normalizeQualityLabel(rawTitle, fallbackQuality);\n}\n\nexport function formatBytes`,
    'normalisation qualité'
  );

  const healthBlock = `export interface LiveDownloadSourceState {\n  configured: boolean;\n  ok: boolean;\n  checkedAt: number;\n  error?: string;\n}\n\nexport interface LiveDownloadSourceHealth {\n  sonarr: LiveDownloadSourceState;\n  radarr: LiveDownloadSourceState;\n  qbittorrent: LiveDownloadSourceState;\n}\n\nconst emptySourceHealth = (configured = false): LiveDownloadSourceState => ({\n  configured,\n  ok: false,\n  checkedAt: Date.now()\n});\n\nlet lastLiveDownloadSourceHealth: LiveDownloadSourceHealth = {\n  sonarr: emptySourceHealth(false),\n  radarr: emptySourceHealth(false),\n  qbittorrent: emptySourceHealth(false)\n};\n\nexport function getLastLiveDownloadSourceHealth(): LiveDownloadSourceHealth {\n  return {\n    sonarr: { ...lastLiveDownloadSourceHealth.sonarr },\n    radarr: { ...lastLiveDownloadSourceHealth.radarr },\n    qbittorrent: { ...lastLiveDownloadSourceHealth.qbittorrent }\n  };\n}\n\n`;

  s = replaceOnce(
    s,
    'export async function fetchLiveDownloadsQueue(config: SonarrRadarrConfig): Promise<LiveDownloadItem[]> {\n  const items: LiveDownloadItem[] = [];',
    `${healthBlock}export async function fetchLiveDownloadsQueue(config: SonarrRadarrConfig): Promise<LiveDownloadItem[]> {\n  const items: LiveDownloadItem[] = [];\n  const sourceHealth: LiveDownloadSourceHealth = {\n    sonarr: emptySourceHealth(Boolean(config.sonarrUrl && config.sonarrApiKey)),\n    radarr: emptySourceHealth(Boolean(config.radarrUrl && config.radarrApiKey)),\n    qbittorrent: emptySourceHealth(Boolean(config.qbittorrentUrl))\n  };`,
    'initialisation santé sources'
  );

  s = replaceOnce(
    s,
    `      const records = Array.isArray(res) ? res : (Array.isArray(res?.records) ? res.records : []);\n\n      for (const rec of records) {`,
    `      sourceHealth.sonarr = { configured: true, ok: true, checkedAt: Date.now() };\n      const records = Array.isArray(res) ? res : (Array.isArray(res?.records) ? res.records : []);\n\n      for (const rec of records) {`,
    'succès Sonarr'
  );

  s = replaceOnce(
    s,
    `          downloadIdAliases: normalizeDownloadClientId(rec.downloadId) ? [normalizeDownloadClientId(rec.downloadId)!] : undefined,\n          releaseTitle: rec.title\n        });`,
    `          downloadIdAliases: normalizeDownloadClientId(rec.downloadId) ? [normalizeDownloadClientId(rec.downloadId)!] : undefined,\n          releaseTitle: rec.title,\n          transferPath: rec.outputPath || undefined,\n          addedAt: rec.added ? Date.parse(rec.added) : undefined,\n          isRestored: false\n        });`,
    'métadonnées Sonarr'
  );

  s = replaceOnce(
    s,
    `    } catch (e: any) {\n      if (!e?.message?.includes('PWA Web')) {\n        console.warn('[LiveQueue] Erreur Sonarr queue:', e);`,
    `    } catch (e: any) {\n      sourceHealth.sonarr = { configured: true, ok: false, checkedAt: Date.now(), error: e?.message || 'Sonarr indisponible' };\n      if (!e?.message?.includes('PWA Web')) {\n        console.warn('[LiveQueue] Erreur Sonarr queue:', e);`,
    'erreur Sonarr'
  );

  // Le second bloc records identique est celui de Radarr : rechercher après le commentaire Radarr.
  const radarrMarker = '// 2. Radarr Queue';
  const radarrIndex = s.indexOf(radarrMarker);
  if (radarrIndex < 0) throw new Error('Bloc Radarr introuvable');
  const beforeRadarr = s.slice(0, radarrIndex);
  let radarrPart = s.slice(radarrIndex);
  radarrPart = replaceOnce(
    radarrPart,
    `      const records = Array.isArray(res) ? res : (Array.isArray(res?.records) ? res.records : []);\n\n      for (const rec of records) {`,
    `      sourceHealth.radarr = { configured: true, ok: true, checkedAt: Date.now() };\n      const records = Array.isArray(res) ? res : (Array.isArray(res?.records) ? res.records : []);\n\n      for (const rec of records) {`,
    'succès Radarr'
  );
  radarrPart = replaceOnce(
    radarrPart,
    `          downloadIdAliases: normalizeDownloadClientId(rec.downloadId) ? [normalizeDownloadClientId(rec.downloadId)!] : undefined,\n          releaseTitle: rec.title\n        });`,
    `          downloadIdAliases: normalizeDownloadClientId(rec.downloadId) ? [normalizeDownloadClientId(rec.downloadId)!] : undefined,\n          releaseTitle: rec.title,\n          transferPath: rec.outputPath || undefined,\n          addedAt: rec.added ? Date.parse(rec.added) : undefined,\n          isRestored: false\n        });`,
    'métadonnées Radarr'
  );
  radarrPart = replaceOnce(
    radarrPart,
    `    } catch (e: any) {\n      if (!e?.message?.includes('PWA Web')) {\n        console.warn('[LiveQueue] Erreur Radarr queue:', e);`,
    `    } catch (e: any) {\n      sourceHealth.radarr = { configured: true, ok: false, checkedAt: Date.now(), error: e?.message || 'Radarr indisponible' };\n      if (!e?.message?.includes('PWA Web')) {\n        console.warn('[LiveQueue] Erreur Radarr queue:', e);`,
    'erreur Radarr'
  );
  s = beforeRadarr + radarrPart;

  s = replaceOnce(
    s,
    `      const res = await executeGet(\`${'${qbitBase}'}/api/v2/torrents/info?filter=all&sort=added_on&reverse=true&limit=50\`, qHeaders);\n      if (Array.isArray(res)) {`,
    `      const res = await executeGet(\`${'${qbitBase}'}/api/v2/torrents/info?filter=all&sort=added_on&reverse=true&limit=50\`, qHeaders);\n      sourceHealth.qbittorrent = { configured: true, ok: true, checkedAt: Date.now() };\n      if (Array.isArray(res)) {`,
    'succès qBittorrent'
  );

  s = replaceOnce(
    s,
    `            size: Number(t.size || 0),\n            sizeleft: 0,\n            progress: rawProgress,\n            status: qbitStatus,\n            statusText: qbitStatusText\n          };`,
    `            size: Number(t.size || 0),\n            sizeleft: 0,\n            progress: rawProgress,\n            status: qbitStatus,\n            statusText: qbitStatusText,\n            transferPath: t.content_path || t.save_path || undefined,\n            addedAt: Number(t.added_on) > 0 ? Number(t.added_on) * 1000 : undefined,\n            isRestored: false\n          };`,
    'probe qBittorrent'
  );

  s = replaceOnce(
    s,
    `            if (qbitDownloadId && samePhysicalDownload(it, qbitProbe)) {\n              exactIndexes.push(index);\n              return;\n            }\n\n            // Migration des anciens états : seulement si *Arr n'a pas de hash exploitable,\n            // avec release ET taille physique quasi identiques. Deux hashes différents\n            // ne seront donc jamais fusionnés par ce fallback.\n            if (!getPhysicalDownloadId(it) && sameLegacyPhysicalTransfer(it, qbitProbe)) {\n              legacyIndexes.push(index);\n            }`,
    `            if (qbitDownloadId && samePhysicalDownload(it, qbitProbe)) {\n              exactIndexes.push(index);\n              return;\n            }\n            if (sameTransferPath(it, qbitProbe)) {\n              exactIndexes.push(index);\n              return;\n            }\n\n            // Fallback ancien/transitoire : release + taille. La fonction refuse déjà\n            // deux vrais infohash incompatibles, donc un downloadId temporaire *Arr ne\n            // bloque plus le rattachement au torrent qBittorrent réel.\n            if (sameLegacyPhysicalTransfer(it, qbitProbe)) {\n              legacyIndexes.push(index);\n            }`,
    'rattachement qBittorrent'
  );

  s = replaceOnce(
    s,
    `            existing.downloadIdAliases = mergeDownloadIdAliases(existing, qbitProbe);\n            // Le hash qBittorrent devient l'identifiant principal uniquement lorsque`,
    `            existing.downloadIdAliases = mergeDownloadIdAliases(existing, qbitProbe);\n            existing.transferPath = existing.transferPath || qbitProbe.transferPath;\n            existing.addedAt = existing.addedAt || qbitProbe.addedAt;\n            existing.isRestored = false;\n            existing.quality = extractQualityFromTitle(t.name, existing.quality);\n            // Le hash qBittorrent devient l'identifiant principal uniquement lorsque`,
    'fusion télémétrie qBittorrent'
  );

  s = replaceOnce(
    s,
    `                downloadClient: 'qBittorrent',\n                releaseTitle: t.name\n              });`,
    `                downloadClient: 'qBittorrent',\n                releaseTitle: t.name,\n                transferPath: t.content_path || t.save_path || undefined,\n                addedAt: Number(t.added_on) > 0 ? Number(t.added_on) * 1000 : undefined,\n                isRestored: false\n              });`,
    'item qBittorrent direct'
  );

  s = replaceOnce(
    s,
    `    } catch (e: any) {\n      if (!e?.message?.includes('PWA Web')) {\n        console.warn('[LiveQueue] Erreur qBittorrent queue:', e);`,
    `    } catch (e: any) {\n      sourceHealth.qbittorrent = { configured: true, ok: false, checkedAt: Date.now(), error: e?.message || 'qBittorrent indisponible' };\n      if (!e?.message?.includes('PWA Web')) {\n        console.warn('[LiveQueue] Erreur qBittorrent queue:', e);`,
    'erreur qBittorrent'
  );

  s = replaceOnce(
    s,
    `  return items;\n}\n\n/**\n * Supprime ou annule un téléchargement`,
    `  lastLiveDownloadSourceHealth = sourceHealth;\n  return items;\n}\n\n/**\n * Supprime ou annule un téléchargement`,
    'publication santé sources'
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// liveDownloadStore.ts : un seul réconciliateur, lifecycle monotone, historique
// ---------------------------------------------------------------------------
{
  const path = 'src/store/liveDownloadStore.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    `  fetchLiveDownloadsQueue,\n  type LiveDownloadItem,`,
    `  fetchLiveDownloadsQueue,\n  getLastLiveDownloadSourceHealth,\n  type LiveDownloadItem,`,
    'import santé sources store'
  );
  s = replaceOnce(
    s,
    `import { getPhysicalDownloadId, getStrongPhysicalDownloadIds, hasConflictingStrongPhysicalIds, mergeDownloadIdAliases, sameLegacyPhysicalTransfer, samePhysicalDownload } from '../features/downloads/downloadIdentity';`,
    `import { getPhysicalDownloadId, getStrongPhysicalDownloadIds, hasConflictingStrongPhysicalIds, mergeDownloadIdAliases, sameLegacyPhysicalTransfer, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';\nimport { fetchRecentDownloadHistory, resolveDownloadHistoryOutcome } from '../features/downloads/downloadHistory';`,
    'imports identité/historique store'
  );

  s = replaceOnce(
    s,
    `const MISSING_WARNING_DELAY_MS = 30_000;`,
    `const MISSING_GRACE_MS = 10_000;\nconst MISSING_WARNING_DELAY_MS = 20_000;`,
    'délais disparition'
  );

  s = replaceRegex(
    s,
    /function sameDownloadIdentity\(a: LiveDownloadItem, b: LiveDownloadItem\): boolean \{[\s\S]*?\n\}\n\nfunction sendLocalNotification/,
    `function isTerminalDownload(item: LiveDownloadItem): boolean {\n  return item.status === 'completed' || Number(item.progress || 0) >= 100;\n}\n\nfunction sameDownloadIdentity(a: LiveDownloadItem, b: LiveDownloadItem): boolean {\n  if (a.id === b.id) return true;\n  if (samePhysicalDownload(a, b)) return true;\n\n  // Deux vrais torrents différents restent distincts, même s'ils concernent le même film.\n  if (hasConflictingStrongPhysicalIds(a, b)) return false;\n  if (sameTransferPath(a, b)) return true;\n\n  const aResolution = resolutionBucket(a);\n  const bResolution = resolutionBucket(b);\n  if (aResolution && bResolution && aResolution !== bResolution) return false;\n\n  if (sameLegacyPhysicalTransfer(a, b)) return true;\n\n  // Un transfert terminé ne doit jamais absorber un nouveau re-téléchargement du\n  // même média simplement parce que le TMDB est identique.\n  if (isTerminalDownload(a) !== isTerminalDownload(b)) return false;\n  if (!sameCanonicalMedia(a, b)) return false;\n\n  if (a.mediaType === 'tv') {\n    if (a.seasonNumber != null && b.seasonNumber != null && a.seasonNumber !== b.seasonNumber) return false;\n    if (a.episodeNumber != null && b.episodeNumber != null && a.episodeNumber !== b.episodeNumber) return false;\n  }\n\n  // Le fallback canonique sert uniquement à raccrocher une intention SeenIt ou un\n  // état réhydraté. Deux snapshots distants sans identité physique commune ne sont\n  // jamais fusionnés sur le seul titre/TMDB.\n  return Boolean(a.isOptimistic || b.isOptimistic || a.isRestored || b.isRestored);\n}\n\nfunction sendLocalNotification`,
    'identité logique store'
  );

  s = replaceOnce(
    s,
    `          downloadId: item.downloadId,\n          downloadIdAliases: item.downloadIdAliases,\n          isOptimistic: true`,
    `          downloadId: item.downloadId,\n          downloadIdAliases: item.downloadIdAliases,\n          transferPath: item.transferPath,\n          addedAt: item.addedAt || Date.now(),\n          isRestored: false,\n          isOptimistic: true`,
    'optimistic métadonnées'
  );

  s = replaceOnce(
    s,
    `          const rawIds = new Set(rawServerItems.map(item => item.id));`,
    `          const sourceHealth = getLastLiveDownloadSourceHealth();\n          const rawIds = new Set(rawServerItems.map(item => item.id));`,
    'lecture santé sources'
  );

  s = replaceOnce(
    s,
    `              if (!serverItem.quality && localMatch.quality) serverItem.quality = localMatch.quality;`,
    `              if (!serverItem.quality && localMatch.quality) serverItem.quality = localMatch.quality;\n              if (!serverItem.transferPath && localMatch.transferPath) serverItem.transferPath = localMatch.transferPath;\n              if (!serverItem.addedAt && localMatch.addedAt) serverItem.addedAt = localMatch.addedAt;\n              serverItem.isRestored = false;`,
    'conservation métadonnées locales'
  );

  s = replaceOnce(
    s,
    `              if (samePhysicalDownload(localMatch, serverItem)\n                  && Number(localMatch.progress || 0) > Number(serverItem.progress || 0)) {`,
    `              if ((samePhysicalDownload(localMatch, serverItem) || sameTransferPath(localMatch, serverItem) || sameLegacyPhysicalTransfer(localMatch, serverItem))\n                  && Number(localMatch.progress || 0) > Number(serverItem.progress || 0)) {`,
    'progression monotone locale'
  );

  const oldPreserved = `          const preservedItems: LiveDownloadItem[] = [];\n          for (const oldItem of currentDownloads) {\n            if (oldItem.isOptimistic || removedSet.has(oldItem.id)) continue;\n            if (serverItems.some(serverItem => sameDownloadIdentity(oldItem, serverItem))) continue;\n\n            if (oldItem.status === 'completed' || oldItem.progress >= 100) {\n              preservedItems.push({\n                ...oldItem,\n                progress: 100,\n                status: 'completed',\n                statusText: 'Téléchargement terminé 🍿',\n                sizeleft: 0,\n                speedBytesPerSec: 0,\n                speedFormatted: '',\n                timeleft: '',\n                timeleftSeconds: 0\n              });\n              continue;\n            }\n\n            if (!missingSince[oldItem.id]) missingSince[oldItem.id] = now;\n            const missingFor = now - missingSince[oldItem.id];\n            preservedItems.push({\n              ...oldItem,\n              status: missingFor >= MISSING_WARNING_DELAY_MS ? 'warning' : oldItem.status,\n              statusText: missingFor >= MISSING_WARNING_DELAY_MS\n                ? 'Source temporairement introuvable • vérification en cours'\n                : 'Synchronisation du téléchargement…',\n              speedBytesPerSec: 0,\n              speedFormatted: '',\n              timeleft: '',\n              timeleftSeconds: 0\n            });\n          }`;

  const newPreserved = `          const missingActiveItems = currentDownloads.filter(oldItem =>\n            !oldItem.isOptimistic\n            && !removedSet.has(oldItem.id)\n            && !isTerminalDownload(oldItem)\n            && !serverItems.some(serverItem => sameDownloadIdentity(oldItem, serverItem))\n          );\n          const historySnapshot = missingActiveItems.length > 0\n            ? await fetchRecentDownloadHistory({\n                sonarrUrl: config.sonarrUrl,\n                sonarrApiKey: config.sonarrApiKey,\n                radarrUrl: config.radarrUrl,\n                radarrApiKey: config.radarrApiKey,\n                qbittorrentUrl: config.qbittorrentUrl,\n                qbittorrentUsername: config.qbittorrentUsername,\n                qbittorrentPassword: config.qbittorrentPassword\n              })\n            : null;\n\n          const preservedItems: LiveDownloadItem[] = [];\n          for (const oldItem of currentDownloads) {\n            if (oldItem.isOptimistic || removedSet.has(oldItem.id)) continue;\n            if (serverItems.some(serverItem => sameDownloadIdentity(oldItem, serverItem))) continue;\n\n            if (isTerminalDownload(oldItem)) {\n              preservedItems.push({\n                ...oldItem,\n                progress: 100,\n                status: 'completed',\n                statusText: 'Téléchargement terminé 🍿',\n                sizeleft: 0,\n                speedBytesPerSec: 0,\n                speedFormatted: '',\n                timeleft: '',\n                timeleftSeconds: 0,\n                isRestored: false\n              });\n              continue;\n            }\n\n            const historyOutcome = historySnapshot\n              ? resolveDownloadHistoryOutcome(oldItem, historySnapshot)\n              : { state: 'unknown' as const };\n\n            if (historyOutcome.state === 'completed') {\n              delete missingSince[oldItem.id];\n              preservedItems.push({\n                ...oldItem,\n                quality: historyOutcome.quality || oldItem.quality,\n                progress: 100,\n                status: 'completed',\n                statusText: 'Téléchargement terminé 🍿',\n                errorMessage: undefined,\n                sizeleft: 0,\n                speedBytesPerSec: 0,\n                speedFormatted: '',\n                timeleft: '',\n                timeleftSeconds: 0,\n                isRestored: false\n              });\n              continue;\n            }\n\n            if (historyOutcome.state === 'failed') {\n              delete missingSince[oldItem.id];\n              preservedItems.push({\n                ...oldItem,\n                status: 'error',\n                statusText: 'Téléchargement échoué',\n                errorMessage: historyOutcome.message || 'Le téléchargement a échoué.',\n                speedBytesPerSec: 0,\n                speedFormatted: '',\n                timeleft: '',\n                timeleftSeconds: 0,\n                isRestored: false\n              });\n              continue;\n            }\n\n            if (!missingSince[oldItem.id]) missingSince[oldItem.id] = now;\n            const missingFor = now - missingSince[oldItem.id];\n            const arrHealth = oldItem.mediaType === 'movie' ? sourceHealth.radarr : sourceHealth.sonarr;\n            const qbitHealth = sourceHealth.qbittorrent;\n            const arrHealthy = !arrHealth.configured || arrHealth.ok;\n            const qbitHealthy = !qbitHealth.configured || qbitHealth.ok;\n            const sourcesHealthy = arrHealthy && qbitHealthy;\n\n            // Si toutes les sources configurées répondent et que l'item n'existe ni\n            // dans les files ni dans l'historique d'import, l'état local est périmé.\n            // On le retire au lieu de ressusciter éternellement un ancien pourcentage.\n            if (sourcesHealthy && missingFor >= MISSING_GRACE_MS) {\n              delete missingSince[oldItem.id];\n              continue;\n            }\n\n            preservedItems.push({\n              ...oldItem,\n              status: missingFor >= MISSING_WARNING_DELAY_MS ? 'warning' : 'searching',\n              statusText: missingFor >= MISSING_WARNING_DELAY_MS\n                ? 'Connexion au téléchargement interrompue • nouvelle tentative…'\n                : 'Vérification de la fin du téléchargement…',\n              speedBytesPerSec: 0,\n              speedFormatted: '',\n              timeleft: '',\n              timeleftSeconds: 0\n            });\n          }`;
  s = replaceOnce(s, oldPreserved, newPreserved, 'résolution disparition/import');

  s = replaceRegex(
    s,
    /          const mergeRepresentations = \(a: LiveDownloadItem, b: LiveDownloadItem\): LiveDownloadItem => \{[\s\S]*?\n          \};\n\n          const finalItems/,
    `          const mergeRepresentations = (a: LiveDownloadItem, b: LiveDownloadItem): LiveDownloadItem => {\n            const meta = metadataScore(a) >= metadataScore(b) ? a : b;\n            const live = liveScore(a) >= liveScore(b) ? a : b;\n            const aliases = mergeDownloadIdAliases(a, b);\n            const strongIds = [...getStrongPhysicalDownloadIds(a), ...getStrongPhysicalDownloadIds(b)];\n            const completed = isTerminalDownload(a) || isTerminalDownload(b);\n            const hasError = !completed && (a.status === 'error' || b.status === 'error' || Boolean(a.errorMessage) || Boolean(b.errorMessage));\n            const errorSource = a.status === 'error' || a.errorMessage ? a : b;\n            const progress = completed ? 100 : Math.max(Number(a.progress || 0), Number(b.progress || 0));\n            const liveWithBestProgress = Number(a.progress || 0) > Number(b.progress || 0) ? a : live;\n\n            return {\n              ...meta,\n              id: meta.id,\n              downloadId: strongIds[0] || getPhysicalDownloadId(live) || getPhysicalDownloadId(meta) || undefined,\n              downloadIdAliases: aliases,\n              transferPath: meta.transferPath || live.transferPath,\n              addedAt: [a.addedAt, b.addedAt].filter(Boolean).length\n                ? Math.min(...([a.addedAt, b.addedAt].filter(Boolean) as number[]))\n                : undefined,\n              releaseTitle: meta.releaseTitle || live.releaseTitle,\n              quality: extractQualityFromTitle(meta.releaseTitle || live.releaseTitle, meta.quality || live.quality),\n              size: liveWithBestProgress.size > 0 ? liveWithBestProgress.size : meta.size,\n              sizeleft: completed ? 0 : liveWithBestProgress.sizeleft,\n              progress,\n              speedBytesPerSec: completed ? 0 : live.speedBytesPerSec,\n              speedFormatted: completed ? '' : live.speedFormatted,\n              timeleft: completed ? '' : live.timeleft,\n              timeleftSeconds: completed ? 0 : live.timeleftSeconds,\n              status: completed ? 'completed' : hasError ? errorSource.status : live.status,\n              statusText: completed ? 'Téléchargement terminé 🍿' : hasError ? errorSource.statusText : live.statusText,\n              errorMessage: completed ? undefined : hasError ? errorSource.errorMessage : undefined,\n              isOptimistic: Boolean(a.isOptimistic && b.isOptimistic),\n              isRestored: false\n            };\n          };\n\n          const finalItems`,
    'fusion monotone représentations'
  );

  s = replaceOnce(
    s,
    `          for (const serverItem of serverItems) {\n            const previous = currentDownloads.find(oldItem => sameDownloadIdentity(oldItem, serverItem));\n            if (serverItem.progress >= 100 && previous && previous.progress < 100 && previous.status !== 'completed') {\n              sendLocalNotification(\n                'Téléchargement terminé 🍿',\n                \`Le téléchargement de "${'${serverItem.title}'}" est terminé !\`,\n                true\n              );\n            }\n          }`,
    `          for (const finalItem of finalItems) {\n            if (!isTerminalDownload(finalItem)) continue;\n            const previous = currentDownloads.find(oldItem => sameDownloadIdentity(oldItem, finalItem));\n            if (previous && !isTerminalDownload(previous)) {\n              sendLocalNotification(\n                'Téléchargement terminé 🍿',\n                \`Le téléchargement de "${'${finalItem.title}'}" est terminé !\`,\n                true\n              );\n            }\n          }`,
    'notification terminale unique'
  );

  s = replaceOnce(
    s,
    `      getMovieDownload: (tmdbId, movieTitle) => {\n        return (get().downloads || []).find(item =>\n          matchMovieDownload(item, tmdbId, movieTitle)\n        ) || null;\n      },`,
    `      getMovieDownload: (tmdbId, movieTitle) => {\n        const matches = (get().downloads || []).filter(item =>\n          matchMovieDownload(item, tmdbId, movieTitle)\n        );\n        if (!matches.length) return null;\n\n        const score = (item: LiveDownloadItem) => {\n          const active = !isTerminalDownload(item) && item.status !== 'error';\n          const exactTmdb = tmdbId && item.tmdbId && Number(tmdbId) === Number(item.tmdbId);\n          return (active ? 10_000 : 0)\n            + (exactTmdb ? 2_000 : 0)\n            + (item.status === 'downloading' ? 500 : 0)\n            + (item.status === 'warning' ? -200 : 0)\n            + Math.min(100, Number(item.progress || 0));\n        };\n\n        return [...matches].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0] || null;\n      },`,
    'sélection film déterministe'
  );

  s = replaceOnce(
    s,
    `      partialize: state => ({\n        downloads: state.downloads,\n        removedIds: state.removedIds\n      })`,
    `      partialize: state => ({\n        // Un état actif local n'est jamais une vérité après redémarrage. On conserve\n        // son identité/métadonnées mais pas son ancien pourcentage : le prochain poll\n        // le rattache à la file actuelle ou à l'historique d'import.\n        downloads: state.downloads.map(item => isTerminalDownload(item)\n          ? { ...item, isRestored: false }\n          : {\n              ...item,\n              progress: 0,\n              sizeleft: item.size > 0 ? item.size : 0,\n              speedBytesPerSec: 0,\n              speedFormatted: '',\n              timeleft: '',\n              timeleftSeconds: 0,\n              status: 'searching',\n              statusText: 'Synchronisation du téléchargement…',\n              isOptimistic: false,\n              isRestored: true\n            }),\n        removedIds: state.removedIds\n      })`,
    'persistance non autoritaire'
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// Tests identité/qualité
// ---------------------------------------------------------------------------
{
  const path = 'tests/downloadIdentity.test.ts';
  let s = read(path);
  s = replaceOnce(
    s,
    `  mergeDownloadIdAliases,\n  normalizeDownloadClientId,`,
    `  mergeDownloadIdAliases,\n  normalizeDownloadClientId,\n  normalizeQualityLabel,`,
    'import qualité test'
  );
  s = replaceOnce(
    s,
    `  sameLegacyPhysicalTransfer,\n  samePhysicalDownload`,
    `  sameLegacyPhysicalTransfer,\n  samePhysicalDownload,\n  sameTransferPath`,
    'import path test'
  );

  s += `\n\ntest('normalise de façon stable la qualité Radarr et qBittorrent', () => {\n  const radarr = normalizeQualityLabel('Normal.2026.1080p.BluRay.x265', 'BluRay-1080p');\n  const qbit = normalizeQualityLabel('Normal.2026.1080p.BluRay.x265');\n  assert.equal(radarr, '1080p BluRay');\n  assert.equal(qbit, '1080p BluRay');\n});\n\ntest('normalise 2160p WEB-DL vers le même badge 4K', () => {\n  assert.equal(normalizeQualityLabel('Film.2160p.WEB-DL.HDR'), '4K WEB-DL HDR');\n  assert.equal(normalizeQualityLabel('Film 4K WEBDL HDR10'), '4K WEB-DL HDR');\n});\n\ntest('rattache Radarr et qBittorrent par chemin de transfert quand le hash manque', () => {\n  assert.equal(sameTransferPath(\n    { transferPath: 'D:\\\\Downloads\\\\Normal.2026.1080p', size: 10_000_000_000 },\n    { transferPath: 'd:/downloads/Normal.2026.1080p/', size: 10_000_000_000 }\n  ), true);\n});\n\ntest('le fallback release accepte un identifiant Arr temporaire non-hash', () => {\n  assert.equal(sameLegacyPhysicalTransfer(\n    { downloadId: 'radarr-temporary-id', mediaType: 'movie', releaseTitle: 'Normal.2026.1080p.BluRay', size: 10_000_000_000 },\n    { mediaType: 'movie', releaseTitle: 'Normal 2026 1080p BluRay x265', size: 10_005_000_000 }\n  ), true);\n});\n`;
  write(path, s);
}

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------
{
  const gradle = 'android/app/build.gradle';
  let s = read(gradle)
    .replace('versionCode 104056', 'versionCode 104057')
    .replace('versionName "1.4.56"', 'versionName "1.4.57"');
  write(gradle, s);

  const updateStore = 'src/store/updateStore.ts';
  s = read(updateStore).replace("CURRENT_APP_VERSION = '1.4.56'", "CURRENT_APP_VERSION = '1.4.57'");
  write(updateStore, s);
}

// Les deux anciens moteurs concurrents ne doivent plus pouvoir être réimportés par erreur.
for (const obsolete of [
  'src/features/downloads/qbitRealtimeMonitor.ts',
  'src/features/downloads/downloadCompletionWatcher.ts'
]) {
  if (fs.existsSync(obsolete)) fs.rmSync(obsolete);
}

console.log('Patch téléchargements 1.4.57 appliqué.');
