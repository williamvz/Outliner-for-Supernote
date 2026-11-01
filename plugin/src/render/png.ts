/* eslint-disable no-bitwise, curly */
/**
 * Minimal PNG writer for the Today page background: 8-bit grayscale, "Up"
 * filter, and a deflate stream made of fixed-Huffman blocks with run matches.
 * A mostly white page shrinks from 2.6 MB to a few dozen KB. There is no zlib
 * in PluginHost's JavaScript, hence the hand-rolled encoder.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Bits are packed least significant first; Huffman codes are sent most significant first. */
class BitWriter {
  private bytes: number[] = [];
  private bitBuffer = 0;
  private bitCount = 0;

  bits(value: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.push((value >>> i) & 1);
    }
  }

  code(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.push((value >>> i) & 1);
    }
  }

  private push(bit: number): void {
    this.bitBuffer |= bit << this.bitCount;
    if (++this.bitCount === 8) {
      this.bytes.push(this.bitBuffer);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
  }

  finish(): number[] {
    if (this.bitCount > 0) {
      this.bytes.push(this.bitBuffer);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
    return this.bytes;
  }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];

function literalOrLength(w: BitWriter, symbol: number): void {
  if (symbol <= 143) {
    w.code(0x30 + symbol, 8);
  } else if (symbol <= 255) {
    w.code(0x190 + symbol - 144, 9);
  } else if (symbol <= 279) {
    w.code(symbol - 256, 7);
  } else {
    w.code(0xc0 + symbol - 280, 8);
  }
}

/** Deflate with a single fixed-Huffman block; matches only repeat the previous byte. */
export function deflateRuns(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.bits(1, 1); // final block
  w.bits(1, 2); // fixed Huffman
  let i = 0;
  while (i < data.length) {
    let run = 0;
    if (i > 0) {
      while (i + run < data.length && run < 258 && data[i + run] === data[i - 1]) {
        run++;
      }
    }
    if (run >= 3) {
      let index = LENGTH_BASE.length - 1;
      while (LENGTH_BASE[index] > run) {
        index--;
      }
      literalOrLength(w, 257 + index);
      w.bits(run - LENGTH_BASE[index], LENGTH_EXTRA[index]);
      w.code(0, 5); // distance code 0 = distance 1
      i += run;
    } else {
      literalOrLength(w, data[i]);
      i++;
    }
  }
  literalOrLength(w, 256);
  const body = w.finish();

  const out = new Uint8Array(2 + body.length + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(body, 2);
  const sum = adler32(data);
  out[out.length - 4] = sum >>> 24;
  out[out.length - 3] = (sum >>> 16) & 0xff;
  out[out.length - 2] = (sum >>> 8) & 0xff;
  out[out.length - 1] = sum & 0xff;
  return out;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
  return out;
}

export function encodeGrayPng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const stride = width + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 2; // Up
    for (let x = 0; x < width; x++) {
      const above = y > 0 ? pixels[(y - 1) * width + x] : 0;
      raw[y * stride + 1 + x] = (pixels[y * width + x] - above) & 0xff;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', header),
    chunk('IDAT', deflateRuns(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(
      B64[(n >>> 18) & 63] +
        B64[(n >>> 12) & 63] +
        (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : '=') +
        (i + 2 < bytes.length ? B64[n & 63] : '='),
    );
  }
  return parts.join('');
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (at < out.length) out[at++] = (n >>> 16) & 255;
    if (at < out.length) out[at++] = (n >>> 8) & 255;
    if (at < out.length) out[at++] = n & 255;
  }
  return out;
}
