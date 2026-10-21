import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SeriesEpisodeCard } from '../../src/components/cards/SeriesEpisodeCard';
import type { Show } from '../../src/types';

const telemetry = { opens: 0, episodes: 0, marks: 0, reminders: 0, unseen: 0 };
Object.assign(window, { __series8f: telemetry });
const base: Show = {
  id: 'series-8f', userId: 'fixture', tmdbId: 66732, title: 'Stranger Things', mediaType: 'tv',
  posterPath: 'http://127.0.0.1:4173/__8f-poster.svg', backdropPath: 'http://127.0.0.1:4173/__8f-backdrop.svg',
  status: 'watching', isArchived: false, createdAt: 1, updatedAt: 1,
  seenEpisodes: ['5x1', '5x2', '5x3'], episodeRecords: {},
  nextEpisodeToWatch: { season_number: 5, episode_number: 4, episode_count: 8, aired_episodes_in_season: 8, name: 'Sorcerer' },
};
const provider = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><rect width="26" height="26" fill="#090909"/><text x="13" y="20" text-anchor="middle" font-size="23" font-weight="900" fill="#e50914">N</text></svg>');
const open = () => { telemetry.opens++; };
const episode = () => { telemetry.episodes++; };
function Harness() {
  const [marked, setMarked] = useState(false);
  const [reminder, setReminder] = useState(false);
  const [pending, setPending] = useState(false);
  const show = marked ? { ...base, seenEpisodes: [...base.seenEpisodes, '5x4'] } : base;
  const next = { ...base.nextEpisodeToWatch!, episode_number: marked ? 5 : 4 };
  return <main style={{ padding: '20px 16px', maxWidth: 452, margin: 'auto' }}>
    <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>Cartes séries · 8f</h1>
    <section id="watch" className="series-8f-host"><SeriesEpisodeCard show={show} episode={next} detail="5 restants" providerLogo={provider} providerName="Netflix" onOpen={open} onOpenEpisode={episode}
      context={{ kind: 'watch', onMarkSeen: async () => { telemetry.marks++; await new Promise(resolve => setTimeout(resolve, 180)); setMarked(true); } }} /></section>
    <section id="long" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Le Seigneur des Anneaux : Les Anneaux de Pouvoir', posterPath: null, backdropPath: null }} episode={{ ...next, name: 'Un très long titre d’épisode sur deux lignes' }} detail="5 restants" onOpen={open} context={{ kind: 'watch', onMarkSeen: () => {} }} /></section>
    {[0, 5, 31].map(days => <section key={days} id={`upcoming-${days}`} className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: days === 0 ? 'The Boys' : days === 5 ? 'The Last of Us' : 'Dark' }} episode={next} detail={days === 0 ? 'ce soir' : `dans ${days} jours`} onOpen={open} providerLogo={provider} providerName="Netflix"
      context={{ kind: 'upcoming', days, reminder, pending, onToggleReminder: async () => { telemetry.reminders++; setPending(true); await new Promise(resolve => setTimeout(resolve, 120)); setReminder(value => !value); setPending(false); } }} /></section>)}
    <section id="history" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Breaking Bad' }} episode={{ ...next, episode_number: 3, name: 'Le crime paie' }} detail="lundi 15 juin" providerLogo={provider} providerName="Netflix" onOpen={episode} onOpenSeries={open} onOpenEpisode={episode} context={{ kind: 'history', watchedAt: new Date(2026, 5, 15, 22, 7).getTime(), onUnseen: () => { telemetry.unseen++; } }} /></section>
    <section id="season-24" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Saison de 24 épisodes' }} episode={{ ...next, episode_count: 24 }} onOpen={open} context={{ kind: 'watch', upToDate: true }} /></section>
    <section id="season-40" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Saison de 40 épisodes', posterPath: 'http://127.0.0.1:4173/__8f-absent.jpg' }} episode={{ ...next, episode_count: 40 }} onOpen={open} context={{ kind: 'watch', onMarkSeen: () => {} }} /></section>
    <section id="unknown" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Métadonnées absentes', posterPath: null, backdropPath: null, nextEpisodeToWatch: null, nextEpisodeToAir: null }} episode={{ season_number: 1, episode_number: 1 }} onOpen={open} context={{ kind: 'watch', upToDate: true }} /></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
