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
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    const aScore = (aName.includes('universe') || aName.includes('world') || aName.includes('whoniverse')) ? 2 : 1;
    const bScore = (bName.includes('universe') || bName.includes('world') || bName.includes('whoniverse')) ? 2 : 1;
    
    // Si même score (par ex tous les deux score=2), donner la priorité aux listes officielles
    if (aScore === bScore) {
      if (a.isOfficial && !b.isOfficial) return -1;
      if (!a.isOfficial && b.isOfficial) return 1;
    }

    return bScore - aScore;
  });
  console.log("Valid lists sorted:");
  validLists.forEach(v => console.log(v.id, v.name, v.isOfficial));
}
test();
