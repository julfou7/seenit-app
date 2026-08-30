export interface TorrentFileLike {
  index: number;
  name: string;
  size?: number;
  priority?: number;
}

export interface EpisodeFileSelection {
  targetIndexes: number[];
  targetNames: string[];
  extraEpisodeNumbers: number[];
  ambiguous: boolean;
}

function isVideoFile(name: string): boolean {
  return /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm)$/i.test(name || '');
}

function isAuxiliaryVideo(name: string): boolean {
  const value = (name || '').toLowerCase();
  return /(^|[\/._ -])(sample|trailer|preview|extras?|featurettes?|behind[ ._-]*the[ ._-]*scenes)([\/._ -]|$)/i.test(value);
}

export function extractEpisodeRefsFromFileName(name: string): Array<{ season: number; episode: number }> {
  const value = String(name || '');
  const refs: Array<{ season: number; episode: number }> = [];

  const seasonMatch = value.match(/s(\d{1,2})/i);
  if (seasonMatch) {
    const season = Number(seasonMatch[1]);
    const suffix = value.slice((seasonMatch.index || 0) + seasonMatch[0].length);
    const episodeRegex = /(?:^|[._ -])?e(\d{1,3})/gi;
    let match: RegExpExecArray | null;
    while ((match = episodeRegex.exec(suffix)) !== null) {
      const episode = Number(match[1]);
      if (Number.isFinite(episode) && episode > 0) refs.push({ season, episode });
    }
  }

  const xRegex = /(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?=[^0-9]|$)/gi;
  let xMatch: RegExpExecArray | null;
  while ((xMatch = xRegex.exec(value)) !== null) {
    const season = Number(xMatch[1]);
    const episode = Number(xMatch[2]);
    if (season >= 0 && episode > 0) refs.push({ season, episode });
  }

  const unique = new Map<string, { season: number; episode: number }>();
  for (const ref of refs) unique.set(`${ref.season}:${ref.episode}`, ref);
  return Array.from(unique.values());
}

export function selectEpisodeFiles(
  files: TorrentFileLike[],
  season: number,
  episode: number
): EpisodeFileSelection {
  const candidates = (Array.isArray(files) ? files : [])
    .filter(file => Number.isInteger(file?.index) && isVideoFile(file?.name) && !isAuxiliaryVideo(file?.name))
    .map(file => ({
      file,
      refs: extractEpisodeRefsFromFileName(file.name)
    }))
    .filter(candidate => candidate.refs.some(ref => ref.season === season && ref.episode === episode));

  const exact = candidates.filter(candidate =>
    candidate.refs.length === 1
    && candidate.refs[0].season === season
    && candidate.refs[0].episode === episode
  );

  const selected = exact.length === 1
    ? exact
    : exact.length > 1
      ? []
      : candidates.length === 1
        ? candidates
        : [];

  if (selected.length !== 1) {
    return {
      targetIndexes: [],
      targetNames: [],
      extraEpisodeNumbers: [],
      ambiguous: candidates.length > 1 || exact.length > 1
    };
  }

  const target = selected[0];
  return {
    targetIndexes: [target.file.index],
    targetNames: [target.file.name],
    extraEpisodeNumbers: target.refs
      .filter(ref => ref.season === season && ref.episode !== episode)
      .map(ref => ref.episode),
    ambiguous: false
  };
}

