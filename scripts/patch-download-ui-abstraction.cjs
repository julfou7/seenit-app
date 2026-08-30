const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, content) { fs.writeFileSync(path, content); }
function replaceExact(path, from, to) {
  const input = read(path);
  if (!input.includes(from)) {
    throw new Error(`Pattern introuvable dans ${path}: ${from.slice(0, 120)}`);
  }
  write(path, input.replace(from, to));
}
function replaceAllExact(path, from, to) {
  const input = read(path);
  if (!input.includes(from)) {
    throw new Error(`Pattern introuvable dans ${path}: ${from.slice(0, 120)}`);
  }
  write(path, input.split(from).join(to));
}

// 1) Identité de téléchargement : migration sûre des anciens doublons sans hash.
{
  const path = 'src/features/downloads/downloadIdentity.ts';
  let src = read(path);
  src = src.replace(
`export interface DownloadIdentityLike {
  id?: string | null;
  downloadId?: string | null;
}`,
`export interface DownloadIdentityLike {
  id?: string | null;
  downloadId?: string | null;
  releaseTitle?: string | null;
  title?: string | null;
  size?: number | null;
  mediaType?: string | null;
}`
  );
  if (!src.includes('sameLegacyPhysicalTransfer')) {
    src += `\n\nexport function normalizeDownloadRelease(value: unknown): string {\n  if (value === null || value === undefined) return '';\n  return String(value)\n    .toLowerCase()\n    .normalize('NFD')\n    .replace(/[\\u0300-\\u036f]/g, '')\n    .replace(/[^a-z0-9]/g, '');\n}\n\nexport function sameLegacyPhysicalTransfer(\n  a?: DownloadIdentityLike | null,\n  b?: DownloadIdentityLike | null\n): boolean {\n  if (!a || !b) return false;\n  if (a.mediaType && b.mediaType && a.mediaType !== b.mediaType) return false;\n\n  const aSize = Number(a.size || 0);\n  const bSize = Number(b.size || 0);\n  if (aSize <= 0 || bSize <= 0) return false;\n  const sizeDelta = Math.abs(aSize - bSize) / Math.max(aSize, bSize);\n  if (sizeDelta > 0.015) return false;\n\n  const aRelease = normalizeDownloadRelease(a.releaseTitle || a.title);\n  const bRelease = normalizeDownloadRelease(b.releaseTitle || b.title);\n  if (!aRelease || !bRelease) return false;\n\n  return aRelease === bRelease || aRelease.includes(bRelease) || bRelease.includes(aRelease);\n}\n`;
  }
  write(path, src);
}

