import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMagnetLink,
  getMagnetInfoHash,
  isSafeMagnetLink,
  normalizeBtih
} from '../src/features/downloads/magnetLink.ts';

const hexHash = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';

test('SEENIT-C411-002 construit un Magnet uniquement depuis un infohash BTIH valide', () => {
  const magnet = buildMagnetLink(hexHash, 'Film & série');
  assert.ok(magnet?.startsWith('magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01'));
  assert.ok(magnet?.includes('dn=Film%20%26%20s%C3%A9rie'));
  assert.equal(buildMagnetLink('abc&tr=https://evil.example', 'Film'), null);
  assert.equal(buildMagnetLink('javascript:alert(1)', 'Film'), null);
});

test('SEENIT-C411-002 accepte les formes BTIH hexadécimale et base32 documentées', () => {
  assert.equal(normalizeBtih(hexHash), hexHash.toLowerCase());
  assert.equal(normalizeBtih('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), 'abcdefghijklmnopqrstuvwxyz234567');
  assert.equal(normalizeBtih('trop-court'), null);
});

test('SEENIT-C411-002 refuse les URL externes et les Magnet sans identité BTIH', () => {
  const safe = buildMagnetLink(hexHash, 'SeenIt');
  assert.equal(getMagnetInfoHash(safe), hexHash.toLowerCase());
  assert.equal(isSafeMagnetLink(safe), true);
  assert.equal(isSafeMagnetLink('https://example.org/file.torrent'), false);
  assert.equal(isSafeMagnetLink('magnet:?dn=SansHash'), false);
  assert.equal(isSafeMagnetLink('magnet:?xt=urn:btmh:1220abcdef'), false);
});
