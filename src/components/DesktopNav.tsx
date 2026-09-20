import { lazy, Suspense } from 'react';
import { RotateCcw } from 'lucide-react';
import { SeenItGlyph, SeenItLogo, type SeenItSymbolType } from './SeenItLogo';
import { cn } from '../lib/utils';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';

const DownloadNavBadge = lazy(() => import('./DownloadNavBadge').then(module => ({ default: module.DownloadNavBadge })));

type MainTab = 'watchlist' | 'library' | 'discover' | 'downloads' | 'profile';

interface DesktopNavProps {
  currentTab: string;
  onTabChange: (tab: MainTab) => void;
  onActiveTabClick?: () => void;
  onResetClick?: () => void;
}

interface DesktopTabItem {
  id: Exclude<MainTab, 'library'>;
  label: string;
  description: string;
  symbol: SeenItSymbolType;
}

const TABS: readonly DesktopTabItem[] = [
  { id: 'watchlist', label: 'À Voir', description: 'Reprendre et suivre', symbol: 'watch' },
  { id: 'discover', label: 'Explorer', description: 'Découvrir films et séries', symbol: 'discover' },
  { id: 'downloads', label: 'Télécharger', description: 'Suivre les transferts', symbol: 'download' },
  { id: 'profile', label: 'Profil', description: 'Statistiques et Ma Liste', symbol: 'profile' },
];

export function DesktopNav({
  currentTab,
  onTabChange,
  onActiveTabClick,
  onResetClick,
}: DesktopNavProps) {
  const downloadsEnabled = useDownloadConfigStore(isDownloadFeatureEnabled);
  const visibleTabs = downloadsEnabled ? TABS : TABS.filter(tab => tab.id !== 'downloads');

  return (
    <aside
      data-seenit-desktop-nav
      className="hidden lg:flex w-60 shrink-0 flex-col border-r border-white/10 bg-zinc-950/82 backdrop-blur-2xl px-4 py-5"
      aria-label="Navigation SeenIt sur PC"
    >
      <div className="px-2 pb-7">
        <SeenItLogo variant="horizontal" size={50} animated />
        <p className="mt-2 pl-1 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-600">
          Version PC
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-2" aria-label="Navigation principale">
        {visibleTabs.map(tab => {
          const isActive = currentTab === tab.id;
          const isDownloadTab = tab.id === 'downloads';

          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                if (isActive) {
                  onActiveTabClick?.();
                  return;
                }
                onTabChange(tab.id);
              }}
              className={cn(
                'group flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D]/70',
                isActive
                  ? 'border-[#E5A93D]/25 bg-[#E5A93D]/12 text-[#E5A93D] shadow-[0_12px_36px_-24px_rgba(229,169,61,0.9)]'
                  : 'border-transparent text-zinc-400 hover:border-white/8 hover:bg-white/5 hover:text-white',
              )}
            >
              <span
                className={cn(
                  'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                  isActive ? 'bg-[#E5A93D]/12' : 'bg-white/[0.03] group-hover:bg-white/[0.06]',
                )}
              >
                <SeenItGlyph
                  size={28}
                  symbol={tab.symbol}
                  active={isActive}
                  glow={isActive}
                  idPrefix={`desktop-nav-${tab.id}`}
                  color="gold"
                />
                {isDownloadTab && downloadsEnabled && (
                  <Suspense fallback={null}>
                    <DownloadNavBadge />
                  </Suspense>
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-extrabold tracking-tight">{tab.label}</span>
                <span className={cn('mt-0.5 block text-[10px] font-medium', isActive ? 'text-amber-100/55' : 'text-zinc-600')}>
                  {tab.description}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-white/8 pt-4">
        <button
          type="button"
          onClick={onResetClick}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-xs font-bold text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E5A93D]/70"
          title="Réinitialiser uniquement la vue active"
        >
          <RotateCcw size={17} aria-hidden="true" />
          <span>Réinitialiser la vue</span>
        </button>
      </div>
    </aside>
  );
}