// 2) Service live : qBittorrent fusionne toutes les représentations du même torrent.
{
  const path = 'src/services/sonarrRadarr.ts';
  let src = read(path);
  src = src.replace(
"import { getPhysicalDownloadId, normalizeDownloadClientId } from '../features/downloads/downloadIdentity';",
"import { getPhysicalDownloadId, normalizeDownloadClientId, sameLegacyPhysicalTransfer, samePhysicalDownload } from '../features/downloads/downloadIdentity';"
  );

  const oldBlock = `          const normTName = (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const existing = items.find(it => {
            // Le hash du client est l'identité physique fiable. Il permet notamment
            // de fusionner un titre Radarr en anglais avec un torrent qBittorrent en français.
            const physicalId = getPhysicalDownloadId(it);
            if (qbitDownloadId && physicalId && physicalId === qbitDownloadId) return true;

            // Fallback uniquement pour les anciens clients/*Arr qui ne fournissent pas downloadId.
            if (!it.releaseTitle && !it.title) return false;
            const normRel = (it.releaseTitle || it.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return Boolean(normRel && normTName && (normRel === normTName || normRel.includes(normTName) || normTName.includes(normRel)));
          });

          if (existing) {`;

  const newBlock = `          const normTName = (t.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const qbitProbe: LiveDownloadItem = {
            id: \`qbit_\${t.hash || t.name}\`,
            downloadId: qbitDownloadId || undefined,
            mediaType: isTv ? 'tv' : 'movie',
            title: t.name,
            releaseTitle: t.name,
            size: Number(t.size || 0),
            sizeleft: 0,
            progress: rawProgress,
            status: qbitStatus,
            statusText: qbitStatusText
          };

          const exactIndexes: number[] = [];
          const legacyIndexes: number[] = [];
          items.forEach((it, index) => {
            if (qbitDownloadId && samePhysicalDownload(it, qbitProbe)) {
              exactIndexes.push(index);
              return;
            }

            // Migration des anciens états : seulement si *Arr n'a pas de hash exploitable,
            // avec release ET taille physique quasi identiques. Deux hashes différents
            // ne seront donc jamais fusionnés par ce fallback.
            if (!getPhysicalDownloadId(it) && sameLegacyPhysicalTransfer(it, qbitProbe)) {
              legacyIndexes.push(index);
            }
          });

          const matchingIndexes = exactIndexes.length > 0 ? exactIndexes : legacyIndexes;
          const metadataScore = (it: LiveDownloadItem) =>
            (it.posterPath ? 8 : 0)
            + (it.tmdbId ? 8 : 0)
            + (it.tvdbId ? 4 : 0)
            + (it.movieTitle || it.seriesTitle ? 4 : 0)
            + (it.imdbId ? 2 : 0);
          const primaryIndex = matchingIndexes.length > 0
            ? [...matchingIndexes].sort((a, b) => metadataScore(items[b]) - metadataScore(items[a]))[0]
            : -1;
          const existing = primaryIndex >= 0 ? items[primaryIndex] : undefined;

          if (existing && matchingIndexes.length > 1) {
            for (const duplicateIndex of [...matchingIndexes].sort((a, b) => b - a)) {
              if (duplicateIndex === primaryIndex) continue;
              const duplicate = items[duplicateIndex];
              if (!existing.posterPath && duplicate.posterPath) existing.posterPath = duplicate.posterPath;
              if (!existing.backdropPath && duplicate.backdropPath) existing.backdropPath = duplicate.backdropPath;
              if (!existing.tmdbId && duplicate.tmdbId) existing.tmdbId = duplicate.tmdbId;
              if (!existing.tvdbId && duplicate.tvdbId) existing.tvdbId = duplicate.tvdbId;
              if (!existing.imdbId && duplicate.imdbId) existing.imdbId = duplicate.imdbId;
              if (!existing.movieTitle && duplicate.movieTitle) existing.movieTitle = duplicate.movieTitle;
              if (!existing.seriesTitle && duplicate.seriesTitle) existing.seriesTitle = duplicate.seriesTitle;
              if (!existing.quality && duplicate.quality) existing.quality = duplicate.quality;
              items.splice(duplicateIndex, 1);
            }
          }

          if (existing) {`;

  if (!src.includes(oldBlock)) throw new Error('Bloc qBittorrent attendu introuvable');
  src = src.replace(oldBlock, newBlock);
  write(path, src);
}

// 3) Store : migrer aussi les doublons déjà persistés en localStorage.
{
  const path = 'src/store/liveDownloadStore.ts';
  let src = read(path);
  src = src.replace(
"import { getPhysicalDownloadId, samePhysicalDownload } from '../features/downloads/downloadIdentity';",
"import { getPhysicalDownloadId, sameLegacyPhysicalTransfer, samePhysicalDownload } from '../features/downloads/downloadIdentity';"
  );
  src = src.replace(
`  if (aPhysicalId && bPhysicalId) return false;

  if (!sameCanonicalMedia(a, b)) return false;`,
`  if (aPhysicalId && bPhysicalId) return false;

  // Compatibilité avec les doublons persistés avant l'introduction du hash :
  // même release + même taille, tant qu'au moins une des deux représentations
  // ne possède pas encore d'identité physique.
  if (sameLegacyPhysicalTransfer(a, b)) return true;

  if (!sameCanonicalMedia(a, b)) return false;`
  );
  write(path, src);
}

// 4) UI : l'utilisateur voit le média, jamais le client technique.
replaceAllExact(
  'src/screens/DownloadsScreen.tsx',
  `            {item.downloadClient && <span className="font-bold text-zinc-300">{item.downloadClient}</span>}\n`,
  ''
);
replaceAllExact(
  'src/components/LiveDownloadBanner.tsx',
  `                  {item.downloadClient && <span className="font-bold text-zinc-300">{item.downloadClient}</span>}\n`,
  ''
);

