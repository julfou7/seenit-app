const fetch = require('node-fetch');
async function test() {
  const login = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apikey: '003b4e7b-87b7-4756-b227-bb241093216f'})
  }).then(r => r.json());
  const token = login.data.token;
  const seriesRes = await fetch('https://api4.thetvdb.com/v4/movies/17657/extended', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  console.log(seriesRes.data.lists?.filter(l => l.name.toLowerCase().includes('world')).map(l => l.id + ' ' + l.name));
}
test();
