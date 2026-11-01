import {inflateSync} from 'zlib';
import {deflateRuns, encodeGrayPng, fromBase64, toBase64} from '../png';

describe('deflateRuns', () => {
  it.each([
    ['empty', new Uint8Array(0)],
    ['short literal', Uint8Array.from([1, 2, 3, 250, 255, 144, 143])],
    ['long runs', new Uint8Array(1000).fill(7)],
    ['mixed', Uint8Array.from({length: 5000}, (_, i) => (i % 97 < 60 ? 255 : (i * 31) & 255))],
    ['exactly 258 and 259 of a kind', Uint8Array.from([...Array(259).fill(0), 5, ...Array(258).fill(5)])],
  ])('round-trips %s through zlib', (_name, data) => {
    expect(new Uint8Array(inflateSync(deflateRuns(data)))).toEqual(data);
  });
});

function decode(png: Uint8Array, w: number, h: number): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset);
  let at = 8;
  let idat: Uint8Array | null = null;
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.slice(at + 4, at + 8));
    if (type === 'IDAT') {
      idat = png.slice(at + 8, at + 8 + len);
    }
    at += 12 + len;
  }
  const raw = new Uint8Array(inflateSync(idat!));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w + 1)]).toBe(2);
    for (let x = 0; x < w; x++) {
      const above = y ? out[(y - 1) * w + x] : 0;
      out[y * w + x] = (raw[y * (w + 1) + 1 + x] + above) & 255;
    }
  }
  return out;
}

describe('encodeGrayPng', () => {
  it.each([
    ['an odd width', 37, 11, (i: number) => (i % 7 === 0 ? 0 : 255)],
    ['a width of a multiple of 4 with repeated rows', 40, 30, (i: number) => (Math.floor(i / 40) % 10 < 7 ? 255 : (i % 40) * 6)],
    ['all different', 64, 20, (i: number) => (i * 37 + 11) & 255],
    ['all white', 64, 20, () => 255],
    ['all black', 64, 20, () => 0],
  ])('writes a valid PNG for %s that zlib unpacks to the original', (_n, w, h, f) => {
    const pixels = Uint8Array.from({length: w * h}, (_, i) => f(i));
    const png = encodeGrayPng(w, h, pixels);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(decode(png, w, h)).toEqual(pixels);
  });

  it('compresses a blank Nomad page to a few KB', () => {
    const png = encodeGrayPng(1404, 1872, new Uint8Array(1404 * 1872).fill(255));
    expect(png.length).toBeLessThan(40_000);
  });

  it('gets the Adler-32 right for rows it never looked at', () => {
    // inflateSync verifies the checksum; a page with many repeated rows exercises the shortcut
    const w = 1404;
    const h = 200;
    const pixels = new Uint8Array(w * h).fill(255);
    for (let y = 50; y < 60; y++) {
      pixels.fill(0, y * w + 100, y * w + 900);
    }
    expect(Buffer.from(decode(encodeGrayPng(w, h, pixels), w, h)).equals(Buffer.from(pixels))).toBe(true);
  });
});

describe('base64', () => {
  it.each([0, 1, 2, 3, 4, 100, 1001])('round-trips %d bytes', n => {
    const bytes = Uint8Array.from({length: n}, (_, i) => (i * 37 + 11) & 255);
    const text = toBase64(bytes);
    expect(text).toBe(Buffer.from(bytes).toString('base64'));
    expect(fromBase64(text)).toEqual(bytes);
  });
});
