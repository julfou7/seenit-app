export interface FranchiseItem {
  id: number;
  media_type: 'tv' | 'movie';
}

export async function getWikidataFranchiseTimeline(tmdbId: number, mediaType: 'tv' | 'movie', imdbId?: string | null): Promise<FranchiseItem[]> {
  const primaryProperty = mediaType === 'tv' ? 'wdt:P4983' : 'wdt:P4947';
  const fallbackProperty = mediaType === 'tv' ? 'wdt:P4947' : 'wdt:P4983';
  const imdbFilter = imdbId ? `UNION { ?item wdt:P345 "${imdbId}" }` : '';

  // SPARQL query: finds franchise (P179), spin-offs (P4552 / P8345), sequels/prequels (P155/P156), part of / has part (P361/P527), fictional universe (P1434/P1445), based on (P144), and derivative work (P4969)
  const relProps = 'wdt:P179|^wdt:P179|wdt:P4552|^wdt:P4552|wdt:P8345|^wdt:P8345|wdt:P155|^wdt:P155|wdt:P156|^wdt:P156|wdt:P361|^wdt:P361|wdt:P1434|^wdt:P1434|wdt:P144|^wdt:P144|wdt:P527|^wdt:P527|wdt:P4969|^wdt:P4969|wdt:P1445|^wdt:P1445';

  const sparqlQuery = `
    SELECT DISTINCT ?relatedTmdbTv ?relatedTmdbMovie ?date WHERE {
      { { ?item ${primaryProperty} "${tmdbId}" } UNION { ?item ${fallbackProperty} "${tmdbId}" } ${imdbFilter} } .
      {
        ?item (${relProps})? ?level1 .
        ?level1 (${relProps})? ?level2 .
        ?level2 (${relProps})? ?level3 .
        ?level3 (${relProps})? ?related .
      }
      OPTIONAL { ?related wdt:P4983 ?relatedTmdbTv . }
      OPTIONAL { ?related wdt:P4947 ?relatedTmdbMovie . }
      OPTIONAL { ?related wdt:P577|wdt:P580 ?date . }
      FILTER(BOUND(?relatedTmdbTv) || BOUND(?relatedTmdbMovie))
    }
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

