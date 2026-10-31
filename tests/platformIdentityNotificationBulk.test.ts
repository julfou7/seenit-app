import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { DISCOVER_PLATFORM_ID_MAP, DISCOVER_PLATFORM_PREFERENCE_ID_MAP } from '../src/features/discover/filterPolicy.ts';
import { platformLogoUrl, readPlatformLogos } from '../src/features/providers/platformLogos.ts';
import { providerIdForPreferenceId, SEENIT_PLATFORM_BY_KEY } from '../src/features/providers/platformIdentity.ts';
import { getFormattedProviderLogo, PROVIDER_BRAND_LOGOS } from '../src/utils/providerLogos.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertDecodablePng(assetPath: string): void {
  const bytes = readFileSync(assetPath);
  assert.equal(bytes.subarray(0, 8).compare(PNG_SIGNATURE), 0, `${assetPath} doit avoir une signature PNG complète`);

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIend = false;
  const idatChunks: Buffer[] = [];

  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, `${assetPath}: en-tête de chunk tronqué`);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + length;
    const crcEnd = payloadEnd + 4;
    assert.ok(crcEnd <= bytes.length, `${assetPath}: chunk ${type.toString('ascii')} tronqué`);

    const payload = bytes.subarray(payloadStart, payloadEnd);
    const expectedCrc = bytes.readUInt32BE(payloadEnd);
    const actualCrc = crc32(Buffer.concat([type, payload]));
    assert.equal(actualCrc, expectedCrc, `${assetPath}: CRC invalide pour ${type.toString('ascii')}`);

    const chunkType = type.toString('ascii');
    if (chunkType === 'IHDR') {
      assert.equal(length, 13, `${assetPath}: IHDR invalide`);
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
    } else if (chunkType === 'IDAT') {
      idatChunks.push(payload);
    } else if (chunkType === 'IEND') {
      sawIend = true;
      assert.equal(crcEnd, bytes.length, `${assetPath}: données après IEND`);
      break;
    }
    offset = crcEnd;
  }

  assert.ok(width >= 64 && height >= 64, `${assetPath}: dimensions trop petites pour une tuile`);
  assert.ok(idatChunks.length > 0, `${assetPath}: aucun IDAT`);
  assert.ok(sawIend, `${assetPath}: IEND manquant`);
  assert.doesNotThrow(() => inflateSync(Buffer.concat(idatChunks)), `${assetPath}: flux IDAT non décodable`);
}

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
  const logosSource = readFileSync('src/features/providers/platformLogos.ts', 'utf8');
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

  const resolved = readPlatformLogos();
  assert.equal(resolved[8], PROVIDER_BRAND_LOGOS.netflix);
  assert.equal(resolved[234], PROVIDER_BRAND_LOGOS.france);
  assert.equal(platformLogoUrl(resolved[8]), PROVIDER_BRAND_LOGOS.netflix);
  assert.equal(platformLogoUrl(resolved[234]), PROVIDER_BRAND_LOGOS.france);

  assert.match(logosSource, /8: PROVIDER_BRAND_LOGOS\.netflix/);
  assert.match(logosSource, /118: PROVIDER_BRAND_LOGOS\.hbo/);
  assert.match(logosSource, /234: PROVIDER_BRAND_LOGOS\.france/);
  assert.match(logosSource, /381: PROVIDER_BRAND_LOGOS\.canal/);
  assert.match(filters, /platformLogoUrl\(platform\.logo\)/);
  assert.match(filters, /getFormattedProviderLogo\(null, 'HBO'\)/);

  for (const asset of Object.values(PROVIDER_BRAND_LOGOS)) assertDecodablePng(`public${asset}`);
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
