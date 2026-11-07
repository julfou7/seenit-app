import type { Show } from '../../types';
import { imageUrl } from '../../features/watchlist/seriesCardPresentation';
import './loadMore.css';

/** Une vignette ronde d'aperçu : l'un des prochains éléments (affiche ou portrait, initiale sinon). */
export interface LoadMorePreview { key: string; initial: string; imagePath?: string | null }

/** Libellé unique de pagination (#873) : lot, « les N » quand il en reste peu, dernier élément. */
export function loadMoreLabel(remainingCount: number, step: number, lastLabel: string): string {
  return remainingCount > step ? `Afficher ${step} de plus` : remainingCount === 1 ? lastLabel : `Afficher les ${remainingCount}`;
}

/**
 * SEENIT-UX-020 #873 — Le seul « Afficher plus » de l'app : trois prochaines vignettes, libellé du lot et
 * « X en attente ». Variante liste (pastille) ou carrousel (tuile de fin de rail). Toute pagination
 * progressive le réutilise ; aucun bouton texte « voir plus » séparé.
 */
export function LoadMore({ previews, remainingCount, onLoad, step = 6, lastLabel = 'Afficher le dernier', tile = false, tileMovies = false, round = false, label }: {
  previews: readonly LoadMorePreview[]; remainingCount: number; onLoad: () => void; step?: number; lastLabel?: string;
  tile?: boolean; tileMovies?: boolean; round?: boolean; label?: string;
}) {
  if (remainingCount <= 0) return null;
  return <button type="button" data-load-more className={`home-load-more${tile ? ' home-load-more--tile' : ''}${tileMovies ? ' home-load-more--movies' : ''}${round ? ' home-load-more--round' : ''}`} onClick={onLoad}>
    <span className="home-load-more__posters" aria-hidden="true">{previews.slice(0, 3).map(preview => <span key={preview.key}>{preview.initial}{preview.imagePath && <img src={imageUrl(preview.imagePath, 'w92')!} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}</span>)}</span>
    <strong>{label || loadMoreLabel(remainingCount, step, lastLabel)}</strong><span>{remainingCount} en attente</span>
  </button>;
}

export function HomeLoadMore({ items, onLoad, tile = false, step = 6, lastLabel, remainingCount = items.length }: { items: Show[]; onLoad: () => void; tile?: boolean; step?: number; lastLabel?: string; remainingCount?: number }) {
  if (!items.length || remainingCount <= 0) return null;
  const movie = items[0].mediaType === 'movie';
  // Libellés historiques : `Afficher ${step} de plus`, `Afficher les ${remainingCount}`, 'Afficher la dernière' ; {remainingCount} en attente.
  return <LoadMore previews={items.slice(0, 3).map((show, index) => ({ key: `${show.id}:${index}`, initial: show.title[0], imagePath: show.posterPath }))} remainingCount={remainingCount} onLoad={onLoad}
    step={step} tile={tile} tileMovies={tile && movie} lastLabel={lastLabel || (movie ? 'Afficher le dernier' : 'Afficher la dernière')} />;
}
