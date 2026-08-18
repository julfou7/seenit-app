import re

with open("src/screens/ShowDetailScreen.tsx", "r") as f:
    content = f.read()

# Add MoreVertical to imports
if "MoreVertical" not in content:
    content = content.replace("Archive, Trash2 }", "Archive, Trash2, MoreVertical }")
    content = content.replace("Archive }", "Archive, Trash2, MoreVertical }")

# Replace all occurrences of the ugly buttons
buttons_regex = r"<button[^>]*onClick=\{deleteShow\}[^>]*>[\s\S]*?</button>|<button[^>]*onClick=\{toggleArchive\}[^>]*>[\s\S]*?</button>|<button[^>]*onClick=\{toggleMediaType\}[^>]*>[\s\S]*?</button>"
content = re.sub(buttons_regex, "", content)

# Remove the container div if it's empty now
empty_div_regex = r'<div className="grid grid-cols-2 gap-3 mb-6">\s*</div>'
content = re.sub(empty_div_regex, "", content)

# Add showMenu state
if "showMenu" not in content:
    state_injection = """  const [selectedEpisode, setSelectedEpisode] = useState<{season: number, episode: any} | null>(null);
  const [showMenu, setShowMenu] = useState(false);"""
    content = content.replace("  const [selectedEpisode, setSelectedEpisode] = useState<{season: number, episode: any} | null>(null);", state_injection)

# Add the 3-dots menu button and dropdown
dropdown_jsx = """
        {/* Menu 3-dots */}
        {show && (
          <div className="absolute top-12 right-4 z-50">
            <button 
              onClick={() => setShowMenu(!showMenu)}
              className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10"
            >
              <MoreVertical size={20} />
            </button>
            
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col py-2 animate-in fade-in slide-in-from-top-2">
                  <button 
                    onClick={() => { setShowMenu(false); toggleArchive(); }}
                    className="px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold"
                  >
                    <Archive size={16} className={show.isArchived ? "text-emerald-500" : "text-zinc-400"} />
                    {show.isArchived ? "Désarchiver" : "Archiver"}
                  </button>
                  <button 
                    onClick={() => { setShowMenu(false); toggleMediaType(); }}
                    className="px-4 py-3 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-3 font-semibold"
                  >
                    <Tv size={16} className="text-zinc-400" />
                    {show.mediaType === 'tv' ? 'Convertir en Film' : 'Convertir en Série'}
                  </button>
                  <div className="h-px bg-white/5 my-1" />
                  <button 
                    onClick={() => { setShowMenu(false); deleteShow(); }}
                    className="px-4 py-3 text-left text-sm text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-3 font-semibold"
                  >
                    <Trash2 size={16} />
                    Ne plus suivre
                  </button>
                </div>
              </>
            )}
          </div>
        )}
"""

# Insert dropdown into Hero Header before {/* Content */}
if "{/* Content */}" in content:
    content = content.replace("{/* Content */}", dropdown_jsx + "\n        {/* Content */}")

with open("src/screens/ShowDetailScreen.tsx", "w") as f:
    f.write(content)

