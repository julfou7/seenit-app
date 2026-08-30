const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceExact(path, from, to) {
  const input = read(path);
  if (!input.includes(from)) throw new Error(`Pattern introuvable dans ${path}: ${from.slice(0, 140)}`);
  write(path, input.replace(from, to));
}
function replaceRegex(path, regex, to) {
  const input = read(path);
  if (!regex.test(input)) throw new Error(`Regex introuvable dans ${path}: ${regex}`);
  write(path, input.replace(regex, to));
}

// -----------------------------------------------------------------------------
// 1) Identité physique : un torrent peut avoir plusieurs infohash (v1/v2/hybride)
// -----------------------------------------------------------------------------
write('src/features/downloads/downloadIdentity.ts', `export interface DownloadIdentityLike {
  id?: string | null;
  downloadId?: string | null;
  downloadIdAliases?: Array<string | null | undefined> | null;
  releaseTitle?: string | null;
  title?: string | null;
  size?: number | null;
  mediaType?: string | null;
}

export function normalizeDownloadClientId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;

  try { normalized = decodeURIComponent(normalized); } catch {}

  // Magnet v1 : magnet:?xt=urn:btih:<hash>
  const btih = normalized.match(/urn:btih:([a-z0-9]+)/i);
  if (btih?.[1]) normalized = btih[1];

  // Magnet v2 : urn:btmh:1220<sha256>. Le préfixe multihash 1220 ne fait
  // pas partie de l'infohash v2 exposé par qBittorrent.
  const btmh = normalized.match(/urn:btmh:(?:1220)?([a-f0-9]{64})/i);
  if (btmh?.[1]) normalized = btmh[1];

  if (normalized.startsWith('qbit_')) normalized = normalized.slice('qbit_'.length);
  if (normalized.startsWith('urn:btih:')) normalized = normalized.slice('urn:btih:'.length);

  return normalized.trim() || null;
}

export function isStrongTorrentHash(value: unknown): boolean {
  const normalized = normalizeDownloadClientId(value);
  if (!normalized) return false;
  return /^[a-f0-9]{40}$/i.test(normalized)
    || /^[a-f0-9]{64}$/i.test(normalized)
    || /^[a-z2-7]{32}$/i.test(normalized);
}

export function getPhysicalDownloadIds(item?: DownloadIdentityLike | null): string[] {
  if (!item) return [];
  const ids = new Set<string>();
  const add = (value: unknown) => {
    const normalized = normalizeDownloadClientId(value);
    if (normalized) ids.add(normalized);
  };

  add(item.downloadId);
  for (const alias of item.downloadIdAliases || []) add(alias);

  const rawId = typeof item.id === 'string' ? item.id.trim() : '';
  if (rawId.toLowerCase().startsWith('qbit_')) add(rawId.slice('qbit_'.length));

  return Array.from(ids);
}

export function getStrongPhysicalDownloadIds(item?: DownloadIdentityLike | null): string[] {
  return getPhysicalDownloadIds(item).filter(isStrongTorrentHash);
}

export function getPhysicalDownloadId(item?: DownloadIdentityLike | null): string | null {
  return getPhysicalDownloadIds(item)[0] || null;
}

export function mergeDownloadIdAliases(...items: Array<DownloadIdentityLike | null | undefined>): string[] {
  const aliases = new Set<string>();
  for (const item of items) {
    for (const id of getPhysicalDownloadIds(item)) aliases.add(id);
  }
  return Array.from(aliases);
}

export function samePhysicalDownload(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  const aIds = new Set(getPhysicalDownloadIds(a));
  if (!aIds.size) return false;
  return getPhysicalDownloadIds(b).some(id => aIds.has(id));
}

export function hasConflictingStrongPhysicalIds(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  const aIds = getStrongPhysicalDownloadIds(a);
  const bIds = getStrongPhysicalDownloadIds(b);
  if (!aIds.length || !bIds.length) return false;
  const aSet = new Set(aIds);
  return !bIds.some(id => aSet.has(id));
}

export function normalizeDownloadRelease(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function sameLegacyPhysicalTransfer(
  a?: DownloadIdentityLike | null,
  b?: DownloadIdentityLike | null
): boolean {
  if (!a || !b) return false;
  if (a.mediaType && b.mediaType && a.mediaType !== b.mediaType) return false;

  // Deux vrais infohash incompatibles restent deux torrents distincts.
  if (hasConflictingStrongPhysicalIds(a, b)) return false;

  const aSize = Number(a.size || 0);
  const bSize = Number(b.size || 0);
  if (aSize <= 0 || bSize <= 0) return false;
  const sizeDelta = Math.abs(aSize - bSize) / Math.max(aSize, bSize);
  if (sizeDelta > 0.03) return false;

  const aRelease = normalizeDownloadRelease(a.releaseTitle || a.title);
  const bRelease = normalizeDownloadRelease(b.releaseTitle || b.title);
  if (!aRelease || !bRelease) return false;

  return aRelease === bRelease || aRelease.includes(bRelease) || bRelease.includes(aRelease);
}
`);

