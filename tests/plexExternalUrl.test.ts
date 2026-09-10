import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isExactPlexPmsWebUrl } from '../src/lib/plexExternalUrl.ts';

const utilsSource = readFileSync('src/lib/utils.ts', 'utf8');
const syncPlexSource = readFileSync('src/features/plex/syncPlex.ts', 'utf8');
const availabilitySource = readFileSync('src/features/plex/plexAvailability.ts', 'utf8');
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

test('SEENIT-PLATFORM-001 ouvre le CTA Plex via Discover vérifié plutôt que le locator PMS', () => {
  assert.match(availabilitySource, /function toPlexAvailabilityEvidence/);
  assert.match(availabilitySource, /delete evidence\.plexUrl/);
  assert.match(availabilitySource, /delete evidence\.watchUrl/);
  assert.match(availabilitySource, /serverId\?: string/);
  assert.match(availabilitySource, /ratingKey\?: string/);
  assert.equal(availabilitySource.includes('buildPlexMediaUrl(info.serverId, info.ratingKey)'), false);

  const openFunctionStart = syncPlexSource.indexOf('export const openPlexWatchUrl');
  const purgeFunctionStart = syncPlexSource.indexOf('export const purgeAllPlexSlugsInDb');
  assert.ok(openFunctionStart >= 0 && purgeFunctionStart > openFunctionStart, 'le parcours d’ouverture Plex doit rester identifiable');

  const openFunctionSource = syncPlexSource.slice(openFunctionStart, purgeFunctionStart);
  assert.match(openFunctionSource, /const expectedResolvedFrom = `tmdb:\$\{tmdbId\}`/);
  assert.match(openFunctionSource, /show\?\.plexResolvedFrom === expectedResolvedFrom/);
  assert.match(openFunctionSource, /isStrictPlexIdentityMatch\(item, \{ tmdbId, mediaType: type \}\)/);
  assert.match(openFunctionSource, /data\?\.slug && data\?\.resolvedFrom === expectedResolvedFrom/);
  assert.match(openFunctionSource, /https:\/\/watch\.plex\.tv\/\$\{type\}\/\$\{resolvedSlug\}/);
  assert.match(openFunctionSource, /Redirection annulée pour éviter l'accueil/);
  assert.equal(openFunctionSource.includes("title='"), false);
  assert.equal(openFunctionSource.includes('year='), false);

  // Le transport générique sait toujours ouvrir une URL PMS explicite lorsqu'une autre
  // fonctionnalité la lui fournit ; le CTA média, lui, ne reçoit plus cette URL depuis
  // la disponibilité et poursuit donc vers le slug Discover vérifié.
  assert.match(utilsSource, /isExactPlexPmsWebUrl\(targetUrl\)/);
});
