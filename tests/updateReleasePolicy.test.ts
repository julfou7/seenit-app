import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSemanticVersions,
  getUpdateMetadataEndpoints,
  isTrustedSeenItApkUrl,
  normalizeSha256Digest,
  parseSeenItRelease,
  resolveSeenItReleaseHistory,
  selectSeenItReleaseHistory
} from '../src/features/release/releasePolicy.ts';

const validPayload = {
  tag_name: 'v1.4.81',
  name: 'SeenIt v1.4.81',
  body: 'Correctifs Android',
  published_at: '2026-08-31T16:00:00Z',
  html_url: 'https://github.com/julfou7/seenit-app/releases/tag/v1.4.81',
  assets: [{
    name: 'SeenIt-v1.4.81.apk',
    browser_download_url: 'https://github.com/julfou7/seenit-app/releases/download/v1.4.81/SeenIt-v1.4.81.apk',
    digest: `sha256:${'a'.repeat(64)}`
  }]
};

function releasePayload(version: string, body = `Nouveautés ${version}`) {
  return {
    ...validPayload,
    tag_name: `v${version}`,
    name: `SeenIt v${version}`,
    body,
    html_url: `https://github.com/julfou7/seenit-app/releases/tag/v${version}`,
    assets: [{
      ...validPayload.assets[0],
      name: `SeenIt-v${version}.apk`,
      browser_download_url: `https://github.com/julfou7/seenit-app/releases/download/v${version}/SeenIt-v${version}.apk`
    }]
  };
}

test('SEENIT-UPDATE-001 l’APK retente toujours le backend SeenIt de production', () => {
  assert.deepEqual(getUpdateMetadataEndpoints(true), [
    { url: 'https://api.github.com/repos/julfou7/seenit-app/releases/latest', kind: 'github' },
    { url: 'https://seenit.ai.studio/api/update', kind: 'seenit' }
  ]);
  assert.equal(getUpdateMetadataEndpoints(false)[1].url, '/api/update');
});

test('SEENIT-UPDATE-001 refuse une release ou un APK qui ne vient pas du dépôt SeenIt exact', () => {
  assert.equal(parseSeenItRelease({ ...validPayload, tag_name: 'latest' }), null);
  assert.equal(parseSeenItRelease({
    ...validPayload,
    assets: [{ ...validPayload.assets[0], browser_download_url: 'https://evil.example/SeenIt-v1.4.81.apk' }]
  }), null);
  assert.equal(isTrustedSeenItApkUrl(`${validPayload.assets[0].browser_download_url}?token=secret`, '1.4.81'), false);
});

test('SEENIT-UPDATE-002 conserve l’empreinte SHA-256 officielle de la release', () => {
  const parsed = parseSeenItRelease(validPayload);
  assert.ok(parsed);
  assert.equal(parsed.apkSha256, 'a'.repeat(64));
  assert.equal(normalizeSha256Digest('SHA256:not-a-digest'), null);
});

test('SEENIT-RELEASE-001 compare uniquement des versions sémantiques SeenIt valides', () => {
  assert.equal(compareSemanticVersions('1.4.81', '1.4.80'), 1);
  assert.equal(compareSemanticVersions('1.4.80', '1.4.80'), 0);
  assert.equal(compareSemanticVersions('1.4', '1.4.80'), 0);
});

test('SEENIT-UPDATE-004 agrège les releases officielles entre la version installée et la cible', () => {
  const history = selectSeenItReleaseHistory([
    releasePayload('1.4.118'),
    releasePayload('1.4.115'),
    releasePayload('1.4.117'),
    { ...releasePayload('1.4.116'), assets: [] },
    releasePayload('1.4.116'),
    releasePayload('1.4.119')
  ], '1.4.115', '1.4.118');

  assert.deepEqual(history.map(entry => entry.version), ['1.4.116', '1.4.117', '1.4.118']);
  assert.equal(history[0].releaseNotes, 'Nouveautés 1.4.116');
});

test('SEENIT-UPDATE-004 retombe sur la cible si l’historique paginé échoue', async () => {
  const target = parseSeenItRelease(releasePayload('1.4.118'));
  assert.ok(target);
  let page = 0;
  const fetchImpl = async () => {
    page += 1;
    if (page === 1) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => Array.from({ length: 100 }, () => releasePayload('1.4.118'))
      } as unknown as Response;
    }
    throw new Error('pagination indisponible');
  };

  const history = await resolveSeenItReleaseHistory(
    '1.4.115',
    target,
    fetchImpl as typeof fetch,
    2
  );
  assert.deepEqual(history.map(entry => entry.version), ['1.4.118']);
  assert.equal(page, 2);
});
