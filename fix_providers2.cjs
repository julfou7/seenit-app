const fs = require('fs');
let content = fs.readFileSync('src/screens/ShowDetailScreen.tsx', 'utf8');

content = content.replace(/<\/div>\s*\}\)\)\}\s*<\/div>/, `</div>\n                  )))})()}\n                </div>`);
// if it didn't match, let's find the exact string
const toReplace = `                  ))}
                </div>`;
const replaceWith = `                  )))})()}
                </div>`;
content = content.replace(toReplace, replaceWith);

fs.writeFileSync('src/screens/ShowDetailScreen.tsx', content);