// -----------------------------------------------------------------------------
// 2) Service : conserver tous les hashes qBittorrent et forcer un téléchargement
//    lorsque le média est déjà présent dans *Arr.
// -----------------------------------------------------------------------------
replaceExact(
  'src/services/sonarrRadarr.ts',
  "import { getPhysicalDownloadId, normalizeDownloadClientId, sameLegacyPhysicalTransfer, samePhysicalDownload } from '../features/downloads/downloadIdentity';",
  "import { getPhysicalDownloadId, isStrongTorrentHash, mergeDownloadIdAliases, normalizeDownloadClientId, sameLegacyPhysicalTransfer, samePhysicalDownload } from '../features/downloads/downloadIdentity';"
);

replaceExact(
  'src/services/sonarrRadarr.ts',
  `  /** Identifiant physique du client de téléchargement (hash torrent qBittorrent / downloadId *Arr). */\n  downloadId?: string;\n  isOptimistic?: boolean;`,
  `  /** Identifiant principal du transfert. */\n  downloadId?: string;\n  /** Tous les identifiants connus du même torrent (hash qBit, infohash v1/v2, alias *Arr). */\n  downloadIdAliases?: string[];\n  isOptimistic?: boolean;`
);

// Les files *Arr exposent leur downloadId : on le garde également comme alias.
replaceExact(
  'src/services/sonarrRadarr.ts',
  `          downloadId: normalizeDownloadClientId(rec.downloadId) || undefined,\n          releaseTitle: rec.title`,
  `          downloadId: normalizeDownloadClientId(rec.downloadId) || undefined,\n          downloadIdAliases: normalizeDownloadClientId(rec.downloadId) ? [normalizeDownloadClientId(rec.downloadId)!] : undefined,\n          releaseTitle: rec.title`
);
// même bloc une seconde fois (Radarr)
replaceExact(
  'src/services/sonarrRadarr.ts',
  `          downloadId: normalizeDownloadClientId(rec.downloadId) || undefined,\n          releaseTitle: rec.title`,
  `          downloadId: normalizeDownloadClientId(rec.downloadId) || undefined,\n          downloadIdAliases: normalizeDownloadClientId(rec.downloadId) ? [normalizeDownloadClientId(rec.downloadId)!] : undefined,\n          releaseTitle: rec.title`
);

replaceExact(
  'src/services/sonarrRadarr.ts',
  `          const qbitDownloadId = normalizeDownloadClientId(t.hash);`,
  `          const qbitDownloadId = normalizeDownloadClientId(t.hash);\n          const qbitDownloadIdAliases = Array.from(new Set([\n            normalizeDownloadClientId(t.hash),\n            normalizeDownloadClientId(t.infohash_v1),\n            normalizeDownloadClientId(t.infohash_v2),\n            normalizeDownloadClientId(t.magnet_uri)\n          ].filter(Boolean) as string[]));`
);

replaceExact(
  'src/services/sonarrRadarr.ts',
  `            downloadId: qbitDownloadId || undefined,\n            mediaType: isTv ? 'tv' : 'movie',`,
  `            downloadId: qbitDownloadId || undefined,\n            downloadIdAliases: qbitDownloadIdAliases,\n            mediaType: isTv ? 'tv' : 'movie',`
);

replaceExact(
  'src/services/sonarrRadarr.ts',
  `            if (qbitDownloadId && !existing.downloadId) existing.downloadId = qbitDownloadId;\n            if (Number(t.size) > 0) existing.size = Number(t.size);`,
  `            existing.downloadIdAliases = mergeDownloadIdAliases(existing, qbitProbe);\n            // Le hash qBittorrent devient l'identifiant principal uniquement lorsque\n            // *Arr n'en fournit pas un vrai. Les alias v1/v2 restent tous conservés.\n            if (qbitDownloadId && (!existing.downloadId || !isStrongTorrentHash(existing.downloadId))) {\n              existing.downloadId = qbitDownloadId;\n            }\n            if (Number(t.size) > 0) existing.size = Number(t.size);`
);

replaceExact(
  'src/services/sonarrRadarr.ts',
  `                downloadId: qbitDownloadId || undefined,\n                mediaType: isTv ? 'tv' : 'movie',`,
  `                downloadId: qbitDownloadId || undefined,\n                downloadIdAliases: qbitDownloadIdAliases,\n                mediaType: isTv ? 'tv' : 'movie',`
);

