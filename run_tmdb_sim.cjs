const fetch = require('node-fetch');

// simulate tmdb.ts getUniverseAndCollection
async function test() {
  const login = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apikey: '003b4e7b-87b7-4756-b227-bb241093216f'})
  }).then(r => r.json());
  const token = login.data.token;

  // Let's get franchise timeline for 'Fantastic Beasts: The Secrets of Dumbledore'
  const searchRes = await fetch(`https://api4.thetvdb.com/v4/search?query=Fantastic+Beasts:+The+Secrets+of+Dumbledore&type=movie`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json());
  const activeTvdbId = searchRes.data[0].tvdb_id;
  
  const seriesRes = await fetch(`https://api4.thetvdb.com/v4/movies/${activeTvdbId}/extended`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json());
  const lists = seriesRes.data.lists || [];
  
  const validLists = lists.filter(
          (l) =>
            l.isOfficial ||
            l.name.toLowerCase().includes('franchise') ||
            l.name.toLowerCase().includes('universe') ||
            l.name.toLowerCase().includes('collection') ||
            l.name.toLowerCase().includes('whoniverse') ||
            l.name.toLowerCase().includes('arrowverse') ||
            l.name.toLowerCase().includes('world of') ||
            l.name.toLowerCase().includes('one chicago')
        );

  validLists.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    const aScore = (aName.includes('universe') || aName.includes('world') || aName.includes('whoniverse')) ? 2 : 1;
    const bScore = (bName.includes('universe') || bName.includes('world') || bName.includes('whoniverse')) ? 2 : 1;
    return bScore - aScore;
  });
  const listId = validLists[0].id;
  console.log("Found List ID:", listId, validLists[0].name);

  const listRes = await fetch(`https://api4.thetvdb.com/v4/lists/${listId}/extended`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json());
  const entities = listRes.data.entities || [];
  console.log("Entities count:", entities.length);
  
  const promises = entities.map(async (entity) => {
    let url = null;
    let media_type = 'tv';
    if (entity.seriesId) { url = `https://api4.thetvdb.com/v4/series/${entity.seriesId}/extended`; media_type = 'tv'; }
    else if (entity.movieId) { url = `https://api4.thetvdb.com/v4/movies/${entity.movieId}/extended`; media_type = 'movie'; }
    
    if (!url) return null;
    const itemRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json());
    const remoteIds = itemRes.data?.remoteIds || [];
    const tmdbRemote = remoteIds.find(r => r.type === 12 || (r.sourceName && r.sourceName.toLowerCase().includes('tmdb')));
    if (tmdbRemote?.id) { return { id: parseInt(tmdbRemote.id), media_type }; }
    return null;
  });
  
  const results = await Promise.all(promises);
  console.log("Franchise TMDB items:", results.filter(r=>r));
}
test();
