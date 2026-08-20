const fs = require('fs');
let code = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf-8');

// 1. Remove the declaration around line 1614
code = code.replace("  const title = show?.title || tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';\n", "");

// 2. Insert it at line 225
const searchStr = "const [tmdbDetails, setTmdbDetails] = useState<any>(null);";
code = code.replace(searchStr, searchStr + "\n  const title = show?.title || tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';");

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', code);
console.log('Fixed TDZ issue');
