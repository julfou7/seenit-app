const fs = require('fs');
let c = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

c = c.replace(
  /const \[visibleCast, setVisibleCast\] = useState\(12\);/,
  `const [visibleCast, setVisibleCast] = useState(12);\n  const [showAllCast, setShowAllCast] = useState(false);`
);

const castingRegex = /<h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider mb-4 px-4">Têtes d'affiche<\/h3>\s*<div className="flex gap-4 overflow-x-auto px-4 pb-4 snap-x snap-mandatory hide-scrollbar">.*?<\/div>/s;

const newCasting = `<div className="flex items-center justify-between px-4 mb-4">
               <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Têtes d'affiche</h3>
               {!showAllCast && tmdbDetails.credits.cast.length > visibleCast && (
                 <button onClick={() => setShowAllCast(true)} className="text-[#E5A93D] text-xs font-bold uppercase tracking-wider">
                   Voir tout
                 </button>
               )}
             </div>
             
             {!showAllCast ? (
               <div className="flex gap-4 overflow-x-auto px-4 pb-4 snap-x snap-mandatory hide-scrollbar">
                  {tmdbDetails.credits.cast.slice(0, visibleCast).map((actor: any) => (
                     <button 
                        key={actor.id} 
                        onClick={() => setSelectedPersonId(actor.id)}
                        className="flex flex-col items-center gap-2 w-[80px] shrink-0 snap-start touch-manipulation active:scale-95 transition-transform text-center"
                      >
                        <div className="w-20 h-20 rounded-full overflow-hidden bg-zinc-800 shrink-0 shadow-md border border-white/5">
                           {actor.profile_path ? (
                              <img src={\`https://image.tmdb.org/t/p/w185\${actor.profile_path}\`} alt={actor.name} className="w-full h-full object-cover" />
                           ) : (
                              <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{actor.name.charAt(0)}</div>
                           )}
                        </div>
                        <div className="w-full">
                           <p className="text-xs font-bold text-zinc-200 truncate">{actor.name}</p>
                           <p className="text-[10px] text-zinc-500 truncate">{actor.character}</p>
                        </div>
                     </button>
                  ))}
               </div>
             ) : (
               <div className="grid grid-cols-2 gap-4 px-4 pb-4">
                  {tmdbDetails.credits.cast.map((actor: any) => (
                     <button 
                        key={actor.id} 
                        onClick={() => setSelectedPersonId(actor.id)}
                        className="flex items-center gap-3 bg-zinc-900/50 p-2 rounded-2xl border border-white/5 text-left touch-manipulation active:scale-95 transition-transform"
                      >
                        <div className="w-12 h-12 rounded-full overflow-hidden bg-zinc-800 shrink-0">
                           {actor.profile_path ? (
                              <img src={\`https://image.tmdb.org/t/p/w185\${actor.profile_path}\`} alt={actor.name} className="w-full h-full object-cover" />
                           ) : (
                              <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs font-bold">{actor.name.charAt(0)}</div>
                           )}
                        </div>
                        <div className="flex-1 min-w-0">
                           <p className="text-xs font-bold text-zinc-200 truncate">{actor.name}</p>
                           <p className="text-[10px] text-zinc-500 truncate">{actor.character}</p>
                        </div>
                     </button>
                  ))}
               </div>
             )}`;

c = c.replace(castingRegex, newCasting);

// Remove the intersection observer spinner for casting since we don't paginate anymore for "showAllCast"
c = c.replace(/\{tmdbDetails\.credits\.cast\.length > visibleCast && \(\s*<div ref=\{castObserverRef\} className="h-10 w-full mt-4 flex items-center justify-center">\s*<div className="animate-spin rounded-full h-5 w-5 border-b-2 border-\[#E5A93D\]" \/>\s*<\/div>\s*\)\}/g, '');

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', c);
