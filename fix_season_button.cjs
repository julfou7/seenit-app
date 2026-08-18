const fs = require('fs');
let content = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

const oldButton = `                  {!isFutureSeason && (
                    <button
                      onClick={(e) => toggleSeasonSeen(e, seasonNum, seasonEpCount)}
                      className="px-3 py-1.5 rounded-lg border border-[#E5A93D]/30 text-[10px] font-bold flex items-center gap-1.5 transition-colors active:scale-95 touch-manipulation uppercase tracking-wider shrink-0"
                      title={isFullyWatched ? "Marquer toute la saison comme non vue" : "Marquer toute la saison comme vue"}
                    >
                      {isFullyWatched ? (
                        <span className="text-[#E5A93D]">Vu</span>
                      ) : (
                        <span className="text-[#E5A93D]">Tout marquer</span>
                      )}
                    </button>
                  )}`;

const newButton = `                  {!isFutureSeason && (
                    <button
                      onClick={(e) => toggleSeasonSeen(e, seasonNum, seasonEpCount)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg border text-[10px] font-bold flex items-center gap-1.5 transition-colors active:scale-95 touch-manipulation uppercase tracking-wider shrink-0",
                        isFullyWatched ? "border-emerald-500 bg-emerald-500/15 text-emerald-400" : "border-[#E5A93D]/30 text-[#E5A93D]"
                      )}
                      title={isFullyWatched ? "Marquer toute la saison comme non vue" : "Marquer toute la saison comme vue"}
                    >
                      {isFullyWatched ? "Vu" : "Tout marquer"}
                    </button>
                  )}`;

if (content.includes('border border-[#E5A93D]/30 text-[10px] font-bold flex items-center gap-1.5 transition-colors active:scale-95 touch-manipulation uppercase tracking-wider shrink-0')) {
    content = content.replace(oldButton, newButton);
    fs.writeFileSync('src/screens/ShowDetailScreen.tsx', content);
    console.log("Success");
} else {
    console.log("Not found");
}
