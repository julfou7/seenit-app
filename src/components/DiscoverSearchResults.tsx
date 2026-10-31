import { useMemo, useState } from 'react';
import { Check, ChevronRight, Plus, User } from 'lucide-react';
import type { DiscoverViewModel } from '../screens/discoverViewModel';
import type { TMDBMedia } from '../features/shows/tmdb';
import { useToastStore } from '../store/toastStore';
import type { CharacterRecord } from '../features/discover/characters';
import { characterInitials } from './CharacterDetailModal';
import { librarySearchStatus, searchHighlight, searchLibrary, searchMediaKey } from '../features/discover/searchPresentation';

function Highlight({ title, query }: { title: string; query: string }) {
  const [before, match, after] = searchHighlight(title, query);
  return <>{before}<mark>{match}</mark>{after}</>;
}
function Thumbnail({ path, person = false }: { path?: string | null; person?: boolean }) {
  return <span className={person ? 'explorer-row-photo' : 'explorer-row-poster'}>
    {path ? <img loading="lazy" src={`https://image.tmdb.org/t/p/w92${path}`} alt="" /> : <User size={20} aria-hidden="true" />}
  </span>;
}
function ResultAction({ item, model }: { item: TMDBMedia; model: DiscoverViewModel }) {
  const [pending, setPending] = useState(false);
  const { showToast } = useToastStore();
  const added = model.shows.some(show => searchMediaKey(show.tmdbId, show.mediaType) === searchMediaKey(item.id, item.media_type));
  return <button type="button" className="explorer-row-action" disabled={pending} onPointerDown={event => event.preventDefault()} aria-pressed={added}
    aria-label={`${added ? 'Retirer' : 'Ajouter'} ${item.title || item.name} ${added ? 'd’À voir' : 'à À voir'}`}
    onClick={async () => { setPending(true); try { await model.handleAddMedia(item); } catch { showToast('Impossible de modifier À voir. Réessaie.', 'error'); } finally { setPending(false); } }}>
    {added ? <Check size={20} /> : <Plus size={20} />}
  </button>;
}

export function DiscoverSearchResults({ model, characters = [], charactersLoading = false, charactersPartial = false, onCharacterClick }: { model: DiscoverViewModel; characters?: CharacterRecord[]; charactersLoading?: boolean; charactersPartial?: boolean; onCharacterClick?: (character: CharacterRecord) => void }) {
  const { query, debouncedQuery, shows, uniqueProcessedResults, loading, onShowClick, openPersonModal } = model;
  const library = useMemo(() => searchLibrary(shows, query), [shows, query]);
  const libraryKeys = useMemo(() => new Set(library.map(show => searchMediaKey(show.tmdbId, show.mediaType))), [library]);
  const current = query.trim() === debouncedQuery.trim();
  const remote = current ? uniqueProcessedResults.filter(item => !libraryKeys.has(searchMediaKey(item.id, item.media_type))) : [];
  const media = remote.filter(item => item.media_type !== 'person');
  const people = remote.filter(item => item.media_type === 'person');
  const pending = loading || !current;
  return <div className="explorer-results" aria-label="Résultats de recherche">
    {library.length > 0 && <section aria-label="Dans ta bibliothèque">
      <h2>Dans ta bibliothèque</h2>
      {library.map(show => <button key={show.id} type="button" className="explorer-result-row" onClick={() => onShowClick(show.tmdbId, show.mediaType)}>
        <Thumbnail path={show.posterPath} /><span className="explorer-row-text"><strong><Highlight title={show.title} query={query} /></strong>
          <small>{show.mediaType === 'movie' ? 'Film' : 'Série'}{show.firstAirDate ? ` · ${show.firstAirDate.slice(0, 4)}` : ''}
            {show.mediaType !== 'movie' && show.totalEpisodes ? ` · ${show.seenEpisodes.length}/${show.totalEpisodes}` : ''}</small></span>
        <span className="explorer-row-status">{librarySearchStatus(show)}</span>
      </button>)}
    </section>}
    {(characters.length > 0 || charactersLoading) && <section aria-label="Personnages"><h2>Personnages {charactersLoading ? <small>recherche…</small> : charactersPartial ? <small>liste incomplète, nouvel essai bientôt</small> : null}</h2>
      {characters.map(character => <button type="button" className="explorer-result-row" key={character.id} onClick={() => onCharacterClick?.(character)}>
        <span className="explorer-row-photo explorer-character-avatar">{characterInitials(character.name)}</span><span className="explorer-row-text"><strong><Highlight title={character.name} query={query} /></strong><small>{character.universe}{character.actors[0] ? ' · ' + character.actors[0].name : ''}</small></span><ChevronRight size={18} className="text-zinc-500 shrink-0" />
      </button>)}
    </section>}
    {(pending || media.length > 0) && <section aria-label="Films et séries TMDB">
      <h2>Films et séries <span className="explorer-section-count">{media.length || ''}</span>{pending && <small>recherche…</small>}</h2>
      {pending ? <div role="status" aria-label="Recherche en cours" className="explorer-search-skeleton"><i /><i /></div> : media.map(item => {
        const title = item.title || item.name || '';
        return <div key={searchMediaKey(item.id, item.media_type)} className="explorer-result-row">
          <button type="button" className="explorer-row-main" onClick={() => onShowClick(item.id, item.media_type === 'movie' ? 'movie' : 'tv')}>
            <Thumbnail path={item.poster_path} /><span className="explorer-row-text"><strong><Highlight title={title} query={query} /></strong>
              <small>{item.media_type === 'movie' ? 'Film' : 'Série'}{(item.release_date || item.first_air_date) ? ` · ${(item.release_date || item.first_air_date).slice(0, 4)}` : ''}{item.vote_average > 0 ? ` · ★ ${item.vote_average.toFixed(1)}` : ''}</small></span>
          </button><ResultAction item={item} model={model} />
        </div>;
      })}
    </section>}
    {people.length > 0 && <section aria-label="Personnes"><h2>Personnes <span className="explorer-section-count">{people.length}</span></h2>
      {people.map(person => <button type="button" key={person.id} className="explorer-result-row" onClick={() => openPersonModal(person.id)}>
        <Thumbnail path={person.profile_path} person /><span className="explorer-row-text"><strong><Highlight title={person.name || ''} query={query} /></strong><small>{person.known_for_department === 'Acting' ? 'Interprète' : person.known_for_department || 'Personne'}</small></span>
      </button>)}
    </section>}
    {!pending && !library.length && !remote.length && !characters.length && !charactersLoading && <p className="explorer-empty">Rien pour « {query} »</p>}
  </div>;
}
