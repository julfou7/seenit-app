const fs = require('fs');
let code = fs.readFileSync('src/components/cards/MovieWatchCard.tsx', 'utf-8');

code = code.replace(
  /if \(!runtime \|\| !releaseYear\) \{/,
  `if (!runtime || !releaseYear || !fullReleaseDate || fullReleaseDate.length <= 4) {`
);

fs.writeFileSync('src/components/cards/MovieWatchCard.tsx', code);
console.log('Successfully patched MovieWatchCard 2');
