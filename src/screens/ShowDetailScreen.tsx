import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { ShowDetailScreen as ShowDetailScreenCore } from './ShowDetailScreenCore';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';
import { tmdb } from '../features/shows/tmdb';
import { useShowsStore } from '../store/showsStore';
import { useMediaPresenceStore } from '../store/mediaPresenceStore';

interface ShowDetailScreenProps {
  key?: string;
  showId?: string;
  tmdbId?: number;
  mediaType?: 'tv' | 'movie';
  initialSeason?: number;
  initialEpisode?: number;
  onBack: () => void;
  onShowClick?: (tmdbId: number, mediaType?: 'tv' | 'movie') => void;
}

const DETAIL_WARMUP_GRACE_MS = 300;
const PROVIDER_LOADING_LABEL = 'Recherche Plex & streaming…';

const HIDDEN_DOWNLOAD_SURFACE_CSS = `
[data-seenit-download-surface="hidden"] button:has(svg.lucide-download),
[data-seenit-download-surface="hidden"] button[title*="télécharg" i],
[data-seenit-download-surface="hidden"] [role="button"][title*="télécharg" i] {
  display: none !important;
}
`;

const DETAIL_UX_CSS = `
[data-seenit-detail-shell="stable"] .animate-pulse { overflow-anchor: none; }
[data-seenit-detail-shell="stable"] h3.mb-3:has(+ .flex > .animate-pulse) {
  font-size: 0;
  min-height: 0.75rem;
}
[data-seenit-detail-shell="stable"] h3.mb-3:has(+ .flex > .animate-pulse)::after {
  content: '';
  display: block;
  width: 8rem;
  height: 0.75rem;
  border-radius: 0.25rem;
  background: rgb(39 39 42 / 0.8);
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
[data-seenit-detail-warmup="cold"] {
  min-height: 100%;
  contain: layout paint;
}
[data-seenit-detail-shell="stable"] #section-episodes button:has(svg.lucide-chevron-up),
[data-seenit-detail-shell="stable"] #section-episodes button:has(svg.lucide-chevron-down) {
  display: none !important;
}
[data-seenit-detail-shell="stable"] #section-casting img {
  object-position: 50% 25%;
}
[data-seenit-detail-shell="stable"] #section-casting p.line-clamp-1 {
  -webkit-line-clamp: 2;
  line-clamp: 2;
  min-height: 2.2em;
}
[data-seenit-detail-shell="stable"] #section-casting .absolute.bottom-0.left-0 {
  opacity: .72;
  font-size: 8px;
  padding-inline: .3rem;
}
[data-seenit-theme-extra="true"][data-seenit-theme-visible="false"] {
  display: none !important;
}
`;

const wait = (delayMs: number) => new Promise<void>(resolve => setTimeout(resolve, delayMs));

