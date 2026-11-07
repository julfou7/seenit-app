import React from 'react';
import { createRoot } from 'react-dom/client';
import { DownloadsScreen } from '../../src/screens/DownloadsScreenCore';
import { SeasonPanel } from '../../src/screens/mediaDetail/seriesSections';
import { DownloadModeBanner, DownloadModeBar } from '../../src/screens/mediaDetail/downloadMode';
import { DownloadModal } from '../../src/components/DownloadModal';
import PreciseVersionPage from '../../src/screens/mediaDetail/PreciseVersionPage';
import { telemetry } from './downloadsRuntime';

const root = createRoot(document.getElementById('root')!);
let mounts = 0;
const mount = (page = 'downloads') => { telemetry.c411Results = page === 'precise'; mounts += 1; mountPage(page); };
const mountPage = (page: string) => root.render(page === 'modal' || page === 'movie-modal'
  ? <DownloadModal isOpen title="L'Arène et un titre de série particulièrement long" mediaType={page === 'modal' ? 'tv' : 'movie'} tmdbId={99} initialSeason={1} initialEpisode={1} seasonsData={[{ season_number: 1, episode_count: 10 }]} onClose={() => mount()} />
  : page === 'downloads'
  ? <div className="h-[100dvh] max-w-md mx-auto flex flex-col"><DownloadsScreen onShowClick={id => telemetry.opened.push(String(id))} /></div>
  : page === 'banner-long'
  ? <div className="max-w-md mx-auto p-4"><DownloadModeBanner season={1} states={Array.from({ length: 24 }, (_, index) => ({ episode: index + 1, state: index < 5 ? 'seen' as const : 'available' as const }))} progress={() => undefined} picked={new Set([6])} allPicked={false} canPick onToggleAll={() => {}} onSegment={episode => telemetry.requested.push(episode)} /></div>
  : page === 'precise' || page === 'precise-error'
  ? <PreciseVersionPage key={`${page}-${mounts}`} target={{ title: "L'Arène", tmdbId: 99, season: 1, episode: 3 }} onClose={() => telemetry.opened.push('precise:close')} />
  : page === 'program' || page === 'program-normal'
  ? <ProgramFixture mode={page === 'program'} />
  : <EpisodesFixture mode={page === 'episodes'} />);

// #879 : épisodes à venir — 5 programmable (coché en bleu), 6 déjà surveillé par Sonarr (« Programmé »).
function ProgramFixture({ mode }: { mode: boolean }) {
  const [picked, setPicked] = React.useState(() => new Set<number>());
  const toggle = (episode: number) => { telemetry.requested.push(episode); setPicked(previous => { const next = new Set(previous); if (next.has(episode)) next.delete(episode); else next.add(episode); return next; }); };
  const states = [{ episode: 4, state: 'available' as const }, { episode: 5, state: 'future' as const }, { episode: 6, state: 'programmed' as const }];
  return <div className="max-w-md mx-auto p-4 flex flex-col gap-3">
    {mode && <DownloadModeBanner season={2} states={states} progress={() => undefined} picked={picked} allPicked={false} canPick onToggleAll={() => {}} onSegment={episode => { if (episode !== 6) toggle(episode); }} />}
    <SeasonPanel season={{ season_number: 2, episode_count: 3 }} episodes={[4, 5, 6].map(episode_number => ({ episode_number, name: `Épisode ${episode_number}`, air_date: episode_number === 4 ? '2020-01-01' : '2099-01-0' + episode_number, still_path: '/fixture.jpg', runtime: 52 }))} show={null} nextKey="2x4" runtimeFallback={52} onToggleSeason={() => {}} onToggleEpisode={() => {}} onOpenEpisode={episode => telemetry.opened.push(`episode:${episode.episode_number}`)}
    downloadMode={{ active: mode, picked, onToggle: toggle }} episodesMonitored={{ '2x6': true }} getEpisodeDownload={() => null} />
  </div>;
}

// #879 : la saison en mode téléchargement (sélection) ou en mode normal (pastilles passives seulement).
function EpisodesFixture({ mode }: { mode: boolean }) {
  const [picked, setPicked] = React.useState(() => new Set<number>([1]));
  const toggle = (episode: number) => { telemetry.requested.push(episode); setPicked(previous => { const next = new Set(previous); if (next.has(episode)) next.delete(episode); else next.add(episode); return next; }); };
  // Même calcul que la fiche : 1 et 4 disponibles, 2 en cours, 3 téléchargé.
  const states = [{ episode: 1, state: 'available' as const }, { episode: 2, state: 'active' as const }, { episode: 3, state: 'present' as const }, { episode: 4, state: 'available' as const }];
  return <div className="max-w-md mx-auto p-4 flex flex-col gap-3">
    {mode && <DownloadModeBanner season={2} states={states} progress={episode => episode === 2 ? 30 : undefined} picked={picked} allPicked={picked.has(1) && picked.has(4)} canPick onToggleAll={() => {}} onSegment={episode => { if (episode === 1 || episode === 4) toggle(episode); }} />}
    <SeasonPanel season={{ season_number: 2, episode_count: 4 }} episodes={[1, 2, 3, 4].map(episode_number => ({ episode_number, name: episode_number === 1 ? 'Un titre particulièrement long qui doit disposer de deux lignes' : `Épisode ${episode_number}`, air_date: '2020-01-01', still_path: '/fixture.jpg', runtime: 52 }))} show={null} nextKey="2x1" runtimeFallback={52} onToggleSeason={() => {}} onToggleEpisode={() => {}} onOpenEpisode={episode => telemetry.opened.push(`episode:${episode.episode_number}`)}
    downloadMode={{ active: mode, picked, onToggle: toggle }}
    episodesHasFile={{ '2x3': true }} getEpisodeDownload={episode => episode === 2 ? { id: 'active', mediaType: 'tv', title: 'Série', status: 'downloading', statusText: 'En cours', progress: 30, size: 0, sizeleft: 0 } : null} />
    {mode && <DownloadModeBar title={`${picked.size} épisodes`} detail="Touche une barre ou un épisode." enabled={picked.size > 0} onLaunch={() => {}} onPrecise={() => {}} onExit={() => telemetry.opened.push('exit')} />}
  </div>;
}
Object.assign(window, { __downloads: { mount, telemetry } });
mount();
