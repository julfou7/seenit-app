sed -i 's/Archive } from '\''lucide-react'\''/Archive, Trash2 } from '\''lucide-react'\''/' src/screens/ShowDetailScreen.tsx
sed -i '/const toggleMediaType = async () => {/i \
  const deleteShow = async () => {\
    if (!show?.id) return;\
    if (window.confirm("Voulez-vous vraiment ne plus suivre cette série ?")) {\
      await db.shows.delete(show.id);\
      onBack();\
    }\
  };\
' src/screens/ShowDetailScreen.tsx
sed -i '/<button/i \
                <button \
                  onClick={deleteShow}\
                  className="bg-red-500/10 border border-red-500/20 backdrop-blur-xl rounded-2xl p-4 flex items-center justify-center gap-2 text-sm font-bold transition-all active:scale-95 text-red-500 shadow-xl col-span-2"\
                >\
                  <Trash2 size={16} />\
                  Ne plus suivre\
                </button>' src/screens/ShowDetailScreen.tsx
