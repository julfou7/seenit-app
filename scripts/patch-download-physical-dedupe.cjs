const fs = require('node:fs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, search, replacement, label) {
  const index = content.indexOf(search);
  if (index < 0) throw new Error(`Bloc introuvable: ${label}`);
  if (content.indexOf(search, index + search.length) >= 0) {
    throw new Error(`Bloc non unique: ${label}`);
  }
  return content.slice(0, index) + replacement + content.slice(index + search.length);
}

const servicePath = 'src/services/sonarrRadarr.ts';
const storePath = 'src/store/liveDownloadStore.ts';
const updatePath = 'src/store/updateStore.ts';
const gradlePath = 'android/app/build.gradle';
const identityPath = 'src/features/downloads/downloadIdentity.ts';
const testPath = 'tests/downloadIdentity.test.ts';

let service = read(servicePath);
let store = read(storePath);
let updateStore = read(updatePath);
let gradle = read(gradlePath);

service = replaceOnce(
  service,
  "import { authenticatedFetch } from '../lib/apiAuth';\n",
  "import { authenticatedFetch } from '../lib/apiAuth';\nimport { getPhysicalDownloadId, normalizeDownloadClientId } from '../features/downloads/downloadIdentity';\n",
  'import downloadIdentity dans sonarrRadarr'
);

service = replaceOnce(
  service,
  "  releaseTitle?: string;\n  isOptimistic?: boolean;\n}",
  "  releaseTitle?: string;\n  /** Identifiant physique du client de téléchargement (hash torrent qBittorrent / downloadId *Arr). */\n  downloadId?: string;\n  isOptimistic?: boolean;\n}",
  'LiveDownloadItem.downloadId'
);

service = replaceOnce(
  service,
  "          downloadClient: rec.downloadClient || 'Sonarr',\n          releaseTitle: rec.title\n",
  "          downloadClient: rec.downloadClient || 'Sonarr',\n          downloadId: normalizeDownloadClientId(rec.downloadId) || undefined,\n          releaseTitle: rec.title\n",
  'downloadId Sonarr'
);

service = replaceOnce(
  service,
  "          downloadClient: rec.downloadClient || 'Radarr',\n          releaseTitle: rec.title\n",
  "          downloadClient: rec.downloadClient || 'Radarr',\n          downloadId: normalizeDownloadClientId(rec.downloadId) || undefined,\n          releaseTitle: rec.title\n",
  'downloadId Radarr'
);

service = replaceOnce(
  service,
  "          const rawProgress = isDone ? 100 : (typeof t.progress === 'number' ? Math.min(99, Math.round(t.progress * 100)) : 0);\n          const speed = t.dlspeed || 0;\n          const etaSec = t.eta || 0;\n          const isTv = t.category === 'tv' || /s\\d{1,2}e\\d{1,2}/i.test(t.name);\n",
  "          const rawProgress = isDone\n            ? 100\n            : (typeof t.progress === 'number'\n                ? Math.min(99.9, Math.max(0, Math.round(t.progress * 1000) / 10))\n                : 0);\n          const speed = t.dlspeed || 0;\n          const etaSec = t.eta || 0;\n          const isTv = t.category === 'tv' || /s\\d{1,2}e\\d{1,2}/i.test(t.name);\n          const qbitDownloadId = normalizeDownloadClientId(t.hash);\n",
  'progression qBittorrent précise + hash'
);

service = replaceOnce(
  service,
  "          const qbitStatus = isQbitError ? 'error' : (isDone ? 'completed' : (t.state === 'stalledDL' ? 'warning' : (t.state || 'downloading')));\n          const qbitStatusText = isQbitError ? 'Erreur' : (isDone ? 'Téléchargement terminé 🍿' : (t.state === 'stalledDL' ? 'En attente de sources' : `qBittorrent ${rawProgress}%`));\n",
  "          const qbitStatus = isQbitError\n            ? 'error'\n            : (isDone ? 'completed' : (t.state === 'stalledDL' ? 'warning' : (t.state === 'pausedDL' ? 'paused' : 'downloading')));\n          const qbitStatusText = isQbitError\n            ? 'Erreur'\n            : (isDone\n                ? 'Téléchargement terminé 🍿'\n                : (t.state === 'stalledDL'\n                    ? 'En attente de sources'\n                    : (t.state === 'pausedDL' ? `Téléchargement en pause • ${rawProgress}%` : `Téléchargement ${rawProgress}%`)));\n",
  'états qBittorrent normalisés'
);

