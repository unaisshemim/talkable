import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = dirname(fileURLToPath(import.meta.url));
const iconDir = join(root, "..", "assets", "icons");
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const png = renderIcon(size);
  await writeFile(join(iconDir, `icon-${size}.png`), png);
}

console.log(`Generated icons: ${sizes.map((size) => `${size}px`).join(", ")}`);

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 128;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = x / scale;
      const ny = y / scale;
      const offset = (y * size + x) * 4;

      if (!inRoundedRect(nx, ny, 0, 0, 128, 128, 26)) {
        pixels[offset + 3] = 0;
        continue;
      }

      setPixel(pixels, offset, 21, 94, 239, 255);

      if (inCapsule(nx, ny, 44, 24, 84, 86, 20)) {
        setPixel(pixels, offset, 255, 255, 255, 255);
      }

      if (inCapsule(nx, ny, 55, 34, 73, 76, 9)) {
        setPixel(pixels, offset, 21, 94, 239, 255);
      }

      if (inCapsule(nx, ny, 34, 54, 46, 96, 6) || inCapsule(nx, ny, 82, 54, 94, 96, 6)) {
        setPixel(pixels, offset, 209, 233, 255, 255);
      }

      if (ny >= 84 && ny <= 96 && distance(nx, ny, 64, 66) >= 18 && distance(nx, ny, 64, 66) <= 31) {
        setPixel(pixels, offset, 209, 233, 255, 255);
      }

      if (nx >= 58 && nx <= 70 && ny >= 94 && ny <= 110) {
        setPixel(pixels, offset, 209, 233, 255, 255);
      }

      if (inCapsule(nx, ny, 42, 104, 86, 116, 6)) {
        setPixel(pixels, offset, 209, 233, 255, 255);
      }
    }
  }

  return encodePng(size, size, pixels);
}

function inRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));

  return x >= left && x <= right && y >= top && y <= bottom && distance(x, y, cx, cy) <= radius;
}

function inCapsule(x, y, left, top, right, bottom, radius) {
  return inRoundedRect(x, y, left, top, right - left, bottom - top, radius);
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function setPixel(pixels, offset, red, green, blue, alpha) {
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
  pixels[offset + 3] = alpha;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data])))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
