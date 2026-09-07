import { useLiveDownloadStore } from '../store/liveDownloadStore';
import { isDownloadActiveOrAttention } from '../features/downloads/downloadStatePolicy';

export function DownloadNavBadge() {
  const activeCount = useLiveDownloadStore(state => state.downloads.filter(isDownloadActiveOrAttention).length);
  if (activeCount <= 0) return null;

  return (
    <span className="absolute -top-0.5 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#E5A93D] border border-zinc-950 text-black font-black text-[9.5px] leading-none flex items-center justify-center shadow-md shadow-[#E5A93D]/40 animate-pulse">
      {activeCount}
    </span>
  );
}
