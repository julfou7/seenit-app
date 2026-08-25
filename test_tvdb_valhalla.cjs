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
  console.log("All lists on Valhalla:", lists.map(l => l.id + " " + l.name + " (Official: " + l.isOfficial + ")"));
}
test();
