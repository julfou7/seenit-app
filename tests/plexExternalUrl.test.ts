import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isExactPlexPmsWebUrl } from '../src/lib/plexExternalUrl.ts';

const utilsSource = readFileSync('src/lib/utils.ts', 'utf8');
const plexExternalUrlSource = readFileSync('src/lib/plexExternalUrl.ts', 'utf8');

test('SEENIT-PLATFORM-001 reconnaît une route PMS Web exacte sans fabriquer de deep link Android', () => {
  assert.equal(
    isExactPlexPmsWebUrl(
      'https://app.plex.tv/desktop/#!/server/server-123/details?key=%2Flibrary%2Fmetadata%2F456%2Fsegment'
    ),
    true
  );
  assert.equal(plexExternalUrlSource.includes('plex://server://'), false);
});

test('SEENIT-IDENTITY-001 refuse de fabriquer un locator depuis Discover ou une route incomplète', () => {
  assert.equal(
    isExactPlexPmsWebUrl('https://watch.plex.tv/show/ted-lasso'),
    false
  );
  assert.equal(
    isExactPlexPmsWebUrl('https://app.plex.tv/desktop/'),
    false
  );
  assert.equal(
    isExactPlexPmsWebUrl(
      'https://app.plex.tv/desktop/#!/server/server-123/details?key=%2Fhubs%2Fhome'
    ),
    false
  );
});

test('SEENIT-PLATFORM-001 ne confond pas lancement de Plex et navigation PMS exacte', () => {
  const exactLocatorBranch = utilsSource.indexOf("const exactPmsWebUrl");
  const universalIntentBranch = utilsSource.indexOf('const plexIntentUrl');

  assert.ok(exactLocatorBranch >= 0, 'la branche locator PMS exacte doit exister');
  assert.ok(universalIntentBranch > exactLocatorBranch, 'le locator PMS exact doit être traité avant le pseudo-intent universel');

  const exactBranchSource = utilsSource.slice(exactLocatorBranch, universalIntentBranch);
  assert.match(exactBranchSource, /isExactPlexPmsWebUrl\(targetUrl\)/);
  assert.match(exactBranchSource, /Browser\.open\(\{ url: targetUrl, windowName: '_system' \}\)/);
  assert.equal(exactBranchSource.includes('AppLauncher.openUrl'), false);
  assert.equal(exactBranchSource.includes('completed'), false);
  assert.equal(exactBranchSource.includes('watch.plex.tv'), false);
  assert.equal(exactBranchSource.includes('title='), false);
  assert.equal(exactBranchSource.includes('year='), false);
  assert.equal(exactBranchSource.includes('autoPlay'), false);
});
