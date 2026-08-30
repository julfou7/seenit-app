import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPhysicalDownloadId,
  normalizeDownloadClientId,
  samePhysicalDownload
} from '../src/features/downloads/downloadIdentity.ts';

test('normalise le hash qBittorrent et le downloadId *Arr sans dépendre de la casse', () => {
  assert.equal(normalizeDownloadClientId(' ABCDEF123 '), 'abcdef123');
  assert.equal(normalizeDownloadClientId('qbit_ABCDEF123'), 'abcdef123');
  assert.equal(normalizeDownloadClientId('urn:btih:ABCDEF123'), 'abcdef123');
});

test('rattache le même torrent physique malgré des titres localisés différents', () => {
  const radarr = {
    id: 'radarr_42',
    downloadId: 'ABCDEF123'
  };
  const qbitPersisted = {
    id: 'qbit_abcdef123'
  };

  assert.equal(getPhysicalDownloadId(radarr), 'abcdef123');
  assert.equal(getPhysicalDownloadId(qbitPersisted), 'abcdef123');
  assert.equal(samePhysicalDownload(radarr, qbitPersisted), true);
});

test('deux hashes différents restent deux téléchargements physiques distincts', () => {
  assert.equal(
    samePhysicalDownload(
      { downloadId: 'aaaaaaaa' },
      { id: 'qbit_bbbbbbbb' }
    ),
    false
  );
});
