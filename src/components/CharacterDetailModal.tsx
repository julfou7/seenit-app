import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import { characterProgress, characterTotalLabel, characterWorkProgress, performerWorkSummary, performerWorkTitles, type CharacterRecord, type CharacterWork } from '../features/discover/characters';
import { POSTER_HUE_FALLBACK, readPosterHue } from '../features/watchlist/posterHue';
import { SeenItCheckButton } from './SeenItCheckButton';
import './historyEntryRow.css';
import { authenticatedFetch } from '../lib/apiAuth';
import { auth } from '../lib/firebase';
import { readUserScopedJson, subscribeUserScopedStorageField, writeUserScopedJson } from '../lib/userIsolation';
import type { Show } from '../types';

interface Props {
 character: CharacterRecord; shows: Show[]; onClose: () => void;
 onPersonClick: (id: number) => void;
 onShowClick: (id: number, type: 'tv' | 'movie', season?: number, episode?: number) => void;
 onCharacterClick: (character: CharacterRecord) => void;
}
export const characterInitials = (name: string) => name.split(/\s+/).map(word => word[0]).slice(0,2).join('').toUpperCase();
const episodeCode = (key: string) => { const [season,episode]=key.split('x');return 'S'+String(season).padStart(2,'0')+' | E'+String(episode).padStart(2,'0'); };
function workRange(work: CharacterWork) {
 if(work.type==='movie')return work.runtime ? 'Film · '+Math.floor(work.runtime/60)+' h '+String(work.runtime%60).padStart(2,'0') : 'Film';
 const episodes=work.episodes||[];
 if(!work.complete || !episodes.length)return '';
 if(episodes.length<=3)return episodes.map(episode=>episodeCode(episode.key)).join(' · ');
 return episodeCode(episodes[0].key)+' → '+episodeCode(episodes.at(-1)!.key);
}
export function CharacterDetailModal({ character, shows, onClose, onPersonClick, onShowClick, onCharacterClick }: Props) {
 const [detail, setDetail] = useState(character);
 const [loading, setLoading] = useState(true);
 const [failed, setFailed] = useState(false);
 const uid = auth.currentUser?.uid || '';
 const subscribe = useCallback((listener: () => void) => subscribeUserScopedStorageField(uid, 'favorite-characters', listener), [uid]);
 const snapshot = useCallback(() => JSON.stringify(readUserScopedJson<string[]>(uid, 'favorite-characters', [])), [uid]);
 const storedFavorites: unknown = JSON.parse(useSyncExternalStore(subscribe, snapshot, () => '[]'));
 const favorites = Array.isArray(storedFavorites) ? storedFavorites.filter((id): id is string => typeof id === 'string').slice(0,500) : [];
 useEffect(() => {
  const controller = new AbortController();
  setDetail(character); setLoading(true); setFailed(false);
  void authenticatedFetch('/api/media/characters/detail?seed=' + encodeURIComponent(character.seed) + '&name=' + encodeURIComponent(character.name), { signal: controller.signal })
   .then(async response => { if (!response.ok) throw Error('unavailable'); return await response.json() as { character: CharacterRecord }; })
   .then(result => { if (!controller.signal.aborted && result.character.id === character.id) setDetail(result.character); })
   .catch(() => { if (!controller.signal.aborted) setFailed(true); })
   .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  return () => controller.abort();
 }, [character.id, character.seed, character.name]);
 const progress = characterProgress(detail, shows);
 const filmOnly=detail.works.length>0&&detail.works.every(work=>work.type==='movie');
 const credited = detail.works.every(work => work.creditCount !== null) ? detail.works.reduce((sum,work) => sum + (work.creditCount || 0),0) : null;
 const mainPoster=detail.works[0]?.poster;
 return <DialogLayer label={'Personnage : ' + detail.name} onDismiss={onClose} historyMode="external" blocking={false} className="character-overlay" data-media-layer="">
  <article className="character-sheet">
   <div className="character-hero">
    {mainPoster&&<img className="character-hero-image" src={'https://image.tmdb.org/t/p/w500'+mainPoster} alt="" />}
    <header><button type="button" aria-label="Retour depuis la fiche personnage" onClick={onClose}><ChevronLeft size={22} /></button>
     <button type="button" disabled={!uid} aria-label={favorites.includes(detail.id) ? 'Ne plus suivre ce personnage' : 'Suivre ce personnage'} aria-pressed={favorites.includes(detail.id)}
      onClick={() => writeUserScopedJson(uid,'favorite-characters', favorites.includes(detail.id) ? favorites.filter(id => id !== detail.id) : [...favorites,detail.id])}><Heart size={20} fill={favorites.includes(detail.id) ? 'currentColor' : 'none'} /></button>
    </header>
    {/* Retour terrain du 21/11 : la photo de l'interprète principal (et des suivants en médaillons) remplace les initiales. */}
    <div className="character-identity"><span className="character-avatar" data-photo={Boolean(detail.actors[0]?.photo)}>{detail.actors[0]?.photo ? <img src={'https://image.tmdb.org/t/p/w185'+detail.actors[0].photo} alt="" /> : characterInitials(detail.name)}
     {detail.actors.slice(1,3).filter(actor => actor.photo).map((actor,index) => <img key={actor.id} className="character-avatar-extra" style={{ '--extra-index': index } as CSSProperties} src={'https://image.tmdb.org/t/p/w92'+actor.photo} alt="" />)}</span><div>
     <p>{detail.universe ? 'Personnage · univers ' + detail.universe : 'Personnage'}</p><h1>{detail.name}</h1>
     {detail.aliases.filter(alias => alias !== detail.name).length > 0 && <small>alias {detail.aliases.filter(alias => alias !== detail.name).join(' · ')}</small>}
    </div></div>
   </div>
   {/* #398 : tous les interprètes crédités, chacun avec ses œuvres exactes ; jamais fusionnés sur un nom. */}
   {detail.actors.length > 1 && <h2>Joué par {detail.actors.length} interprètes</h2>}
   <div className="character-actors">{detail.actors.map(actor => { const titles = performerWorkTitles(actor, detail.works); const summary = performerWorkSummary(actor, detail.works); return <button type="button" key={actor.id} aria-label={'Joué par ' + actor.name + (titles ? ' dans ' + titles : '')} onClick={() => onPersonClick(actor.id)}>
    <span>{actor.photo ? <img src={'https://image.tmdb.org/t/p/w92'+actor.photo} alt="" /> : characterInitials(actor.name)}</span>
    <div><strong>{actor.name}</strong><small>{detail.actors.length > 1 ? summary || 'Interprète' : 'Joué par'}</small></div><ChevronRight size={18} />
   </button>; })}</div>
   <div className="character-stats" aria-busy={loading}>
    <div><strong>{progress.complete ? progress.total : credited ?? '—'}</strong><small>{characterTotalLabel(detail.works, progress.complete)}</small></div>
    <div><strong>{progress.from ? progress.from === progress.to ? progress.from : progress.from + '→' + progress.to?.slice(-2) : '—'}</strong><small>{progress.from && progress.to ? Math.max(1,Number(progress.to)-Number(progress.from))+' an'+(Number(progress.to)-Number(progress.from)>1?'s':'') : 'période'}</small></div>
    {/* #872 : apparitions pas toutes vérifiées → au moins les épisodes et films vus déjà prouvés (« ≥ N »). */}
    <div className="is-gold"><strong>{progress.complete ? progress.seen+'/'+progress.total : progress.seen > 0 ? '≥ '+progress.seen : '—'}</strong><small>vus par toi</small></div>
   </div>
   {loading && <p role="status" className="character-status">Vérification des apparitions…</p>}
   {!loading && (failed || !progress.complete) && <p className="character-status">Détail partiellement disponible. La progression sera affichée une fois les épisodes vérifiés.</p>}
   <h2>Son parcours</h2>
   {/* Retour terrain du 21/11 : le parcours reprend les cartes de l'Historique (affiche, titre or, ligne grise, Vu à droite). */}
   <div className="history-entry-list character-parcours">{detail.works.map(work => {
    const watched = characterWorkProgress(work,shows);
    const episode = watched.next?.key.split('x').map(Number);
    const canResume = watched.complete && watched.next && watched.show && work.type === 'tv';
    const movieSeen=Boolean(watched.show?.seenEpisodes.includes('movie')||watched.show?.status==='completed');
    const status=work.type==='movie' ? movieSeen?'Vu':work.cinema?watched.show?.notificationsEnabled?'Rappel activé':'Au cinéma · rappel possible':watched.show?'Dans À voir':'À voir'
      : watched.complete && watched.total>0 && watched.seen===watched.total?'Vu en entier'
      : watched.complete && watched.next ? watched.seen>0?watched.seen+'/'+watched.total+' · reprendre '+episodeCode(watched.next.key):'Pas encore vu · '+episodeCode(watched.next.key)
      : 'Voir la fiche';
    const seen = status==='Vu'||status==='Vu en entier';
    const year = work.releaseDate?.slice(0,4);
    const open = () => onShowClick(work.id,work.type,canResume ? episode?.[0] : undefined,canResume ? episode?.[1] : undefined);
    const meta = work.type==='movie' ? workRange(work) : [watched.complete ? watched.total+' ép.' : work.creditCount!==null ? work.creditCount+' ép.' : 'Série', workRange(work)].filter(Boolean).join(' · ');
    return <div className="history-entry-host" key={work.key}><article className="history-entry character-work" data-seen={seen} style={{ '--history-hue': readPosterHue(work.poster ? 'https://image.tmdb.org/t/p/w300'+work.poster : null) ?? POSTER_HUE_FALLBACK } as CSSProperties}>
     <button type="button" className="history-entry__open" aria-label={work.title+' · '+status} onClick={open} />
     <div className="history-entry__image" aria-hidden="true"><span>{characterInitials(work.title)}</span>{work.poster && <img src={'https://image.tmdb.org/t/p/w300'+work.poster} alt="" loading="lazy" />}</div>
     <div className="history-entry__text"><h3>{work.title}</h3><div>{year && <strong>{year}</strong>}{year && meta && <span> · </span>}{meta}</div>
      {watched.complete && watched.total > 1 && !seen ? <div className="character-progress"><i style={{width: (watched.seen / watched.total * 100)+'%'}} /></div> : loading && !watched.complete && <div className="character-progress character-loading" aria-hidden="true" />}
      <p className={seen ? 'is-gold' : ''}>{status}</p>
     </div>
     {seen && <div className="history-entry__action-column"><SeenItCheckButton isWatched title={work.title+' · vu'} onClick={open} /></div>}
    </article></div>;
   })}</div>
   {Boolean(detail.complete && detail.neighbors?.length) && <><h2>Il croise le plus</h2><div className="character-neighbors">{detail.neighbors!.map(neighbor =>
    <button type="button" key={neighbor.id} disabled={neighbor.available===false} aria-label={neighbor.name+' · '+neighbor.count+' crédits communs'} data-available={neighbor.available!==false}
     onClick={() => onCharacterClick({ ...character, id: neighbor.id, name: neighbor.name, aliases: [neighbor.name], seed: neighbor.seed, actors: [], works: [] })}>
     <span>{characterInitials(neighbor.name)}</span><strong>{neighbor.name}</strong><small>{detail.complete ? '' : '≥ '}{neighbor.count} {filmOnly?'films':'ép.'}</small>
    </button>)}</div></>}
  </article>
 </DialogLayer>;
}
