import React from 'react';
import { Pencil } from 'lucide-react';
import { parentalRatingKey, type ParentalMediaType } from '../features/shows/parentalRating';
import { useParentalRatingStore } from '../store/parentalRatingStore';
import { useToastStore } from '../store/toastStore';

interface ParentalRatingEditorProps {
  tmdbId?: number | null;
  mediaType?: ParentalMediaType;
}

export function ParentalRatingEditor({ tmdbId, mediaType = 'tv' }: ParentalRatingEditorProps) {
  const overrides = useParentalRatingStore(state => state.overrides);
  const setOverride = useParentalRatingStore(state => state.setOverride);
  const clearOverride = useParentalRatingStore(state => state.clearOverride);
  const showToast = useToastStore(state => state.showToast);

  if (!tmdbId || !Number.isFinite(Number(tmdbId))) return null;

  const key = parentalRatingKey(mediaType, Number(tmdbId));
  const current = overrides[key] || null;

  const handleEdit = async () => {
    const answer = window.prompt(
      "Âge conseillé personnel (0 à 18).\n0 = Tous publics.\nLaisse vide pour revenir à la classification US TMDB.",
      current ? String(current.age) : '',
    );

    if (answer === null) return;
    const trimmed = answer.trim();

    try {
      if (!trimmed) {
        await clearOverride(mediaType, Number(tmdbId));
        showToast('Âge conseillé personnel supprimé · retour à TMDB', 'info');
        return;
      }

      const age = Number(trimmed);
      if (!Number.isInteger(age) || age < 0 || age > 18) {
        showToast('Entre un âge entier compris entre 0 et 18.', 'error');
        return;
      }

      await setOverride(mediaType, Number(tmdbId), age);
      showToast(`${age === 0 ? 'Tous publics' : `${age}+`} enregistré comme choix personnel`, 'success');
    } catch (error) {
      console.error('[ParentalRatingEditor] Unable to persist personal rating', error);
      showToast("Impossible d'enregistrer l'âge conseillé personnel.", 'error');
    }
  };

  return (
    <button
      type="button"
      onClick={handleEdit}
      className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-[210] inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-zinc-900/95 px-3 py-2 text-[11px] font-bold text-zinc-200 shadow-xl backdrop-blur-xl active:scale-95 transition-transform"
      aria-label="Corriger l’âge conseillé de ce média"
      title="Corriger l’âge conseillé"
    >
      <Pencil size={13} className="text-[#E5A93D]" />
      <span>{current ? `Âge perso ${current.age === 0 ? 'TP' : `${current.age}+`}` : "Corriger l’âge"}</span>
    </button>
  );
}
