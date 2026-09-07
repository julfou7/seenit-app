import { Download, Loader2 } from 'lucide-react';
import { useDownloadConfigStore } from '../store/downloadConfigStore';
import { useToastStore } from '../store/toastStore';
import { isDownloadFeatureEnabled } from '../features/downloads/downloadFeatureVisibility';

export function DownloadFeatureSettingsCard() {
  const enabled = useDownloadConfigStore(isDownloadFeatureEnabled);
  const isHydrated = useDownloadConfigStore(state => state.isHydrated);
  const isSaving = useDownloadConfigStore(state => state.isSaving);
  const saveConfig = useDownloadConfigStore(state => state.saveConfig);
  const setConfig = useDownloadConfigStore(state => state.setConfig);
  const showToast = useToastStore(state => state.showToast);

  const handleToggle = async () => {
    if (!isHydrated || isSaving) return;
    const nextValue = !enabled;
    const saved = await saveConfig({ downloadsEnabled: nextValue });
    if (!saved) {
      setConfig({ downloadsEnabled: enabled }, false);
      showToast("Impossible d'enregistrer ce réglage pour le moment.", 'error');
      return;
    }

    showToast(
      nextValue ? 'Téléchargements affichés dans SeenIt.' : 'Téléchargements masqués dans SeenIt.',
      'success'
    );
  };

  return (
    <section className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5" aria-labelledby="downloads-visibility-title">
      <h2 id="downloads-visibility-title" className="font-bold text-sm text-zinc-100 mb-3 flex items-center gap-2.5">
        <Download className="text-blue-400" size={18} />
        Fonctionnalité personnelle
      </h2>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-zinc-950/50 p-3">
        <div className="min-w-0">
          <div className="text-xs font-bold text-white">Téléchargements</div>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-400">
            Afficher l'onglet et les actions de téléchargement dans l'application.
          </p>
          <p className="mt-1.5 text-[10px] font-semibold text-zinc-500">
            {enabled ? 'Visible pour ce compte' : 'Masqué par défaut'}
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Afficher la fonctionnalité Téléchargements"
          disabled={!isHydrated || isSaving}
          onClick={() => void handleToggle()}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
            enabled
              ? 'border-[#E5A93D]/60 bg-[#E5A93D]'
              : 'border-zinc-700 bg-zinc-800'
          }`}
        >
          <span
            className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-0.5'
            }`}
          >
            {isSaving && <Loader2 size={11} className="animate-spin text-zinc-700" />}
          </span>
        </button>
      </div>
    </section>
  );
}
