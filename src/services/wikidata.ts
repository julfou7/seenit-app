export interface FranchiseItem {
  id: number;
  media_type: 'tv' | 'movie';
}

export async function getWikidataFranchiseTimeline(tmdbId: number, mediaType: 'tv' | 'movie'): Promise<FranchiseItem[]> {
  const propertyId = mediaType === 'tv' ? 'P4983' : 'P4947';

  // SPARQL query: finds franchise (P179), direct links (P155/P156), spin-offs (P4552 / P8345), based-on (P144) and 2-hop relations
  const sparqlQuery = `
    SELECT DISTINCT ?relatedTmdbTv ?relatedTmdbMovie ?date WHERE {
      ?item wdt:${propertyId} "${tmdbId}" .
      {
        ?item (wdt:P4552|wdt:P8345|wdt:P144|^wdt:P144|wdt:P155|wdt:P156|wdt:P179|^wdt:P179) ?related .
      } UNION {
        ?item (wdt:P4552|wdt:P8345|wdt:P144|^wdt:P144|wdt:P155|wdt:P156|wdt:P179|^wdt:P179) ?mid .
        ?mid (wdt:P4552|wdt:P8345|wdt:P144|^wdt:P144|wdt:P155|wdt:P156|wdt:P179|^wdt:P179) ?related .
      }
      OPTIONAL { ?related wdt:P4983 ?relatedTmdbTv . }
      OPTIONAL { ?related wdt:P4947 ?relatedTmdbMovie . }
      OPTIONAL { ?related wdt:P577|wdt:P580 ?date . }
    } ORDER BY ?date
  `;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'SeriesApp/1.0' }
    });
    
    if (!response.ok) return [];

    const data = await response.json();
    const results: FranchiseItem[] = [];

    data.results?.bindings?.forEach((row: any) => {
      const tvIdStr = row.relatedTmdbTv?.value;
      const movieIdStr = row.relatedTmdbMovie?.value;

      if (tvIdStr) {
        const id = parseInt(tvIdStr, 10);
        if (!isNaN(id) && !results.some(r => r.id === id && r.media_type === 'tv')) {
          results.push({ id, media_type: 'tv' });
        }
      } else if (movieIdStr) {
        const id = parseInt(movieIdStr, 10);
        if (!isNaN(id) && !results.some(r => r.id === id && r.media_type === 'movie')) {
          results.push({ id, media_type: 'movie' });
        }
      }
    });

    return results;
  } catch (error) {
    console.error('[Wikidata] Erreur SPARQL:', error);
    return [];
  }
}

