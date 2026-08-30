const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content, 'utf8'); }
function replaceOnce(content, before, after, label) {
  const index = content.indexOf(before);
  if (index < 0) throw new Error(`Bloc introuvable: ${label}`);
  return content.slice(0, index) + after + content.slice(index + before.length);
}

// ---------------------------------------------------------------------------
// downloadIdentity.ts : handshake temporel ID-first avant disponibilité du hash
// ---------------------------------------------------------------------------
{
  const path = 'src/features/downloads/downloadIdentity.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    `  mediaType?: string | null;\n  transferPath?: string | null;\n}`,
    `  mediaType?: string | null;\n  transferPath?: string | null;\n  addedAt?: number | null;\n  tmdbId?: number | string | null;\n  tvdbId?: number | string | null;\n  seasonNumber?: number | null;\n  episodeNumber?: number | null;\n  quality?: string | null;\n  isOptimistic?: boolean | null;\n}`,
    'champs handshake identité'
  );

  const handshake = `\nfunction identityResolutionBucket(item?: DownloadIdentityLike | null): '4k' | '1080p' | '720p' | null {\n  const value = \`${'${item?.quality || \'\'}'} ${'${item?.releaseTitle || \'\'}'}\`.toLowerCase();\n  if (/2160|4k|uhd/.test(value)) return '4k';\n  if (/1080/.test(value)) return '1080p';\n  if (/720/.test(value)) return '720p';\n  return null;\n}\n\n/**\n * Rattache temporairement une demande SeenIt au transfert qui vient juste\n * d'apparaître avant que *Arr/qBittorrent ne partagent un hash commun.\n * Aucun titre n'est utilisé : uniquement temps, type, IDs canoniques s'ils\n * existent, scope épisode/saison et résolution.\n */\nexport function canAttachRecentOptimisticRequest(\n  request?: DownloadIdentityLike | null,\n  remote?: DownloadIdentityLike | null,\n  now = Date.now(),\n  windowMs = 60_000\n): boolean {\n  if (!request?.isOptimistic || !remote) return false;\n  if (request.mediaType && remote.mediaType && request.mediaType !== remote.mediaType) return false;\n\n  const requestedAt = Number(request.addedAt || 0);\n  const remoteAddedAt = Number(remote.addedAt || 0);\n  if (!requestedAt || !remoteAddedAt) return false;\n  if (requestedAt > now + 5_000 || remoteAddedAt > now + 5_000) return false;\n\n  const delta = remoteAddedAt - requestedAt;\n  if (delta < -5_000 || delta > windowMs) return false;\n\n  if (request.tmdbId && remote.tmdbId && Number(request.tmdbId) !== Number(remote.tmdbId)) return false;\n  if (request.tvdbId && remote.tvdbId && Number(request.tvdbId) !== Number(remote.tvdbId)) return false;\n\n  if (request.mediaType === 'tv') {\n    if (request.seasonNumber != null && remote.seasonNumber != null\n        && Number(request.seasonNumber) !== Number(remote.seasonNumber)) return false;\n    if (request.episodeNumber != null && remote.episodeNumber != null\n        && Number(request.episodeNumber) !== Number(remote.episodeNumber)) return false;\n  }\n\n  const requestResolution = identityResolutionBucket(request);\n  const remoteResolution = identityResolutionBucket(remote);\n  if (requestResolution && remoteResolution && requestResolution !== remoteResolution) return false;\n\n  return true;\n}\n`;

  s = replaceOnce(
    s,
    `export function normalizeDownloadRelease(value: unknown): string {`,
    `${handshake}\nexport function normalizeDownloadRelease(value: unknown): string {`,
    'helper handshake temporel'
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// liveDownloadStore.ts : zéro doublon transitoire + notifications de session
// ---------------------------------------------------------------------------
{
  const path = 'src/store/liveDownloadStore.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    `import { getPhysicalDownloadId, getStrongPhysicalDownloadIds, hasConflictingStrongPhysicalIds, mergeDownloadIdAliases, sameLegacyPhysicalTransfer, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';`,
    `import { canAttachRecentOptimisticRequest, getPhysicalDownloadId, getStrongPhysicalDownloadIds, hasConflictingStrongPhysicalIds, mergeDownloadIdAliases, sameLegacyPhysicalTransfer, samePhysicalDownload, sameTransferPath } from '../features/downloads/downloadIdentity';`,
    'import handshake store'
  );

  s = replaceOnce(
    s,
    `const missingSince: Record<string, number> = {};\nconst OPTIMISTIC_TTL_MS = 120_000;`,
    `const missingSince: Record<string, number> = {};\nconst completionNotificationEligibility = new Set<string>();\nconst OPTIMISTIC_TTL_MS = 120_000;`,
    'mémoire notifications session'
  );

  s = replaceOnce(
    s,
    `function sameRequestScope(a: LiveDownloadItem, b: LiveDownloadItem): boolean {`,
    `function completionNotificationKeys(item: LiveDownloadItem): string[] {\n  const keys = new Set<string>();\n  for (const id of getStrongPhysicalDownloadIds(item)) keys.add(\`physical:${'${id}'}\`);\n\n  const quality = resolutionBucket(item) || 'auto';\n  if (item.mediaType === 'movie') {\n    if (item.tmdbId) keys.add(\`movie:tmdb:${'${Number(item.tmdbId)}'}:${'${quality}'}\`);\n    else if (item.imdbId) keys.add(\`movie:imdb:${'${String(item.imdbId).toLowerCase()}'}:${'${quality}'}\`);\n  } else {\n    const canonical = item.tmdbId ? \`tmdb:${'${Number(item.tmdbId)}'}\` : item.tvdbId ? \`tvdb:${'${Number(item.tvdbId)}'}\` : '';\n    if (canonical) {\n      keys.add(\`tv:${'${canonical}'}:s${'${item.seasonNumber ?? "*"}'}:e${'${item.episodeNumber ?? "*"}'}:${'${quality}'}\`);\n    }\n  }\n\n  return Array.from(keys);\n}\n\nfunction markCompletionNotificationEligible(item: LiveDownloadItem) {\n  for (const key of completionNotificationKeys(item)) completionNotificationEligibility.add(key);\n}\n\nfunction consumeCompletionNotificationEligibility(item: LiveDownloadItem): boolean {\n  const keys = completionNotificationKeys(item);\n  const eligible = keys.some(key => completionNotificationEligibility.has(key));\n  if (eligible) keys.forEach(key => completionNotificationEligibility.delete(key));\n  return eligible;\n}\n\nfunction sameRequestScope(a: LiveDownloadItem, b: LiveDownloadItem): boolean {`,
    'helpers notifications session'
  );

  s = replaceOnce(
    s,
    `function sendLocalNotification(title: string, body: string, isSuccess = false) {\n  try {\n    useToastStore.getState().showToast(\`${'${title}'}: ${'${body}'}\`, isSuccess ? 'success' : 'download');\n  } catch {}`,
    `function sendLocalNotification(title: string, body: string, isSuccess = false, item?: LiveDownloadItem) {\n  try {\n    if (item) {\n      const mediaTitle = item.movieTitle || item.seriesTitle || item.title;\n      const subtitle = item.mediaType === 'tv' && item.seasonNumber != null\n        ? item.episodeNumber != null\n          ? \`S${'${String(item.seasonNumber).padStart(2, \'0\')}'}E${'${String(item.episodeNumber).padStart(2, \'0\')}'}\`\n          : \`Saison ${'${item.seasonNumber}'}\`\n        : undefined;\n      useToastStore.getState().showToast({\n        title: mediaTitle,\n        subtitle,\n        action: isSuccess ? 'Téléchargement terminé' : body,\n        posterPath: item.posterPath\n      }, isSuccess ? 'success' : 'download');\n    } else {\n      useToastStore.getState().showToast(\`${'${title}'}: ${'${body}'}\`, isSuccess ? 'success' : 'download');\n    }\n  } catch {}`,
    'toast riche notification'
  );

  s = replaceOnce(
    s,
    `        const existing = get().downloads.find(download =>`,
    `        markCompletionNotificationEligible(candidate);\n\n        const existing = get().downloads.find(download =>`,
    'éligibilité notification demande'
  );

  // Marquer tout transfert réellement vu actif pendant cette session.
  s = replaceOnce(
    s,
    `            if (serverItem.progress >= 100 || serverItem.status === 'completed') {\n              serverItem.progress = 100;\n              serverItem.status = 'completed';\n              serverItem.statusText = 'Téléchargement terminé 🍿';\n              serverItem.sizeleft = 0;\n            }\n          });\n\n          const now = Date.now();`,
    `            if (serverItem.progress >= 100 || serverItem.status === 'completed') {\n              serverItem.progress = 100;\n              serverItem.status = 'completed';\n              serverItem.statusText = 'Téléchargement terminé 🍿';\n              serverItem.sizeleft = 0;\n            } else {\n              markCompletionNotificationEligible(serverItem);\n            }\n          });\n\n          const handshakeNow = Date.now();\n          const recentOptimistics = currentDownloads.filter(item => item.isOptimistic && !isTerminalDownload(item));\n          const handshakeCandidates = recentOptimistics.map(optimistic => ({\n            optimistic,\n            candidates: serverItems.filter(serverItem =>\n              !sameDownloadIdentity(optimistic, serverItem)\n              && (serverItem.id.startsWith('qbit_') || (!serverItem.tmdbId && !serverItem.tvdbId))\n              && canAttachRecentOptimisticRequest(optimistic, serverItem, handshakeNow)\n            )\n          }));\n\n          for (const entry of handshakeCandidates) {\n            if (entry.candidates.length !== 1) continue;\n            const serverItem = entry.candidates[0];\n            const contenders = handshakeCandidates.filter(other => other.candidates.includes(serverItem));\n            if (contenders.length !== 1) continue;\n\n            const optimistic = entry.optimistic;\n            if (!serverItem.tmdbId && optimistic.tmdbId) serverItem.tmdbId = optimistic.tmdbId;\n            if (!serverItem.tvdbId && optimistic.tvdbId) serverItem.tvdbId = optimistic.tvdbId;\n            if (!serverItem.imdbId && optimistic.imdbId) serverItem.imdbId = optimistic.imdbId;\n            if (!serverItem.posterPath && optimistic.posterPath) serverItem.posterPath = optimistic.posterPath;\n            if (!serverItem.backdropPath && optimistic.backdropPath) serverItem.backdropPath = optimistic.backdropPath;\n            if (serverItem.seasonNumber == null && optimistic.seasonNumber != null) serverItem.seasonNumber = optimistic.seasonNumber;\n            if (serverItem.episodeNumber == null && optimistic.episodeNumber != null) serverItem.episodeNumber = optimistic.episodeNumber;\n            if (serverItem.mediaType === 'movie') {\n              serverItem.movieTitle = optimistic.movieTitle || optimistic.title;\n            } else {\n              serverItem.seriesTitle = optimistic.seriesTitle || optimistic.title;\n            }\n            serverItem.downloadIdAliases = mergeDownloadIdAliases(serverItem, optimistic);\n            markCompletionNotificationEligible(serverItem);\n          }\n\n          const now = Date.now();`,
    'handshake demande vers qbit'
  );

  s = replaceOnce(
    s,
    `            if (previous && !isTerminalDownload(previous)) {\n              sendLocalNotification(\n                'Téléchargement terminé 🍿',\n                \`Le téléchargement de "${'${finalItem.title}'}" est terminé !\`,\n                true\n              );\n            }`,
    `            if (previous && !isTerminalDownload(previous) && consumeCompletionNotificationEligibility(finalItem)) {\n              sendLocalNotification(\n                'Téléchargement terminé 🍿',\n                \`Le téléchargement de "${'${finalItem.movieTitle || finalItem.seriesTitle || finalItem.title}'}" est terminé !\`,\n                true,\n                finalItem\n              );\n            }`,
    'notification uniquement session active'
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// DownloadModal.tsx : toasts média avec poster
// ---------------------------------------------------------------------------
{
  const path = 'src/components/DownloadModal.tsx';
  let s = read(path);

  s = replaceOnce(
    s,
    `  const automationClientName = mediaType === 'tv' ? 'Sonarr' : 'Radarr';\n\n  const handleScopeChange`,
    `  const automationClientName = mediaType === 'tv' ? 'Sonarr' : 'Radarr';\n\n  const showMediaDownloadToast = (action: string, toastType: 'download' | 'success' | 'error' | 'info' = 'download') => {\n    const subtitle = mediaType === 'tv'\n      ? scopeMode === 'episode'\n        ? \`S${'${String(selectedSeason).padStart(2, \'0\')}'}E${'${String(selectedEpisode).padStart(2, \'0\')}'}\`\n        : scopeMode === 'season'\n          ? \`Saison ${'${selectedSeason}'}\`\n          : undefined\n      : undefined;\n    showToast({ title, subtitle, action, posterPath }, toastType);\n  };\n\n  const handleScopeChange`,
    'helper toast média modal'
  );

  s = replaceOnce(s, `      showToast(message, 'error');`, `      showMediaDownloadToast(message, 'error');`, 'toast config auto');
  s = replaceOnce(s, `    showToast(\`Demande prise en compte • recherche ${'${qualityLabel}'}…\`, 'download');`, `    showMediaDownloadToast(\`Recherche ${'${qualityLabel}'} en cours…\`, 'download');`, 'toast recherche auto');
  s = replaceOnce(s, `        showToast(\`${'${client}'} : ${'${result.message}'}\`, 'error');`, `        showMediaDownloadToast(result.message, 'error');`, 'toast erreur auto résultat');
  s = replaceOnce(s, `      showToast(\`${'${client}'} : ${'${message}'}\`, 'error');`, `      showMediaDownloadToast(message, 'error');`, 'toast erreur auto exception');
  s = replaceOnce(s, `    showToast('Demande prise en compte • préparation du téléchargement…', 'download');`, `    showMediaDownloadToast('Préparation du téléchargement…', 'download');`, 'toast manuel départ');
  s = replaceOnce(s, `        else showToast(successMessage, 'success');`, `        else showMediaDownloadToast(successMessage, 'success');`, 'toast manuel succès');

  // Les deux derniers showToast(result/message) appartiennent au flux manuel média.
  const manualResultIndex = s.indexOf(`        setActionMessage({ text: result.message, type: 'error' });`);
  if (manualResultIndex < 0) throw new Error('Bloc erreur manuelle introuvable');
  const beforeManual = s.slice(0, manualResultIndex);
  let manual = s.slice(manualResultIndex);
  manual = replaceOnce(manual, `        showToast(result.message, 'error');`, `        showMediaDownloadToast(result.message, 'error');`, 'toast erreur manuelle résultat');
  manual = replaceOnce(manual, `      showToast(message, 'error');`, `      showMediaDownloadToast(message, 'error');`, 'toast erreur manuelle exception');
  s = beforeManual + manual;

  write(path, s);
}

// ---------------------------------------------------------------------------
// LiveDownloadBanner.tsx : aucune fausse barre de progression pendant recherche
// ---------------------------------------------------------------------------
{
  const path = 'src/components/LiveDownloadBanner.tsx';
  let s = read(path);

  s = replaceOnce(
    s,
    `{item.releaseTitle || item.title}`,
    `{item.movieTitle || item.seriesTitle || item.title}`,
    'titre média banner'
  );

  s = replaceOnce(
    s,
    `            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">\n              {showIndeterminate ? (\n                <div className="h-full w-1/3 rounded-full bg-blue-500/70 animate-pulse" />\n              ) : (\n                <div\n                  className={\`h-full rounded-full transition-[width] duration-300 ${'${'}\n                    phase.kind === 'error'\n                      ? 'bg-red-500'\n                      : phase.kind === 'warning'\n                        ? 'bg-amber-500'\n                        : phase.kind === 'completed'\n                          ? 'bg-emerald-500'\n                          : 'bg-cyan-500'\n                  }\`}\n                  style={{ width: \`${'${progress}'}%\` }}\n                />\n              )}\n            </div>`,
    `            {showIndeterminate ? (\n              <div className="mt-3 flex h-2 items-center gap-1.5" aria-label="Activité en cours">\n                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90 animate-pulse" />\n                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/65 animate-pulse [animation-delay:160ms]" />\n                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/40 animate-pulse [animation-delay:320ms]" />\n              </div>\n            ) : (\n              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">\n                <div\n                  className={\`h-full rounded-full transition-[width] duration-300 ${'${'}\n                    phase.kind === 'error'\n                      ? 'bg-red-500'\n                      : phase.kind === 'warning'\n                        ? 'bg-amber-500'\n                        : phase.kind === 'completed'\n                          ? 'bg-emerald-500'\n                          : 'bg-cyan-500'\n                  }\`}\n                  style={{ width: \`${'${progress}'}%\` }}\n                />\n              </div>\n            )}`,
    'activité indéterminée banner'
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// DownloadsScreen.tsx : même activité indéterminée + toast suppression lisible
// ---------------------------------------------------------------------------
{
  const path = 'src/screens/DownloadsScreen.tsx';
  let s = read(path);

  s = replaceOnce(
    s,
    `          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.03]">\n            {isPending && progress <= 0 ? (\n              <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-500/30 via-cyan-300/80 to-cyan-500/30 animate-pulse" />\n            ) : (\n              <div\n                className={\`relative h-full rounded-full transition-[width] duration-500 ease-out ${'${progressBar}'} ${'${!isCompleted && !isError ? \'shadow-[0_0_12px_rgba(34,211,238,0.28)]\' : \'\'}'}\`}\n                style={{ width: \`${'${progress}'}%\` }}\n              >\n                {!isCompleted && progress > 4 && <div className="absolute inset-0 bg-white/[0.08]" />}\n              </div>\n            )}\n          </div>`,
    `          {isPending && progress <= 0 ? (\n            <div className="mt-2 flex h-2 items-center gap-1.5" aria-label="Activité en cours">\n              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/90 animate-pulse" />\n              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/65 animate-pulse [animation-delay:160ms]" />\n              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/40 animate-pulse [animation-delay:320ms]" />\n            </div>\n          ) : (\n            <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.03]">\n              <div\n                className={\`relative h-full rounded-full transition-[width] duration-500 ease-out ${'${progressBar}'} ${'${!isCompleted && !isError ? \'shadow-[0_0_12px_rgba(34,211,238,0.28)]\' : \'\'}'}\`}\n                style={{ width: \`${'${progress}'}%\` }}\n              >\n                {!isCompleted && progress > 4 && <div className="absolute inset-0 bg-white/[0.08]" />}\n              </div>\n            </div>\n          )}`,
    'activité indéterminée écran'
  );

  s = replaceOnce(
    s,
    `    showToast(\n      success ? 'Téléchargement retiré.' : 'Retiré de SeenIt, mais le client distant n’a pas confirmé la suppression.',\n      success ? 'success' : 'info'\n    );`,
    `    showToast({\n      title: item.movieTitle || item.seriesTitle || item.title,\n      action: success\n        ? 'Retiré de la liste'\n        : 'Retiré de la liste • arrêt non confirmé',\n      posterPath: item.posterPath\n    }, success ? 'success' : 'info');`,
    'toast suppression court et riche'
  );

  write(path, s);
}

// ---------------------------------------------------------------------------
// tests : scénario exact FR/original + garde-fous
// ---------------------------------------------------------------------------
{
  const path = 'tests/downloadIdentity.test.ts';
  let s = read(path);

  s = replaceOnce(
    s,
    `  mergeDownloadIdAliases,\n  normalizeDownloadClientId,`,
    `  canAttachRecentOptimisticRequest,\n  mergeDownloadIdAliases,\n  normalizeDownloadClientId,`,
    'import handshake tests'
  );

  s += `\n\ntest('rattache le titre localisé à l’unique torrent apparu juste après la demande sans utiliser le nom', () => {\n  const now = 1_700_000_020_000;\n  assert.equal(canAttachRecentOptimisticRequest(\n    { isOptimistic: true, mediaType: 'movie', tmdbId: 123, title: 'Le Virtuose', quality: '1080p', addedAt: now - 15_000 },\n    { mediaType: 'movie', title: 'Tuner', releaseTitle: 'Tuner.2026.1080p.WEB-DL', quality: '1080p WEB-DL', addedAt: now - 8_000 },\n    now\n  ), true);\n});\n\ntest('ne rattache jamais un vieux torrent à une nouvelle demande', () => {\n  const now = 1_700_000_120_000;\n  assert.equal(canAttachRecentOptimisticRequest(\n    { isOptimistic: true, mediaType: 'movie', tmdbId: 123, quality: '1080p', addedAt: now - 5_000 },\n    { mediaType: 'movie', quality: '1080p', addedAt: now - 120_000 },\n    now\n  ), false);\n});\n\ntest('ne rattache pas une autre résolution pendant la fenêtre transitoire', () => {\n  const now = 1_700_000_220_000;\n  assert.equal(canAttachRecentOptimisticRequest(\n    { isOptimistic: true, mediaType: 'movie', tmdbId: 123, quality: '1080p', addedAt: now - 5_000 },\n    { mediaType: 'movie', quality: '4K WEB-DL', addedAt: now - 2_000 },\n    now\n  ), false);\n});\n`;

  write(path, s);
}

// ---------------------------------------------------------------------------
// version 1.4.58
// ---------------------------------------------------------------------------
{
  const path = 'android/app/build.gradle';
  let s = read(path);
  s = s.replace(/versionCode\s+104057/, 'versionCode 104058');
  s = s.replace(/versionName\s+"1\.4\.57"/, 'versionName "1.4.58"');
  write(path, s);
}
{
  const path = 'src/store/updateStore.ts';
  let s = read(path);
  s = s.replace(`CURRENT_APP_VERSION = '1.4.57'`, `CURRENT_APP_VERSION = '1.4.58'`);
  write(path, s);
}

console.log('Patch 1.4.58 appliqué.');
