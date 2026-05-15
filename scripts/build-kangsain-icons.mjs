import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ORANGE = [240, 107, 26];
const WHITE = [255, 255, 255];
const outDir = new URL('../kangsain/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let crc = -1;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writeRgbPng(path, width, height, pixels) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersect = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function inRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function makeIcon(size) {
  const supersample = 4;
  const textHeight = size * 0.36;
  const bar = size * 0.075;
  const gap = size * 0.05;
  const nWidth = size * 0.225;
  const totalWidth = bar + gap + nWidth;
  const left = (size - totalWidth) / 2;
  const top = (size - textHeight) / 2;
  const bottom = top + textHeight;
  const iRect = { x: left, y: top, w: bar, h: textHeight };
  const nLeft = left + bar + gap;
  const nRight = nLeft + nWidth - bar;
  const nRects = [
    { x: nLeft, y: top, w: bar, h: textHeight },
    { x: nRight, y: top, w: bar, h: textHeight },
  ];
  const diagonal = [
    [nLeft + bar * 0.18, top],
    [nLeft + bar * 1.08, top],
    [nRight + bar * 0.82, bottom],
    [nRight - bar * 0.08, bottom],
  ];

  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hit = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const px = x + (sx + 0.5) / supersample;
          const py = y + (sy + 0.5) / supersample;
          if (
            inRect(px, py, iRect) ||
            nRects.some((rect) => inRect(px, py, rect)) ||
            pointInPolygon(px, py, diagonal)
          ) {
            hit += 1;
          }
        }
      }
      const a = hit / (supersample * supersample);
      const offset = (y * size + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        pixels[offset + c] = Math.round(ORANGE[c] * (1 - a) + WHITE[c] * a);
      }
    }
  }
  return pixels;
}

for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  writeRgbPng(new URL(name, outDir), size, size, makeIcon(size));
}

console.log('Built KangsaIN icons');
