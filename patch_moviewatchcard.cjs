const fs = require('fs');
let code = fs.readFileSync('src/components/cards/MovieWatchCard.tsx', 'utf-8');

// 1. Add fullReleaseDate state
code = code.replace(
  /const \[releaseYear, setReleaseYear\] = useState<string \| null>\([\s\S]*?\);/,
  `const [releaseYear, setReleaseYear] = useState<string | null>(
    show.firstAirDate ? show.firstAirDate.slice(0, 4) : null
  );
  const [fullReleaseDate, setFullReleaseDate] = useState<string | null>(
    show.firstAirDate || null
  );`
);

// 2. Update setFullReleaseDate in useEffect
code = code.replace(
  /if \(res\.value\.release_date && !releaseYear\) \{\s*setReleaseYear\(res\.value\.release_date\.slice\(0, 4\)\);\s*\}/,
  `if (res.value.release_date) {
              if (!releaseYear) setReleaseYear(res.value.release_date.slice(0, 4));
              if (fullReleaseDate !== res.value.release_date) setFullReleaseDate(res.value.release_date);
            }`
);

// 3. Update the badge logic
const oldLogic = `// Badge "AU CINÉMA" / sortie récente
  let cinemaBadge = null;
  
  if (show.firstAirDate) {
    const [y, m, d] = show.firstAirDate.split('-').map(Number);
    if (y && m && d) {
      const relDate = new Date(y, m - 1, d);
      relDate.setHours(0, 0, 0, 0);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const diffMs = now.getTime() - relDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-red-600 to-amber-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap animate-pulse">
            SORTI AUJOURD'HUI 🔥
          </div>
        );
      } else if (diffDays === 1) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-blue-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">
            SORTI HIER 🌟
          </div>
        );
      } else if (diffDays > 1 && diffDays <= 7) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-indigo-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">
            SORTI IL Y A {diffDays}J 🆕
          </div>
        );
      } else if (isMovieAtCinema(show)) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-amber-600 to-rose-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap shadow-black/50">
            AU CINÉMA 🎬
          </div>
        );
      } else if (isMovieUpcoming(show)) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-purple-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap shadow-black/50">
            À VENIR 🗓️
          </div>
        );
      }
    }
  }`;

const newLogic = `// Badge "AU CINÉMA" / sortie récente
  let cinemaBadge = null;
  const mockTmdbData = { media_type: 'movie', release_date: fullReleaseDate };
  
  if (fullReleaseDate) {
    const [y, m, d] = fullReleaseDate.split('-').map(Number);
    if (y && m && d) {
      const relDate = new Date(y, m - 1, d);
      relDate.setHours(0, 0, 0, 0);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const diffMs = now.getTime() - relDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-red-600 to-amber-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap animate-pulse">
            SORTI AUJOURD'HUI 🔥
          </div>
        );
      } else if (diffDays === 1) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-blue-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">
            SORTI HIER 🌟
          </div>
        );
      } else if (diffDays > 1 && diffDays <= 7) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-indigo-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap">
            SORTI IL Y A {diffDays}J 🆕
          </div>
        );
      } else if (isMovieAtCinema(mockTmdbData)) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-amber-600 to-rose-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap shadow-black/50">
            AU CINÉMA 🎬
          </div>
        );
      } else if (isMovieUpcoming(mockTmdbData)) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-purple-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap shadow-black/50">
            À VENIR 🗓️
          </div>
        );
      }
    } else {
      if (isMovieAtCinema(mockTmdbData)) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r from-amber-600 to-rose-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap shadow-black/50">
            AU CINÉMA 🎬
          </div>
        );
      } else if (isMovieUpcoming(mockTmdbData)) {
        cinemaBadge = (
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 bg-purple-600 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-t-lg shadow-lg uppercase tracking-wider whitespace-nowrap shadow-black/50">
            À VENIR 🗓️
          </div>
        );
      }
    }
  }`;

if (code.includes('if (show.firstAirDate) {')) {
  code = code.replace(oldLogic, newLogic);
  fs.writeFileSync('src/components/cards/MovieWatchCard.tsx', code);
  console.log('Successfully patched MovieWatchCard');
} else {
  console.log('Could not find target code snippet');
}
