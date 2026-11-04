import React, { useEffect, useMemo, useState } from 'react';
import { tmdb } from '../../features/shows/tmdb';
import { getTodayStr } from '../../lib/utils';
import { planMovieEnd } from '../../features/shows/detailPlanning';
import { buildVerifiedSimilar, directedMovies, movieIdsFromCredits, type SimilarCandidate, type VerifiedSimilar } from '../../features/shows/similarReasons';
import { DetailCard, DetailSectionTitle, useClockMinutes } from './detailUi';

/**
 * « Si tu lances maintenant · Fin à HH:MM », barre sur 200 min avec repère de minuit (prototype).
 * Retour terrain v1.4.251 (#857) : ni « il est HH:MM » (affiché deux fois) ni « Fini X min avant minuit ».
 */
export function MovieEndCard({ runtime }: { runtime: number | null | undefined }) {
  const now = useClockMinutes();
  const plan = planMovieEnd(now, runtime);
  if (!plan) return null;
  const late = plan.afterMidnight > 0;
  return <DetailCard accent className="p-4 flex flex-col gap-2.5">
    <div className="flex flex-col gap-0.5"><span className="text-[13px] text-zinc-400">Si tu lances maintenant</span><span className="text-[40px] font-extrabold leading-none tracking-[-0.04em] whitespace-nowrap" style={{ color: late ? '#FDBA74' : '#E5A93D' }}>Fin à {plan.end}</span></div>
    <div className="relative h-2.5 rounded-[5px] bg-zinc-800 mt-1" aria-hidden="true"><div className="h-2.5 rounded-[5px] bg-[#E5A93D]" style={{ width: `${plan.barPercent.toFixed(1)}%` }} />{plan.midnightPercent !== null && <div className="absolute -top-[5px] -bottom-[5px] border-l-2 border-dashed border-zinc-400" style={{ left: `${plan.midnightPercent.toFixed(1)}%` }} />}</div>
    {plan.midnightPercent !== null && <div className="relative h-3.5 text-[11px] text-zinc-500" aria-hidden="true"><span className="absolute -translate-x-1/2" style={{ left: `${plan.midnightPercent.toFixed(1)}%` }}>minuit</span></div>}
  </DetailCard>;
}

type MovieDetails = { id: number; genres?: Array<{ id: number; name: string }>; credits?: { cast?: Array<{ id: number; name: string }>; crew?: Array<{ id: number; name: string; job?: string }> } };

/**
 * « Similaires, et pourquoi » : recommandations TMDB et autres films du réalisateur, gardés seulement
 * avec une raison prouvée (SEENIT-RELATION-001 révisée). La section disparaît si rien n'est prouvé.
 */
export function VerifiedSimilarRail({ movie, excludedIds, onOpen }: { movie: MovieDetails | null; excludedIds: ReadonlySet<number>; onOpen: (movieId: number) => void }) {
  const [items, setItems] = useState<VerifiedSimilar[] | null>(null);
  const director = useMemo(() => movie?.credits?.crew?.find(member => member.job === 'Director') || null, [movie]);
  const leads = useMemo(() => (movie?.credits?.cast || []).slice(0, 2), [movie]);
  const excludedKey = [...excludedIds].sort().join(',');
  useEffect(() => {
    if (!movie?.id) return;
    let cancelled = false;
    setItems(null);
    void (async () => {
      const [recommendations, directorCredits, ...actorCredits] = await Promise.all([
        tmdb.getMovieRecommendations(movie.id),
        director ? tmdb.getCachedPersonCredits(director.id) : Promise.resolve(null),
        ...leads.map(actor => tmdb.getCachedPersonCredits(actor.id)),
      ]);
      if (cancelled) return;
      const directorData = directorCredits && directorCredits.ok ? directorCredits.value : null;
      const result = buildVerifiedSimilar(
        movie.id,
        recommendations.ok ? (recommendations.value as SimilarCandidate[]) : [],
        directedMovies(directorData, getTodayStr()).slice(0, 4),
        {
          director: director && directorData ? { name: director.name, movieIds: movieIdsFromCredits(directorData, 'director') } : null,
          leadActors: leads.map((actor, index) => { const credits = actorCredits[index]; return credits && credits.ok ? { name: actor.name, movieIds: movieIdsFromCredits(credits.value, 'cast') } : null; }).filter((entry): entry is { name: string; movieIds: Set<number> } => entry !== null),
          mainGenre: movie.genres?.[0] || null,
        },
        excludedIds,
      );
      setItems(result);
    })();
    return () => { cancelled = true; };
    // excludedKey résume excludedIds (Set recréé à chaque rendu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie?.id, director?.id, leads.map(actor => actor.id).join(','), excludedKey]);
  if (!items || items.length === 0) return null;
  return <section className="flex flex-col gap-2.5" aria-labelledby="detail-similar-title">
    <DetailSectionTitle id="detail-similar-title">Similaires, et pourquoi</DetailSectionTitle>
    <div className="flex gap-2.5 overflow-x-auto hide-scrollbar -mr-4 pr-4">
      {items.map(({ candidate, reason }) => <button type="button" key={`similar-${candidate.id}`} onClick={() => onOpen(candidate.id)} className="w-28 shrink-0 flex flex-col gap-1.5 text-left" aria-label={`${candidate.title || candidate.name} — ${reason}`}>
        <span className="h-[168px] rounded-xl overflow-hidden bg-zinc-800 relative">{candidate.poster_path && <img src={`https://image.tmdb.org/t/p/w342${candidate.poster_path}`} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />}</span>
        <span className="text-[11px] font-bold leading-[1.3] text-zinc-300 line-clamp-2">{reason}</span>
      </button>)}
    </div>
  </section>;
}
