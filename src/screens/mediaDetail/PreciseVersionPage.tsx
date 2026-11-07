import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, Loader2, Search } from 'lucide-react';
import { DialogLayer } from '../../components/ui/DialogLayer';
import { type C411Torrent, searchC411Torrents } from '../../services/c411';
import { useDownloadConfigStore } from '../../store/downloadConfigStore';
import { useToastStore } from '../../store/toastStore';
import { isDownloadFeatureEnabled } from '../../features/downloads/downloadFeatureVisibility';
import { sendReleaseToClient } from '../../features/downloads/releaseSend';
import { describeReleases, formatReleaseSize, matchesVersionFilter, releaseAgeLabel, VERSION_FILTERS, type VersionFilter } from '../../features/downloads/releaseVersions';
import { cn } from '../../lib/utils';

export interface PreciseVersionTarget {
  title: string;
  tmdbId: number | string;
  tvdbId?: number | string;
  imdbId?: string;
  year?: number | string;
  posterPath?: string;
  season: number;
  episode: number;
  qualityPreference?: '1080p' | '4k';
}

const SPEED_COLOR = { 3: '#86EFAC', 2: '#FCD34D', 1: '#FB7185' } as const;
const code = (season: number, episode: number) => `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;

/**
 * #879 — Page « Version précise » (maquette DlVersion) : toutes les versions trouvées pour un épisode,
 * filtrées par qualité ou langue, la conseillée en tête. Une carte se déplie pour montrer le nom du
 * fichier et envoyer cette version au client configuré (même envoi que la popup). Pleine page, jamais
 * une feuille du bas ; Retour la ferme.
 */
export default function PreciseVersionPage({ target, onClose }: { target: PreciseVersionTarget; onClose: () => void }) {
  const { title, season, episode, qualityPreference = '1080p' } = target;
  const initialQuery = `${title.trim()} ${code(season, episode)}`;
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
    searchC411Torrents({ query, mediaType: 'tv' })
      .then(found => { if (cancelled) return; setResults(found); setState('ready'); })
      // Une panne reste une panne : elle n'est jamais présentée comme une absence de version.
      .catch((reason: unknown) => { if (cancelled) return; setResults([]); setError(reason instanceof Error ? reason.message : 'La recherche est momentanément indisponible.'); setState('error'); });
    return () => { cancelled = true; };
  }, [query]);

  useEffect(() => { if (editing) searchRef.current?.focus(); }, [editing]);

  const versions = useMemo(() => describeReleases(results, qualityPreference), [results, qualityPreference]);
  const visible = versions.filter(entry => matchesVersionFilter(entry, filter));
  // Ouvre d'office la conseillée à l'arrivée des résultats.
  useEffect(() => { if (state === 'ready') setOpen(versions[0]?.release.id ?? null); }, [state, versions]);

  const notify = (action: string, toastType: 'download' | 'success' | 'error' | 'info' = 'download') =>
    useToastStore.getState().showToast({ title, subtitle: `S${season} | E${episode}`, action, posterPath: target.posterPath }, toastType);

  const send = async (torrent: C411Torrent) => {
    if (sending !== null) return;
    const config = useDownloadConfigStore.getState();
    if (!isDownloadFeatureEnabled(config)) return;
    setSending(torrent.id);
    try {
      const result = await sendReleaseToClient({ config, torrent, mediaType: 'tv', title, tmdbId: target.tmdbId, tvdbId: target.tvdbId, imdbId: target.imdbId, year: target.year, posterPath: target.posterPath, season, episode, notify });
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
        <p className="truncate text-[13px] text-zinc-400"><span className="seenit-media-title font-bold">{title}</span> · {code(season, episode)}</p>
      </div>
    </header>

    <div role="group" aria-label="Filtrer les versions" className="shrink-0 flex gap-2 px-4 pb-3 overflow-x-auto hide-scrollbar">
      {VERSION_FILTERS.map(label => <button key={label} type="button" aria-pressed={filter === label} onClick={() => { setFilter(label); setOpen(null); }}
        className={cn('h-11 shrink-0 px-4 rounded-full text-[14px] font-bold', filter === label ? 'bg-zinc-100 text-black' : 'bg-[#1F1F23] text-zinc-300')}>{label}</button>)}
    </div>

    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] flex flex-col gap-2.5">
      {state === 'loading' && <p role="status" className="flex items-center gap-2 py-6 text-[14px] text-zinc-400"><Loader2 size={18} className="animate-spin" />Recherche des versions…</p>}
      {state === 'error' && <p role="alert" className="rounded-2xl bg-rose-500/10 px-4 py-3 text-[14px] text-rose-200">{error}</p>}
      {state === 'ready' && !visible.length && <p className="py-6 text-[14px] text-zinc-400">{versions.length ? 'Aucune version pour ce filtre.' : 'Aucune version trouvée sous ce nom.'}</p>}
      {state === 'ready' && visible.map(entry => {
        const { release } = entry;
        const isOpen = open === release.id;
        const age = releaseAgeLabel(entry.ageDays);
        return <article key={release.id} data-version-card={release.id} className={cn('rounded-[18px] bg-[#161619] overflow-hidden', isOpen && 'bg-[#1E1A12] shadow-[inset_0_0_0_1.5px_rgba(229,169,61,0.6)]')}>
          <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : release.id)} className="w-full min-h-[64px] flex items-center gap-3 px-3 py-2.5 text-left">
            <span className={cn('w-[58px] h-11 shrink-0 rounded-xl grid place-items-center text-[15px] font-extrabold', entry.quality === '4K' ? 'bg-zinc-100 text-black' : 'bg-[#2A2A2F] text-zinc-100')}>{entry.quality}</span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="flex items-center gap-2 min-w-0"><strong className="truncate text-[15px] font-extrabold">{entry.language}{entry.light ? ' · Light' : ''}</strong>{entry.recommended && <span className="shrink-0 rounded-md bg-[#E5A93D] px-1.5 text-[11.5px] font-extrabold leading-[1.6] text-black">Conseillée</span>}</span>
              <span className="text-[13px] text-zinc-400">{formatReleaseSize(release.size)} · <span className="font-bold" style={{ color: SPEED_COLOR[entry.speedLevel] }}>{'●'.repeat(entry.speedLevel)}{'○'.repeat(3 - entry.speedLevel)} {entry.speedLabel}</span></span>
            </span>
            <ChevronDown size={20} aria-hidden="true" className={cn('shrink-0 text-zinc-500 transition-transform motion-reduce:transition-none', isOpen && 'rotate-180')} />
          </button>
          {isOpen && <div className="px-3 pb-3 flex flex-col gap-2">
            <span className="text-[11px] font-extrabold tracking-[0.08em] text-zinc-500">NOM DU FICHIER</span>
            <span className="text-[13px] leading-[1.4] text-zinc-200 break-all">{release.name}</span>
            <span className="text-[12.5px] text-zinc-500">{['C411', `${release.seeders} source${release.seeders > 1 ? 's' : ''}`, age].filter(Boolean).join(' · ')}</span>
            <button type="button" disabled={sending !== null} onClick={() => void send(release)} className="mt-1 h-12 rounded-[14px] bg-[#E5A93D] text-black text-[15px] font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60">
              {sending === release.id && <Loader2 size={18} className="animate-spin" />}Télécharger cette version
            </button>
          </div>}
        </article>;
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
