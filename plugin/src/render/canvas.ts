/* eslint-disable no-bitwise, curly */
import {FACES, type FaceData} from './font';
import {fromBase64} from './png';

/**
 * An 8-bit gray bitmap with just enough drawing for the Today page: lines,
 * boxes and text from the pre-rasterised glyphs in font.ts.
 */

export type FaceName = keyof typeof FACES | string;

const decoded = new Map<string, Uint8Array>();

function glyphData(name: string, face: FaceData): Uint8Array {
  let data = decoded.get(name);
  if (!data) {
    data = fromBase64(face.data);
    decoded.set(name, data);
  }
  return data;
}

export class Canvas {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height).fill(255);
  }

  setPixel(x: number, y: number, value: number): void {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      const i = y * this.width + x;
      if (value < this.pixels[i]) {
        this.pixels[i] = value;
      }
    }
  }

  /** Darkest value wins, so a light rule never washes out text. */
  fillRect(left: number, top: number, right: number, bottom: number, value: number): void {
    const x0 = Math.max(0, Math.round(left));
    const x1 = Math.min(this.width, Math.round(right));
    const y1 = Math.min(this.height, Math.round(bottom));
    const p = this.pixels;
    for (let y = Math.max(0, Math.round(top)); y < y1; y++) {
      let i = y * this.width + x0;
      for (let x = x0; x < x1; x++) {
        if (value < p[i]) {
          p[i] = value;
        }
        i++;
      }
    }
  }

  hline(x1: number, x2: number, y: number, thickness: number, value: number): void {
    this.fillRect(x1, y - thickness / 2, x2, y + thickness / 2, value);
  }

  vline(x: number, y1: number, y2: number, thickness: number, value: number): void {
    this.fillRect(x - thickness / 2, y1, x + thickness / 2, y2, value);
  }

  strokeRect(left: number, top: number, right: number, bottom: number, thickness: number, value: number): void {
    this.hline(left, right, top + thickness / 2, thickness, value);
    this.hline(left, right, bottom - thickness / 2, thickness, value);
    this.vline(left + thickness / 2, top, bottom, thickness, value);
    this.vline(right - thickness / 2, top, bottom, thickness, value);
  }

  dottedVline(x: number, y1: number, y2: number, value: number, dash = 6, gap = 10): void {
    for (let y = y1; y < y2; y += dash + gap) {
      this.vline(x, y, Math.min(y + dash, y2), 2, value);
    }
  }

  /** A straight line of the given thickness, for the arrow in the "Not today" box. */
  line(x1: number, y1: number, x2: number, y2: number, thickness: number, value: number): void {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      this.fillRect(x - thickness / 2, y - thickness / 2, x + thickness / 2, y + thickness / 2, value);
    }
  }

  /** Width of `text` in pixels. Unknown characters count as "?". */
  measure(face: FaceName, text: string): number {
    const f = FACES[face];
    let w = 0;
    for (const ch of text) {
      w += (f.glyphs[ch.codePointAt(0)!] ?? f.glyphs[63])[4];
    }
    return w;
  }

  /**
   * Draws text with its baseline at `baseline`. `ink` is the darkest gray
   * (0 = black). Returns the width drawn.
   */
  text(face: FaceName, text: string, x: number, baseline: number, ink = 0): number {
    const f = FACES[face];
    const data = glyphData(face, f);
    let pen = x;
    for (const ch of text) {
      const g = f.glyphs[ch.codePointAt(0)!] ?? f.glyphs[63];
      const [w, h, left, top, advance, offset] = g;
      const gx = Math.round(pen) + left;
      const gy = baseline - top;
      const span = 255 - ink;
      const p = this.pixels;
      for (let row = 0; row < h; row++) {
        const y = gy + row;
        if (y < 0 || y >= this.height) {
          continue;
        }
        for (let col = 0; col < w; col++) {
          const index = row * w + col;
          const byte = data[offset + (index >> 1)];
          const alpha = index & 1 ? byte & 15 : byte >> 4;
          const x = gx + col;
          if (alpha && x >= 0 && x < this.width) {
            const value = 255 - Math.round((span * alpha) / 15);
            const at = y * this.width + x;
            if (value < p[at]) {
              p[at] = value;
            }
          }
        }
      }
      pen += advance;
    }
    return pen - x;
  }

  /** Cuts `text` to fit `maxWidth`, ending in an ellipsis when it had to cut. */
  fit(face: FaceName, text: string, maxWidth: number): string {
    if (this.measure(face, text) <= maxWidth) {
      return text;
    }
    const chars = Array.from(text);
    while (chars.length > 1 && this.measure(face, `${chars.join('')}…`) > maxWidth) {
      chars.pop();
    }
    return `${chars.join('').trimEnd()}…`;
  }

  /** Greedy word wrap into at most `maxLines` lines; the last line is cut with an ellipsis. */
  wrap(face: FaceName, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (let i = 0; i < words.length; i++) {
      const candidate = current ? `${current} ${words[i]}` : words[i];
      if (this.measure(face, candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (!current) {
        // a single word wider than the line
        current = this.fit(face, words[i], maxWidth);
        continue;
      }
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        current = words.slice(i).join(' ');
        break;
      }
    }
    if (current) {
      lines.push(this.fit(face, current, maxWidth));
    }
    return lines.slice(0, maxLines);
  }
}
