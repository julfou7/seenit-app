const fetch = require('node-fetch');

async function test() {
  const login = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apikey: '003b4e7b-87b7-4756-b227-bb241093216f'})
  }).then(r => r.json());
  const token = login.data.token;

  const seriesRes = await fetch(`https://api4.thetvdb.com/v4/movies/17657/extended`, { headers: { Authorization: `Bearer ${token}` } }).then(r=>r.json());
  const lists = seriesRes.data.lists || [];
  
  const validLists = lists.filter(
          (l) =>
            l.isOfficial ||
            l.name.toLowerCase().includes('franchise') ||
            l.name.toLowerCase().includes('universe') ||
            l.name.toLowerCase().includes('collection') ||
            l.name.toLowerCase().includes('whoniverse') ||
            l.name.toLowerCase().includes('arrowverse') ||
            l.name.toLowerCase().includes('world') ||
            l.name.toLowerCase().includes('one chicago')
        );

  validLists.sort((a, b) => {
    // Official gets a +1 bump, 'universe/world' gets a +2 bump
    let aScore = 0; let bScore = 0;
    if (a.isOfficial) aScore += 1;
    if (b.isOfficial) bScore += 1;
    
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    if (aName.includes('universe') || aName.includes('world') || aName.includes('whoniverse')) aScore += 2;
    if (bName.includes('universe') || bName.includes('world') || bName.includes('whoniverse')) bScore += 2;
    
    return bScore - aScore;
  });
  console.log("Valid lists sorted by new score:");
  validLists.forEach(v => console.log(v.id, v.name, v.isOfficial));
}
test();
