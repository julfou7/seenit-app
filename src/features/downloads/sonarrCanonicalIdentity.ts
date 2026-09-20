export interface CanonicalSeriesBridge {
  tmdbId: number;
  tvdbId: number;
  imdbId?: string;
}

export interface ExactSonarrSeriesIdentity extends CanonicalSeriesBridge {
  seriesId: number;
  title: string;
  year?: number;
}

export interface ExactSonarrReleasePayload {
  title: string;
  downloadUrl: string;
  protocol: 'torrent';
  publishDate: string;
  tvdbId: number;
  imdbId?: string;
}

export interface ExactSonarrReleaseResult {
  success: boolean;
  message: string;
  releaseTitle?: string;
  response?: unknown;
}

interface ExactSonarrReleaseDependencies {
  parseReleaseTitle: (title: string) => Promise<unknown>;
  postRelease: (payload: ExactSonarrReleasePayload) => Promise<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalImdbId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return /^tt\d+$/i.test(normalized) ? normalized : undefined;
}

export function resolveCanonicalSeriesBridge(
  requestedTmdbId: unknown,
  tmdbDetails: unknown
): CanonicalSeriesBridge | null {
  const tmdbId = positiveInteger(requestedTmdbId);
  const details = asRecord(tmdbDetails);
  if (!tmdbId || !details) return null;

  const returnedTmdbId = details.id === undefined ? tmdbId : positiveInteger(details.id);
  if (returnedTmdbId !== tmdbId) return null;

  const externalIds = asRecord(details.external_ids);
  const tvdbId = positiveInteger(externalIds?.tvdb_id);
  if (!tvdbId) return null;

  return {
    tmdbId,
    tvdbId,
    imdbId: optionalImdbId(externalIds?.imdb_id)
  };
}

function hasContradictoryIdentity(
  candidate: Record<string, unknown>,
  canonical: CanonicalSeriesBridge
): boolean {
  const candidateTmdbId = positiveInteger(candidate.tmdbId);
  if (candidateTmdbId && candidateTmdbId !== canonical.tmdbId) return true;

  const candidateTvdbId = positiveInteger(candidate.tvdbId);
  if (candidateTvdbId && candidateTvdbId !== canonical.tvdbId) return true;

  const candidateImdbId = optionalImdbId(candidate.imdbId);
  if (candidateImdbId && canonical.imdbId && candidateImdbId.toLowerCase() !== canonical.imdbId.toLowerCase()) {
    return true;
  }

  return false;
}

export function findExactSonarrSeries(
  candidates: unknown,
  canonical: CanonicalSeriesBridge
): Record<string, unknown> | null {
  if (!Array.isArray(candidates)) return null;

  for (const value of candidates) {
    const candidate = asRecord(value);
    if (!candidate || hasContradictoryIdentity(candidate, canonical)) continue;
    if (positiveInteger(candidate.tvdbId) === canonical.tvdbId) return candidate;
  }

  return null;
}

export function toExactSonarrSeriesIdentity(
  candidateValue: unknown,
  canonical: CanonicalSeriesBridge
): ExactSonarrSeriesIdentity | null {
  const candidate = asRecord(candidateValue);
  if (!candidate || hasContradictoryIdentity(candidate, canonical)) return null;
  if (positiveInteger(candidate.tvdbId) !== canonical.tvdbId) return null;

  const seriesId = positiveInteger(candidate.id);
  const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  if (!seriesId || !title) return null;

  const year = positiveInteger(candidate.year) ?? undefined;
  return { ...canonical, seriesId, title, year };
}

function parsedSeriesMatchesExactTarget(parsedValue: unknown, exact: ExactSonarrSeriesIdentity): boolean {
  const parsed = asRecord(parsedValue);
  const series = asRecord(parsed?.series);
  if (!series || positiveInteger(series.id) !== exact.seriesId) return false;
  return !hasContradictoryIdentity(series, exact);
}

