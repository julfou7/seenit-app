const fs = require('fs');

// Patch manifest.json
const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
manifest.name = "SeenIt";
manifest.short_name = "SeenIt";
manifest.description = "Suivi de vos séries et films";
manifest.background_color = "#040406";
manifest.theme_color = "#040406";
fs.writeFileSync('public/manifest.json', JSON.stringify(manifest, null, 2));

// Patch index.html
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/<title>.*?<\/title>/g, "<title>SeenIt</title>");
html = html.replace(/content=".*?" name="apple-mobile-web-app-title"/g, 'content="SeenIt" name="apple-mobile-web-app-title"');
html = html.replace(/content="Aura"/g, 'content="SeenIt"');
html = html.replace(/content="Séries"/g, 'content="SeenIt"');
fs.writeFileSync('index.html', html);

// Patch metadata.json
const meta = JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
meta.name = "SeenIt";
meta.description = "SeenIt - Premium TV & Movie Tracker";
fs.writeFileSync('metadata.json', JSON.stringify(meta, null, 2));

console.log("Successfully updated manifest, index.html, and metadata.json for SeenIt");
