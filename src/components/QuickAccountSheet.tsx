import { X, Settings } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { closeTopDialog } from '../features/navigation/dialogStack';
import { DialogLayer } from './ui/DialogLayer';
import { DownloadFeatureSettingsCard } from './DownloadFeatureSettingsCard';
const SettingsScreen = lazy(() => import('../screens/SettingsScreen').then(module => ({ default: module.SettingsScreen })));
export function QuickAccountSheet({ onClose }: { onClose: () => void }) {
  const [fullSettings, setFullSettings] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!fullSettings) return;
    const frame = requestAnimationFrame(() => backRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [fullSettings]);
  return <DialogLayer label={fullSettings ? 'Réglages' : 'Réglages rapides du compte'} onDismiss={onClose}
    className={fullSettings ? 'fixed inset-0 bg-zinc-950 flex flex-col' : 'fixed inset-0 bg-black/60 flex items-end justify-center p-4'}>
    {fullSettings ? <div className="nav-account-settings w-full max-w-md mx-auto flex-1 min-h-0 flex flex-col">
      <header className="p-3 border-b border-white/10"><button ref={backRef} type="button" onClick={() => closeTopDialog()} className="min-h-11 px-3 rounded-xl text-[#F2C36B]">Retour</button></header>
      <Suspense fallback={<p role="status" className="p-6">Chargement des réglages…</p>}><SettingsScreen /></Suspense>
    </div> : <section className="nav-quick-account w-full max-w-md rounded-3xl bg-zinc-950 border border-white/10 p-4 space-y-4">
      <header className="flex items-center justify-between gap-3"><h2 className="font-bold text-lg">Réglages rapides</h2><button type="button" onClick={() => closeTopDialog()} aria-label="Fermer les réglages rapides" className="min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/5"><X size={20} /></button></header>
      <DownloadFeatureSettingsCard />
      <button type="button" onClick={() => setFullSettings(true)} className="min-h-11 w-full flex items-center justify-center gap-2 rounded-xl bg-white/5 text-[#F2C36B] font-bold text-sm"><Settings size={18} />Tous les réglages</button>
    </section>}
  </DialogLayer>;
}
