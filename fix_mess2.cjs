const fs = require('fs');
let lines = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8').split('\n');

lines.splice(930, 0, '          </div>', '        )}');

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', lines.join('\n'));
