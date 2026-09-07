const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Empreintes uniquement : les anciennes valeurs exposées ne doivent jamais être recopiées ici.
const exposedFingerprints = new Set(["fcf48f1b1a2bf3181f6d24fc38691f13aac42ca31265419e78de0c15eeeb44a1","dd341e88d2b4997022388cf00c14e9b39960120c38d6f56ac9bdb6d7b42fc8a2","d9a2b4ef1b7cd63fba46a28e431ed1c11f941922d5bd4b04d06d8d350aacf22f"]);
const forbidden = /VITE_(?:TMDB|OMDB|TVDB)_API_KEY|api\.themoviedb\.org|omdbapi\.com|api4\.thetvdb\.com|[?&](?:api_key|apikey)=/i;
function hasProviderSecret(source) {
  if (forbidden.test(source)) return true;
  for (const token of source.match(/[A-Za-z0-9_-]{8,}/g) || []) {
    if (exposedFingerprints.has(crypto.createHash('sha256').update(token).digest('hex'))) return true;
  }
  return false;
}
function scanClientBundle(directory = 'dist/assets') {
  let files = 0;
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(js|map)$/.test(entry.name)) {
        files++;
        if (hasProviderSecret(fs.readFileSync(file, 'utf8'))) {
          throw new Error('Signature fournisseur interdite dans ' + file);
        }
      }
    }
  };
  visit(directory);
  if (!files) throw new Error('Aucun bundle client à contrôler.');
  return files;
}
if (require.main === module) {
  try { console.log('[ProviderSecurity] ' + scanClientBundle(process.argv[2]) + ' artefacts client contrôlés, aucune signature fournisseur interdite.'); }
  catch (error) { console.error('[ProviderSecurity] ' + error.message); process.exitCode = 1; }
}
module.exports = { hasProviderSecret, scanClientBundle };