export function buildCanonicalSonarrReleaseTitle(
  originalTitle: string,
  exact: ExactSonarrSeriesIdentity
): string | null {
  const marker = /(?:^|[ ._\-[\(])((?:S\d{1,2}(?:[ ._-]*E\d{1,3}(?:[ ._-]*(?:E|-)?\d{1,3})*)?)|(?:\d{1,2}x\d{1,3})|(?:\d{4}[ ._-]\d{2}[ ._-]\d{2}))/i.exec(originalTitle);
  if (!marker || marker.index === undefined) return null;

  const markerIndex = marker.index + marker[0].length - marker[1].length;
  const technicalSuffix = originalTitle.slice(markerIndex).replace(/^[ ._-]+/, '').trim();
  if (!technicalSuffix) return null;

  const canonicalPrefix = exact.title.trim().replace(/\s+/g, '.');
  const yearSegment = exact.year ? `.${exact.year}` : '';
  return `${canonicalPrefix}${yearSegment}.${technicalSuffix}`;
}

function firstReleaseResult(response: unknown): Record<string, unknown> | null {
  const value = Array.isArray(response) ? response[0] : response;
  return asRecord(value);
}

function releaseRejections(response: unknown): string[] {
  const release = firstReleaseResult(response);
  if (!release) return [];
  if (Array.isArray(release.rejections)) {
    const reasons = release.rejections
      .filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0);
    if (reasons.length > 0) return reasons;
  }
  return release.approved === false ? ['Release non approuvée par Sonarr'] : [];
}

export async function pushExactSonarrRelease(
  input: {
    releaseTitle: string;
    magnetUri: string;
    publishDate: string;
    exact: ExactSonarrSeriesIdentity;
  },
  dependencies: ExactSonarrReleaseDependencies
): Promise<ExactSonarrReleaseResult> {
  let selectedTitle = input.releaseTitle;
  const originalParse = await dependencies.parseReleaseTitle(selectedTitle);

  if (!parsedSeriesMatchesExactTarget(originalParse, input.exact)) {
    const canonicalTitle = buildCanonicalSonarrReleaseTitle(input.releaseTitle, input.exact);
    if (!canonicalTitle) {
      return {
        success: false,
        message: 'Sonarr ne peut pas prouver la série exacte de cette release ; aucun téléchargement n’a été lancé.'
      };
    }

    const canonicalParse = await dependencies.parseReleaseTitle(canonicalTitle);
    if (!parsedSeriesMatchesExactTarget(canonicalParse, input.exact)) {
      return {
        success: false,
        message: 'Le parseur Sonarr associe cette release à une autre série ; envoi bloqué avant téléchargement.'
      };
    }
    selectedTitle = canonicalTitle;
  }

  const response = await dependencies.postRelease({
    title: selectedTitle,
    downloadUrl: input.magnetUri,
    protocol: 'torrent',
    publishDate: input.publishDate,
    tvdbId: input.exact.tvdbId,
    ...(input.exact.imdbId ? { imdbId: input.exact.imdbId } : {})
  });
  const result = firstReleaseResult(response);
  const mappedSeriesId = positiveInteger(result?.mappedSeriesId);
  if (mappedSeriesId && mappedSeriesId !== input.exact.seriesId) {
    return {
      success: false,
      message: 'Sonarr a renvoyé une série différente de la fiche TMDB ; résultat rejeté.',
      releaseTitle: selectedTitle,
      response
    };
  }

  const rejections = releaseRejections(response);
  if (rejections.length > 0) {
    return {
      success: false,
      message: `Sonarr a refusé la release : ${rejections.join(' • ')}`,
      releaseTitle: selectedTitle,
      response
    };
  }

  return {
    success: true,
    message: 'Torrent envoyé avec succès à Sonarr !',
    releaseTitle: selectedTitle,
    response
  };
}
