const fetch = require('node-fetch');
async function test() {
  const res = await fetch('https://api.themoviedb.org/3/movie/338953?api_key=428df60dc2bfab481bd057bc642646b9&append_to_response=external_ids').then(r => r.json());
  console.log("External IDs:", res.external_ids);
}
test();
