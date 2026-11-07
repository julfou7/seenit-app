import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Loader2, Search } from 'lucide-react';
import { DialogLayer } from '../../components/ui/DialogLayer';
import { type C411Torrent, searchC411Torrents } from '../../services/c411';
import { useDownloadConfigStore } from '../../store/downloadConfigStore';
import { useToastStore } from '../../store/toastStore';
import { isDownloadFeatureEnabled } from '../../features/downloads/downloadFeatureVisibility';
import { sendReleaseToClient } from '../../features/downloads/releaseSend';
import { describeReleases, matchesVersionFilter, releaseAgeLabel, type VersionFilter } from '../../features/downloads/releaseVersions';
import { ReleaseVersionCard, VersionFilterChips } from '../../components/ReleaseVersionCard';

export interface PreciseVersionTarget {
  title: string;
  tmdbId: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  year?: number | string;
  posterPath?: string;
  /** Sans saison ni épisode, la page cherche le film (maquette DlFilm : « Version précise › »). */
  season?: number;
  episode?: number;
  qualityPreference?: '1080p' | '4k';
}

const code = (season: number, episode: number) => `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;

/**
 * #879 — Page « Version précise » (maquette DlVersion) : toutes les versions trouvées pour un épisode,
 * filtrées par qualité ou langue, la conseillée en tête. Une carte se déplie pour montrer le nom du
 * fichier et envoyer cette version au client configuré (même envoi que la popup). Pleine page, jamais
 * une feuille du bas ; Retour la ferme.
 */
export default function PreciseVersionPage({ target, onClose }: { target: PreciseVersionTarget; onClose: () => void }) {
  const { title, season, episode, qualityPreference = '1080p' } = target;
  const isMovie = season === undefined || episode === undefined;
  const scopeLabel = isMovie ? `Film${target.year ? ` · ${target.year}` : ''}` : code(season, episode);
  const initialQuery = isMovie ? [title.trim(), target.year].filter(Boolean).join(' ') : `${title.trim()} ${code(season, episode)}`;
  const [query, setQuery] = useState(initialQuery);
  const [draft, setDraft] = useState(initialQuery);
  const [editing, setEditing] = useState(false);
  const [results, setResults] = useState<C411Torrent[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<VersionFilter>('Toutes');
  const [open, setOpen] = useState<number | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setOpen(null);
    searchC411Torrents({ query, mediaType: isMovie ? 'movie' : 'tv' })
      .then(found => { if (cancelled) return; setResults(found); setState('ready'); })
      // Une panne reste une panne : elle n'est jamais présentée comme une absence de version.
      .catch((reason: unknown) => { if (cancelled) return; setResults([]); setError(reason instanceof Error ? reason.message : 'La recherche est momentanément indisponible.'); setState('error'); });
    return () => { cancelled = true; };
  }, [query, isMovie]);

  useEffect(() => { if (editing) searchRef.current?.focus(); }, [editing]);

  const versions = useMemo(() => describeReleases(results, qualityPreference), [results, qualityPreference]);
  const visible = versions.filter(entry => matchesVersionFilter(entry, filter));
  // Ouvre d'office la conseillée à l'arrivée des résultats.
  useEffect(() => { if (state === 'ready') setOpen(versions[0]?.release.id ?? null); }, [state, versions]);

  const notify = (action: string, toastType: 'download' | 'success' | 'error' | 'info' = 'download') =>
    useToastStore.getState().showToast({ title, subtitle: isMovie ? undefined : `S${season} | E${episode}`, action, posterPath: target.posterPath }, toastType);

  const send = async (torrent: C411Torrent) => {
    if (sending !== null) return;
    const config = useDownloadConfigStore.getState();
    if (!isDownloadFeatureEnabled(config)) return;
    setSending(torrent.id);
    try {
      const result = await sendReleaseToClient({ config, torrent, mediaType: isMovie ? 'movie' : 'tv', title, tmdbId: target.tmdbId, tvdbId: target.tvdbId, imdbId: target.imdbId, year: target.year, posterPath: target.posterPath, season, episode, notify });
      if (result.success && !result.magnetOnly) { notify(result.message, 'success'); onClose(); }
    } finally {
      setSending(null);
    }
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (next) { setQuery(next); setEditing(false); }
  };

  return <DialogLayer onDismiss={onClose} label="Version précise" role="dialog" data-precise-version
    className="fixed inset-0 z-[180] max-w-md mx-auto bg-[#0B0B0D] text-white flex flex-col">
    <header className="shrink-0 flex items-center gap-1 px-2 pt-[calc(var(--seenit-safe-area-top,env(safe-area-inset-top,0px))+6px)] pb-2">
      <button type="button" onClick={onClose} aria-label="Retour" className="w-11 h-11 grid place-items-center rounded-full text-zinc-100 active:bg-white/10"><ChevronLeft size={26} /></button>
      <div className="min-w-0 leading-tight">
        <h2 className="text-[19px] font-extrabold">Version précise</h2>
        <p className="truncate text-[13px] text-zinc-400"><span className="seenit-media-title font-bold">{title}</span> · {scopeLabel}</p>
      </div>
    </header>

    <div className="shrink-0 px-4 pb-3"><VersionFilterChips value={filter} onChange={label => { setFilter(label); setOpen(null); }} /></div>

    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] flex flex-col gap-2.5">
      {state === 'loading' && <p role="status" className="flex items-center gap-2 py-6 text-[14px] text-zinc-400"><Loader2 size={18} className="animate-spin" />Recherche des versions…</p>}
      {state === 'error' && <p role="alert" className="rounded-2xl bg-rose-500/10 px-4 py-3 text-[14px] text-rose-200">{error}</p>}
      {state === 'ready' && !visible.length && <p className="py-6 text-[14px] text-zinc-400">{versions.length ? 'Aucune version pour ce filtre.' : 'Aucune version trouvée sous ce nom.'}</p>}
      {state === 'ready' && visible.map(entry => {
        const { release } = entry;
        const isOpen = open === release.id;
        return <ReleaseVersionCard key={release.id} entry={entry} open={isOpen} onToggle={() => setOpen(isOpen ? null : release.id)}
          details={['C411', `${release.seeders} source${release.seeders > 1 ? 's' : ''}`, releaseAgeLabel(entry.ageDays)].filter(Boolean).join(' · ')}>
          <button type="button" disabled={sending !== null} onClick={() => void send(release)} className="mt-1 h-12 rounded-[14px] bg-[#E5A93D] text-black text-[15px] font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60">
            {sending === release.id && <Loader2 size={18} className="animate-spin" />}Télécharger cette version
          </button>
        </ReleaseVersionCard>;
      })}

      {editing
        ? <form onSubmit={submitSearch} role="search" className="flex gap-2 pt-1">
          <input ref={searchRef} value={draft} onChange={event => setDraft(event.target.value)} aria-label="Nom à chercher" enterKeyHint="search" className="flex-1 min-w-0 h-12 rounded-[14px] bg-[#1F1F23] px-3 text-[15px] text-white outline-none focus:shadow-[inset_0_0_0_1.5px_#E5A93D]" />
          <button type="submit" aria-label="Chercher" className="w-12 h-12 shrink-0 grid place-items-center rounded-[14px] bg-zinc-100 text-black"><Search size={20} /></button>
        </form>
        : state !== 'loading' && <button type="button" onClick={() => setEditing(true)} className="mt-1 h-12 rounded-[14px] text-[14.5px] font-bold text-zinc-300 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] active:bg-white/5">Chercher sous un autre nom…</button>}
    </div>
  </DialogLayer>;
}
