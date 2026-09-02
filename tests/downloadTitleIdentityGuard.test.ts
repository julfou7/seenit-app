import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('SEENIT-DOWNLOAD-001 interdit durablement tout fallback d’identité par titre ou release', () => {
  const identity = read('src/features/downloads/downloadIdentity.ts');
  const store = read('src/store/liveDownloadStore.ts');
  const service = read('src/services/sonarrRadarr.ts');
  assert.equal(identity.includes('sameLegacyPhysicalTransfer'), false);
  assert.equal(store.includes('cleanMediaTitleForComparison'), false);
  assert.equal(store.includes('sameLegacyPhysicalTransfer'), false);
  assert.equal(service.includes('sameLegacyPhysicalTransfer'), false);
  assert.match(identity, /!request\.tmdbId \|\| !remote\.tmdbId/);
  assert.match(identity, /if \(!item\?\.tmdbId/);
});
