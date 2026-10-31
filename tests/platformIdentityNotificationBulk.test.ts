import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DISCOVER_PLATFORM_ID_MAP, DISCOVER_PLATFORM_PREFERENCE_ID_MAP } from '../src/features/discover/filterPolicy.ts';
import { providerIdForPreferenceId, SEENIT_PLATFORM_BY_KEY } from '../src/features/providers/platformIdentity.ts';
import { PLATFORM_BRAND_ASSETS } from '../src/features/providers/platformBrandAssets.ts';
import { getFormattedProviderLogo } from '../src/utils/providerLogos.ts';

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

test('#809 Réglages et Explorer utilisent les quatre logos de marque canoniques', () => {
  const logos = readFileSync('src/features/providers/platformLogos.ts', 'utf8');
  const filters = readFileSync('src/components/FilterModal.tsx', 'utf8');
  assert.match(logos, /8: PLATFORM_BRAND_ASSETS\.netflix/);
  assert.match(logos, /118: PLATFORM_BRAND_ASSETS\.hbo/);
  assert.match(logos, /234: PLATFORM_BRAND_ASSETS\.franceTv/);
  assert.match(logos, /381: PLATFORM_BRAND_ASSETS\.canal/);
  assert.match(filters, /PLATFORMS\.map\(withCanonicalLogo\)/);
  assert.match(filters, /platformLogos\[preferenceId\(id\)\]/);
  assert.doesNotMatch(filters, /pbpMk2JmcoNnQwx5JGpXngfoWtp/);
  assert.doesNotMatch(filters, /getFormattedProviderLogo\(null, 'HBO'\)/);
  assert.doesNotMatch(filters, /brand\/providers\/canalplus\.svg/);
});

test('#809 les badges de cartes utilisent les mêmes variantes Netflix, HBO, Canal+ et France TV', () => {
  assert.equal(getFormattedProviderLogo('/legacy.jpg', 'Netflix'), PLATFORM_BRAND_ASSETS.netflix);
  assert.equal(getFormattedProviderLogo('/legacy.jpg', 'HBO'), PLATFORM_BRAND_ASSETS.hbo);
  assert.equal(getFormattedProviderLogo('/legacy.jpg', 'CANAL+'), PLATFORM_BRAND_ASSETS.canal);
  assert.equal(getFormattedProviderLogo('/legacy.jpg', 'France TV'), PLATFORM_BRAND_ASSETS.franceTv);
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
