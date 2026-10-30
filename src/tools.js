// Zeichenwerkzeuge. Ein Strich merkt sich den alten Wert jedes berührten
// Pixels, damit er rückgängig gemacht oder abgebrochen werden kann.

import { pixelEntry } from './history.js';

export const TOOLS = {
  pen: { label: 'Stift' },
  eraser: { label: 'Radierer' },
  fill: { label: 'Füllen' },
  picker: { label: 'Pipette' },
};

/**
 * Füllt die zusammenhängende Fläche gleicher Farbe (4er-Nachbarschaft,
 * also nicht über Diagonalen hinweg) auf einer Ebene.
 * @returns Verlaufseintrag oder null, wenn sich nichts ändert.
 */
export function floodFill(layer, width, height, x, y, value) {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const px = new Uint32Array(layer.data.buffer);
  const start = y * width + x;
  const target = px[start];
  value >>>= 0;
  if (target === value) return null;
  const changed = [];
  const stack = [start];
  px[start] = value;
  while (stack.length) {
    const i = stack.pop();
    changed.push(i);
    const cx = i % width;
    if (cx > 0 && px[i - 1] === target) { px[i - 1] = value; stack.push(i - 1); }
    if (cx < width - 1 && px[i + 1] === target) { px[i + 1] = value; stack.push(i + 1); }
    if (i >= width && px[i - width] === target) { px[i - width] = value; stack.push(i - width); }
    if (i < width * (height - 1) && px[i + width] === target) { px[i + width] = value; stack.push(i + width); }
  }
  const indices = Uint32Array.from(changed);
  return pixelEntry(layer, indices, new Uint32Array(indices.length).fill(target), new Uint32Array(indices.length).fill(value));
}

export class Stroke {
  constructor(layer, width, height, value) {
    this.layer = layer;
    this.width = width;
    this.height = height;
    this.value = value >>> 0;
    this.px = new Uint32Array(layer.data.buffer);
    this.before = new Map();
    this.last = null;
  }

  plot(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    if (!this.before.has(i)) this.before.set(i, this.px[i]);
    this.px[i] = this.value;
  }

  /** Zieht eine lückenlose Pixellinie (Bresenham) vom letzten Punkt aus. */
  to(x, y) {
    if (!this.last) {
      this.plot(x, y);
      this.last = { x, y };
      return;
    }
    let { x: x0, y: y0 } = this.last;
    const dx = Math.abs(x - x0), sx = x0 < x ? 1 : -1;
    const dy = -Math.abs(y - y0), sy = y0 < y ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.plot(x0, y0);
      if (x0 === x && y0 === y) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    this.last = { x, y };
  }

  cancel() {
    for (const [i, v] of this.before) this.px[i] = v;
    this.before.clear();
  }

  /** @returns Verlaufseintrag oder null, wenn sich nichts geändert hat. */
  finish() {
    const indices = [], before = [], after = [];
    for (const [i, v] of this.before) {
      if (v === this.px[i]) continue;
      indices.push(i);
      before.push(v);
      after.push(this.px[i]);
    }
    if (!indices.length) return null;
    return pixelEntry(this.layer, Uint32Array.from(indices), Uint32Array.from(before), Uint32Array.from(after));
  }
}
