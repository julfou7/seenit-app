/** Transport C411 côté serveur. Une réponse invalide ou un échec n'est jamais un catalogue vide. */
export async function fetchC411Torrents(options: { apiKey: string; query: string; searchParams: URLSearchParams; signal: () => AbortSignal; fetcher?: typeof fetch }): Promise<unknown[]> {
  const request = options.fetcher || fetch;
  const urls = [...new Set([
    `https://c411.org/api/torrents?${options.searchParams}`,
    `https://c411.org/api/torrents?${new URLSearchParams({ name: options.query, category: '1', page: '1', perPage: '100', viewMode: 'flat' })}`,
    `https://c411.org/api/torrents?${new URLSearchParams({ name: options.query })}`
  ])];
  let validEmpty = false;
  for (const [index, url] of urls.entries()) {
    const response = await request(url, { headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json', 'User-Agent': 'SeenIt-App', Referer: 'https://c411.org/torrents' }, signal: options.signal() });
    // Une première erreur peut venir de la sous-catégorie ; le repli doit ensuite réussir réellement.
    if (!response.ok) {
      if (index === 0 && ![401, 403, 429].includes(response.status)) continue;
      throw new Error(`C411 indisponible (${response.status}).`);
    }
    const payload: unknown = await response.json();
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : null;
    if (!Array.isArray(data)) throw new Error('Réponse C411 invalide.');
    if (data.length) return data;
    validEmpty = true;
  }
  if (!validEmpty) throw new Error('Recherche C411 indisponible.');
  return [];
}
