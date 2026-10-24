import type { Show } from '../../types';
import { imageUrl } from '../../features/watchlist/seriesCardPresentation';

export function HomeLoadMore({ items, onLoad, tile = false, step = 6, lastLabel }: { items: Show[]; onLoad: () => void; tile?: boolean; step?: number; lastLabel?: string }) {
  if (!items.length) return null;
  const movie = items[0].mediaType === 'movie';
  const label = items.length > step ? `Afficher ${step} de plus` : items.length === 1 ? lastLabel || (movie ? 'Afficher le dernier' : 'Afficher la dernière') : `Afficher les ${items.length}`;
  return <button type="button" className={`home-load-more${tile ? ' home-load-more--tile' : ''}${tile && movie ? ' home-load-more--movies' : ''}`} onClick={onLoad}>
    <span className="home-load-more__posters" aria-hidden="true">{items.slice(0, 3).map((show, index) => <span key={`${show.id}:${index}`}>{show.title[0]}{show.posterPath && <img src={imageUrl(show.posterPath, 'w92')!} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}</span>)}</span>
    <strong>{label}</strong><span>{items.length} en attente</span>
  </button>;
}
