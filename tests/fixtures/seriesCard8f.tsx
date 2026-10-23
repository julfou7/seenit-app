import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SeriesEpisodeCard } from '../../src/components/cards/SeriesEpisodeCard';
import { buildSeasonProgressEvidence } from '../../src/features/shows/seasonProgressEvidence';
import type { Show } from '../../src/types';

let finishMark: (() => void) | null = null;
const telemetry = { opens: 0, episodes: 0, marks: 0, reminders: 0, unseen: 0, releaseMark: () => { finishMark?.(); finishMark = null; } };
Object.assign(window, { __series8f: telemetry });
const base: Show = {
  id: 'series-8f', userId: 'fixture', tmdbId: 66732, title: 'Stranger Things', mediaType: 'tv',
  posterPath: 'http://127.0.0.1:4173/__8f-poster.svg', backdropPath: 'http://127.0.0.1:4173/__8f-backdrop.svg',
  status: 'watching', isArchived: false, createdAt: 1, updatedAt: 1, seriesEnded: true, tmdbStatus: 'Ended',
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
  const harryEpisode = {
    season_number: 1, episode_number: 3, episode_count: 4, aired_episodes_in_season: 3,
    known_episodes_in_season: 4, season_total_unknown: true, last_season_number: 1,
    last_known_episode_type: 'standard', last_known_episode_air_date: null, name: 'Épisode 3',
  };
  const harry = {
    ...base, id: 'harry-potter', title: 'Harry Potter', seriesEnded: false, tmdbStatus: 'Returning Series',
    seenEpisodes: ['1x1', '1x2'], nextEpisodeToWatch: harryEpisode,
    seasonProgress: buildSeasonProgressEvidence([{ season_number: 1, episode_count: 4, episodes: [{ episode_number: 4, episode_type: 'standard' }] }], false),
    nextEpisodeToAir: { season_number: 1, episode_number: 4, episode_count: null, air_date: '2026-11-01' },
  } as Show;
  return <main style={{ padding: '20px 16px', maxWidth: 452, margin: 'auto' }}>
    <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 16 }}>Cartes séries · 8f</h1>
    <section id="watch" className="series-8f-host"><SeriesEpisodeCard show={show} episode={next} detail="5 restants" providerLogo={provider} providerName="Netflix" onOpen={open} onOpenEpisode={episode}
      context={{ kind: 'watch', onMarkSeen: async () => { telemetry.marks++; await new Promise<void>(resolve => { finishMark = resolve; }); setMarked(true); } }} /></section>
    <section id="long" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Le Seigneur des Anneaux : Les Anneaux de Pouvoir', posterPath: null, backdropPath: null }} episode={{ ...next, name: 'Un très long titre d’épisode sur deux lignes' }} detail="5 restants" onOpen={open} context={{ kind: 'watch', onMarkSeen: () => {} }} /></section>
    {[0, 5, 31, 132].map(days => <section key={days} id={`upcoming-${days}`} className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: days === 0 ? 'The Boys' : days === 5 ? 'The Last of Us' : 'Dark', posterPath: days === 31 ? null : base.posterPath }} episode={next} detail={days === 0 ? 'ce soir' : `dans ${days} jours`} onOpen={open} providerLogo={provider} providerName="Netflix"
      context={{ kind: 'upcoming', days, reminder, pending, onToggleReminder: async () => { telemetry.reminders++; setPending(true); await new Promise(resolve => setTimeout(resolve, 120)); setReminder(value => !value); setPending(false); } }} /></section>)}
    <section id="history" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Breaking Bad' }} episode={{ ...next, episode_number: 3, name: 'Le crime paie' }} detail="lundi 15 juin" providerLogo={provider} providerName="Netflix" onOpen={episode} onOpenSeries={open} onOpenEpisode={episode} context={{ kind: 'history', watchedAt: new Date(2026, 5, 15, 22, 7).getTime(), onUnseen: () => { telemetry.unseen++; } }} /></section>
    <section id="season-24" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Saison de 24 épisodes' }} episode={{ ...next, episode_count: 24 }} onOpen={open} context={{ kind: 'watch', upToDate: true }} /></section>
    <section id="season-40" className="series-8f-host"><SeriesEpisodeCard show={{ ...base, title: 'Saison de 40 épisodes', posterPath: 'http://127.0.0.1:4173/__8f-absent.jpg' }} episode={{ ...next, episode_count: 40 }} onOpen={open} context={{ kind: 'watch', onMarkSeen: () => {} }} /></section>
    <section id="unknown" className="series-8f-host"><SeriesEpisodeCard show={harry} episode={harryEpisode} onOpen={open} providerLogo={provider} providerName="Max" context={{ kind: 'watch' }} /></section>
    <section id="known-total" className="series-8f-host"><SeriesEpisodeCard show={{ ...harry, id: 'mobland', title: 'MobLand', seasonProgress: buildSeasonProgressEvidence([{ season_number: 1, episode_count: 10, episodes: [{ episode_number: 4 }] }], false) }} episode={{ ...harryEpisode, episode_count: 10 }} onOpen={open} context={{ kind: 'watch' }} /></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