// Helpers de recherche interactive *Arr : contrairement à EpisodeSearch/MoviesSearch,
// POST /release force réellement le grab d'une release choisie, y compris si le fichier
// existe déjà et que le moteur d'upgrade automatique considère le cutoff atteint.
const forceHelpers = `
async function executeArrInteractiveGet(url: string, headers: Record<string, string>): Promise<any> {
  if (!Capacitor.isNativePlatform()) return executeGet(url, headers);
  try {
    const normHeaders = { ...headers };
    if (headers['X-Api-Key']) normHeaders['x-api-key'] = headers['X-Api-Key'];
    const response = await CapacitorHttp.get({
      url,
      headers: normHeaders,
      connectTimeout: 10000,
      readTimeout: 30000
    });
    if (response.status >= 200 && response.status < 300) {
      let data = response.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch {}
      }
      return data;
    }
    throw new Error(\`Erreur HTTP \${response.status}\`);
  } catch (error: any) {
    throw new Error(error?.message || 'Recherche interactive impossible');
  }
}

async function executeArrInteractivePost(url: string, body: any, headers: Record<string, string>): Promise<any> {
  if (!Capacitor.isNativePlatform()) return executePost(url, body, headers);
  try {
    const response = await CapacitorHttp.post({
      url,
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: body,
      connectTimeout: 10000,
      readTimeout: 30000
    });
    if (response.status >= 200 && response.status < 300) return response.data || { success: true };
    throw new Error(\`Erreur HTTP \${response.status}\`);
  } catch (error: any) {
    throw new Error(error?.message || 'Grab de la release impossible');
  }
}

function releaseMatchesQualityPreference(release: any, preference?: '1080p' | '4k'): boolean {
  if (!preference) return true;
  const qualityName = release?.quality?.quality?.name || release?.quality?.name || '';
  const resolution = release?.quality?.quality?.resolution || release?.quality?.resolution || '';
  const haystack = \`\${qualityName} \${resolution} \${release?.title || ''}\`.toLowerCase();
  if (preference === '4k') return /2160|4k|uhd/.test(haystack);
  return /1080/.test(haystack) && !/2160|4k|uhd/.test(haystack);
}

function hasOnlyExistingMediaRejections(release: any): boolean {
  const rejections = Array.isArray(release?.rejections) ? release.rejections.filter(Boolean) : [];
  if (!rejections.length) return true;
  return rejections.every((reason: any) =>
    /existing file|cutoff|upgrade|custom format|already.*file|equal or higher/i.test(String(reason))
  );
}

function rankInteractiveReleases(releases: any[], preference?: '1080p' | '4k', preferSeasonPack = false): any[] {
  return releases
    .filter(release => releaseMatchesQualityPreference(release, preference))
    .filter(release => release?.approved === true || release?.rejected !== true || hasOnlyExistingMediaRejections(release))
    .sort((a, b) => {
      if (preferSeasonPack && Boolean(a.fullSeason) !== Boolean(b.fullSeason)) return a.fullSeason ? -1 : 1;
      if (Boolean(a.approved) !== Boolean(b.approved)) return a.approved ? -1 : 1;
      const weightA = Number(a.releaseWeight ?? Number.MAX_SAFE_INTEGER);
      const weightB = Number(b.releaseWeight ?? Number.MAX_SAFE_INTEGER);
      if (weightA !== weightB) return weightA - weightB;
      const cfA = Number(a.customFormatScore || 0);
      const cfB = Number(b.customFormatScore || 0);
      if (cfA !== cfB) return cfB - cfA;
      return Number(b.seeders || 0) - Number(a.seeders || 0);
    });
}

async function grabFirstWorkingRelease(
  base: string,
  headers: Record<string, string>,
  releases: any[],
  contextPatch: Record<string, any> = {}
): Promise<{ success: boolean; release?: any; error?: string }> {
  let lastError = '';
  for (const release of releases.slice(0, 8)) {
    try {
      await executeArrInteractivePost(\`\${base}/api/v3/release\`, { ...release, ...contextPatch }, headers);
      return { success: true, release };
    } catch (error: any) {
      lastError = error?.message || String(error);
      // Une release peut être refusée par qBittorrent car elle est déjà présente :
      // on essaie alors la release suivante plutôt que d'abandonner tout le flux.
    }
  }
  return { success: false, error: lastError || 'Aucune release compatible n’a pu être lancée.' };
}

async function forceGrabExistingEpisode(
  base: string,
  headers: Record<string, string>,
  episodeId: number,
  preference?: '1080p' | '4k'
): Promise<{ success: boolean; message: string }> {
  const releases = await executeArrInteractiveGet(\`\${base}/api/v3/release?episodeId=\${episodeId}\`, headers);
  const ranked = rankInteractiveReleases(Array.isArray(releases) ? releases : [], preference);
  if (!ranked.length) return { success: false, message: 'Le fichier existe déjà et aucune nouvelle release compatible n’a été trouvée.' };
  const grabbed = await grabFirstWorkingRelease(base, headers, ranked, { episodeId });
  return grabbed.success
    ? { success: true, message: 'Le fichier existe déjà : une nouvelle release a été forcée.' }
    : { success: false, message: grabbed.error || 'Impossible de relancer cet épisode.' };
}

async function forceGrabExistingSeason(
  base: string,
  headers: Record<string, string>,
  seriesId: number,
  seasonNumber: number,
  preference?: '1080p' | '4k'
): Promise<{ success: boolean; message: string }> {
  const releases = await executeArrInteractiveGet(
    \`\${base}/api/v3/release?seriesId=\${seriesId}&seasonNumber=\${seasonNumber}\`,
    headers
  );
  const ranked = rankInteractiveReleases(Array.isArray(releases) ? releases : [], preference, true);
  if (!ranked.length) return { success: false, message: 'La saison existe déjà et aucune nouvelle release compatible n’a été trouvée.' };

  const seasonPack = ranked.filter(release => release.fullSeason);
  if (seasonPack.length) {
    const grabbed = await grabFirstWorkingRelease(base, headers, seasonPack, { seriesId });
    if (grabbed.success) return { success: true, message: 'La saison existe déjà : un nouveau pack a été forcé.' };
  }

  // Pas de pack : on force au maximum une release par épisode depuis le résultat
  // interactif déjà récupéré, sans relancer une recherche indexer pour chaque épisode.
  const episodeNumbers = new Set<number>();
  for (const release of ranked) {
    const mapped = Array.isArray(release.mappedEpisodeNumbers)
      ? release.mappedEpisodeNumbers
      : (Array.isArray(release.episodeNumbers) ? release.episodeNumbers : []);
    mapped.forEach((n: any) => Number.isFinite(Number(n)) && episodeNumbers.add(Number(n)));
  }

  let grabbedCount = 0;
  for (const episodeNumber of Array.from(episodeNumbers).sort((a, b) => a - b)) {
    const candidates = ranked.filter(release => {
      if (release.fullSeason) return false;
      const mapped = Array.isArray(release.mappedEpisodeNumbers)
        ? release.mappedEpisodeNumbers
        : (Array.isArray(release.episodeNumbers) ? release.episodeNumbers : []);
      return mapped.some((n: any) => Number(n) === episodeNumber);
    });
    if (!candidates.length) continue;
    const grabbed = await grabFirstWorkingRelease(base, headers, candidates, { seriesId });
    if (grabbed.success) grabbedCount++;
  }

  return grabbedCount > 0
    ? { success: true, message: \`La saison existe déjà : \${grabbedCount} téléchargement(s) ont été forcés.\` }
    : { success: false, message: 'La saison existe déjà mais aucune release n’a pu être relancée.' };
}

async function forceGrabExistingMovie(
  base: string,
  headers: Record<string, string>,
  movieId: number,
  preference?: '1080p' | '4k'
): Promise<{ success: boolean; message: string }> {
  const releases = await executeArrInteractiveGet(\`\${base}/api/v3/release?movieId=\${movieId}\`, headers);
  const ranked = rankInteractiveReleases(Array.isArray(releases) ? releases : [], preference);
  if (!ranked.length) return { success: false, message: 'Le film existe déjà et aucune nouvelle release compatible n’a été trouvée.' };
  const grabbed = await grabFirstWorkingRelease(base, headers, ranked, { movieId });
  return grabbed.success
    ? { success: true, message: 'Le film existe déjà : une nouvelle release a été forcée.' }
    : { success: false, message: grabbed.error || 'Impossible de relancer ce film.' };
}
`;

