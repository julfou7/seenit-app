import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Check, X } from 'lucide-react';
import { DialogLayer } from './ui/DialogLayer';
import { auth } from '../lib/firebase';
import { readUserScopedJson, subscribeUserScopedStorageField } from '../lib/userIsolation';
import { DISCOVER_PLATFORM_ID_MAP, DISCOVER_PLATFORM_PREFERENCE_ID_MAP, MOVIE_RELEASE_YEAR_MIN } from '../features/discover/filterPolicy';
import { loadPlatformLogos, platformLogoUrl, readPlatformLogos } from '../features/providers/platformLogos';

export type FilterTab = 'Trier' | 'Plateformes' | 'Genres' | 'Note' | 'Âge' | 'Année';
const TABS: FilterTab[] = ['Trier', 'Plateformes', 'Genres', 'Note', 'Âge', 'Année'];
const GENRE_OPTIONS = ['Action', 'Aventure', 'Animation', 'Biopic', 'Comédie', 'Drame', 'Fantastique', 'Horreur', 'Romance', 'Sci-Fi', 'Thriller'];
const EXTRA_PLATFORM_LABELS: Record<string, string> = { paramount: 'Paramount+', france: 'France TV', arte: 'Arte' };
const PLATFORMS = [
  { id: 'netflix', label: 'Netflix' },
  { id: 'hbo', label: 'HBO' },
  { id: 'disney', label: 'Disney+' },
  { id: 'apple', label: 'Apple TV+' },
  { id: 'prime', label: 'Prime' },
  { id: 'canal', label: 'Canal+' },
  { id: 'max', label: 'Max' },
];
const AGE_OPTIONS = [
  { id: 'Tous', label: 'Tous les âges' }, { id: 'age:0', label: 'Tous publics' },
  ...[7, 10, 13, 14, 17, 18].map(age => ({ id: `age:${age}`, label: `Jusqu’à ${age} ans` })),
];
const RATING_OPTIONS = ['Toutes', '6+', '7+', '7.5+', '8+', '8.5+', '9+'];
const SORT_OPTIONS = [{ id: 'popular', label: 'Populaires' }, { id: 'rating', label: 'Mieux notés' }, { id: 'date', label: 'Plus récents' }, { id: 'title', label: 'A → Z' }] as const;
type Sort = typeof SORT_OPTIONS[number]['id'];
interface FilterModalProps {
  onClose: () => void;
  activeCategory: string;
  setActiveCategory: (category: string) => void;
  initialSelectedPlatforms: string[];
  initialSelectedGenres: string[];
  initialPegi: string;
  initialRating: string;
  initialMovieReleaseAfterYear: string;
  query: string;
  onApply: (platforms: string[], genres: string[], age: string, rating: string, year: string) => void;
  sortBy?: Sort;
  onSort?: (sort: Sort) => void;
  initialTab?: FilterTab;
  onTabChange?: (tab: FilterTab) => void;
  resultCount?: number | null;
}
export function FilterModal({ onClose, setActiveCategory, initialSelectedPlatforms: platforms, initialSelectedGenres: genres, initialPegi: age, initialRating: rating, initialMovieReleaseAfterYear: year, onApply, sortBy = 'popular', onSort, initialTab = 'Plateformes', onTabChange, resultCount }: FilterModalProps) {
  const [tab, setTab] = useState<FilterTab>(initialTab);
  const uid = auth.currentUser?.uid ?? null;
  const subscribe = useCallback((listener: () => void) => subscribeUserScopedStorageField(uid, 'platforms', listener), [uid]);
  const snapshot = useCallback(() => JSON.stringify(readUserScopedJson<number[]>(uid, 'platforms', [])), [uid]);
  const saved: number[] = JSON.parse(useSyncExternalStore(subscribe, snapshot, () => '[]'));
  const [platformLogos, setPlatformLogos] = useState<Record<number, string>>(() => readPlatformLogos());
  useEffect(() => {
    let current = true;
    const preferenceIds = Object.values(DISCOVER_PLATFORM_PREFERENCE_ID_MAP).map(Number).filter(Number.isFinite);
    void loadPlatformLogos(preferenceIds).then(logos => { if (current) setPlatformLogos(logos); });
    return () => { current = false; };
  }, []);
  const preferenceId = (id: string) => Number(DISCOVER_PLATFORM_PREFERENCE_ID_MAP[id]);
  const withCanonicalLogo = ({ id, label }: { id: string; label: string }) => ({ id, label, logo: platformLogos[preferenceId(id)] || '' });
  const available = [
    ...PLATFORMS.map(withCanonicalLogo),
    ...Object.entries(EXTRA_PLATFORM_LABELS)
      .filter(([id]) => saved.includes(preferenceId(id)) || platforms.includes(id))
      .map(([id, label]) => withCanonicalLogo({ id, label })),
  ];
  const preferred = Object.keys(DISCOVER_PLATFORM_ID_MAP).filter(id => saved.includes(preferenceId(id)));
  const mine = preferred.length > 0 && preferred.length === platforms.length && preferred.every(id => platforms.includes(id));
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(value => value !== id) : [...list, id];
  const counts = { Trier: sortBy !== 'popular' ? 1 : 0, Plateformes: platforms.length, Genres: genres.length, Note: rating !== 'Toutes' ? 1 : 0, Âge: age !== 'Tous' ? 1 : 0, Année: year !== 'Toutes' ? 1 : 0 };
  const active = Object.values(counts).some(Boolean);
  const reset = () => { onApply([], [], 'Tous', 'Toutes', 'Toutes'); onSort?.('popular'); };
  const changeYear = (value: string) => {
    if (value !== 'Toutes') setActiveCategory('Films');
    onApply(platforms, genres, age, rating, value);
  };
  const currentYear = new Date().getFullYear();
  return <DialogLayer label="Filtres" onDismiss={onClose} historyMode="local" role="dialog"
    className="explorer-filter-overlay" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="explorer-filter-sheet">
      <div className="explorer-sheet-handle" aria-hidden="true" />
      <header><h2>Filtres</h2>{active && <button type="button" onClick={reset}>Réinitialiser</button>}
        <button type="button" aria-label="Fermer les filtres" onClick={onClose}><X size={20} /></button></header>
      <div className="explorer-filter-tabs" role="tablist" aria-label="Type de filtre">
        {TABS.map(value => <button type="button" role="tab" key={value} id={`filter-tab-${value}`} aria-controls="explorer-filter-content"
          aria-selected={value === tab} onClick={() => { setTab(value); onTabChange?.(value); }}>
          {value}{counts[value] > 0 && <span>{counts[value]}</span>}
        </button>)}
      </div>
      <div className="explorer-filter-content" role="tabpanel" id="explorer-filter-content" aria-labelledby={`filter-tab-${tab}`}>
        {tab === 'Trier' && <div className="explorer-sort-options">{SORT_OPTIONS.map(option =>
          <button type="button" role="radio" aria-checked={sortBy === option.id} key={option.id} onClick={() => onSort?.(option.id)}>
            {option.label}<span>{sortBy === option.id && <Check size={16} />}</span>
          </button>)}</div>}
        {tab === 'Plateformes' && <>
          <button type="button" role="switch" aria-checked={mine} disabled={!preferred.length} className="explorer-mine"
            onClick={() => onApply(mine ? [] : preferred, genres, age, rating, year)}>
            <span><strong>Mes plateformes</strong><small>{preferred.length ? preferred.map(id => available.find(p => p.id === id)?.label || id).join(', ') : 'À choisir dans Réglages'}</small></span>
            <i className={mine ? 'is-on' : ''} />
          </button>
          <div className="explorer-platform-grid">{available.map(platform => <button type="button" key={platform.id}
            aria-pressed={platforms.includes(platform.id)} onClick={() => onApply(toggle(platforms, platform.id), genres, age, rating, year)}>
            {platform.logo && <img src={platformLogoUrl(platform.logo)!} alt="" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}
            <span>{platform.label}</span>{platforms.includes(platform.id) && <Check size={14} className="explorer-selected-check" />}
          </button>)}</div>
        </>}
        {tab === 'Genres' && <div className="explorer-genre-grid">{GENRE_OPTIONS.map(genre => <button type="button" key={genre} aria-pressed={genres.includes(genre)}
          onClick={() => onApply(platforms, toggle(platforms, genre), age, rating, year)}>{genre}</button>)}</div>}
        {tab === 'Note' && <div className="explorer-slider"><strong>{rating === 'Toutes' ? 'Toutes les notes' : `★ ${rating.replace('.', ',').replace('+', '')} et plus`}</strong>
          <input type="range" min={0} max={RATING_OPTIONS.length - 1} value={Math.max(0, RATING_OPTIONS.indexOf(rating))} aria-label="Note minimale" aria-valuetext={rating}
            onChange={event => onApply(platforms, genres, age, RATING_OPTIONS[Number(event.target.value)], year)} />
          <div><span>Toutes</span><span>9+</span></div>
        </div>}
        {tab === 'Âge' && <div className="explorer-slider"><strong>{AGE_OPTIONS.find(option => option.id === age)?.label || 'Tous les âges'}</strong>
          <input type="range" min={0} max={AGE_OPTIONS.length - 1} value={Math.max(0, AGE_OPTIONS.findIndex(option => option.id === age))} aria-label="Âge conseillé" aria-valuetext={AGE_OPTIONS.find(option => option.id === age)?.label}
            onChange={event => onApply(platforms, genres, AGE_OPTIONS[Number(event.target.value)].id, rating, year)} />
          <div><span>Tous</span><span>18 ans</span></div><p>Classification US TMDB. Un âge inconnu est exclu.</p>
        </div>}
        {tab === 'Année' && <div className="explorer-slider"><strong>{year === 'Toutes' ? 'Toutes les années' : `Sortis après ${year}`}</strong>
          <input type="range" min={MOVIE_RELEASE_YEAR_MIN - 1} max={currentYear} value={year === 'Toutes' ? MOVIE_RELEASE_YEAR_MIN - 1 : Number(year)}
            aria-label="Films sortis après" aria-valuetext={year} onChange={event => changeYear(Number(event.target.value) < MOVIE_RELEASE_YEAR_MIN ? 'Toutes' : event.target.value)} />
          <div><span>Toutes</span><span>{currentYear}</span></div>
          <label>Année <select value={year} onChange={event => changeYear(event.target.value)}><option>Toutes</option>
            {Array.from({ length: currentYear - MOVIE_RELEASE_YEAR_MIN + 1 }, (_, index) => <option key={index}>{currentYear - index}</option>)}</select></label>
        </div>}
      </div>
      <footer><button type="button" className="explorer-filter-submit" onClick={onClose}>
        {resultCount === 0 ? 'Aucun titre avec ces filtres' : resultCount == null ? 'Afficher les résultats' : `Afficher ${resultCount} titres`}
      </button></footer>
    </div>
  </DialogLayer>;
}