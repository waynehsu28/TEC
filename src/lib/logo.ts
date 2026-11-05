import { inflateSync } from 'node:zlib';

const maxBytes = 1_048_576;
const maxPixels = 4_000_000;
function validDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= maxPixels;
}
function crc32(bytes: Buffer): number {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
}
function validPng(bytes: Buffer): boolean {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  const chunks: Buffer[] = [];
  let width = 0, height = 0, bits = 0, color = -1, interlace = 0, ended = false, palette = false;
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) return false;
    const length = bytes.readUInt32BE(at);
    if (at + length + 12 > bytes.length) return false;
    const type = bytes.toString('ascii', at + 4, at + 8);
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== bytes.readUInt32BE(at + 8 + length)) return false;
    if (at === 8 && type !== 'IHDR') return false;
    if (type === 'IHDR') {
      if (at !== 8 || length !== 13) return false;
      width = bytes.readUInt32BE(at + 8); height = bytes.readUInt32BE(at + 12);
      bits = bytes[at + 16]; color = bytes[at + 17]; interlace = bytes[at + 20];
      if (!validDimensions(width, height) || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || interlace > 1) return false;
      const allowed: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!allowed[color]?.includes(bits)) return false;
    } else if (type === 'PLTE') {
      if (length === 0 || length > 768 || length % 3 !== 0) return false;
      palette = true;
    } else if (type === 'IDAT') chunks.push(bytes.subarray(at + 8, at + 8 + length));
    else if (type === 'IEND') {
      if (length !== 0 || at + 12 !== bytes.length) return false;
      ended = true; break;
    } else if (type[0] === type[0]?.toUpperCase()) return false; // Unknown critical chunk.
    at += length + 12;
  }
  if (!ended || chunks.length === 0 || (color === 3 && !palette)) return false;
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: 40_000_000 });
  const passes = interlace === 0 ? [[0, 0, 1, 1]] : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let offset = 0;
  for (const [x, y, dx, dy] of passes) {
    const passWidth = Math.max(0, Math.ceil((width - x) / dx)), passHeight = Math.max(0, Math.ceil((height - y) / dy));
    if (!passWidth || !passHeight) continue;
    const rowBytes = Math.ceil(passWidth * channels[color] * bits / 8);
    for (let row = 0; row < passHeight; row++) {
      if (offset >= raw.length || raw[offset] > 4) return false;
      offset += rowBytes + 1;
    }
  }
  return offset === raw.length;
}
function validJpeg(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let dimensions = false;
  for (let at = 2; at < bytes.length - 2;) {
    if (bytes[at++] !== 0xff) return false;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xda) return dimensions; // JPEG entropy-coded data follows SOS.
    if (marker === 0xd9 || at + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length) return false;
    if (frames.has(marker)) {
      if (length < 8 || bytes[at + 2] !== 8 || ![1, 3, 4].includes(bytes[at + 7])) return false;
      dimensions = validDimensions(bytes.readUInt16BE(at + 5), bytes.readUInt16BE(at + 3));
      if (!dimensions) return false;
    }
    at += length;
  }
  return false;
}
/** Validate the actual image bytes before storing a Logo that will later be embedded in PDFs. */
export function validCompanyLogo(dataUrl: string): boolean {
  if (dataUrl === '') return true;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0 || dataUrl.length > 1_398_130) return false;
  try {
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > maxBytes || bytes.toString('base64') !== match[2]) return false;
    return match[1] === 'png' ? validPng(bytes) : validJpeg(bytes);
  } catch { return false; }
}
