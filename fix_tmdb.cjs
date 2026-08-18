const fs = require('fs');
let c = fs.readFileSync('src/features/shows/tmdb.ts', 'utf8');

c = c.replace(
  /async getWatchProviders\(id: number\): Promise<Result<any>> \{/,
  `async getWatchProviders(id: number, type: 'tv' | 'movie' = 'tv'): Promise<Result<any>> {`
);

c = c.replace(
  /const url = new URL\(\`\$\{this\.baseUrl\}\/tv\/\$\{id\}\/watch\/providers\?api_key=\$\{apiKey\}\`\);/,
  `const url = new URL(\`\${this.baseUrl}/\${type}/\${id}/watch/providers?api_key=\${apiKey}\`);`
);

fs.writeFileSync('src/features/shows/tmdb.ts', c);
