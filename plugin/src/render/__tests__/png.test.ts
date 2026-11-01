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

describe('encodeGrayPng', () => {
  it('writes a valid PNG that zlib can unpack to the original rows', () => {
    const w = 37;
    const h = 11;
    const pixels = Uint8Array.from({length: w * h}, (_, i) => (i % 7 === 0 ? 0 : 255));
    const png = encodeGrayPng(w, h, pixels);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // pull the IDAT payload out and undo the Up filter
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
    expect(out).toEqual(pixels);
  });

  it('compresses a blank Nomad page to a few KB', () => {
    const png = encodeGrayPng(1404, 1872, new Uint8Array(1404 * 1872).fill(255));
    expect(png.length).toBeLessThan(40_000);
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