service = replaceOnce(
  service,
  "          const normTName = (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');\n          const existing = items.find(it => {\n            if (!it.releaseTitle && !it.title) return false;\n            const normRel = (it.releaseTitle || it.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');\n            return normRel && normTName && (normRel === normTName || normRel.includes(normTName) || normTName.includes(normRel));\n          });\n",
  "          const normTName = (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');\n          const existing = items.find(it => {\n            // Le hash du client est l'identité physique fiable. Il permet notamment\n            // de fusionner un titre Radarr en anglais avec un torrent qBittorrent en français.\n            const physicalId = getPhysicalDownloadId(it);\n            if (qbitDownloadId && physicalId && physicalId === qbitDownloadId) return true;\n\n            // Fallback uniquement pour les anciens clients/*Arr qui ne fournissent pas downloadId.\n            if (!it.releaseTitle && !it.title) return false;\n            const normRel = (it.releaseTitle || it.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');\n            return Boolean(normRel && normTName && (normRel === normTName || normRel.includes(normTName) || normTName.includes(normRel)));\n          });\n",
  'matching qBittorrent par hash'
);

const oldMergeBlock = `          if (existing) {\n            if (isDone) {\n              existing.progress = 100;\n              existing.status = 'completed';\n              existing.statusText = 'Téléchargement terminé 🍿';\n              existing.sizeleft = 0;\n              existing.speedBytesPerSec = 0;\n              existing.speedFormatted = '';\n              existing.timeleft = '';\n              existing.timeleftSeconds = 0;\n            } else {\n              existing.progress = Math.max(existing.progress || 0, rawProgress);\n              existing.sizeleft = Math.round((t.size || 0) * (1 - (t.progress || 0)));\n              if (speed > 0) {\n                existing.speedBytesPerSec = speed;\n                existing.speedFormatted = formatSpeed(speed);\n              }\n              if (etaSec > 0 && etaSec < 86400 * 7) {\n                existing.timeleftSeconds = etaSec;\n                existing.timeleft = formatSecondsToETA(etaSec);\n              }\n              if (isQbitError) {\n                existing.status = 'error';\n                existing.statusText = 'Erreur';\n                existing.errorMessage = qbitErrorMsg;\n              }\n            }\n          } else {`;

const newMergeBlock = `          if (existing) {\n            // Métadonnées *Arr (TMDB, titre, poster) + télémétrie qBittorrent (source de vérité live).\n            if (qbitDownloadId && !existing.downloadId) existing.downloadId = qbitDownloadId;\n            if (Number(t.size) > 0) existing.size = Number(t.size);\n            existing.progress = rawProgress;\n            existing.sizeleft = isDone\n              ? 0\n              : Math.max(0, Math.round((Number(t.size) || existing.size || 0) * (1 - (Number(t.progress) || 0))));\n            existing.speedBytesPerSec = isDone ? 0 : speed;\n            existing.speedFormatted = !isDone && speed > 0 ? formatSpeed(speed) : '';\n\n            const hasUsefulEta = !isDone && etaSec > 0 && etaSec < 86400 * 7;\n            existing.timeleftSeconds = hasUsefulEta ? etaSec : 0;\n            existing.timeleft = hasUsefulEta ? formatSecondsToETA(etaSec) : '';\n            existing.downloadClient = 'qBittorrent';\n\n            if (isQbitError) {\n              existing.status = 'error';\n              existing.statusText = 'Erreur';\n              existing.errorMessage = qbitErrorMsg;\n            } else if (existing.status === 'error' && existing.errorMessage) {\n              // Ne pas masquer une erreur d'import *Arr par un torrent sain.\n            } else {\n              existing.status = qbitStatus;\n              existing.statusText = qbitStatusText;\n              existing.errorMessage = undefined;\n            }\n          } else {`;

service = replaceOnce(service, oldMergeBlock, newMergeBlock, 'fusion télémétrie qBittorrent');

service = replaceOnce(
  service,
  "                id: `qbit_${t.hash || t.name}`,\n                mediaType: isTv ? 'tv' : 'movie',\n",
  "                id: `qbit_${t.hash || t.name}`,\n                downloadId: qbitDownloadId || undefined,\n                mediaType: isTv ? 'tv' : 'movie',\n",
  'downloadId qBittorrent standalone'
);

