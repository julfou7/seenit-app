import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import { characterProgress, characterWorkProgress, type CharacterRecord, type CharacterWork } from '../features/discover/characters';
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
 if(work.type==='movie')return work.runtime ? 'Film · '+Math.floor(work.runtime/60)+' h '+String(work.runtime%60).padStart(2,'0') : work.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(work.releaseDate) ? 'Film · '+new Date(work.releaseDate+'T12:00:00').toLocaleDateString('fr-FR') : 'Film';
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
 return <DialogLayer label={'Personnage : ' + detail.name} onDismiss={onClose} historyMode="external" blocking={false} className="character-overlay">
  <article className="character-sheet">
   <div className="character-hero">
    {mainPoster&&<img className="character-hero-image" src={'https://image.tmdb.org/t/p/w500'+mainPoster} alt="" />}
    <header><button type="button" aria-label="Retour depuis la fiche personnage" onClick={onClose}><ChevronLeft size={22} /></button>
     <button type="button" disabled={!uid} aria-label={favorites.includes(detail.id) ? 'Ne plus suivre ce personnage' : 'Suivre ce personnage'} aria-pressed={favorites.includes(detail.id)}
      onClick={() => writeUserScopedJson(uid,'favorite-characters', favorites.includes(detail.id) ? favorites.filter(id => id !== detail.id) : [...favorites,detail.id])}><Heart size={20} fill={favorites.includes(detail.id) ? 'currentColor' : 'none'} /></button>
    </header>
    <div className="character-identity"><span className="character-avatar">{characterInitials(detail.name)}</span><div>
     <p>Personnage · univers {detail.universe}</p><h1>{detail.name}</h1>
     {detail.aliases.filter(alias => alias !== detail.name).length > 0 && <small>alias {detail.aliases.filter(alias => alias !== detail.name).join(' · ')}</small>}
    </div></div>
   </div>
   <div className="character-actors">{detail.actors.slice(0,1).map(actor => <button type="button" key={actor.id} aria-label={'Joué par ' + actor.name} onClick={() => onPersonClick(actor.id)}>
    <span>{actor.photo ? <img src={'https://image.tmdb.org/t/p/w92'+actor.photo} alt="" /> : characterInitials(actor.name)}</span>
    <div><small>Joué par</small><strong>{actor.name}</strong></div><ChevronRight size={18} />
   </button>)}</div>
   <div className="character-stats" aria-busy={loading}>
    <div><strong>{progress.complete ? progress.total : credited ?? '—'}</strong><small>{filmOnly ? 'films' : progress.complete ? 'épisodes' : 'ép. crédités'}</small></div>
    <div><strong>{progress.from ? progress.from === progress.to ? progress.from : progress.from + '→' + progress.to?.slice(-2) : '—'}</strong><small>{progress.from && progress.to ? Math.max(1,Number(progress.to)-Number(progress.from))+' an'+(Number(progress.to)-Number(progress.from)>1?'s':'') : 'période'}</small></div>
    <div className="is-gold"><strong>{progress.complete ? progress.seen+'/'+progress.total : '—'}</strong><small>vus par toi</small></div>
   </div>
   {loading && <p role="status" className="character-status">Vérification des apparitions…</p>}
   {!loading && (failed || !progress.complete) && <p className="character-status">Détail partiellement disponible. La progression sera affichée une fois les épisodes vérifiés.</p>}
   <h2>Son parcours</h2>
   <div className="character-works">{detail.works.map(work => {
    const watched = characterWorkProgress(work,shows);
    const episode = watched.next?.key.split('x').map(Number);
    const canResume = watched.complete && watched.next && watched.show && work.type === 'tv';
    const movieSeen=Boolean(watched.show?.seenEpisodes.includes('movie')||watched.show?.status==='completed');
    const status=work.type==='movie' ? movieSeen?'Vu':work.cinema?watched.show?.notificationsEnabled?'Rappel activé':'Au cinéma · rappel possible':watched.show?'Dans À voir':'À voir'
      : watched.complete && watched.total>0 && watched.seen===watched.total?'Vu en entier'
      : watched.complete && watched.next ? watched.seen>0?watched.seen+'/'+watched.total+' · reprendre '+episodeCode(watched.next.key):'Pas encore vu · '+episodeCode(watched.next.key)
      : 'Voir la fiche';
    return <button type="button" key={work.key} aria-label={work.title+' · '+status} onClick={() => onShowClick(work.id,work.type,canResume ? episode?.[0] : undefined,canResume ? episode?.[1] : undefined)}>
     {work.poster ? <img src={'https://image.tmdb.org/t/p/w154'+work.poster} alt="" /> : <span className="character-work-poster" />}
     <div><div className="character-work-title"><strong>{work.title}</strong><small>{work.type==='movie'?work.releaseDate?.slice(0,4):watched.complete?watched.total+' ép.':work.creditCount!==null?work.creditCount+' ép.':''}</small></div>
      <small>{workRange(work)}</small>
      {watched.complete && watched.total > 0 ? <div className="character-progress"><i style={{width: (watched.seen / watched.total * 100)+'%'}} /></div>:loading&&<div className="character-progress character-loading" aria-hidden="true" />}
      <em className={status==='Vu'||status==='Vu en entier'?'is-gold':''}>{status}</em>
     </div>
    </button>;
   })}</div>
   {Boolean(detail.complete && detail.neighbors?.length) && <><h2>Il croise le plus</h2><div className="character-neighbors">{detail.neighbors!.map(neighbor =>
    <button type="button" key={neighbor.id} disabled={neighbor.available===false} aria-label={neighbor.name+' · '+neighbor.count+' crédits communs'} data-available={neighbor.available!==false}
     onClick={() => onCharacterClick({ ...character, id: neighbor.id, name: neighbor.name, aliases: [neighbor.name], seed: neighbor.seed, actors: [], works: [] })}>
     <span>{characterInitials(neighbor.name)}</span><strong>{neighbor.name}</strong><small>{detail.complete ? '' : '≥ '}{neighbor.count} {filmOnly?'films':'ép.'}</small>
    </button>)}</div></>}
  </article>
 </DialogLayer>;
}
