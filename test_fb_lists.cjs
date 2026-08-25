const fetch = require('node-fetch');
const TVDB_API_KEY = '003b4e7b-87b7-4756-b227-bb241093216f';
const BASE_URL = 'https://api4.thetvdb.com/v4';
async function test() {
  const login = await fetch(`${BASE_URL}/login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({apikey: TVDB_API_KEY})}).then(r => r.json());
  const token = login.data.token;
  const seriesRes = await fetch(`${BASE_URL}/movies/17657/extended`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json());
  console.log("Fantastic Beasts lists:");
  seriesRes.data?.lists?.forEach(l => console.log(l.id, l.name, l.isOfficial));
}
test();
