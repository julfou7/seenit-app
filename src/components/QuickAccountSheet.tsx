import { X, Settings } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import { DownloadFeatureSettingsCard } from './DownloadFeatureSettingsCard';
export function QuickAccountSheet({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  return <DialogLayer label="Réglages rapides du compte" onDismiss={onClose} className="fixed inset-0 bg-black/60 flex items-end justify-center p-4">
    <section className="nav-quick-account w-full max-w-md rounded-3xl bg-zinc-950 border border-white/10 p-4 space-y-4">
      <header className="flex items-center justify-between gap-3"><h2 className="font-bold text-lg">Réglages rapides</h2><button type="button" onClick={onClose} aria-label="Fermer les réglages rapides" className="min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/5"><X size={20} /></button></header>
      <DownloadFeatureSettingsCard />
      <button type="button" onClick={onSettings} className="min-h-11 w-full flex items-center justify-center gap-2 rounded-xl bg-white/5 text-[#F2C36B] font-bold text-sm"><Settings size={18} />Tous les réglages</button>
    </section>
  </DialogLayer>;
}
