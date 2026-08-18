const fs = require('fs');
let c = fs.readFileSync('src/features/shows/tmdb.ts', 'utf8');

const oldFunc = `  async getPersonDetails(personId: number): Promise<Result<any>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(\`\${this.baseUrl}/person/\${personId}?api_key=\${apiKey}&language=fr-FR\`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(\`TMDB Error: \${res.value.status}\`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));
    return data;
  }`;

const newFunc = `  async getPersonDetails(personId: number): Promise<Result<any>> {
    const apiKey = this.getApiKey();
    if (!apiKey) return err(new Error('Missing API Key'));
    const url = new URL(\`\${this.baseUrl}/person/\${personId}?api_key=\${apiKey}&language=fr-FR\`);
    const res = await tryCatch(fetch(url.toString()));
    if (!res.ok) return err((res as any).error);
    if (!res.value.ok) return err(new Error(\`TMDB Error: \${res.value.status}\`));
    const data = await tryCatch(res.value.json());
    if (!data.ok) return err((data as any).error);
    if (data.value && data.value.status_code) return err(new Error(data.value.status_message || 'TMDB Error'));
    
    // Fallback to English if no French biography
    if (data.value && !data.value.biography) {
       try {
         const enUrl = new URL(\`\${this.baseUrl}/person/\${personId}?api_key=\${apiKey}&language=en-US\`);
         const enRes = await fetch(enUrl.toString());
         if (enRes.ok) {
           const enData = await enRes.json();
           if (enData.biography) data.value.biography = enData.biography;
         }
       } catch (e) {}
    }
    
    return data;
  }`;

c = c.replace(oldFunc, newFunc);
fs.writeFileSync('src/features/shows/tmdb.ts', c);
