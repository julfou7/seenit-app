const fetch = require('node-fetch');
async function test() {
  const login = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apikey: '003b4e7b-87b7-4756-b227-bb241093216f'})
  }).then(r => r.json());
  const token = login.data.token;

  // TMDB ID of Fantastic Beasts is 259316. IMDB ID is tt3183660
  const search1 = await fetch(`https://api4.thetvdb.com/v4/search?q=tt3183660`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  console.log(`IMDB search:`, search1.data?.map(d => d.name + ' (' + d.tvdb_id + ')'));
}
test();
