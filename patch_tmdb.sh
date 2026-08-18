sed -i '/async getPopular/i \
  async discoverByGenre(type: '\''tv'\'' | '\''movie'\'', genreId: number): Promise<Result<SearchResponse>> {\
    const apiKey = this.getApiKey();\
    if (!apiKey) return err(new Error('\''Missing API Key'\''));\
    const url = new URL(`${this.baseUrl}/discover/${type}?api_key=${apiKey}&language=fr-FR&with_genres=${genreId}`);\
    const res = await tryCatch(fetch(url.toString()));\
    if (!res.ok) return err((res as any).error);\
    return await tryCatch(res.value.json());\
  }\
' src/features/shows/tmdb.ts
