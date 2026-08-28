const fs = require('fs');
const file = 'src/features/plex/plexAvailability.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /export function getPlexMediaKey\(tmdbId\?: number \| string \| null, title\?: string, mediaType: 'movie' \| 'tv' = 'movie'\): string \{\n  if \(tmdbId\) return `\$\{mediaType\}:\$\{tmdbId\}`;\n  return `\$\{mediaType\}:\$\{normalizeTitle\(title\)\}`;\n\}/g,
  `export function getPlexMediaKey(tmdbId?: number | string | null, title?: string, mediaType: 'movie' | 'tv' = 'movie'): string {
  if (tmdbId) return \`v2:\${mediaType}:\${tmdbId}\`;
  return \`v2:\${mediaType}:\${normalizeTitle(title)}\`;
}`
);

fs.writeFileSync(file, content);
