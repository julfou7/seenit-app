const fs = require('fs');
let code = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf-8');

// 1. Move title declaration to the top
const titleDecl = "  const title = show?.title || tmdbDetails?.name || tmdbDetails?.title || 'Chargement...';\n";
code = code.replace(/const \[tmdbDetails, setTmdbDetails\] = useState<any>\(null\);/, (match) => match + '\n' + titleDecl);

// 2. Remove old title declaration
code = code.replace(/  const title = show\?\.title \|\| tmdbDetails\?\.name \|\| tmdbDetails\?\.title \|\| 'Chargement\.\.\.';\n/, '');

// 3. Move checkPlexAvailability inside fetchDetails to ensure we have the correct title
// Let's replace the whole block of checkPlexAvailability.

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', code);