function normalizeTorrentCorrelationId(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * Retourne uniquement les torrents qBittorrent apparus après le snapshot initial
 * et prouvés par un identifiant exact Sonarr ou par l'infohash exact de la release.
 * Un hash déjà présent avant la demande n'est jamais éligible, même s'il correspond
 * à la release choisie : SeenIt ne doit jamais modifier un torrent préexistant.
 */
export function findExactNewTorrentIds(
  candidateDownloadIds: Array<string | null | undefined>,
  currentQbitHashes: Array<string | null | undefined>,
  beforeQbitHashes: Array<string | null | undefined>,
  releaseHash?: string | null
): string[] {
  const before = new Set(
    (beforeQbitHashes || []).map(normalizeTorrentCorrelationId).filter(Boolean)
  );
  const current = new Set(
    (currentQbitHashes || []).map(normalizeTorrentCorrelationId).filter(Boolean)
  );
  const newlySeen = new Set(Array.from(current).filter(hash => !before.has(hash)));
  const exact = new Set<string>();

  for (const candidate of candidateDownloadIds || []) {
    const id = normalizeTorrentCorrelationId(candidate);
    if (id && newlySeen.has(id)) exact.add(id);
  }

  const normalizedReleaseHash = normalizeTorrentCorrelationId(releaseHash);
  if (normalizedReleaseHash && newlySeen.has(normalizedReleaseHash)) {
    exact.add(normalizedReleaseHash);
  }

  return Array.from(exact);
}

/**
 * Choisit l'unique identifiant qu'un nettoyage de sécurité est autorisé à toucher.
 * La frontière est absolue : tout hash présent avant la demande est exclu, quelle
 * que soit la preuve Sonarr apparue ensuite.
 */
export function chooseExactCleanupTorrentId(
  exactNewTorrentIds: Array<string | null | undefined>,
  corroboratedSonarrIds: Array<string | null | undefined>,
  beforeQbitHashes: Array<string | null | undefined>,
  releaseHash?: string | null
): string | null {
  const before = new Set(
    (beforeQbitHashes || []).map(normalizeTorrentCorrelationId).filter(Boolean)
  );
  const release = normalizeTorrentCorrelationId(releaseHash);
  if (release && !before.has(release)) return release;

  const exact = Array.from(new Set(
    (exactNewTorrentIds || [])
      .map(normalizeTorrentCorrelationId)
      .filter(id => id && !before.has(id))
  ));
  if (exact.length === 1) return exact[0];

  const corroborated = Array.from(new Set(
    (corroboratedSonarrIds || [])
      .map(normalizeTorrentCorrelationId)
      .filter(id => id && !before.has(id))
  ));
  return corroborated.length === 1 ? corroborated[0] : null;
}

function releaseMatchesQuality(release: any, preference?: '1080p' | '4k'): boolean {
  if (!preference) return true;
  const qualityName = release?.quality?.quality?.name || release?.quality?.name || '';
  const resolution = release?.quality?.quality?.resolution || release?.quality?.resolution || '';
  const haystack = `${qualityName} ${resolution} ${release?.title || ''}`.toLowerCase();
  if (preference === '4k') return /2160|4k|uhd/.test(haystack);
  return /1080/.test(haystack) && !/2160|4k|uhd/.test(haystack);
}

function releaseCanBeGrabbed(release: any): boolean {
  if (release?.approved === true) return true;
  const rejections = Array.isArray(release?.rejections) ? release.rejections.filter(Boolean) : [];
  if (!rejections.length) return true;
  return rejections.every((reason: any) => /existing file/i.test(String(reason)));
}

export function rankSeasonPackReleases(releases: any[], preference?: '1080p' | '4k'): any[] {
  return (Array.isArray(releases) ? releases : [])
    .filter(release => release?.fullSeason === true)
    .filter(release => releaseMatchesQuality(release, preference))
    .filter(releaseCanBeGrabbed)
    .sort((a, b) => {
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

export function hasCompatibleIndividualEpisodeRelease(releases: any[], preference?: '1080p' | '4k'): boolean {
  return (Array.isArray(releases) ? releases : []).some(release =>
    release?.fullSeason !== true
    && releaseMatchesQuality(release, preference)
    && releaseCanBeGrabbed(release)
  );
}

export function extractReleaseTorrentHash(release: any): string | null {
  const directCandidates = [
    release?.infoHash,
    release?.infohash,
    release?.torrentInfoHash,
    release?.downloadId
  ];
  for (const candidate of directCandidates) {
    const value = String(candidate || '').trim().toLowerCase();
    if (/^[a-f0-9]{40}$/.test(value) || /^[a-f0-9]{64}$/.test(value)) return value;
  }

  const textCandidates = [release?.magnetUrl, release?.magnetUri, release?.downloadUrl, release?.guid];
  for (const candidate of textCandidates) {
    const value = String(candidate || '');
    const btih = value.match(/btih:([a-f0-9]{40}|[a-f0-9]{64})/i);
    if (btih) return btih[1].toLowerCase();
  }
  return null;
}
