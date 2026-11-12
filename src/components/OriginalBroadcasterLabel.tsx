import { CANAL_ORIGINAL_BROADCASTER_NAME } from '../utils/providerLogos';

export function OriginalBroadcasterLabel({ name, overlay = true }: { name?: string | null; overlay?: boolean }) {
  if (name !== CANAL_ORIGINAL_BROADCASTER_NAME) return null;
  return <span aria-hidden="true" className={`${overlay ? 'absolute right-0 top-full ' : ''}rounded bg-zinc-950 px-1 py-0.5 text-[10px] font-bold leading-none text-amber-300`}>Origine</span>;
}
