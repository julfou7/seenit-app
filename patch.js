const fs = require('fs');
let code = fs.readFileSync('src/screens/DiscoverScreen.tsx', 'utf8');
const searchIndex = code.indexOf('async function search() {');
if (searchIndex !== -1) {
  console.log("Found search function");
}
