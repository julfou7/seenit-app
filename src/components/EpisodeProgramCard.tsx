import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { notifyArrWrite } from '../store/arrSyncStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { episodePresenceKey } from '../features/downloads/episodePresenceKey';
import type { MediaPresenceData } from '../store/mediaPresenceStore';

/**
 * Retour terrain du 08/11 : « il me faut pouvoir programmer un téléchargement d'épisode depuis la fiche détail
 * d'épisode ». Sur un épisode à venir d'une série, sous le réglage Téléchargements : 1080p ou 4K programme
 * l'épisode dans Sonarr (même écriture que le mode téléchargement de la fiche série : cet épisode seul, la
 * saison n'est plus surveillée en bloc) ; une fois programmé, « Annuler » retire seulement sa surveillance.
 * Chaque action resynchronise l'état Sonarr/Radarr partagé et la fiche (SEENIT-DOWNLOAD-016).
 */
export function EpisodeProgramCard({ title, tmdbId, tvdbId, imdbId, season, episode, presence, posterPath = null }: { title: string; tmdbId?: number | string; tvdbId?: number | string; imdbId?: string; season: number; episode: number; presence: MediaPresenceData; posterPath?: string | null }) {
  const available = useDownloadConfigStore(state => isDownloadFeatureEnabled(state) && Boolean(state.sonarrUrl && state.sonarrApiKey));
  const [pending, setPending] = useState<string | null>(null);
  const key = episodePresenceKey(season, episode);
  if (!available || !tmdbId || presence.episodesHasFile?.[key]) return null;
  const programmed = presence.episodesMonitored?.[key] === true;
  const code = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
  const toast = useToastStore.getState().showToast;
  const readConfig = () => useDownloadConfigStore.getState();
  const program = async (quality: '1080p' | '4k') => {
    if (pending) return;
    setPending(quality);
    try {
      const { programArrEpisodes } = await import('../features/downloads/episodeProgramming');
      const outcome = await programArrEpisodes({ title, tmdbId, tvdbId, imdbId, season, episodes: [episode], qualityPreference: quality, readConfig });
      if (outcome.interrupted) return;
      // Un seul toast par lancement (SEENIT-DOWNLOAD-015).
      if (outcome.programmed.length) toast({ title, subtitle: `S${season} | E${episode}`, posterPath, media: Number(tmdbId) > 0 ? { tmdbId: Number(tmdbId), mediaType: 'tv' } : null, action: `Programmé pour sa sortie · ${quality === '4k' ? '4K' : '1080p'}` }, 'success');
      else toast({ title, subtitle: `S${season} | E${episode}`, posterPath, media: Number(tmdbId) > 0 ? { tmdbId: Number(tmdbId), mediaType: 'tv' } : null, action: outcome.failure || 'Épisode pas encore annoncé dans Sonarr : réessaie plus tard.' }, outcome.failure ? 'error' : 'info');
      notifyArrWrite({ tmdbId, tvdbId, mediaType: 'tv' });
    } finally {
      setPending(null);
    }
  };
  const cancel = async () => {
    if (pending) return;
    setPending('cancel');
    try {
      const { unprogramArrEpisode } = await import('../features/downloads/episodeProgramming');
      const failure = await unprogramArrEpisode({ title, tmdbId, tvdbId, imdbId, season, episode, readConfig });
      toast({ title, subtitle: `S${season} | E${episode}`, posterPath, media: Number(tmdbId) > 0 ? { tmdbId: Number(tmdbId), mediaType: 'tv' } : null, action: failure || 'N’est plus programmé.' }, failure ? 'error' : 'info');
      notifyArrWrite({ tmdbId, tvdbId, mediaType: 'tv' });
    } finally {
      setPending(null);
    }
  };
  return <section data-episode-program={code} aria-busy={pending !== null || undefined} className="rounded-2xl p-3 bg-[#0B1A21] shadow-[inset_0_0_0_1px_rgba(125,211,252,0.35)] flex flex-col gap-2">
    <p className="flex items-center gap-2 text-[13.5px] font-bold text-sky-300"><Clock3 size={16} aria-hidden="true" />{programmed ? 'Programmé · téléchargé à sa sortie' : 'Télécharger à la sortie'}</p>
    {programmed
      ? <button type="button" disabled={pending !== null} onClick={() => void cancel()} className="min-h-11 rounded-xl text-[13.5px] font-bold text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]">{pending === 'cancel' ? 'Annulation…' : 'Annuler la programmation'}</button>
      : <div className="flex gap-2" role="group" aria-label={`Programmer ${code}`}>
        {(['1080p', '4k'] as const).map(quality => <button key={quality} type="button" disabled={pending !== null} onClick={() => void program(quality)} className="flex-1 min-h-11 rounded-xl bg-[#0B2531] text-sky-300 text-[14px] font-extrabold shadow-[inset_0_0_0_1.5px_rgba(125,211,252,0.7)]">{pending === quality ? 'Programmation…' : quality === '4k' ? '4K' : '1080p'}</button>)}
      </div>}
  </section>;
}
