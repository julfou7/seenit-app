const apiKey = '6d0ecde1df5f3e4bc3603d6d67b2d556';

async function test(query) {
  const url = `https://api.themoviedb.org/3/search/multi?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=fr-FR`;
  const res = await fetch(url).then(r => r.json());
  console.log(`Results for ${query}:`);
  res.results.forEach(r => {
    console.log(`- ${r.title || r.name} (${r.release_date || r.first_air_date})`);
  });
}

test('Yellowstone');
test('Vaiana');
test('1883');
