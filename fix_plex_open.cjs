const fs = require('fs');
const file = 'src/features/plex/syncPlex.ts';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('openExternalUrl')) {
  content = content.replace(
    /import \{ useToastStore \} from '\.\.\/\.\.\/store\/toastStore';/,
    "import { useToastStore } from '../../store/toastStore';\nimport { openExternalUrl } from '../../lib/utils';"
  );
}

content = content.replace(
  /window\.location\.href = `https:\/\/watch\.plex\.tv\/\$\{type\}\/\$\{resolvedSlug\}`;/g,
  "openExternalUrl(`https://watch.plex.tv/${type}/${resolvedSlug}`);"
);

content = content.replace(
  /window\.location\.href = `https:\/\/watch\.plex\.tv`;/g,
  "openExternalUrl(`https://watch.plex.tv`);"
);

fs.writeFileSync(file, content);
