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
const tabsStartStr = `<div className="sticky top-[104px] z-10 px-4 pt-4 pb-2 bg-gradient-to-b from-black via-black/90 to-transparent">
        <div className="flex gap-1 bg-zinc-900 p-1 rounded-full border border-white/5">`;
        
const oldTabsRegex = /<div className="sticky top-\[104px\] z-10 px-4 pt-4 pb-2 bg-gradient-to-b from-black via-black\/90 to-transparent">\s*<div className="flex gap-1 bg-zinc-900 p-1 rounded-full border border-white\/5">.*?<\/div>\s*<\/div>/s;

const newTabs = `      {/* ANCRES STICKY DE NAVIGATION */}
      <div className="sticky top-[104px] z-20 px-4 pt-2 pb-2 bg-black/90 backdrop-blur-xl border-b border-white/10 flex gap-4 overflow-x-auto hide-scrollbar">
        <button 
          onClick={() => document.getElementById('section-about')?.scrollIntoView({ behavior: 'smooth' })}
          className="text-sm font-bold uppercase tracking-wider text-white whitespace-nowrap bg-zinc-800 px-4 py-1.5 rounded-full"
        >
          À propos
        </button>
        {isSeries && (
          <button 
            onClick={() => document.getElementById('section-episodes')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-sm font-bold uppercase tracking-wider text-zinc-400 hover:text-white whitespace-nowrap px-4 py-1.5"
          >
            Épisodes
          </button>
        )}
        {tmdbDetails?.credits?.cast && tmdbDetails.credits.cast.length > 0 && (
          <button 
            onClick={() => document.getElementById('section-casting')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-sm font-bold uppercase tracking-wider text-zinc-400 hover:text-white whitespace-nowrap px-4 py-1.5"
          >
            Casting
          </button>
        )}
      </div>`;
content = content.replace(oldTabsRegex, newTabs);

