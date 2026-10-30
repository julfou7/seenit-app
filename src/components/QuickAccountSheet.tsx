import { X, Settings } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { closeTopDialog } from '../features/navigation/dialogStack';
import { DialogLayer } from './ui/DialogLayer';
import { DownloadFeatureSettingsCard } from './DownloadFeatureSettingsCard';
const SettingsScreen = lazy(() => import('../screens/SettingsScreen').then(module => ({ default: module.SettingsScreen })));
export function QuickAccountSheet({ onClose }: { onClose: () => void }) {
  const [fullSettings, setFullSettings] = useState(false);
  return <DialogLayer label={fullSettings ? 'Réglages' : 'Réglages rapides du compte'} onDismiss={onClose}
    className={fullSettings ? 'reg-root fixed inset-0 bg-[#0B0B0D] flex flex-col' : 'fixed inset-0 bg-black/60 flex items-end justify-center p-4'}>
    {fullSettings ? <div className="nav-account-settings w-full max-w-md mx-auto flex-1 min-h-0 flex flex-col">
      <Suspense fallback={<p role="status" className="p-6">Chargement des réglages…</p>}><SettingsScreen onClose={() => closeTopDialog()} /></Suspense>
    </div> : <section className="nav-quick-account w-full max-w-md rounded-3xl bg-zinc-950 border border-white/10 p-4 space-y-4">
      <header className="flex items-center justify-between gap-3"><h2 className="font-bold text-lg">Réglages rapides</h2><button type="button" onClick={() => closeTopDialog()} aria-label="Fermer les réglages rapides" className="min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/5"><X size={20} /></button></header>
      <DownloadFeatureSettingsCard />
      <button type="button" onClick={() => setFullSettings(true)} className="min-h-11 w-full flex items-center justify-center gap-2 rounded-xl bg-white/5 text-[#F2C36B] font-bold text-sm"><Settings size={18} />Tous les réglages</button>
    </section>}
  </DialogLayer>;
}