replaceExact(
  'src/services/sonarrRadarr.ts',
  `/**\n * Déclenche une recherche et un ajout automatique de Série dans Sonarr\n */\nexport async function searchAndDownloadInSonarr`,
  `${forceHelpers}\n/**\n * Déclenche une recherche et un ajout automatique de Série dans Sonarr\n */\nexport async function searchAndDownloadInSonarr`
);

// Épisode existant : EpisodeSearch respecte le cutoff et peut ne rien faire. On force
// donc une release interactive lorsque Sonarr indique déjà hasFile=true.
replaceExact(
  'src/services/sonarrRadarr.ts',
  `          if (targetEp && targetEp.id) {\n            await executePost(\`${'${base}'}/api/v3/command\`, {\n              name: 'EpisodeSearch',\n              episodeIds: [targetEp.id]\n            }, headers);`,
  `          if (targetEp && targetEp.id) {\n            if (targetEp.hasFile) {\n              return await forceGrabExistingEpisode(base, headers, targetEp.id, params.qualityPreference);\n            }\n            await executePost(\`${'${base}'}/api/v3/command\`, {\n              name: 'EpisodeSearch',\n              episodeIds: [targetEp.id]\n            }, headers);`
);

// Saison déjà complète : SeasonSearch ne déclenche généralement rien. Détection via
// la liste des épisodes, puis grab interactif d'un pack (ou releases par épisode).
replaceExact(
  'src/services/sonarrRadarr.ts',
  `      // Recherche par saison entière\n      if (params.season !== undefined && params.season !== null) {\n        await executePost(\`${'${base}'}/api/v3/command\`, {`,
  `      // Recherche par saison entière\n      if (params.season !== undefined && params.season !== null) {\n        try {\n          const seasonEpisodes: any[] = await executeGet(\`${'${base}'}/api/v3/episode?seriesId=${'${seriesId}'}\`, headers);\n          const scopedEpisodes = Array.isArray(seasonEpisodes)\n            ? seasonEpisodes.filter(ep => Number(ep.seasonNumber) === Number(params.season))\n            : [];\n          if (scopedEpisodes.length > 0 && scopedEpisodes.every(ep => Boolean(ep.hasFile))) {\n            return await forceGrabExistingSeason(base, headers, seriesId, Number(params.season), params.qualityPreference);\n          }\n        } catch (presenceErr) {\n          console.warn('[Sonarr] Impossible de vérifier la présence des fichiers de saison:', presenceErr);\n        }\n\n        await executePost(\`${'${base}'}/api/v3/command\`, {`
);

