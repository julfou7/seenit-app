const fs = require('fs');
const file = 'src/features/plex/syncPlex.ts';
let content = fs.readFileSync(file, 'utf8');

const replacement = `export const openPlexWatchUrl = async (tmdbId: string, type: 'movie' | 'show') => {
  const RESOLVE_ENDPOINTS = [
    'https://seenit.ai.studio/api/plex/resolve-slug',
    'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug',
    'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug',
    '/api/plex/resolve-slug'
  ];

  let resolvedSlug = null;
  for (const ep of RESOLVE_ENDPOINTS) {
    try {
      const response = await fetch(\`\${ep}?tmdbId=\${tmdbId}&type=\${type}\`);
      if (response.ok) {
        const data = await response.json();
        if (data?.slug) {
          resolvedSlug = data.slug;
          break;
        }
      }
    } catch (error) {
      // Ignorer l'erreur et essayer le suivant
    }
  }

  if (resolvedSlug) {
    window.location.href = \`https://watch.plex.tv/\${type}/\${resolvedSlug}\`;
    return;
  }

  // Si pas de slug ou erreur API -> Redirection d'accueil uniquement
  window.location.href = \`https://watch.plex.tv\`;
};`;

content = content.replace(/export const openPlexWatchUrl = async \([\s\S]*?\};\n/g, replacement + '\n');
fs.writeFileSync(file, content);
