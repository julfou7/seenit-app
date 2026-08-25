const fetch = require('node-fetch');
const TVDB_API_KEY = '003b4e7b-87b7-4756-b227-bb241093216f';
const BASE_URL = 'https://api4.thetvdb.com/v4';

async function test() {
  const login = await fetch(`${BASE_URL}/login`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apikey: TVDB_API_KEY})
  }).then(r => r.json());
  const token = login.data.token;

  // Search for Vikings Valhalla
  const searchRes = await fetch(
    `${BASE_URL}/search?query=Vikings:+Valhalla&type=series`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json());
  
  const activeTvdbId = searchRes.data[0].tvdb_id || searchRes.data[0].id;
  console.log("Found TVDB ID:", activeTvdbId);

  const seriesRes = await fetch(`${BASE_URL}/series/${activeTvdbId}/extended`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  
  const lists = seriesRes.data?.lists || [];
  
  const validLists = lists.filter(
      (l) =>
        l.isOfficial ||
        l.name.toLowerCase().includes('franchise') ||
        l.name.toLowerCase().includes('universe') ||
        l.name.toLowerCase().includes('whoniverse') ||
        l.name.toLowerCase().includes('arrowverse') ||
        l.name.toLowerCase().includes('world') ||
        l.name.toLowerCase().includes('saga') ||
        l.name.toLowerCase().includes('one chicago')
    );

  console.log("Valid lists:", validLists.map(l => l.id + " " + l.name));
  
  validLists.sort((a, b) => {
    let aScore = 0; let bScore = 0;
    if (a.isOfficial) aScore += 1;
    if (b.isOfficial) bScore += 1;
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    if (aName.includes('universe') || aName.includes('world') || aName.includes('whoniverse')) aScore += 2;
    if (bName.includes('universe') || bName.includes('world') || bName.includes('whoniverse')) bScore += 2;
    return bScore - aScore;
  });

  const listIds = validLists.slice(0, 3).map(l => l.id);
  console.log("Selected Lists:", listIds);

  const entitiesMap = new Map();
  for (const listId of listIds) {
      try {
          const listRes = await fetch(`${BASE_URL}/lists/${listId}/extended`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json());
          if (listRes.data && listRes.data.entities) {
              listRes.data.entities.forEach(entity => {
                  const key = entity.seriesId ? `tv_${entity.seriesId}` : `movie_${entity.movieId}`;
                  if (!entitiesMap.has(key)) {
                      entitiesMap.set(key, entity);
                  }
              });
          }
      } catch (e) {
          console.error(e);
      }
  }
  const allEntities = Array.from(entitiesMap.values());
  console.log("Entities in these lists:");
  allEntities.forEach(e => {
    if (e.seriesId) console.log("Series", e.seriesId);
    if (e.movieId) console.log("Movie", e.movieId);
  })
}
test();