// 3. Remove conditional rendering for tabs and add section IDs
content = content.replace(/{activeTab === 'about' && \(/, `<div id="section-about" className="scroll-mt-40">\n        {true && (`);
content = content.replace(/{activeTab === 'episodes' && isSeries && \(/, `</div>\n        <div id="section-episodes" className="scroll-mt-40 mt-12">\n        {isSeries && (`);
content = content.replace(/{activeTab === 'casting' && tmdbDetails\?\.credits\?\.cast && \(/, `</div>\n        <div id="section-casting" className="scroll-mt-40 mt-12">\n        {tmdbDetails?.credits?.cast && (`);

// 4. About - Unique Providers
const providersMatch = `providers.flatrate.map((provider: any) => (`;
const providersReplace = `(() => {
                  const uniqueProviders = providers?.flatrate 
                    ? Array.from(new Map(providers.flatrate.map((p: any) => [p.provider_name.split(' ')[0], p])).values())
                    : [];
                  return uniqueProviders.map((provider: any) => (`;
content = content.replace(providersMatch, providersReplace);
// add closing brackets for IIFE
const providersEndMatch = `</div>
              </div>
            )}`;
const providersEndReplace = `</div>
              </div>
            )})()}`;
content = content.replace(providersEndMatch, providersEndReplace);

// 5. Remove "Year" card from Info Grid
const yearCardRegex = /<div className="bg-zinc-900\/50 border border-white\/5 p-3 rounded-2xl">.*?<p className="text-sm font-bold text-white mt-1">.*?<\/p>\s*<\/div>/s;
content = content.replace(yearCardRegex, '');

// 6. Episode row formatting
const episodeRowOld = `<span className="text-xs font-mono font-bold text-zinc-500 shrink-0 w-4 text-center">
                              {(ep.episode_number ?? 1).toString().padStart(2, '0')}
                            </span>
                            <div className="relative w-24 h-16 rounded-md overflow-hidden bg-zinc-800 shrink-0 border border-white/5">`;
                            
const episodeRowNew = `<div className="relative w-32 h-20 rounded-md overflow-hidden bg-zinc-800 shrink-0 border border-white/5">`;
content = content.replace(episodeRowOld, episodeRowNew);

// Add number and duration under title
const epTitleOld = `<p className={cn("text-[13px] font-bold truncate", isSeen ? "text-zinc-500 line-through" : "text-zinc-300")}>{ep.name}</p>
                               <p className="text-[11px] font-semibold text-zinc-500 mt-0.5">{ep.runtime ? \`\${Math.floor(ep.runtime / 60) > 0 ? \`\${Math.floor(ep.runtime / 60)}h\` : ''}\${ep.runtime % 60}min\` : '45min'}</p>`;
const epTitleNew = `<p className={cn("text-[14px] font-bold truncate leading-tight", isSeen ? "text-zinc-500 line-through" : "text-zinc-200")}>{ep.name}</p>
                               <p className="text-[12px] font-semibold text-zinc-500 mt-1">
                                 E{(ep.episode_number ?? 1).toString().padStart(2, '0')} • {ep.runtime ? \`\${Math.floor(ep.runtime / 60) > 0 ? \`\${Math.floor(ep.runtime / 60)}h \` : ''}\${ep.runtime % 60}min\` : '45min'}
                               </p>`;
content = content.replace(epTitleOld, epTitleNew);

// Adjust p-4 flex gap to remove span and fit image left
const epContainerOld = `className={cn("p-4 flex items-center gap-4 hover:bg-white/5 transition-colors cursor-pointer active:bg-white/10", isFutureEp && "opacity-50")}`;
const epContainerNew = `className={cn("p-3 flex items-center gap-3 hover:bg-white/5 transition-colors cursor-pointer active:bg-white/10", isFutureEp && "opacity-50")}`;
content = content.replace(epContainerOld, epContainerNew);


// 7. Casting Carousel
const castingGridOld = `<div className="grid grid-cols-2 gap-4">
                {tmdbDetails.credits.cast.slice(0, visibleCast).map((actor: any) => (
                   <button 
                      key={actor.id} 
                      onClick={() => setSelectedPersonId(actor.id)}
                      className="flex items-center gap-3 bg-zinc-900/50 p-2 rounded-2xl border border-white/5 text-left touch-manipulation active:scale-95 transition-transform"
                    >
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800 shrink-0">`;
                      
const castingGridNew = `<h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-4 px-4">Têtes d'affiche</h3>
             <div className="flex gap-4 overflow-x-auto px-4 pb-4 snap-x snap-mandatory hide-scrollbar">
                {tmdbDetails.credits.cast.slice(0, visibleCast).map((actor: any) => (
                   <button 
                      key={actor.id} 
                      onClick={() => setSelectedPersonId(actor.id)}
                      className="flex flex-col items-center gap-2 w-[80px] shrink-0 snap-start touch-manipulation active:scale-95 transition-transform text-center"
                    >
                      <div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-800 shrink-0 shadow-md border border-white/5">`;
content = content.replace(castingGridOld, castingGridNew);

const castingTextOld = `</div>
                      <div className="flex-1 min-w-0">
                         <p className="text-xs font-bold text-zinc-200 truncate">{actor.name}</p>
                         <p className="text-[10px] text-zinc-500 truncate">{actor.character}</p>
                      </div>
                   </button>`;
const castingTextNew = `</div>
                      <div className="w-full">
                         <p className="text-xs font-bold text-zinc-200 truncate">{actor.name}</p>
                         <p className="text-[10px] text-zinc-500 truncate">{actor.character}</p>
                      </div>
                   </button>`;
content = content.replace(castingTextOld, castingTextNew);

// 8. Similar Titles - Dynamic Title
const similarTitleOld = `<h3 className="px-4 text-xs font-bold uppercase text-zinc-500 tracking-wider mb-4">Titres similaires</h3>`;
const similarTitleNew = `<h3 className="px-4 text-xs font-bold uppercase text-zinc-500 tracking-wider mb-4">{isSeries ? "Séries similaires" : "Films similaires"}</h3>`;
content = content.replace(similarTitleOld, similarTitleNew);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', content);
console.log("Done refactoring");
