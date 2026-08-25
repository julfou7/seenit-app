const fetch = require('node-fetch');

async function test() {
  const login = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apikey: '003b4e7b-87b7-4756-b227-bb241093216f'})
  }).then(r => r.json());
  const token = login.data.token;

  const validLists = [{id: 7580}, {id: 13349}, {id: 15298}];
  const listsToFetch = validLists.slice(0, 3).map(l => l.id);
  
  const entitiesMap = new Map();
  for (const listId of listsToFetch) {
      try {
          const listRes = await fetch(`https://api4.thetvdb.com/v4/lists/${listId}/extended`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json());
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
  console.log("Merged entities count:", allEntities.length);
  console.log("Entities:", allEntities.map(e => e.seriesId ? `TV ${e.seriesId}` : `Movie ${e.movieId}`));
}
test();
