import React from 'react';
import { createRoot } from 'react-dom/client';
import { DownloadsScreen } from '../../src/screens/DownloadsScreenCore';
import { SeasonPanel } from '../../src/screens/mediaDetail/seriesSections';
import { DownloadModal } from '../../src/components/DownloadModal';
import { telemetry } from './downloadsRuntime';

const root = createRoot(document.getElementById('root')!);
const mount = (page = 'downloads') => root.render(page === 'modal' || page === 'movie-modal'
  ? <DownloadModal isOpen title="L'Arène et un titre de série particulièrement long" mediaType={page === 'modal' ? 'tv' : 'movie'} tmdbId={99} initialSeason={1} initialEpisode={1} seasonsData={[{ season_number: 1, episode_count: 10 }]} onClose={() => mount()} />
  : page === 'downloads'
  ? <div className="h-[100dvh] max-w-md mx-auto flex flex-col"><DownloadsScreen onShowClick={id => telemetry.opened.push(String(id))} /></div>
  : <EpisodesFixture mode={page === 'episodes'} />);

// #879 : la saison en mode téléchargement (sélection) ou en mode normal (pastilles passives seulement).
function EpisodesFixture({ mode }: { mode: boolean }) {
  const [picked, setPicked] = React.useState(() => new Set<number>([1]));
  return <div className="max-w-md mx-auto p-4"><SeasonPanel season={{ season_number: 2, episode_count: 4 }} episodes={[1, 2, 3, 4].map(episode_number => ({ episode_number, name: episode_number === 1 ? 'Un titre particulièrement long qui doit disposer de deux lignes' : `Épisode ${episode_number}`, air_date: '2020-01-01', still_path: '/fixture.jpg', runtime: 52 }))} show={null} nextKey="2x1" runtimeFallback={52} onToggleSeason={() => {}} onToggleEpisode={() => {}} onOpenEpisode={episode => telemetry.opened.push(`episode:${episode.episode_number}`)}
    downloadMode={{ active: mode, picked, onToggle: episode => { telemetry.requested.push(episode); setPicked(previous => { const next = new Set(previous); if (next.has(episode)) next.delete(episode); else next.add(episode); return next; }); } }}
    episodesHasFile={{ '2x3': true }} getEpisodeDownload={episode => episode === 2 ? { id: 'active', mediaType: 'tv', title: 'Série', status: 'downloading', statusText: 'En cours', progress: 30, size: 0, sizeleft: 0 } : null} /></div>;
}
Object.assign(window, { __downloads: { mount, telemetry } });
mount();