// Série entière déjà complète : ne plus annoncer un faux succès qui restera 2 minutes
// dans le store. On explique qu'un scope explicite est nécessaire pour forcer proprement.
replaceExact(
  'src/services/sonarrRadarr.ts',
  `      // Recherche de toute la série\n      await executePost(\`${'${base}'}/api/v3/command\`, {`,
  `      // Recherche de toute la série\n      try {\n        const allEpisodes: any[] = await executeGet(\`${'${base}'}/api/v3/episode?seriesId=${'${seriesId}'}\`, headers);\n        const regularEpisodes = Array.isArray(allEpisodes)\n          ? allEpisodes.filter(ep => Number(ep.seasonNumber) > 0 && ep.airDateUtc)\n          : [];\n        if (regularEpisodes.length > 0 && regularEpisodes.every(ep => Boolean(ep.hasFile))) {\n          return {\n            success: false,\n            message: 'La série est déjà complète. Choisis une saison ou un épisode pour forcer un nouveau téléchargement.'\n          };\n        }\n      } catch {}\n\n      await executePost(\`${'${base}'}/api/v3/command\`, {`
);

// Film déjà présent : MoviesSearch respecte le cutoff. On passe en recherche interactive
// et POST /release pour réellement démarrer une nouvelle release.
replaceExact(
  'src/services/sonarrRadarr.ts',
  `    if (existingMovie && existingMovie.id) {\n      // Ajuster le profil de qualité si différent`,
  `    if (existingMovie && existingMovie.id) {\n      // Ajuster le profil de qualité si différent`
);
replaceExact(
  'src/services/sonarrRadarr.ts',
  `      await executePost(\`${'${base}'}/api/v3/command\`, {\n        name: 'MoviesSearch',\n        movieIds: [existingMovie.id]\n      }, headers);`,
  `      if (existingMovie.hasFile) {\n        return await forceGrabExistingMovie(base, headers, existingMovie.id, params.qualityPreference);\n      }\n\n      await executePost(\`${'${base}'}/api/v3/command\`, {\n        name: 'MoviesSearch',\n        movieIds: [existingMovie.id]\n      }, headers);`
);

// -----------------------------------------------------------------------------
// 3) Store : mémoriser les alias entre les polls + vraie agrégation finale.
// -----------------------------------------------------------------------------
replaceExact(
  'src/store/liveDownloadStore.ts',
  "import { getPhysicalDownloadId, sameLegacyPhysicalTransfer, samePhysicalDownload } from '../features/downloads/downloadIdentity';",
  "import { getPhysicalDownloadId, getStrongPhysicalDownloadIds, hasConflictingStrongPhysicalIds, mergeDownloadIdAliases, sameLegacyPhysicalTransfer, samePhysicalDownload } from '../features/downloads/downloadIdentity';"
);

replaceExact(
  'src/store/liveDownloadStore.ts',
  `  const aPhysicalId = getPhysicalDownloadId(a);\n  const bPhysicalId = getPhysicalDownloadId(b);\n  if (samePhysicalDownload(a, b)) return true;\n  // Deux hashes explicites différents = deux téléchargements physiques différents,\n  // même si TMDB/titre sont identiques (ex. 1080p et 4K en parallèle).\n  if (aPhysicalId && bPhysicalId) return false;`,
  `  if (samePhysicalDownload(a, b)) return true;\n  // Deux vrais infohash incompatibles = deux torrents différents. Un identifiant\n  // temporaire/non-hash de *Arr ne doit en revanche pas bloquer les autres signaux.\n  if (hasConflictingStrongPhysicalIds(a, b)) return false;`
);

replaceExact(
  'src/store/liveDownloadStore.ts',
  `          downloadId: item.downloadId,\n          isOptimistic: true`,
  `          downloadId: item.downloadId,\n          downloadIdAliases: item.downloadIdAliases,\n          isOptimistic: true`
);

replaceExact(
  'src/store/liveDownloadStore.ts',
  `              if (!serverItem.downloadId && localMatch.downloadId) serverItem.downloadId = localMatch.downloadId;\n\n              // Si qBittorrent est momentanément indisponible`,
  `              // Une même entrée *Arr peut temporairement changer/perdre son downloadId.\n              // On garde l'historique des alias appris sur les polls précédents afin que\n              // le torrent qBittorrent reste rattaché sans clignotement 1 → 2 → 1.\n              serverItem.downloadIdAliases = mergeDownloadIdAliases(serverItem, localMatch);\n              if (!serverItem.downloadId && localMatch.downloadId) serverItem.downloadId = localMatch.downloadId;\n\n              // Si qBittorrent est momentanément indisponible`
);