// États runtime génériques dans l'écran Téléchargements.
replaceAllExact('src/screens/DownloadsScreen.tsx', 'statusText: `Demande prise en compte • envoi à ${clientLabel}…`,', "statusText: 'Demande prise en compte • préparation du téléchargement…',");
replaceAllExact('src/screens/DownloadsScreen.tsx', 'showToast(`Demande prise en compte • envoi à ${clientLabel}.`, \'download\');', "showToast('Demande prise en compte • préparation du téléchargement…', 'download');");
replaceAllExact('src/screens/DownloadsScreen.tsx', 'acceptDownloadRequest(requestId, `${clientLabel} a accepté la release • mise en file d’attente`, \'queued\');', "acceptDownloadRequest(requestId, 'Téléchargement accepté • mise en file d’attente', 'queued');");

// États runtime génériques dans la modale de téléchargement.
replaceAllExact('src/components/DownloadModal.tsx', 'statusText: `Demande prise en compte • envoi à ${client}…`,', "statusText: 'Demande prise en compte • préparation du téléchargement…',");
replaceAllExact('src/components/DownloadModal.tsx', 'showToast(`Demande prise en compte • ${client} prépare ${qualityLabel}.`, \'download\');', 'showToast(`Demande prise en compte • recherche ${qualityLabel}…`, \'download\');');
replaceAllExact('src/components/DownloadModal.tsx', '`${client} a accepté la demande • recherche ${qualityLabel} en cours`,', '`Demande acceptée • recherche ${qualityLabel} en cours`,');
replaceAllExact('src/components/DownloadModal.tsx', 'statusText: `Demande prise en compte • envoi de la release à ${clientLabel}…`,', "statusText: 'Demande prise en compte • préparation du téléchargement…',");
replaceAllExact('src/components/DownloadModal.tsx', 'showToast(`Demande prise en compte • envoi à ${clientLabel}.`, \'download\');', "showToast('Demande prise en compte • préparation du téléchargement…', 'download');");
replaceAllExact('src/components/DownloadModal.tsx', '`${clientLabel} a accepté la release • mise en file d\'attente`,', "`Téléchargement accepté • mise en file d'attente`,");

// Les bannières lancées depuis une fiche restent elles aussi orientées utilisateur.
replaceAllExact('src/screens/ShowDetailScreen.tsx', "statusText: 'Lancement dans Sonarr...'", "statusText: 'Préparation du téléchargement…'");
replaceAllExact('src/screens/ShowDetailScreen.tsx', "statusText: 'Lancement de la saison dans Sonarr...'", "statusText: 'Préparation du téléchargement…'");
replaceAllExact('src/screens/ShowDetailScreen.tsx', "statusText: 'Lancement dans Radarr...'", "statusText: 'Préparation du téléchargement…'");

// 5) Tests identité / migration.
{
  const path = 'tests/downloadIdentity.test.ts';
  let src = read(path);
  src = src.replace(
`  getPhysicalDownloadId,
  normalizeDownloadClientId,
  samePhysicalDownload`,
`  getPhysicalDownloadId,
  normalizeDownloadClientId,
  sameLegacyPhysicalTransfer,
  samePhysicalDownload`
  );
  if (!src.includes('rattache un ancien doublon sans hash')) {
    src += `\n\ntest('rattache un ancien doublon sans hash grâce à la release et la taille', () => {\n  const arr = {\n    mediaType: 'movie',\n    title: 'Disclosure Day',\n    releaseTitle: 'Disclosure.Day.2026.1080p.BluRay',\n    size: 4_400_000_000\n  };\n  const persistedQbit = {\n    mediaType: 'movie',\n    title: 'Disclosure.Day.2026.1080p.BluRay-GROUP',\n    releaseTitle: 'Disclosure.Day.2026.1080p.BluRay-GROUP',\n    size: 4_410_000_000\n  };\n\n  assert.equal(sameLegacyPhysicalTransfer(arr, persistedQbit), true);\n});\n\ntest('ne fusionne pas deux releases de tailles différentes', () => {\n  assert.equal(\n    sameLegacyPhysicalTransfer(\n      { mediaType: 'movie', releaseTitle: 'Film.1080p', size: 4_000_000_000 },\n      { mediaType: 'movie', releaseTitle: 'Film.1080p', size: 8_000_000_000 }\n    ),\n    false\n  );\n});\n`;
  }
  write(path, src);
}

// 6) Version 1.4.55.
replaceExact('src/store/updateStore.ts', "export const CURRENT_APP_VERSION = '1.4.54';", "export const CURRENT_APP_VERSION = '1.4.55';");
replaceExact('android/app/build.gradle', '        versionCode 104054\n        versionName "1.4.54"', '        versionCode 104055\n        versionName "1.4.55"');

console.log('Patch 1.4.55 appliqué.');
