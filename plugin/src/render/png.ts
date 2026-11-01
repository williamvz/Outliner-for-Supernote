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
  for (let i = 0; i < bytes.length; ) {
    // 5552 bytes can be summed before the modulo can overflow 32 bits
    const stop = Math.min(bytes.length, i + 5552);
    for (; i < stop; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Reverses the lowest `count` bits: deflate sends Huffman codes most significant bit first. */
function reverse(value: number, count: number): number {
  let out = 0;
  for (let i = 0; i < count; i++) {
    out = (out << 1) | ((value >>> i) & 1);
  }
  return out;
}

/** The fixed Huffman code of every literal/length symbol, bits already reversed for LSB-first output. */
const CODE_BITS = new Uint16Array(288);
const CODE_LEN = new Uint8Array(288);
for (let sym = 0; sym < 288; sym++) {
  let code: number;
  let len: number;
  if (sym <= 143) {
    code = 0x30 + sym;
    len = 8;
  } else if (sym <= 255) {
    code = 0x190 + sym - 144;
    len = 9;
  } else if (sym <= 279) {
    code = sym - 256;
    len = 7;
  } else {
    code = 0xc0 + sym - 280;
    len = 8;
  }
  CODE_BITS[sym] = reverse(code, len);
  CODE_LEN[sym] = len;
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const LENGTH_INDEX = new Uint8Array(259);
for (let len = 3, index = 0; len <= 258; len++) {
  while (index + 1 < LENGTH_BASE.length && LENGTH_BASE[index + 1] <= len) {
    index++;
  }
  LENGTH_INDEX[len] = index;
}

/** A deflate stream of one fixed-Huffman block; matches only repeat the previous byte. */
class Deflater {
  private out = new Uint8Array(1 << 16);
  private length = 0;
  private buffer = 0;
  private count = 0;
  /** The last byte of the data fed so far; a run can continue it. */
  private previous = -1;
  /** Bytes fed so far, to know whether a run may start with a match. */
  private fed = 0;

  constructor() {
    this.bits(1, 1); // final block
    this.bits(1, 2); // fixed Huffman
  }

  private bits(value: number, count: number): void {
    this.buffer |= value << this.count;
    this.count += count;
    while (this.count >= 8) {
      if (this.length === this.out.length) {
        const bigger = new Uint8Array(this.out.length * 2);
        bigger.set(this.out);
        this.out = bigger;
      }
      this.out[this.length++] = this.buffer & 0xff;
      this.buffer >>>= 8;
      this.count -= 8;
    }
  }

  private symbol(sym: number): void {
    this.bits(CODE_BITS[sym], CODE_LEN[sym]);
  }

  /** Feeds `length` bytes of `data` starting at `start`. */
  feed(data: Uint8Array, start: number, length: number): void {
    const end = start + length;
    let i = start;
    while (i < end) {
      let run = 0;
      if (this.fed > 0) {
        const prev = i > start ? data[i - 1] : this.previous;
        const limit = Math.min(258, end - i);
        while (run < limit && data[i + run] === prev) {
          run++;
        }
      }
      if (run >= 3) {
        const index = LENGTH_INDEX[run];
        this.symbol(257 + index);
        this.bits(run - LENGTH_BASE[index], LENGTH_EXTRA[index]);
        this.bits(0, 5); // distance code 0 = distance 1
        this.fed += run;
        i += run;
      } else {
        this.symbol(data[i]);
        this.fed++;
        i++;
      }
    }
    if (length > 0) {
      this.previous = data[end - 1];
    }
  }

  /** `count` copies of `value` (the same as feeding them, without looking at each one). */
  feedRepeated(value: number, count: number): void {
    let left = count;
    if (left > 0 && (this.fed === 0 || this.previous !== value)) {
      this.symbol(value);
      this.fed++;
      this.previous = value;
      left--;
    }
    while (left >= 3) {
      const run = Math.min(258, left);
      const index = LENGTH_INDEX[run];
      this.symbol(257 + index);
      this.bits(run - LENGTH_BASE[index], LENGTH_EXTRA[index]);
      this.bits(0, 5);
      this.fed += run;
      left -= run;
    }
    while (left > 0) {
      this.symbol(value);
      this.fed++;
      left--;
    }
    if (count > 0) {
      this.previous = value;
    }
  }

  finish(adler: number): Uint8Array {
    this.symbol(256);
    if (this.count > 0) {
      this.bits(0, 8 - this.count);
    }
    const out = new Uint8Array(2 + this.length + 4);
    out[0] = 0x78;
    out[1] = 0x01;
    out.set(this.out.subarray(0, this.length), 2);
    out[out.length - 4] = adler >>> 24;
    out[out.length - 3] = (adler >>> 16) & 0xff;
    out[out.length - 2] = (adler >>> 8) & 0xff;
    out[out.length - 1] = adler & 0xff;
    return out;
  }
}

/** Deflate for arbitrary bytes (used by the tests); matches only repeat the previous byte. */
export function deflateRuns(data: Uint8Array): Uint8Array {
  const d = new Deflater();
  d.feed(data, 0, data.length);
  return d.finish(adler32(data));
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
  const deflater = new Deflater();
  const row = new Uint8Array(width + 1);
  row[0] = 2; // filter type Up
  const words = width % 4 === 0 ? new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4) : null;
  const perRow = width / 4;
  // Adler-32 kept by hand so rows identical to the one above need no pass over their bytes.
  let a = 1;
  let b = 0;

  for (let y = 0; y < height; y++) {
    const at = y * width;
    let same = y > 0;
    if (same) {
      const above = at - width;
      if (words) {
        const w0 = at / 4;
        const w1 = above / 4;
        for (let k = 0; k < perRow; k++) {
          if (words[w0 + k] !== words[w1 + k]) {
            same = false;
            break;
          }
        }
      } else {
        for (let x = 0; x < width; x++) {
          if (pixels[at + x] !== pixels[above + x]) {
            same = false;
            break;
          }
        }
      }
    }

    if (same) {
      // filter byte 2, then `width` zero residuals
      deflater.feedRepeated(2, 1);
      deflater.feedRepeated(0, width);
      a += 2;
      b += a;
      b = (b + a * width) % 65521;
      a %= 65521;
      continue;
    }

    for (let x = 0; x < width; x++) {
      row[x + 1] = (pixels[at + x] - (y > 0 ? pixels[at - width + x] : 0)) & 0xff;
    }
    deflater.feed(row, 0, width + 1);
    for (let x = 0; x < width + 1; x++) {
      a += row[x];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  const idat = deflater.finish((((b << 16) | a) >>> 0));

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', header),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
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
