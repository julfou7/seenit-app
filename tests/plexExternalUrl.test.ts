import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPlexAndroidPmsDeepLinkFromWebUrl } from '../src/lib/plexExternalUrl.ts';

const utilsSource = readFileSync('src/lib/utils.ts', 'utf8');

test('SEENIT-PLATFORM-001 convertit la route PMS exacte en deep link Plex Android', () => {
  assert.equal(
    buildPlexAndroidPmsDeepLinkFromWebUrl(
      'https://app.plex.tv/desktop/#!/server/server-123/details?key=%2Flibrary%2Fmetadata%2F456%2Fsegment'
    ),
    'plex://server://server-123/com.plexapp.plugins.library/library/metadata/456%2Fsegment'
  );
});

test('SEENIT-IDENTITY-001 refuse de fabriquer un locator Android depuis Discover ou une route incomplète', () => {
  assert.equal(
    buildPlexAndroidPmsDeepLinkFromWebUrl('https://watch.plex.tv/show/ted-lasso'),
    null
  );
  assert.equal(
    buildPlexAndroidPmsDeepLinkFromWebUrl('https://app.plex.tv/desktop/'),
    null
  );
  assert.equal(
    buildPlexAndroidPmsDeepLinkFromWebUrl(
      'https://app.plex.tv/desktop/#!/server/server-123/details?key=%2Fhubs%2Fhome'
    ),
    null
  );
});

test('SEENIT-PLATFORM-001 tente le vrai PMS Android avant le pseudo-intent et conserve le fallback Web exact', () => {
  const exactLocatorBranch = utilsSource.indexOf('const exactPmsAndroidUrl');
  const universalIntentBranch = utilsSource.indexOf('const plexIntentUrl');

  assert.ok(exactLocatorBranch >= 0, 'la branche locator PMS exacte doit exister');
  assert.ok(universalIntentBranch > exactLocatorBranch, 'le locator PMS exact doit être tenté avant le pseudo-intent universel');

  const exactBranchSource = utilsSource.slice(exactLocatorBranch, universalIntentBranch);
  assert.match(exactBranchSource, /AppLauncher\.openUrl\(\{ url: exactPmsAndroidUrl \}\)/);
  assert.match(exactBranchSource, /Browser\.open\(\{ url: targetUrl, windowName: '_system' \}\)/);
  assert.equal(exactBranchSource.includes('watch.plex.tv'), false);
  assert.equal(exactBranchSource.includes('title='), false);
  assert.equal(exactBranchSource.includes('year='), false);
});
