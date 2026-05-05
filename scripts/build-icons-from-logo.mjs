import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const source = '/Users/archivepilates/Library/CloudStorage/GoogleDrive-kihyo2215@gmail.com/다른 컴퓨터/hyodalpc/Desktop/아카이브필라테스/아카이브 필라테스 로고작업/아카이브+필라테스+최종원본/logo.png';
const outDir = new URL('../icons/', import.meta.url);
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

function decodePng(path) {
  const png = readFileSync(path);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idats = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.slice(pos + 4, pos + 8).toString('ascii');
    const data = png.slice(pos + 8, pos + 8 + len);
    pos += len + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[12] !== 0) throw new Error('Interlaced PNG is not supported');
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (colorType !== 6) throw new Error(`Expected RGBA PNG, got color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idats));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(width * height * 4);
  let rawPos = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawPos++];
    const row = Buffer.from(raw.slice(rawPos, rawPos + stride));
    rawPos += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      }
    }
    row.copy(pixels, y * stride);
    prev = row;
  }
  return { width, height, pixels };
}

function writePng(path, width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function findBounds(img) {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (y * img.width + x) * 4;
      const r = img.pixels[i];
      const g = img.pixels[i + 1];
      const b = img.pixels[i + 2];
      const a = img.pixels[i + 3];
      if (a > 10 && (r < 245 || g < 245 || b < 245)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const side = Math.max(w, h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    x: Math.max(0, Math.round(cx - side / 2)),
    y: Math.max(0, Math.round(cy - side / 2)),
    side,
  };
}

function resizeCrop(img, crop, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(img.width - 1, Math.max(0, Math.round(crop.x + (x + 0.5) * crop.side / size)));
      const sy = Math.min(img.height - 1, Math.max(0, Math.round(crop.y + (y + 0.5) * crop.side / size)));
      img.pixels.copy(out, (y * size + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
    }
  }
  return out;
}

function averageRed(pixels, width, height) {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (a > 10 && r > 180 && g < 80 && b < 80) {
        rSum += r;
        gSum += g;
        bSum += b;
        count += 1;
      }
    }
  }
  return count > 0
    ? [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count), 255]
    : [237, 32, 26, 255];
}

function isWhiteish(pixels, i) {
  return pixels[i + 3] <= 10 || (pixels[i] > 235 && pixels[i + 1] > 235 && pixels[i + 2] > 235);
}

function fillOuterWhiteWithRed(pixels, size, red) {
  const out = Buffer.from(pixels);
  const seen = new Uint8Array(size * size);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const p = y * size + x;
    if (seen[p]) return;
    const i = p * 4;
    if (!isWhiteish(out, i)) return;
    seen[p] = 1;
    queue.push(p);
  };

  for (let n = 0; n < size; n += 1) {
    push(n, 0);
    push(n, size - 1);
    push(0, n);
    push(size - 1, n);
  }

  for (let qi = 0; qi < queue.length; qi += 1) {
    const p = queue[qi];
    const i = p * 4;
    out[i] = red[0];
    out[i + 1] = red[1];
    out[i + 2] = red[2];
    out[i + 3] = red[3];
    const x = p % size;
    const y = Math.floor(p / size);
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  return out;
}

const img = decodePng(source);
const crop = findBounds(img);
const red = averageRed(img.pixels, img.width, img.height);
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-512.png', 512],
  ['icon-192.png', 192],
]) {
  const pixels = fillOuterWhiteWithRed(resizeCrop(img, crop, size), size, red);
  writePng(new URL(name, outDir), size, size, pixels);
}

console.log(`cropped ${crop.side}x${crop.side} at ${crop.x},${crop.y}`);