// Remplace la déduplication finale basée sur un seul hash par une agrégation des cartes.
replaceExact(
  'src/store/liveDownloadStore.ts',
  `          const itemMap = new Map<string, LiveDownloadItem>();\n          const seenPhysicalIds = new Set<string>();\n          for (const item of [...serverItems, ...pendingOptimistic, ...preservedItems]) {\n            if (removedSet.has(item.id)) continue;\n\n            const physicalId = getPhysicalDownloadId(item);\n            if (physicalId && seenPhysicalIds.has(physicalId)) continue;\n            if (physicalId) seenPhysicalIds.add(physicalId);\n\n            itemMap.set(item.id, item);\n          }\n          const finalItems = Array.from(itemMap.values());`,
  `          const metadataScore = (item: LiveDownloadItem) =>\n            (item.posterPath ? 20 : 0)\n            + (item.tmdbId ? 20 : 0)\n            + (item.tvdbId ? 8 : 0)\n            + (item.movieTitle || item.seriesTitle ? 8 : 0)\n            + (item.imdbId ? 4 : 0)\n            + (item.quality ? 2 : 0);\n\n          const liveScore = (item: LiveDownloadItem) =>\n            (item.id.startsWith('qbit_') ? 50 : 0)\n            + (Number(item.speedBytesPerSec || 0) > 0 ? 10 : 0)\n            + (Number(item.timeleftSeconds || 0) > 0 ? 5 : 0)\n            + (Number(item.progress || 0) % 1 !== 0 ? 2 : 0);\n\n          const mergeRepresentations = (a: LiveDownloadItem, b: LiveDownloadItem): LiveDownloadItem => {\n            const meta = metadataScore(a) >= metadataScore(b) ? a : b;\n            const live = liveScore(a) >= liveScore(b) ? a : b;\n            const hasError = a.status === 'error' || b.status === 'error' || a.errorMessage || b.errorMessage;\n            const errorSource = a.status === 'error' || a.errorMessage ? a : b;\n            const aliases = mergeDownloadIdAliases(a, b);\n            const strongIds = [...getStrongPhysicalDownloadIds(a), ...getStrongPhysicalDownloadIds(b)];\n\n            return {\n              ...meta,\n              id: meta.id,\n              downloadId: strongIds[0] || getPhysicalDownloadId(live) || getPhysicalDownloadId(meta) || undefined,\n              downloadIdAliases: aliases,\n              releaseTitle: meta.releaseTitle || live.releaseTitle,\n              quality: meta.quality || live.quality,\n              size: live.size > 0 ? live.size : meta.size,\n              sizeleft: live.sizeleft,\n              progress: live.progress,\n              speedBytesPerSec: live.speedBytesPerSec,\n              speedFormatted: live.speedFormatted,\n              timeleft: live.timeleft,\n              timeleftSeconds: live.timeleftSeconds,\n              status: hasError ? errorSource.status : live.status,\n              statusText: hasError ? errorSource.statusText : live.statusText,\n              errorMessage: hasError ? errorSource.errorMessage : undefined,\n              isOptimistic: Boolean(a.isOptimistic && b.isOptimistic)\n            };\n          };\n\n          const finalItems: LiveDownloadItem[] = [];\n          for (const item of [...serverItems, ...pendingOptimistic, ...preservedItems]) {\n            if (removedSet.has(item.id)) continue;\n\n            const existingIndex = finalItems.findIndex(existing => sameDownloadIdentity(existing, item));\n            if (existingIndex >= 0) {\n              finalItems[existingIndex] = mergeRepresentations(finalItems[existingIndex], item);\n              continue;\n            }\n            finalItems.push(item);\n          }`
);

// -----------------------------------------------------------------------------
// 4) Refonte visuelle de la carte téléchargement.
// -----------------------------------------------------------------------------
replaceExact(
  'src/screens/DownloadsScreen.tsx',
  `  Download,\n  Film,\n  Loader2,`,
  `  Download,\n  Film,\n  HardDrive,\n  Clock3,\n  Loader2,`
);

