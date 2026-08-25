const fetch = require('node-fetch');
async function test() {
  const login = await fetch('https://api4.thetvdb.com/v4/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({apikey: '003b4e7b-87b7-4756-b227-bb241093216f'})
  }).then(r => r.json());
  const token = login.data.token;
  const list = await fetch('https://api4.thetvdb.com/v4/lists/7580/extended', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  console.log("List 7580 entities count:", list.data?.entities?.length);
  
  const list2 = await fetch('https://api4.thetvdb.com/v4/lists/13349/extended', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  console.log("List 13349 entities count:", list2.data?.entities?.length);

  const list3 = await fetch('https://api4.thetvdb.com/v4/lists/15298/extended', {
    headers: { Authorization: `Bearer ${token}` }
  }).then(r => r.json());
  console.log("List 15298 entities count:", list3.data?.entities?.length);
}
test();