store = replaceOnce(
  store,
  "import { auth } from '../lib/firebase';\n",
  "import { auth } from '../lib/firebase';\nimport { getPhysicalDownloadId, samePhysicalDownload } from '../features/downloads/downloadIdentity';\n",
  'import identité physique dans liveDownloadStore'
);

store = replaceOnce(
  store,
  `function sameDownloadIdentity(a: LiveDownloadItem, b: LiveDownloadItem): boolean {\n  if (a.id === b.id) return true;\n  if (!sameCanonicalMedia(a, b)) return false;\n\n  if (a.mediaType === 'tv') {\n    if (a.seasonNumber != null && b.seasonNumber != null && a.seasonNumber !== b.seasonNumber) return false;\n    if (a.episodeNumber != null && b.episodeNumber != null && a.episodeNumber !== b.episodeNumber) return false;\n  }\n  return true;\n}`,
  `function sameDownloadIdentity(a: LiveDownloadItem, b: LiveDownloadItem): boolean {\n  if (a.id === b.id) return true;\n\n  const aPhysicalId = getPhysicalDownloadId(a);\n  const bPhysicalId = getPhysicalDownloadId(b);\n  if (samePhysicalDownload(a, b)) return true;\n  // Deux hashes explicites différents = deux téléchargements physiques différents,\n  // même si TMDB/titre sont identiques (ex. 1080p et 4K en parallèle).\n  if (aPhysicalId && bPhysicalId) return false;\n\n  if (!sameCanonicalMedia(a, b)) return false;\n\n  if (a.mediaType === 'tv') {\n    if (a.seasonNumber != null && b.seasonNumber != null && a.seasonNumber !== b.seasonNumber) return false;\n    if (a.episodeNumber != null && b.episodeNumber != null && a.episodeNumber !== b.episodeNumber) return false;\n  }\n  return true;\n}`,
  'sameDownloadIdentity physique'
);

store = replaceOnce(
  store,
  "          releaseTitle: item.releaseTitle || item.title,\n          isOptimistic: true\n",
  "          releaseTitle: item.releaseTitle || item.title,\n          downloadId: item.downloadId,\n          isOptimistic: true\n",
  'downloadId optimistic'
);

store = replaceOnce(
  store,
  `              if (!serverItem.tmdbId && localMatch.tmdbId) serverItem.tmdbId = localMatch.tmdbId;\n              if (!serverItem.tvdbId && localMatch.tvdbId) serverItem.tvdbId = localMatch.tvdbId;\n              if (!serverItem.quality && localMatch.quality) serverItem.quality = localMatch.quality;\n            }`,
  `              if (!serverItem.tmdbId && localMatch.tmdbId) serverItem.tmdbId = localMatch.tmdbId;\n              if (!serverItem.tvdbId && localMatch.tvdbId) serverItem.tvdbId = localMatch.tvdbId;\n              if (!serverItem.quality && localMatch.quality) serverItem.quality = localMatch.quality;\n              if (!serverItem.downloadId && localMatch.downloadId) serverItem.downloadId = localMatch.downloadId;\n\n              // Si qBittorrent est momentanément indisponible, ne jamais faire reculer\n              // la progression physique connue au poll précédent.\n              if (samePhysicalDownload(localMatch, serverItem)\n                  && Number(localMatch.progress || 0) > Number(serverItem.progress || 0)) {\n                serverItem.progress = localMatch.progress;\n                if (localMatch.size > 0) serverItem.size = localMatch.size;\n                serverItem.sizeleft = localMatch.sizeleft;\n                if (localMatch.speedBytesPerSec) serverItem.speedBytesPerSec = localMatch.speedBytesPerSec;\n                if (localMatch.speedFormatted) serverItem.speedFormatted = localMatch.speedFormatted;\n                if (localMatch.timeleftSeconds) serverItem.timeleftSeconds = localMatch.timeleftSeconds;\n                if (localMatch.timeleft) serverItem.timeleft = localMatch.timeleft;\n              }\n            }`,
  'préservation télémétrie physique'
);

