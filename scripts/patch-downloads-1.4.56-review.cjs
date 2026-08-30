const fs = require('node:fs');

function replaceExact(path, from, to) {
  const input = fs.readFileSync(path, 'utf8');
  if (!input.includes(from)) throw new Error(`Pattern introuvable dans ${path}`);
  fs.writeFileSync(path, input.replace(from, to));
}

// Ne contourner que les rejets causés par le fichier déjà présent.
// Les rejets de langue, indexer, seeders, taille, âge, etc. restent bloquants.
replaceExact(
  'src/services/sonarrRadarr.ts',
`function hasOnlyExistingMediaRejections(release: any): boolean {
  const rejections = Array.isArray(release?.rejections) ? release.rejections.filter(Boolean) : [];
  if (!rejections.length) return true;
  return rejections.every((reason: any) =>
    /existing file|cutoff|upgrade|custom format|already.*file|equal or higher/i.test(String(reason))
  );
}

function rankInteractiveReleases(releases: any[], preference?: '1080p' | '4k', preferSeasonPack = false): any[] {
  return releases
    .filter(release => releaseMatchesQualityPreference(release, preference))
    .filter(release => release?.approved === true || release?.rejected !== true || hasOnlyExistingMediaRejections(release))`,
`function hasOnlyExistingMediaRejections(release: any): boolean {
  const rejections = Array.isArray(release?.rejections) ? release.rejections.filter(Boolean) : [];
  if (!rejections.length) return true;
  return rejections.every((reason: any) => /existing file/i.test(String(reason)));
}

function rankInteractiveReleases(releases: any[], preference?: '1080p' | '4k', preferSeasonPack = false): any[] {
  return releases
    .filter(release => releaseMatchesQualityPreference(release, preference))
    .filter(release => release?.approved === true || hasOnlyExistingMediaRejections(release))`
);

// Le fallback média du store ne doit pas confondre deux vrais téléchargements
// 1080p/4K parallèles quand l'un des clients ne remonte pas encore son hash.
replaceExact(
  'src/store/liveDownloadStore.ts',
`function sameRequestScope(a: LiveDownloadItem, b: LiveDownloadItem): boolean {`,
`function resolutionBucket(item: LiveDownloadItem): '4k' | '1080p' | '720p' | null {
  const value = \`${'${item.quality || \'\'}'} ${'${item.releaseTitle || \'\'}'}\`.toLowerCase();
  if (/2160|4k|uhd/.test(value)) return '4k';
  if (/1080/.test(value)) return '1080p';
  if (/720/.test(value)) return '720p';
  return null;
}

function sameRequestScope(a: LiveDownloadItem, b: LiveDownloadItem): boolean {`
);

replaceExact(
  'src/store/liveDownloadStore.ts',
`  if (hasConflictingStrongPhysicalIds(a, b)) return false;

  // Compatibilité avec les doublons persistés avant l'introduction du hash :`,
`  if (hasConflictingStrongPhysicalIds(a, b)) return false;

  const aResolution = resolutionBucket(a);
  const bResolution = resolutionBucket(b);
  if (aResolution && bResolution && aResolution !== bResolution) return false;

  // Compatibilité avec les doublons persistés avant l'introduction du hash :`
);

console.log('Revue 1.4.56 appliquée.');