function StableColdDetailSkeleton({ onBack }: Pick<ShowDetailScreenProps, 'onBack'>) {
  return (
    <div data-seenit-detail-warmup="cold" className="flex-1 overflow-hidden bg-black text-white relative w-full h-full">
      <div className="relative min-h-[420px]">
        <div className="absolute top-0 inset-x-0 h-96 bg-zinc-900/60 animate-pulse" />
        <div className="relative z-10 pt-10 px-4">
          <button type="button" onClick={onBack} className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white text-xl" aria-label="Retour">‹</button>
          <div className="flex gap-4 mt-8">
            <div className="w-[120px] shrink-0 aspect-[2/3] bg-zinc-800/80 rounded-xl border border-white/10 animate-pulse" />
            <div className="flex-1 min-w-0 flex flex-col justify-end gap-3 pb-1">
              <div className="flex gap-2"><div className="h-5 w-24 bg-zinc-800/80 rounded-md animate-pulse" /><div className="h-5 w-16 bg-zinc-800/80 rounded-md animate-pulse" /></div>
              <div className="h-9 w-4/5 max-w-56 bg-zinc-800/80 rounded-lg animate-pulse" />
              <div className="h-4 w-32 bg-zinc-800/80 rounded animate-pulse" />
              <div className="flex gap-2 min-h-[26px]"><div className="h-6 w-16 bg-zinc-800/80 rounded-lg animate-pulse" /><div className="h-6 w-16 bg-zinc-800/80 rounded-lg animate-pulse" /></div>
            </div>
          </div>
          <div className="h-12 w-full bg-zinc-800/80 rounded-2xl mt-5 animate-pulse" />
        </div>
      </div>
      <div className="px-4 mt-4"><div className="h-10 bg-zinc-900 rounded-full animate-pulse border border-white/5" /></div>
      <div className="p-4 space-y-6">
        <div className="space-y-2"><div className="h-3 w-20 bg-zinc-800 rounded animate-pulse" /><div className="h-3.5 bg-zinc-800/80 rounded w-full animate-pulse" /><div className="h-3.5 bg-zinc-800/80 rounded w-11/12 animate-pulse" /><div className="h-3.5 bg-zinc-800/80 rounded w-4/5 animate-pulse" /></div>
        <div className="h-20 bg-zinc-900/60 rounded-2xl border border-white/5 animate-pulse" />
      </div>
    </div>
  );
}