store = replaceOnce(
  store,
  `          const itemMap = new Map<string, LiveDownloadItem>();\n          for (const item of [...serverItems, ...pendingOptimistic, ...preservedItems]) {\n            if (!removedSet.has(item.id)) itemMap.set(item.id, item);\n          }\n          const finalItems = Array.from(itemMap.values());`,
  `          const itemMap = new Map<string, LiveDownloadItem>();\n          const seenPhysicalIds = new Set<string>();\n          for (const item of [...serverItems, ...pendingOptimistic, ...preservedItems]) {\n            if (removedSet.has(item.id)) continue;\n\n            const physicalId = getPhysicalDownloadId(item);\n            if (physicalId && seenPhysicalIds.has(physicalId)) continue;\n            if (physicalId) seenPhysicalIds.add(physicalId);\n\n            itemMap.set(item.id, item);\n          }\n          const finalItems = Array.from(itemMap.values());`,
  'déduplication finale par téléchargement physique'
);

updateStore = replaceOnce(
  updateStore,
  "export const CURRENT_APP_VERSION = '1.4.53';",
  "export const CURRENT_APP_VERSION = '1.4.54';",
  'version updateStore 1.4.54'
);

gradle = replaceOnce(
  gradle,
  '        versionCode 104053\n        versionName "1.4.53"',
  '        versionCode 104054\n        versionName "1.4.54"',
  'version Android 1.4.54'
);

const identity = `export interface DownloadIdentityLike {\n  id?: string | null;\n  downloadId?: string | null;\n}\n\nexport function normalizeDownloadClientId(value: unknown): string | null {\n  if (value === null || value === undefined) return null;\n  let normalized = String(value).trim().toLowerCase();\n  if (!normalized) return null;\n\n  if (normalized.startsWith('qbit_')) normalized = normalized.slice('qbit_'.length);\n  if (normalized.startsWith('urn:btih:')) normalized = normalized.slice('urn:btih:'.length);\n\n  return normalized.trim() || null;\n}\n\nexport function getPhysicalDownloadId(item?: DownloadIdentityLike | null): string | null {\n  if (!item) return null;\n\n  const explicit = normalizeDownloadClientId(item.downloadId);\n  if (explicit) return explicit;\n\n  const rawId = typeof item.id === 'string' ? item.id.trim() : '';\n  if (rawId.toLowerCase().startsWith('qbit_')) {\n    return normalizeDownloadClientId(rawId.slice('qbit_'.length));\n  }\n\n  return null;\n}\n\nexport function samePhysicalDownload(\n  a?: DownloadIdentityLike | null,\n  b?: DownloadIdentityLike | null\n): boolean {\n  const aId = getPhysicalDownloadId(a);\n  const bId = getPhysicalDownloadId(b);\n  return Boolean(aId && bId && aId === bId);\n}\n`;

const test = `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport {\n  getPhysicalDownloadId,\n  normalizeDownloadClientId,\n  samePhysicalDownload\n} from '../src/features/downloads/downloadIdentity.ts';\n\ntest('normalise le hash qBittorrent et le downloadId *Arr sans dépendre de la casse', () => {\n  assert.equal(normalizeDownloadClientId(' ABCDEF123 '), 'abcdef123');\n  assert.equal(normalizeDownloadClientId('qbit_ABCDEF123'), 'abcdef123');\n  assert.equal(normalizeDownloadClientId('urn:btih:ABCDEF123'), 'abcdef123');\n});\n\ntest('rattache le même torrent physique malgré des titres localisés différents', () => {\n  const radarr = {\n    id: 'radarr_42',\n    downloadId: 'ABCDEF123'\n  };\n  const qbitPersisted = {\n    id: 'qbit_abcdef123'\n  };\n\n  assert.equal(getPhysicalDownloadId(radarr), 'abcdef123');\n  assert.equal(getPhysicalDownloadId(qbitPersisted), 'abcdef123');\n  assert.equal(samePhysicalDownload(radarr, qbitPersisted), true);\n});\n\ntest('deux hashes différents restent deux téléchargements physiques distincts', () => {\n  assert.equal(\n    samePhysicalDownload(\n      { downloadId: 'aaaaaaaa' },\n      { id: 'qbit_bbbbbbbb' }\n    ),\n    false\n  );\n});\n`;

write(servicePath, service);
write(storePath, store);
write(updatePath, updateStore);
write(gradlePath, gradle);
fs.mkdirSync('src/features/downloads', { recursive: true });
write(identityPath, identity);
write(testPath, test);

console.log('Correctif téléchargement physique 1.4.54 appliqué.');
