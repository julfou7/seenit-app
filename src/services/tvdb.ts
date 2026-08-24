export interface TVDBFranchiseItem {
  id: number;
  media_type: 'tv' | 'movie';
}

let tvdbTokenCache: { token: string; expiresAt: number } | null = null;

const TVDB_API_KEY = '003b4e7b-87b7-4756-b227-bb241093216f';
const BASE_URL = 'https://api4.thetvdb.com/v4';

async function getTVDBToken(): Promise<string | null> {
  const now = Date.now();
  if (tvdbTokenCache && tvdbTokenCache.expiresAt > now) {
    return tvdbTokenCache.token;
  }

  try {
    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: TVDB_API_KEY }),
    });

    if (!response.ok) {
      console.error('[TVDB] Erreur lors de l’authentification:', response.statusText);
      return null;
    }

    const json = await response.json();
    const token = json.data?.token;
    if (token) {
      // Token valide pour 24h
      tvdbTokenCache = {
        token,
        expiresAt: now + 24 * 60 * 60 * 1000,
      };
      return token;
    }
  } catch (err) {
    console.error('[TVDB] Erreur de connexion:', err);
  }

  return null;
}

/**
 * Récupère la liste des œuvres rattachées à la franchise / univers d'une série via TVDB.
 */
export async function getTVDBFranchiseTimeline(
  tvdbId?: number | null,
  mediaTitle?: string | null,
  imdbId?: string | null
): Promise<TVDBFranchiseItem[]> {
  const token = await getTVDBToken();
  if (!token) return [];

  let activeTvdbId = tvdbId;
  let listId: number | string | null = null;

  // A. Si aucun ID TVDB fourni, rechercher par titre sur TVDB
  if (!activeTvdbId && mediaTitle) {
    try {
      const searchRes = await fetch(
        `${BASE_URL}/search?query=${encodeURIComponent(mediaTitle)}&type=series`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (searchRes.ok) {
        const sData = await searchRes.json();
        if (sData.data && sData.data.length > 0) {
          activeTvdbId = parseInt(sData.data[0].tvdb_id, 10);
        }
      }
    } catch (e) {
      console.error('[TVDB] Erreur recherche série:', e);
    }
  }

  // B. Chercher une liste officielle/franchise rattachée à la série sur TVDB
  if (activeTvdbId) {
    try {
      const seriesRes = await fetch(`${BASE_URL}/series/${activeTvdbId}/extended`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (seriesRes.ok) {
        const seriesData = (await seriesRes.json()).data;
        const lists = seriesData?.lists || [];

        // Filtrer les listes correspondant à une franchise / un univers
        const franchiseList = lists.find(
          (l: any) =>
            l.isOfficial ||
            l.name.toLowerCase().includes('franchise') ||
            l.name.toLowerCase().includes('universe') ||
            l.name.toLowerCase().includes('collection') ||
            l.name.toLowerCase().includes('whoniverse') ||
            l.name.toLowerCase().includes('arrowverse') ||
            l.name.toLowerCase().includes('world of') ||
            l.name.toLowerCase().includes('one chicago')
        );

        if (franchiseList) {
          listId = franchiseList.id;
        }
      }
    } catch (e) {
      console.error('[TVDB] Erreur récupération détails série:', e);
    }
  }

  // C. Recherche de liste par le titre principal de la franchise si aucune liste directe
  if (!listId && mediaTitle) {
    try {
      const cleanTitle = mediaTitle.replace(/:(.*)/, '').trim();
      const searchListRes = await fetch(
        `${BASE_URL}/search?query=${encodeURIComponent(cleanTitle)}&type=list`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (searchListRes.ok) {
        const sListData = await searchListRes.json();
        const matchedList = sListData.data?.find(
          (l: any) =>
            l.name.toLowerCase().includes('franchise') ||
            l.name.toLowerCase().includes('universe') ||
            l.name.toLowerCase().includes('collection')
        );
        if (matchedList) {
          listId = matchedList.tvdb_id || matchedList.id;
        }
      }
    } catch (e) {
      console.error('[TVDB] Erreur recherche liste:', e);
    }
  }

  if (!listId) return [];

  // D. Récupérer les entités composant la liste de franchise
  try {
    const listRes = await fetch(`${BASE_URL}/lists/${listId}/extended`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) return [];

    const listData = (await listRes.json()).data;
    const entities = listData?.entities || [];

    // E. Extraire les identifiants TMDB de chaque entité en parallèle
    const promises = entities.map(async (entity: any) => {
      let url: string | null = null;
      let media_type: 'tv' | 'movie' = 'tv';

      if (entity.seriesId) {
        url = `${BASE_URL}/series/${entity.seriesId}/extended`;
        media_type = 'tv';
      } else if (entity.movieId) {
        url = `${BASE_URL}/movies/${entity.movieId}/extended`;
        media_type = 'movie';
      }

      if (!url) return null;

      const itemRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!itemRes.ok) return null;

      const itemData = (await itemRes.json()).data;
      const remoteIds = itemData?.remoteIds || [];
      const tmdbRemote = remoteIds.find(
        (r: any) =>
          r.type === 12 ||
          (r.sourceName && r.sourceName.toLowerCase().includes('themoviedb')) ||
          (r.sourceName && r.sourceName.toLowerCase().includes('tmdb'))
      );

      if (tmdbRemote?.id) {
        const parsedId = parseInt(tmdbRemote.id, 10);
        if (!isNaN(parsedId)) {
          return { id: parsedId, media_type };
        }
      }

      return null;
    });

    const results = await Promise.all(promises);
    return results.filter((r): r is TVDBFranchiseItem => r !== null);
  } catch (e) {
    console.error('[TVDB] Erreur récupération entités de liste:', e);
  }

  return [];
}
