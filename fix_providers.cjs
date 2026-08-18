const fs = require('fs');
let content = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

// Undo the bad ending replacement
content = content.replace(`</div>
              </div>
            )})()}`, `</div>
              </div>
            )}`);

// Fix the map end replacement
content = content.replace(/<\/div>\s*\}\)\)\}\s*<\/div>/, `</div>\n                  )))})()}\n                </div>`);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', content);
