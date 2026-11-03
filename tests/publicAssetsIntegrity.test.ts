import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

// #809 : quatre PNG embarqués étaient illisibles (logos Netflix, France TV, CANAL+ et une marque
// inutilisée), car un binaire écrit comme du texte via une API voit ses octets > 0x7F remplacés par
// EF BF BD (caractère de remplacement UTF-8). Toute image publique doit rester décodable.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const UTF8_REPLACEMENT = Buffer.from([0xef, 0xbf, 0xbd]);

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function listPngs(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listPngs(path);
    return name.toLowerCase().endsWith('.png') ? [path] : [];
  });
}

/** Erreur lisible, ou null si le PNG est intact (signature, CRC de chaque chunk, IEND, flux IDAT). */
export function pngDefect(bytes: Buffer): string | null {
  if (bytes.subarray(0, 3).equals(UTF8_REPLACEMENT)) return 'binaire écrit comme du texte (EF BF BD au lieu de 0x89)';
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'signature PNG absente';
  const idat: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) return 'chunk tronqué';
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) return `chunk ${type.toString('latin1')} tronqué`;
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(Buffer.concat([type, payload])) !== bytes.readUInt32BE(offset + 8 + length)) return `CRC invalide (${type.toString('latin1')})`;
    if (type.toString('latin1') === 'IDAT') idat.push(payload);
    if (type.toString('latin1') === 'IEND') {
      try { inflateSync(Buffer.concat(idat)); } catch { return 'flux IDAT non décodable'; }
      return null;
    }
    offset = end;
  }
  return 'IEND manquant';
}

test('#809 toutes les images PNG publiques sont décodables', () => {
  const pngs = listPngs('public');
  assert.ok(pngs.length >= 10, 'les assets publics sont bien inventoriés');
  const defects = pngs.map(path => [path, pngDefect(readFileSync(path))] as const).filter(([, defect]) => defect);
  assert.deepEqual(defects, [], 'image publique illisible');
});

test('#809 le contrôle reconnaît la corruption d’un binaire écrit comme du texte', () => {
  const valid = readFileSync('public/brand/providers/netflix.png');
  assert.equal(pngDefect(valid), null);
  const asText = Buffer.from(valid.toString('utf8'), 'utf8');
  assert.match(pngDefect(asText) || '', /écrit comme du texte/);
  const flipped = Buffer.from(valid);
  flipped[flipped.length - 20] ^= 0xff;
  assert.match(pngDefect(flipped) || '', /CRC invalide|IDAT|tronqué/);
});
