import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

// Vrai store de présence, seuls ses transports et réglages sont remplacés.
const bundle = await build({ entryPoints: ['src/store/mediaPresenceStore.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'presence-ports', setup(builder) {
    builder.onResolve({ filter: /\/(?:downloadConfigStore|sonarrRadarr|plexAvailability|firebase)$|^firebase\/auth$/ }, args => ({ path: args.path.split('/').at(-1) || '', namespace: 'ports' }));
    builder.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: args.path === 'downloadConfigStore'
      ? 'export const useDownloadConfigStore={getState:()=>({isHydrated:true,downloadsEnabled:true,sonarrUrl:"http://sonarr",sonarrApiKey:"k"})};'
      : args.path === 'sonarrRadarr'
        ? 'export const cleanUrl=u=>u;export const executeGet=async url=>url.endsWith("/api/v3/series")?[{id:7,tvdbId:123,tmdbId:42}]:url.includes("/api/v3/episode?seriesId=7")?[{seasonNumber:3,episodeNumber:4,hasFile:true},{seasonNumber:3,episodeNumber:5,hasFile:false}]:[];'
        : args.path === 'plexAvailability' ? 'export const checkPlexAvailability=async()=>({available:false});'
        : args.path === 'firebase' ? 'export const auth={currentUser:{uid:"u1"}};'
        : 'export const onAuthStateChanged=()=>()=>{};' }));
  } }] });
const { useMediaPresenceStore } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('SEENIT-DOWNLOAD-014 #879 un épisode téléchargé dans Sonarr est reconnu par la fiche, le mode et la popup', async () => {
  const presence = await useMediaPresenceStore.getState().checkPresence({ tmdbId: 42, tvdbId: 123, mediaType: 'tv', forceRefresh: true });
  // Une seule clé « saison x épisode », celle que lisent tous les consommateurs.
  assert.deepEqual({ ...presence.episodesHasFile }, { '3x4': true, '3x5': false });
  assert.equal(presence.seasonsHasFile[3], false);
  for (const file of ['src/screens/ShowDetailView.tsx', 'src/components/DownloadModal.tsx', 'src/store/mediaPresenceStore.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /episodePresenceKey\(/, `${file} passe par la clé unique`);
    assert.doesNotMatch(source, /episodesHasFile[^;\n]*`\$\{|`S\$\{sNum\}E\$\{eNum\}`/, `${file} : plus de clé construite à la main`);
  }
});