function ProviderAvailabilityControls({ detailIdentity, tmdbId, mediaType }: { detailIdentity: string | null; tmdbId?: number; mediaType: 'tv' | 'movie' }) {
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hostRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('[data-seenit-detail-shell="stable"]');
    if (!shell) return;

    const ensureProviderUi = () => {
      const heading = Array.from(shell.querySelectorAll('h3')).find(node => node.textContent?.trim() === 'Où regarder');
      if (!heading?.parentElement) return;

      for (const pulse of heading.parentElement.querySelectorAll<HTMLElement>('.animate-pulse')) {
        if (!pulse.querySelector('img[alt="Plex"]')) continue;
        const label = pulse.querySelector<HTMLElement>('span');
        if (label && label.textContent !== PROVIDER_LOADING_LABEL) label.textContent = PROVIDER_LOADING_LABEL;
        if (label) label.style.whiteSpace = 'nowrap';
      }

      let row = heading.parentElement.querySelector<HTMLElement>(':scope > [data-seenit-provider-heading-row="true"]');
      if (!row) {
        row = document.createElement('div');
        row.dataset.seenitProviderHeadingRow = 'true';
        row.className = 'flex items-center gap-1.5 mb-2';
        heading.insertAdjacentElement('beforebegin', row);
        heading.classList.remove('mb-2');
        row.appendChild(heading);
      }

      let host = row.querySelector<HTMLElement>('[data-seenit-provider-refresh-host="true"]');
      if (!host) {
        host = document.createElement('span');
        host.dataset.seenitProviderRefreshHost = 'true';
        host.className = 'inline-flex shrink-0';
        row.appendChild(host);
      }
      if (hostRef.current !== host) {
        hostRef.current = host;
        setPortalHost(host);
      }
    };

    ensureProviderUi();
    const observer = new MutationObserver(ensureProviderUi);
    observer.observe(shell, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      hostRef.current = null;
      setPortalHost(null);
    };
  }, [detailIdentity]);

  const refreshPlexServers = async () => {
    if (!tmdbId || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const details = tmdb.peekMediaDetails(tmdbId, mediaType);
      await useMediaPresenceStore.getState().checkPresence({
        tmdbId,
        tvdbId: details?.external_ids?.tvdb_id,
        imdbId: details?.external_ids?.imdb_id || details?.imdb_id,
        mediaType,
        forceRefresh: true,
        refreshPlexServers: true,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!portalHost || !tmdbId) return null;
  return createPortal(
    <button
      type="button"
      onClick={() => void refreshPlexServers()}
      disabled={isRefreshing}
      aria-label="Actualiser Plex"
      title="Actualiser Plex"
      className="inline-flex w-11 h-11 items-center justify-center rounded-full text-zinc-500 transition hover:text-white hover:bg-white/5 active:scale-95 disabled:opacity-60"
    >
      <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
    </button>,
    portalHost,
  );
}

function DetailUxNormalizer({ detailIdentity }: { detailIdentity: string | null }) {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('[data-seenit-detail-shell="stable"]');
    if (!shell) return;

    const normalize = () => {
      for (const span of Array.from(shell.querySelectorAll<HTMLElement>('span'))) {
        const text = span.textContent?.trim() || '';
        if (text.startsWith('📺 SÉRIE •')) span.textContent = '📺 SÉRIE';

        if (text.includes('· US ·') && !span.dataset.seenitAgeCompact) {
          const parts = text.split('·').map(part => part.trim()).filter(Boolean);
          if (parts.length >= 3) {
            const readableAge = parts.at(-1)!;
            const provenance = parts.slice(0, -1).join(' · ');
            span.dataset.seenitAgeCompact = 'true';
            span.setAttribute('aria-label', `${readableAge}, classification ${provenance}`);
            span.title = `${provenance} · ${readableAge}`;
            span.innerHTML = `<strong>${readableAge}</strong><small style="font-size:8px;opacity:.62;margin-left:5px;font-weight:600;text-transform:none">${provenance}</small>`;
          }
        }
      }

      for (const button of Array.from(shell.querySelectorAll<HTMLButtonElement>('#section-episodes button'))) {
        const title = button.title || '';
        if (title === 'Marquer toute la saison comme vue' && button.textContent?.trim() !== 'Tout marquer vu') {
          button.textContent = 'Tout marquer vu';
          button.setAttribute('aria-label', title);
          button.classList.add('px-2');
        } else if (title === 'Marquer toute la saison comme non vue' && button.textContent?.trim() !== 'Tout marquer non vu') {
          button.textContent = 'Tout marquer non vu';
          button.setAttribute('aria-label', title);
          button.classList.add('px-2');
        }

        if (/^Saison\s+\d+/.test(button.textContent?.trim() || '')) {
          const card = button.closest<HTMLElement>('.rounded-2xl');
          const expanded = Boolean(card && Array.from(card.children).some(child => child.classList.contains('border-t')));
          button.setAttribute('aria-expanded', String(expanded));
        }
      }

      const categoriesHeading = Array.from(shell.querySelectorAll<HTMLElement>('span')).find(node => node.textContent?.trim() === 'Catégories & Thèmes');
      const chipRow = categoriesHeading?.parentElement?.querySelector<HTMLElement>(':scope > .flex.flex-wrap');
      if (chipRow) {
        const extras = Array.from(chipRow.children).filter((node): node is HTMLElement =>
          node instanceof HTMLElement && node.className.includes('bg-zinc-800/60') && !node.dataset.seenitThemeToggle,
        );
        if (extras.length) {
          const expanded = chipRow.dataset.seenitThemesExpanded === 'true';
          extras.forEach(node => {
            node.dataset.seenitThemeExtra = 'true';
            node.dataset.seenitThemeVisible = String(expanded);
          });
          let toggle = chipRow.querySelector<HTMLButtonElement>('[data-seenit-theme-toggle="true"]');
          if (!toggle) {
            toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.dataset.seenitThemeToggle = 'true';
            toggle.className = 'min-h-11 px-2.5 py-1 rounded-full border border-white/10 text-zinc-400 text-[10px] font-semibold hover:text-white';
            toggle.addEventListener('click', () => {
              chipRow.dataset.seenitThemesExpanded = String(chipRow.dataset.seenitThemesExpanded !== 'true');
              normalize();
            });
            chipRow.appendChild(toggle);
          }
          toggle.textContent = expanded ? 'Masquer les thèmes' : `+${extras.length} thèmes`;
          toggle.setAttribute('aria-expanded', String(expanded));
        }
      }
    };

    normalize();
    const observer = new MutationObserver(normalize);
    observer.observe(shell, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [detailIdentity]);
  return null;
}

export function ShowDetailScreen(props: ShowDetailScreenProps) {
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);
  const shows = useShowsStore(state => state.shows);

  const resolvedMedia = useMemo(() => {
    const matchingShow = shows.find(show =>
      (props.showId && (String(show.id) === String(props.showId) || String(show.tmdbId) === String(props.showId)))
      || (props.tmdbId && String(show.tmdbId) === String(props.tmdbId))
    );
    const numericShowId = props.showId && /^\d+$/.test(props.showId) ? Number(props.showId) : undefined;
    const tmdbId = matchingShow?.tmdbId ? Number(matchingShow.tmdbId) : props.tmdbId ? Number(props.tmdbId) : numericShowId;
    const mediaType: 'tv' | 'movie' = matchingShow?.mediaType === 'movie' || props.mediaType === 'movie' ? 'movie' : 'tv';
    return { tmdbId: Number.isFinite(tmdbId) && Number(tmdbId) > 0 ? Number(tmdbId) : undefined, mediaType };
  }, [shows, props.showId, props.tmdbId, props.mediaType]);

  const detailIdentity = resolvedMedia.tmdbId ? `${resolvedMedia.mediaType}:${resolvedMedia.tmdbId}` : null;
  const [coldWarmupIdentity, setColdWarmupIdentity] = useState<string | null>(() => {
    if (!resolvedMedia.tmdbId || !detailIdentity) return null;
    return tmdb.peekMediaDetails(resolvedMedia.tmdbId, resolvedMedia.mediaType) ? null : detailIdentity;
  });

  useEffect(() => {
    const tmdbId = resolvedMedia.tmdbId;
    const mediaType = resolvedMedia.mediaType;
    const identity = detailIdentity;
    if (!tmdbId || !identity) { setColdWarmupIdentity(null); return; }
    if (tmdb.peekMediaDetails(tmdbId, mediaType)) { setColdWarmupIdentity(null); return; }

    let cancelled = false;
    setColdWarmupIdentity(identity);
    const warmColdDetail = async () => {
      const providersPromise = tmdb.getWatchProviders(tmdbId, mediaType);
      const detailsResult = await tmdb.getMediaDetails(tmdbId, mediaType);
      if (!detailsResult.ok || !detailsResult.value) {
        if (!cancelled) setColdWarmupIdentity(null);
        return;
      }
      await Promise.race([providersPromise.catch(() => undefined), wait(DETAIL_WARMUP_GRACE_MS)]);
      if (!cancelled) setColdWarmupIdentity(null);
    };
    void warmColdDetail();
    return () => { cancelled = true; };
  }, [detailIdentity, resolvedMedia.tmdbId, resolvedMedia.mediaType]);

  const isColdWarmup = Boolean(detailIdentity && coldWarmupIdentity === detailIdentity);

  return (
    <div className="contents" data-seenit-download-surface={downloadsEnabled ? 'visible' : 'hidden'} data-seenit-detail-shell="stable">
      {!downloadsEnabled && <style>{HIDDEN_DOWNLOAD_SURFACE_CSS}</style>}
      <style>{DETAIL_UX_CSS}</style>
      {isColdWarmup ? (
        <StableColdDetailSkeleton onBack={props.onBack} />
      ) : (
        <>
          <ShowDetailScreenCore key={downloadsEnabled ? 'downloads-visible' : 'downloads-hidden'} {...props} />
          <ProviderAvailabilityControls detailIdentity={detailIdentity} tmdbId={resolvedMedia.tmdbId} mediaType={resolvedMedia.mediaType} />
          <DetailUxNormalizer detailIdentity={detailIdentity} />
        </>
      )}
    </div>
  );
}
