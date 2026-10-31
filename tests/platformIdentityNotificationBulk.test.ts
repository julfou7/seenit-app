import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DISCOVER_PLATFORM_ID_MAP, DISCOVER_PLATFORM_PREFERENCE_ID_MAP } from '../src/features/discover/filterPolicy.ts';
import { providerIdForPreferenceId, SEENIT_PLATFORM_BY_KEY } from '../src/features/providers/platformIdentity.ts';
import { getFormattedProviderLogo, PROVIDER_BRAND_LOGOS } from '../src/utils/providerLogos.ts';

test('#809 conserve les préférences historiques tout en utilisant les fournisseurs TMDB FR corrects', () => {
  assert.equal(SEENIT_PLATFORM_BY_KEY.france.preferenceId, 234);
  assert.equal(SEENIT_PLATFORM_BY_KEY.france.providerId, 236);
  assert.equal(SEENIT_PLATFORM_BY_KEY.arte.preferenceId, 239);
  assert.equal(SEENIT_PLATFORM_BY_KEY.arte.providerId, 234);
  assert.equal(providerIdForPreferenceId(234), 236);
  assert.equal(providerIdForPreferenceId(239), 234);
  assert.equal(DISCOVER_PLATFORM_PREFERENCE_ID_MAP.france, '234');
  assert.equal(DISCOVER_PLATFORM_PREFERENCE_ID_MAP.arte, '239');
  assert.equal(DISCOVER_PLATFORM_ID_MAP.france, '236');
  assert.equal(DISCOVER_PLATFORM_ID_MAP.arte, '234');
});

test('#809 Réglages, Explorer et les cartes partagent les logos de marque embarqués', () => {
  const logos = readFileSync('src/features/providers/platformLogos.ts', 'utf8');
  const filters = readFileSync('src/components/FilterModal.tsx', 'utf8');

  assert.deepEqual(PROVIDER_BRAND_LOGOS, {
    netflix: '/brand/providers/netflix.png',
    canal: '/brand/providers/canalplus.png',
    hbo: '/brand/providers/hbo.png',
    france: '/brand/providers/france-tv.png',
  });
  assert.equal(getFormattedProviderLogo(null, 'Netflix'), PROVIDER_BRAND_LOGOS.netflix);
  assert.equal(getFormattedProviderLogo(null, 'CANAL+'), PROVIDER_BRAND_LOGOS.canal);
  assert.equal(getFormattedProviderLogo(null, 'HBO'), PROVIDER_BRAND_LOGOS.hbo);
  assert.equal(getFormattedProviderLogo(null, 'France TV'), PROVIDER_BRAND_LOGOS.france);

  assert.match(logos, /8: PROVIDER_BRAND_LOGOS\.netflix/);
  assert.match(logos, /118: PROVIDER_BRAND_LOGOS\.hbo/);
  assert.match(logos, /234: PROVIDER_BRAND_LOGOS\.france/);
  assert.match(logos, /381: PROVIDER_BRAND_LOGOS\.canal/);
  assert.match(filters, /platformLogoUrl\(platform\.logo\)/);
  assert.match(filters, /getFormattedProviderLogo\(null, 'HBO'\)/);

  for (const asset of Object.values(PROVIDER_BRAND_LOGOS)) {
    const bytes = readFileSync(`public${asset}`);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG');
    assert.ok(bytes.length > 1_000, `${asset} doit être un vrai asset PNG embarqué`);
  }
});

test('#809 le catalogue reste réindexé par préférence sans mélanger France TV et ARTE', () => {
  const logos = readFileSync('src/features/providers/platformLogos.ts', 'utf8');
  assert.match(logos, /seenit_platform_logos_v2/);
  assert.match(logos, /rawLogos\[platform\.providerId\]/);
  assert.match(logos, /logos\[platform\.preferenceId\] = logo/);
  assert.match(logos, /\/brand\/providers\/canalplus\.svg/);
  assert.match(logos, /PROVIDER_BRAND_LOGOS\.canal/);
});

test('#809 les liens et les notifications traduisent les IDs de préférence avant usage fournisseur', () => {
  const links = readFileSync('src/features/providers/providerLink.ts', 'utf8');
  const notificationProvider = readFileSync('src/features/notifications/notificationProvider.ts', 'utf8');
  assert.match(links, /case 236: return `https:\/\/www\.france\.tv/);
  assert.match(links, /case 234: return `https:\/\/www\.arte\.tv/);
  assert.doesNotMatch(links, /case 239:/);
  assert.match(notificationProvider, /providerIdForPreferenceId\(preferenceId\)/);
  assert.match(notificationProvider, /Number\(item\?\.provider_id\) === providerId/);
});

test('#809 Tout marquer lu masque la liste en une seule écriture sans toast individuel', () => {
  const notifications = readFileSync('src/components/HomeNotifications.tsx', 'utf8');
  assert.match(notifications, /const markAllRead = \(\) => \{/);
  assert.match(notifications, /\.\.\.visibleNotices\.map\(notice => notice\.id\)/);
  assert.match(notifications, /writeUserScopedJson\(uid, 'home_dismissed_notifications', nextDismissed\)/);
  assert.match(notifications, /void markRead\(visibleNotices\)/);
  assert.match(notifications, /onClick=\{markAllRead\}><CheckCheck/);
  assert.doesNotMatch(notifications, /void markRead\(notices\)/);
  const bulk = notifications.slice(notifications.indexOf('const markAllRead'), notifications.indexOf('return <>'));
  assert.doesNotMatch(bulk, /dismiss\(/);
  assert.doesNotMatch(bulk, /Notification retirée/);
});
