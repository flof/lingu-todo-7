/**
 * Draws the app icons with nothing but node:zlib — a green tile with a white
 * check, supersampled 3× so the edges are smooth. Run: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(fileURLToPath(new URL('..', import.meta.url)), 'client/public/icons');
const BRAND = [31, 111, 74, 255];
const WHITE = [255, 255, 255, 255];
const SCALE = 3;

// -- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -- drawing ----------------------------------------------------------------

function drawIcon(size, { maskable }) {
  const big = size * SCALE;
  const pixels = new Uint8ClampedArray(big * big * 4);

  const put = (x, y, color) => {
    const offset = (y * big + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  };

  const radius = maskable ? 0 : big * 0.22;
  for (let y = 0; y < big; y += 1) {
    for (let x = 0; x < big; x += 1) {
      if (radius === 0 || insideRoundedRect(x, y, big, radius)) put(x, y, BRAND);
    }
  }

  // The check, drawn as two thick segments with round caps.
  const shrink = maskable ? 0.62 : 0.78;
  const midX = 0.5;
  const midY = 0.5;
  const points = [
    [midX - 0.21 * shrink, midY + 0.02 * shrink],
    [midX - 0.06 * shrink, midY + 0.17 * shrink],
    [midX + 0.21 * shrink, midY - 0.14 * shrink],
  ].map(([x, y]) => [x * big, y * big]);

  const half = big * 0.055 * shrink;
  for (let index = 0; index < points.length - 1; index += 1) {
    stampSegment(pixels, big, points[index], points[index + 1], half);
  }

  // Downsample.
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const offset = ((y * SCALE + sy) * big + (x * SCALE + sx)) * 4;
          r += pixels[offset];
          g += pixels[offset + 1];
          b += pixels[offset + 2];
          a += pixels[offset + 3];
        }
      }
      const count = SCALE * SCALE;
      const offset = (y * size + x) * 4;
      out[offset] = r / count;
      out[offset + 1] = g / count;
      out[offset + 2] = b / count;
      out[offset + 3] = a / count;
    }
  }
  return out;
}

function insideRoundedRect(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function stampSegment(pixels, size, from, to, half) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const steps = Math.ceil(Math.hypot(dx, dy));
  for (let step = 0; step <= steps; step += 1) {
    const cx = from[0] + (dx * step) / steps;
    const cy = from[1] + (dy * step) / steps;
    const r = half;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const offset = (y * size + x) * 4;
        pixels[offset] = WHITE[0];
        pixels[offset + 1] = WHITE[1];
        pixels[offset + 2] = WHITE[2];
        pixels[offset + 3] = WHITE[3];
      }
    }
  }
}

mkdirSync(outDir, { recursive: true });
for (const [file, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const png = encodePng(size, size, drawIcon(size, { maskable }));
  writeFileSync(join(outDir, file), png);
  console.log(`${file}: ${png.length} bytes`);
}
