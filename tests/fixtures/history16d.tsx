import React from 'react';
import { createRoot } from 'react-dom/client';
import { HistoryFeed } from '../../src/components/HistoryFeed';
import { useToastStore } from '../../src/store/toastStore';
import { telemetry, makeRecordlessHistory, makeGroupedHistory } from './history16dRuntime';

Object.assign(window, { __history16d: Object.assign(telemetry, { makeLegacy: makeRecordlessHistory, grouped:makeGroupedHistory }) });
window.open = (url?: string | URL) => { telemetry.playback.push(String(url)); return window; };
function Harness() {
  const undo = useToastStore(state => state.onUndo);
  return <main style={{ maxWidth: 620, margin: 'auto', padding: 16 }}>
    <h1>Historique</h1>
    <button id="history-undo" style={{ minHeight: 44, padding: 10 }} disabled={!undo} onClick={async () => { await undo?.(); useToastStore.getState().clearQueue(); }}>Annuler la dernière action</button>
    <HistoryFeed onShowClick={(id, type) => telemetry.movieOpens.push(`${type}:${id}`)} onEpisodeClick={(id, season, episode) => telemetry.episodeOpens.push(`${id}:${season}x${episode}`)} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
