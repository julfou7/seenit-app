import React, { useRef, useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { Tv, Film, X, Sparkles, FileText, User, Ticket } from 'lucide-react';

interface FilterModalProps {
  onClose: () => void;
  activeCategory: string;
  setActiveCategory: (cat: string) => void;
  initialSelectedPlatforms: string[];
  initialSelectedGenres: string[];
  initialPegi: string;
  initialRating: string;
  query: string;
  onApply: (platforms: string[], genres: string[], pegi: string, rating: string) => void;
}

const GENRE_OPTIONS = [
  'Action', 'Aventure', 'Animation', 'Biopic', 'Comédie', 'Drame',
  'Fantastique', 'Horreur', 'Romance', 'Sci-Fi', 'Thriller'
];

const PLATFORMS = [
  { id: 'netflix', label: 'Netflix', color: 'text-red-500' },
  { id: 'hbo', label: 'HBO', color: 'text-purple-500' },
  { id: 'disney', label: 'Disney+', color: 'text-blue-500' },
  { id: 'apple', label: 'Apple TV+', color: 'text-gray-300' },
  { id: 'prime', label: 'Prime', color: 'text-cyan-500' },
  { id: 'canal', label: 'Canal+', color: 'text-white' },
  { id: 'max', label: 'Max', color: 'text-blue-400' },
];

// Tokens volontairement distincts des anciennes valeurs PEGI : la façade TMDB
// les interprète comme une borne d'âge maximale cumulative.
const AGE_OPTIONS = [
  { id: 'Tous', label: 'Tous' },
  { id: 'age:0', label: 'TP' },
  { id: 'age:7', label: '≤ 7' },
  { id: 'age:10', label: '≤ 10' },
  { id: 'age:13', label: '≤ 13' },
  { id: 'age:14', label: '≤ 14' },
  { id: 'age:17', label: '≤ 17' },
  { id: 'age:18', label: '≤ 18' },
];
const RATING_OPTIONS = ['Toutes', '6+', '7+', '7.5+', '8+', '8.5+', '9+'];

export function FilterModal({
  onClose,
  activeCategory,
  setActiveCategory,
  initialSelectedPlatforms,
  initialSelectedGenres,
  initialPegi,
  initialRating,
  query,
  onApply
}: FilterModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const isSearchActive = query.trim().length > 0;

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(initialSelectedPlatforms);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialSelectedGenres);
  const [pegi, setPegi] = useState(initialPegi);
  const [rating, setRating] = useState(initialRating);

  const togglePlatform = (id: string) => {
    setSelectedPlatforms(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev => prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleReset = () => {
    setSelectedPlatforms([]);
    setSelectedGenres([]);
    setPegi('Tous');
    setRating('Toutes');
  };

  const handleValidate = () => {
    onApply(selectedPlatforms, selectedGenres, pegi, rating);
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
    >
      <div className="w-full max-w-xl mx-auto bg-[#1C1C1E] rounded-t-[2rem] pt-3 px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] shadow-2xl animate-in slide-in-from-bottom-full duration-300 max-h-[90vh] flex flex-col">

        {/* Handle */}
        <div className="w-12 h-1.5 bg-white/10 rounded-full mx-auto mb-4 shrink-0" />

        {/* Header with Reset */}
        <div className="flex justify-between items-center mb-4 shrink-0">
          <button onClick={handleReset} className="text-[13px] font-semibold text-zinc-400 hover:text-white transition-colors">
            Réinitialiser
          </button>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto hide-scrollbar pb-6 space-y-6">
          {/* TYPE DE CONTENU */}
          <div>
            <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-3">Type de contenu</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveCategory('Séries')}
                className={cn("px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-1.5 transition-all border", activeCategory === 'Séries' ? "bg-[#E5A93D]/20 text-[#E5A93D] border-[#E5A93D]/50" : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10")}
              >
                <Tv size={14}/> Séries
              </button>
              <button
                onClick={() => setActiveCategory('Films')}
                className={cn("px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-1.5 transition-all border", activeCategory === 'Films' ? "bg-[#E5A93D]/20 text-[#E5A93D] border-[#E5A93D]/50" : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10")}
              >
                <Film size={14}/> Films
              </button>
              <button
                onClick={() => setActiveCategory('Pépites')}
                className={cn("px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-1.5 transition-all border", activeCategory === 'Pépites' ? "bg-[#E5A93D]/20 text-[#E5A93D] border-[#E5A93D]/50" : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10")}
              >
                <Sparkles size={14}/> Pépites
              </button>
              <button
                onClick={() => setActiveCategory('Au cinéma')}
                className={cn("px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-1.5 transition-all border", activeCategory === 'Au cinéma' ? "bg-[#E5A93D]/20 text-[#E5A93D] border-[#E5A93D]/50" : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10")}
              >
                <Ticket size={14}/> Au cinéma
              </button>
              <button
                onClick={() => setActiveCategory('Documentaires')}
                className={cn("px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-1.5 transition-all border", activeCategory === 'Documentaires' ? "bg-[#E5A93D]/20 text-[#E5A93D] border-[#E5A93D]/50" : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10")}
              >
                <FileText size={14}/> Documentaires
              </button>
              <button
                onClick={() => setActiveCategory('Personnes')}
                className={cn("px-4 py-2 rounded-full text-[13px] font-semibold flex items-center gap-1.5 transition-all border", activeCategory === 'Personnes' ? "bg-[#E5A93D]/20 text-[#E5A93D] border-[#E5A93D]/50" : "bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10")}
              >
                <User size={14}/> Personnes
              </button>
            </div>
          </div>

          {/* PLATEFORME */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Plateforme</h3>
              {isSearchActive && (
                <span className="text-[10px] text-amber-500 font-medium bg-amber-500/10 px-2 py-0.5 rounded">
                  Indisponible en recherche texte
                </span>
              )}
            </div>
            <div className={cn("flex flex-wrap gap-2", isSearchActive && "opacity-30 pointer-events-none grayscale")}>
              {PLATFORMS.map(platform => (
                <button
                  key={platform.id}
                  onClick={() => togglePlatform(platform.id)}
                  className={cn(
                    "px-4 py-2 rounded-full text-[13px] font-semibold transition-all border",
                    selectedPlatforms.includes(platform.id)
                      ? "bg-white/15 border-white/20"
                      : "bg-transparent border-white/10 hover:border-white/20",
                    platform.color
                  )}
                >
                  {platform.label}
                </button>
              ))}
            </div>
          </div>

          {/* GENRE */}
          <div>
            <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-3">Genre</h3>
            <div className="flex flex-wrap gap-2">
              {GENRE_OPTIONS.map(genre => (
                <button
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                  className={cn(
                    "px-4 py-2 rounded-full text-[13px] font-medium transition-all border",
                    selectedGenres.includes(genre)
                      ? "bg-[#E5A93D]/20 border-[#E5A93D]/50 text-[#E5A93D]"
                      : "bg-transparent border-white/10 text-zinc-300 hover:border-white/20"
                  )}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>

          {/* ÂGE CONSEILLÉ MAXIMUM */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Âge conseillé maximum</h3>
                <p className="text-[10px] text-zinc-600 mt-1">Classification US TMDB · inconnues exclues</p>
              </div>
              {isSearchActive && (
                <span className="text-[10px] text-amber-500 font-medium bg-amber-500/10 px-2 py-0.5 rounded shrink-0">
                  Indisponible en recherche texte
                </span>
              )}
            </div>
            <div className={cn("flex flex-wrap gap-2", isSearchActive && "opacity-30 pointer-events-none grayscale")}>
              {AGE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setPegi(opt.id)}
                  className={cn(
                    "min-w-12 h-11 px-3 flex items-center justify-center rounded-xl text-[13px] font-bold transition-all border",
                    pegi === opt.id
                      ? opt.id === 'Tous' ? "bg-green-500/20 text-green-400 border-green-500/50" : "bg-[#E5A93D]/20 border-[#E5A93D]/50 text-[#E5A93D]"
                      : "bg-transparent border-white/10 text-zinc-400 hover:border-white/20"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* NOTE MINIMUM */}
          <div>
            <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-3">Note Minimum — Toutes</h3>
            <div className="flex flex-wrap gap-2">
              {RATING_OPTIONS.map(opt => (
                <button
                  key={opt}
                  onClick={() => setRating(opt)}
                  className={cn(
                    "px-4 py-2.5 rounded-full text-[13px] font-bold transition-all border",
                    rating === opt
                      ? "bg-[#E5A93D]/20 text-[#E5A93D] border-[#E5A93D]/50"
                      : "bg-transparent border-white/10 text-zinc-400 hover:border-white/20"
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Validate Button */}
        <div className="pt-4 border-t border-white/5 shrink-0">
          <button
            onClick={handleValidate}
            className="w-full bg-[#E5A93D] text-black font-bold text-[15px] py-4 rounded-2xl shadow-[0_4px_14px_0_rgba(229,169,61,0.3)] hover:bg-[#F6BA4E] transition-colors"
          >
            Afficher les résultats
          </button>
        </div>

      </div>
    </div>
  );
}
