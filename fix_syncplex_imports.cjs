const fs = require('fs');
const file = 'src/features/plex/syncPlex.ts';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(
  /import \{ collection, doc, writeBatch, getDocs \} from 'firebase\/firestore';/,
  "import { collection, doc, writeBatch, getDocs, updateDoc } from 'firebase/firestore';"
);
fs.writeFileSync(file, content);