replaceRegex(
  'src/screens/DownloadsScreen.tsx',
  /function DownloadItemCard\(\{[\s\S]*?\n}\n\nexport function DownloadsScreen/,
`function getQualityBadges(quality?: string) {
  if (!quality) return [] as string[];
  const q = quality.toUpperCase();
  const badges: string[] = [];

  if (/2160|4K|UHD/.test(q)) badges.push('4K');
  else if (/1080/.test(q)) badges.push('1080p');
  else if (/720/.test(q)) badges.push('720p');

  if (/REMUX/.test(q)) badges.push('REMUX');
  else if (/BLU.?RAY|BDRIP/.test(q)) badges.push('BluRay');
  else if (/WEB.?DL|WEBDL|WEBRIP/.test(q)) badges.push('WEB-DL');
  else if (/HDTV/.test(q)) badges.push('HDTV');

  if (/HDR/.test(q)) badges.push('HDR');
  else if (/DOLBY.?VISION|DOVI|\\bDV\\b/.test(q)) badges.push('DV');

  return Array.from(new Set(badges)).slice(0, 3);
}

function DownloadItemCard({
  item,
  onShowClick,
  onRemove,
  isRemoving
}: {
  item: LiveDownloadItem;
  onShowClick?: Props['onShowClick'];
  onRemove: (item: LiveDownloadItem) => void;
  isRemoving: boolean;
}) {
  const { cleanTitle, subTitle, isTv } = formatCleanMediaInfo(item);
  const status = String(item.status || '').toLowerCase();
  const isCompleted = status === 'completed' || item.progress >= 100;
  const isError = status === 'error' || Boolean(item.errorMessage);
  const isWarning = status === 'warning';
  const isPending = status === 'submitting' || status === 'searching' || status === 'queued';
  const progress = Math.min(100, Math.max(0, Number(item.progress || 0)));
  const qualityBadges = getQualityBadges(item.quality);
  const downloadedBytes = item.size > 0 ? Math.max(0, item.size - item.sizeleft) : 0;
  const progressLabel = isCompleted ? '100%' : progress > 0 ? \`${'${progress.toFixed(1).replace(/\\.0$/, \'\')}'}%\` : '0%';
  const posterSrc = item.posterPath
    ? item.posterPath.startsWith('http')
      ? item.posterPath
      : \`https://image.tmdb.org/t/p/w185${'${item.posterPath}'}\`
    : null;

  const accent = isError
    ? 'text-red-300'
    : isWarning
      ? 'text-amber-300'
      : isCompleted
        ? 'text-emerald-300'
        : 'text-cyan-300';

  const progressBar = isError
    ? 'bg-red-500'
    : isWarning
      ? 'bg-amber-400'
      : isCompleted
        ? 'bg-gradient-to-r from-emerald-500 to-emerald-300'
        : 'bg-gradient-to-r from-cyan-500 via-sky-400 to-cyan-300';

  const statusLabel = isError
    ? 'Erreur'
    : isWarning
      ? (item.statusText || 'En attente')
      : isCompleted
        ? 'Terminé'
        : isPending
          ? (status === 'searching' ? 'Recherche' : 'Préparation')
          : 'Téléchargement';

  return (
    <div
      className={\`relative overflow-hidden rounded-[22px] border bg-gradient-to-br from-zinc-900/95 to-zinc-950/90 p-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.18)] ${'${'}
        isError
          ? 'border-red-500/25'
          : isWarning
            ? 'border-amber-500/20'
            : isCompleted
              ? 'border-emerald-500/20'
              : 'border-white/[0.08]'
      }\`}
    >
      <div className="flex gap-3.5">
        <button
          type="button"
          onClick={() => item.tmdbId && onShowClick?.(item.tmdbId, item.mediaType)}
          className="relative w-16 aspect-[2/3] shrink-0 self-start overflow-hidden rounded-[14px] border border-white/10 bg-zinc-950 shadow-md flex items-center justify-center"
        >
          {posterSrc ? (
            <img
              src={posterSrc}
              alt={cleanTitle}
              className="absolute inset-0 block h-full w-full object-cover object-center"
              loading="lazy"
            />
          ) : isTv ? (
            <Tv size={22} className="text-purple-400" />
          ) : (
            <Film size={22} className="text-amber-400" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => item.tmdbId && onShowClick?.(item.tmdbId, item.mediaType)}
              className="min-w-0 flex-1 text-left"
            >
              <h3 className="text-[15px] font-black leading-tight text-white line-clamp-2">{cleanTitle}</h3>
              {subTitle && <p className="mt-1 text-[11px] font-semibold text-zinc-400">{subTitle}</p>}
            </button>

            <button
              type="button"
              disabled={isRemoving}
              onClick={() => onRemove(item)}
              className="-mr-1 -mt-1 rounded-full p-2 text-zinc-600 transition-colors hover:bg-white/5 hover:text-red-400 disabled:opacity-50"
              aria-label="Supprimer"
            >
              {isRemoving ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />}
            </button>
          </div>

          {qualityBadges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {qualityBadges.map((badge, index) => (
                <span
                  key={badge}
                  className={\`rounded-md border px-1.5 py-0.5 text-[9px] font-black tracking-wide ${'${'}
                    index === 0
                      ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200'
                      : 'border-white/10 bg-white/[0.04] text-zinc-300'
                  }\`}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-end justify-between gap-3">
            <div className={\`flex min-w-0 items-center gap-1.5 text-[11px] font-bold ${'${accent}'}\`}>
              <span className={\`h-1.5 w-1.5 shrink-0 rounded-full ${'${'}isCompleted ? 'bg-emerald-400' : isError ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-cyan-400'}\`} />
              <span className="truncate">{statusLabel}</span>
            </div>
            <span className={\`shrink-0 text-sm font-black tabular-nums ${'${accent}'}\`}>{progressLabel}</span>
          </div>

          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07] ring-1 ring-white/[0.03]">
            {isPending && progress <= 0 ? (
              <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-cyan-500/30 via-cyan-300/80 to-cyan-500/30 animate-pulse" />
            ) : (
              <div
                className={\`relative h-full rounded-full transition-[width] duration-500 ease-out ${'${progressBar}'} ${'${'}!isCompleted && !isError ? 'shadow-[0_0_12px_rgba(34,211,238,0.28)]' : ''}\`}
                style={{ width: \`${'${progress}'}%\` }}
              >
                {!isCompleted && progress > 4 && <div className="absolute inset-0 bg-white/[0.08]" />}
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-zinc-400">
            <div className="flex min-w-0 items-center gap-1.5 tabular-nums">
              <HardDrive size={11} className="shrink-0 text-zinc-500" />
              {item.size > 0 && !isPending ? (
                <span className="truncate">{formatBytes(downloadedBytes)} / {formatBytes(item.size)}</span>
              ) : (
                <span className="truncate">{item.statusText || statusLabel}</span>
              )}
            </div>

            {!isCompleted && !isError && !isPending && (
              <div className="flex shrink-0 items-center gap-2.5 tabular-nums">
                {item.speedFormatted && (
                  <span className="flex items-center gap-1 font-semibold text-zinc-300">
                    <Download size={11} className="text-cyan-400" />
                    {item.speedFormatted}
                  </span>
                )}
                {item.timeleft && item.timeleft !== '--' && (
                  <span className="flex items-center gap-1 text-zinc-400">
                    <Clock3 size={11} />
                    {item.timeleft}
                  </span>
                )}
              </div>
            )}
          </div>

          {item.errorMessage && (
            <p className="mt-2 rounded-xl border border-red-500/15 bg-red-500/[0.07] px-2.5 py-2 text-[10px] leading-snug text-red-300">
              {item.errorMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function DownloadsScreen`
);

// -----------------------------------------------------------------------------
// 5) Tests : reproduire le cas vidéo et protéger les vrais torrents distincts.
// -----------------------------------------------------------------------------
replaceExact(
  'tests/downloadIdentity.test.ts',
  `  getPhysicalDownloadId,\n  normalizeDownloadClientId,\n  sameLegacyPhysicalTransfer,\n  samePhysicalDownload`,
  `  getPhysicalDownloadId,\n  getPhysicalDownloadIds,\n  hasConflictingStrongPhysicalIds,\n  mergeDownloadIdAliases,\n  normalizeDownloadClientId,\n  sameLegacyPhysicalTransfer,\n  samePhysicalDownload`
);

{
  const path = 'tests/downloadIdentity.test.ts';
  let src = read(path);
  if (!src.includes('rattache un torrent hybride')) {
    src += `\n\ntest('rattache un torrent hybride grâce aux alias infohash v1/v2', () => {\n  const v1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';\n  const v2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';\n  const arr = { id: 'radarr_77', downloadId: v1 };\n  const qbit = {\n    id: 'qbit_cccccccccccccccccccccccccccccccccccccccc',\n    downloadId: 'cccccccccccccccccccccccccccccccccccccccc',\n    downloadIdAliases: [v1, v2]\n  };\n\n  assert.equal(samePhysicalDownload(arr, qbit), true);\n  assert.deepEqual(new Set(getPhysicalDownloadIds(qbit)), new Set([\n    'cccccccccccccccccccccccccccccccccccccccc',\n    v1,\n    v2\n  ]));\n});\n\ntest('conserve les alias appris entre deux polls même si *Arr change temporairement de downloadId', () => {\n  const learned = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';\n  const transient = 'not-a-real-hash';\n  const aliases = mergeDownloadIdAliases(\n    { id: 'radarr_42', downloadId: learned },\n    { id: 'radarr_42', downloadId: transient }\n  );\n\n  assert.ok(aliases.includes(learned));\n  assert.ok(aliases.includes(transient));\n  assert.equal(\n    samePhysicalDownload(\n      { id: 'radarr_42', downloadId: transient, downloadIdAliases: aliases },\n      { id: \`qbit_\${learned}\` }\n    ),\n    true\n  );\n});\n\ntest('deux vrais infohash différents ne sont jamais fusionnés par le fallback release + taille', () => {\n  const a = {\n    id: 'radarr_1',\n    downloadId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',\n    mediaType: 'movie',\n    releaseTitle: 'Film.2026.2160p.WEB-DL',\n    size: 10_000_000_000\n  };\n  const b = {\n    id: 'qbit_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',\n    downloadId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',\n    mediaType: 'movie',\n    releaseTitle: 'Film.2026.2160p.WEB-DL',\n    size: 10_000_000_000\n  };\n\n  assert.equal(hasConflictingStrongPhysicalIds(a, b), true);\n  assert.equal(sameLegacyPhysicalTransfer(a, b), false);\n});\n`;
  }
  write(path, src);
}

// -----------------------------------------------------------------------------
// 6) Version
// -----------------------------------------------------------------------------
replaceExact('src/store/updateStore.ts', "export const CURRENT_APP_VERSION = '1.4.55';", "export const CURRENT_APP_VERSION = '1.4.56';");
replaceExact('android/app/build.gradle', '        versionCode 104055\n        versionName "1.4.55"', '        versionCode 104056\n        versionName "1.4.56"');

console.log('Patch téléchargements 1.4.56 appliqué.');
