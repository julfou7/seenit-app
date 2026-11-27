import React, { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Show } from '../../types';
import { comingBackCountdown, selectComingBack, type ComingBackItem } from '../../features/watchlist/comingBack';
import { imageUrl } from '../../features/watchlist/seriesCardPresentation';
import { EpisodeReminderBell } from '../EpisodeReminderBell';
import { SeenItRing } from '../SeenItLogo';
import './comingBack.css';

interface Props {
  shows: Show[];
  today: string;
  onOpen: (id: string, type?: 'tv' | 'movie') => void;
  onUpcoming?: () => void;
}

/** « Ça revient » : section de l'accueil entre « Continuer à regarder » et « Nouveautés », masquée si vide. */
export function ComingBackRail({ shows, today, onOpen, onUpcoming }: Props) {
  const items = useMemo(() => selectComingBack(shows, today), [shows, today]);
  if (!items.length) return null;
  return <section className="home-series-section coming-back" aria-labelledby="home-section-coming-back">
    <header className="home-section-heading">
      <h2 id="home-section-coming-back"><span className="home-section-name">Ça revient</span><span className="home-count">{items.length}</span></h2>
      {onUpcoming && <button type="button" className="coming-back__all" onClick={onUpcoming}>Tout À venir<ChevronRight size={16} strokeWidth={2.4} aria-hidden="true" /></button>}
    </header>
    <div className="home-series-rail coming-back__rail">
      {items.map(item => <ComingBackCard key={item.show.id} item={item} onOpen={onOpen} />)}
    </div>
  </section>;
}

function ComingBackCard({ item, onOpen }: { item: ComingBackItem; onOpen: Props['onOpen'] }) {
  const { show, kind, episode, days, label, reason, behind } = item;
  const countdown = comingBackCountdown(episode.air_date, days);
  const backdrop = imageUrl(show.backdropPath || show.posterPath, 'w780');
  return <div className={`coming-back__card coming-back__card--${kind}`} data-coming-back={kind} data-behind={behind || undefined}>
    {backdrop && <img className="coming-back__image" src={backdrop} alt="" loading="lazy" decoding="async" />}
    <span className="coming-back__shade" aria-hidden="true" />
    <button type="button" className="coming-back__open" onClick={() => onOpen(show.id, 'tv')} aria-label={`${show.title} · ${label} · ${countdown.headline}, ${countdown.detail} · ${reason}`} />
    <div className="coming-back__top">
      <span className="coming-back__chip">{label}</span>
      <EpisodeReminderBell show={show} episode={episode} subject={show.title} />
    </div>
    <div className="coming-back__body" aria-hidden="true">
      <p className={`coming-back__when${countdown.near ? ' is-near' : ''}`}><strong>{countdown.headline}</strong><span>{countdown.detail}</span></p>
      {countdown.near && <span className="coming-back__week">{Array.from({ length: 7 }, (_, index) => <span key={index} data-elapsed={index < countdown.elapsed || undefined} />)}</span>}
      <h3 className="coming-back__title">{show.title}</h3>
      <span className={`coming-back__reason${behind ? ' is-behind' : ''}`}>{kind !== 'premiere' && !behind && <SeenItRing size={15} />}{reason}</span>
    </div>
  </div>;
}
