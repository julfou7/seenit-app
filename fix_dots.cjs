const fs = require('fs');
let content = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

content = content.replace(
  '<div className="relative">\n              <button \n                onClick={() => setShowMenu(!showMenu)}\n                className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10"\n              >',
  '<div className="relative z-30">\n              <button \n                onClick={() => setShowMenu(!showMenu)}\n                className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white"\n              >'
);

content = content.replace(
  'className="absolute right-0 mt-2 w-56 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col py-2 animate-in fade-in slide-in-from-top-2"',
  'className="absolute right-0 mt-2 w-56 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col py-1"'
);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', content);
