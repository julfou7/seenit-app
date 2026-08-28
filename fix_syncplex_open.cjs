const fs = require('fs');
const file = 'src/features/plex/syncPlex.ts';
let content = fs.readFileSync(file, 'utf8');

const regex = /export const openPlexWatchUrl = async \([\s\S]*?\};\n/g;

const replacement = `export const openPlexWatchUrl = async (show: any) => {
  const tmdbId = show.tmdbId;
  const type = show.mediaType === 'tv' ? 'show' : 'movie';
  const showId = show.id;
  const userId = auth.currentUser?.uid;
  
  if (show.plexSlug) {
    // 1. Slug was already saved in DB -> reliable -> open directly
    openExternalUrl(\`https://watch.plex.tv/\${type}/\${show.plexSlug}\`);
    return;
  }

  // 2. Fetch from backend
  const RESOLVE_ENDPOINTS = [
    'https://seenit.ai.studio/api/plex/resolve-slug',
    'https://ais-pre-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug',
    'https://ais-dev-mooctibtw2amkshvkzlqij-700628279309.europe-west2.run.app/api/plex/resolve-slug',
    '/api/plex/resolve-slug'
  ];

  let resolvedSlug = null;
  const token = localStorage.getItem('plex_auth_token') || localStorage.getItem('plex_token') || '';

  for (const ep of RESOLVE_ENDPOINTS) {
    try {
      const response = await fetch(\`\${ep}?tmdbId=\${tmdbId}&type=\${type}&token=\${token}\`);
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
    // 3. Save to DB so we don't have to fetch again
    if (showId && userId) {
      try {
        const showRef = doc(db, \`users/\${userId}/shows\`, showId);
        await updateDoc(showRef, { plexSlug: resolvedSlug });
        // Optimistically update the store if possible
        const storeShows = useShowsStore.getState().shows;
        const idx = storeShows.findIndex(s => s.id === showId);
        if (idx >= 0) {
          const updated = [...storeShows];
          updated[idx] = { ...updated[idx], plexSlug: resolvedSlug };
          useShowsStore.getState().setShows(updated);
        }
      } catch (err) {
        console.warn('Failed to save plexSlug to DB', err);
      }
    }
    openExternalUrl(\`https://watch.plex.tv/\${type}/\${resolvedSlug}\`);
    return;
  }

  // 4. Fallback if resolution fails
  openExternalUrl(\`https://watch.plex.tv\`);
};
`;

content = content.replace(regex, replacement);
fs.writeFileSync(file, content);
