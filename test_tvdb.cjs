const fetch = require('node-fetch');

async function test() {
  const login = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apikey: '003b4e7b-87b7-4756-b227-bb241093216f'})
  }).then(r => r.json());
  const token = login.data.token;

  // Search Fantastic Beasts
  const search = await fetch('https://api4.thetvdb.com/v4/search?query=Fantastic+Beasts&type=movie', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  console.log("Search FB:", search.data[0].tvdb_id);

  // Get extended
  const fb = await fetch(`https://api4.thetvdb.com/v4/movies/${search.data[0].tvdb_id}/extended`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  console.log("FB Lists:", fb.data.lists?.map(l => l.name));
  
  // Let's check TMDB ID of HP Series (433637)
  const hpSeries = await fetch(`https://api4.thetvdb.com/v4/series/433637/extended`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  console.log("HP Series Lists:", hpSeries.data.lists?.map(l => l.name));
}
test();
