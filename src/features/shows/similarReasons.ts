/**
 * SEENIT-RELATION-001 (révision du 03/11/2026) — « Similaires, et pourquoi » sur la fiche film.
 * Un titre n'est proposé que si une raison prouvable par les données TMDB l'accompagne :
 * même réalisateur (crédit « Director » de la personne), même acteur principal (crédit cast de la
 * personne) ou genre principal commun. Sans raison, pas de carte. L'identité reste l'ID TMDB : aucun
 * titre ni année ne sert à rapprocher deux œuvres, et ce rail ne remplace jamais une relation TVDB.
 */
export interface SimilarCandidate {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  genre_ids?: number[];
  release_date?: string;
  popularity?: number;
  media_type?: string;
  adult?: boolean;
}

export interface SimilarPerson {
  name: string;
  movieIds: ReadonlySet<number>;
}

export interface SimilarEvidence {
  director?: SimilarPerson | null;
  leadActors?: readonly SimilarPerson[];
  mainGenre?: { id: number; name: string } | null;
}

export type SimilarReasonKind = 'director' | 'actor' | 'genre';

export interface VerifiedSimilar {
  candidate: SimilarCandidate;
  kind: SimilarReasonKind;
  reason: string;
}

const REASON_ORDER: Record<SimilarReasonKind, number> = { director: 0, actor: 1, genre: 2 };

export function similarReasonFor(candidate: SimilarCandidate, evidence: SimilarEvidence): { kind: SimilarReasonKind; reason: string } | null {
  const id = Number(candidate.id);
  if (evidence.director && evidence.director.movieIds.has(id)) return { kind: 'director', reason: `Même réalisateur · ${evidence.director.name}` };
  const actor = (evidence.leadActors || []).find(person => person.movieIds.has(id));
  if (actor) return { kind: 'actor', reason: `Avec ${actor.name}` };
  if (evidence.mainGenre && (candidate.genre_ids || []).includes(evidence.mainGenre.id)) return { kind: 'genre', reason: `Même genre · ${evidence.mainGenre.name}` };
  return null;
}

/**
 * Fusionne les recommandations TMDB et les autres films du réalisateur, écarte le film courant, sa
 * collection et les titres sans affiche, puis classe par force de la raison (réalisateur > acteur > genre)
 * en conservant l'ordre TMDB à force égale.
 */
export function buildVerifiedSimilar(
  currentId: number,
  recommendations: readonly SimilarCandidate[],
  directorFilms: readonly SimilarCandidate[],
  evidence: SimilarEvidence,
  excludedIds: ReadonlySet<number> = new Set(),
  limit = 10,
): VerifiedSimilar[] {
  const seen = new Set<number>([Number(currentId), ...excludedIds]);
  const pool: SimilarCandidate[] = [];
  for (const candidate of [...recommendations, ...directorFilms]) {
    const id = Number(candidate?.id);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id) || candidate.adult || !candidate.poster_path) continue;
    if (candidate.media_type && candidate.media_type !== 'movie') continue;
    seen.add(id);
    pool.push(candidate);
  }
  return pool
    .map((candidate, index) => ({ candidate, index, verdict: similarReasonFor(candidate, evidence) }))
    .filter((entry): entry is { candidate: SimilarCandidate; index: number; verdict: { kind: SimilarReasonKind; reason: string } } => entry.verdict !== null)
    .sort((a, b) => REASON_ORDER[a.verdict.kind] - REASON_ORDER[b.verdict.kind] || a.index - b.index)
    .slice(0, limit)
    .map(entry => ({ candidate: entry.candidate, kind: entry.verdict.kind, reason: entry.verdict.reason }));
}

type CreditEntry = { id?: unknown; job?: unknown; media_type?: unknown; poster_path?: unknown; popularity?: unknown; release_date?: unknown; title?: unknown; genre_ids?: unknown; adult?: unknown };

/** Films réalisés (crew job « Director ») d'une personne, déjà sortis, les plus populaires d'abord. */
export function directedMovies(credits: { crew?: readonly CreditEntry[] } | null | undefined, todayIso: string): SimilarCandidate[] {
  return (credits?.crew || [])
    .filter(entry => entry.job === 'Director' && (entry.media_type === undefined || entry.media_type === 'movie'))
    .filter(entry => typeof entry.release_date === 'string' && entry.release_date !== '' && entry.release_date <= todayIso)
    .map(entry => ({ id: Number(entry.id), title: typeof entry.title === 'string' ? entry.title : undefined, poster_path: typeof entry.poster_path === 'string' ? entry.poster_path : null, genre_ids: Array.isArray(entry.genre_ids) ? entry.genre_ids.map(Number) : [], release_date: entry.release_date as string, popularity: Number(entry.popularity) || 0, media_type: 'movie', adult: entry.adult === true }))
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

export function movieIdsFromCredits(credits: { cast?: readonly CreditEntry[]; crew?: readonly CreditEntry[] } | null | undefined, role: 'cast' | 'director'): Set<number> {
  const entries = role === 'cast' ? credits?.cast || [] : (credits?.crew || []).filter(entry => entry.job === 'Director');
  return new Set(entries.filter(entry => entry.media_type === undefined || entry.media_type === 'movie').map(entry => Number(entry.id)).filter(id => Number.isSafeInteger(id) && id > 0));
}
