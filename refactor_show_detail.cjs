const fs = require('fs');
let content = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

// 1. Reset states when effectiveTmdbId changes
const useEffectReplace = `  useEffect(() => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [effectiveTmdbId, showId]);`;

const useEffectNew = `  useEffect(() => {
    setTmdbDetails(null);
    setProviders(null);
    setSeasonsCache({});
    setExpandedSeason(null);
    setSelectedEpisode(null);
    setShowMenu(false);

    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [effectiveTmdbId, showId]);`;

content = content.replace(useEffectReplace, useEffectNew);

// 2. Tabs to Sticky anchors
// We need to add refs and change the tabs rendering.
const tabsRegex = /<div className="flex gap-6 border-b border-white\/10 px-4 mb-6 sticky top-0 bg-black z-10">.*?<\/div>/s;

const newTabs = `
      {/* ANCRES STICKY DE NAVIGATION */}
      <div className="sticky top-0 z-20 bg-black/90 backdrop-blur-xl flex gap-6 px-4 py-3 border-b border-white/10 overflow-x-auto hide-scrollbar">
        <button 
          onClick={() => {
            const el = document.getElementById('section-about');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
          className="text-sm font-bold uppercase tracking-wider text-white border-b-2 border-[#E5A93D] pb-1 whitespace-nowrap"
        >
          À propos
        </button>
        {(!tmdbDetails || tmdbDetails.seasons) && (
          <button 
            onClick={() => {
              const el = document.getElementById('section-episodes');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="text-sm font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 pb-1 whitespace-nowrap"
          >
            Épisodes
          </button>
        )}
        <button 
          onClick={() => {
            const el = document.getElementById('section-casting');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}
          className="text-sm font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-200 pb-1 whitespace-nowrap"
        >
          Casting
        </button>
      </div>
`;
content = content.replace(tabsRegex, newTabs);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', content);
