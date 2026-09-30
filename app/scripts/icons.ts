// Renders PWA icons from the hero pixel sprite. Run: npx tsx app/scripts/icons.ts
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { PALETTE, SPRITES } from '../src/sprites/pixels';

const out = join(import.meta.dirname, '../public/icons');

function crc32(buf: Buffer) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h: string): [number, number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  255,
];

const hero = SPRITES.hero;
const bg = hex('#5c94fc');
const ground = hex('#63c74d');

/** Hero on a sky tile; `fill` = fraction of the icon the sprite spans. */
function icon(size: number, fill: number) {
  const scale = Math.floor((size * fill) / 16);
  const off = Math.floor((size - 16 * scale) / 2);
  return png(size, (x, y) => {
    const sx = Math.floor((x - off) / scale);
    const sy = Math.floor((y - off) / scale);
    const ch = hero[sy]?.[sx];
    if (ch && ch !== '.' && PALETTE[ch]) return hex(PALETTE[ch]);
    return y > off + 15 * scale ? ground : bg;
  });
}

writeFileSync(join(out, 'icon-192.png'), icon(192, 0.8));
writeFileSync(join(out, 'icon-512.png'), icon(512, 0.8));
writeFileSync(join(out, 'icon-maskable-512.png'), icon(512, 0.6));
writeFileSync(join(out, 'apple-touch-icon.png'), icon(180, 0.75));
console.log('icons written to', out);
