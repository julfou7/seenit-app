const UNIVERSES = [
  {
    name: "Yellowstone",
    match: (t) => ["yellowstone", "1883", "1923", "6666", "the madison", "lawmen: bass reeves"].includes(t),
    queries: ["Yellowstone", "1883", "1923", "The Madison"]
  },
  {
    name: "Vaiana",
    match: (t) => ["vaiana", "moana", "vaiana 2", "moana 2", "vaiana, la légende du bout du monde"].includes(t),
    queries: ["Vaiana", "Moana"]
  }
];

const apiKey = '6d0ecde1df5f3e4bc3603d6d67b2d556';
const baseUrl = 'https://api.themoviedb.org/3';

async function test(universeName) {
    const universe = UNIVERSES.find(u => u.name === universeName);
    const searchesToRun = universe.queries;
    const parts = [];
    for (const q of searchesToRun) {
      const url = `${baseUrl}/search/multi?api_key=${apiKey}&query=${encodeURIComponent(q)}&language=fr-FR`;
      const sRes = await fetch(url).then(r => r.json());
      if (sRes.results) {
        sRes.results.forEach((r) => {
             if (r.media_type === 'movie' || r.media_type === 'tv') {
                const rTitle = (r.title || r.name || '').toLowerCase();
                const rOriginal = (r.original_name || r.original_title || '').toLowerCase();
                if ((universe.match(rTitle) || universe.match(rOriginal)) && !parts.some(p => p.id === r.id)) {
                  parts.push(r);
                }
             }
        });
      }
    }
    console.log(`Results for ${universeName}:`);
    parts.forEach(p => console.log(`- ${p.title || p.name}`));
}

test('Yellowstone');
test('Vaiana');
