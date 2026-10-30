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
    this.hits = new Map(); // wie oft dieser Strich ein Pixel gerade belegt
    this.path = [];
  }

  paint(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    if (!this.before.has(i)) this.before.set(i, this.px[i]);
    this.hits.set(i, (this.hits.get(i) || 0) + 1);
    this.px[i] = this.value;
  }

  unpaint(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    const n = this.hits.get(i) - 1;
    this.hits.set(i, n);
    if (n === 0) this.px[i] = this.before.get(i);
  }

  /**
   * Ein Pixel weiter entlang des Strichs. "Pixel Perfect": Treppenstufen
   * (L-förmige Ecken) und kurzes Zurückzucken des Fingers werden wieder
   * entfernt, damit freihändige Linien genau 1 Pixel dünn bleiben.
   */
  step(x, y) {
    const path = this.path;
    if (path.length >= 2) {
      const a = path[path.length - 2], b = path[path.length - 1];
      const back = a.x === x && a.y === y;
      const corner = (a.x === b.x || a.y === b.y) && (x === b.x || y === b.y) && a.x !== x && a.y !== y;
      if (back || corner) {
        path.pop();
        this.unpaint(b.x, b.y);
        if (back) return;
      }
    }
    const prev = path[path.length - 1];
    if (prev && prev.x === x && prev.y === y) return;
    this.paint(x, y);
    path.push({ x, y });
    if (path.length > 64) path.splice(0, path.length - 64);
  }

  /** Zieht eine lückenlose Pixellinie (Bresenham) vom letzten Punkt aus. */
  to(x, y) {
    const last = this.path[this.path.length - 1];
    if (!last) {
      this.step(x, y);
      return;
    }
    let x0 = last.x, y0 = last.y;
    const dx = Math.abs(x - x0), sx = x0 < x ? 1 : -1;
    const dy = -Math.abs(y - y0), sy = y0 < y ? 1 : -1;
    let err = dx + dy;
    while (x0 !== x || y0 !== y) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      this.step(x0, y0);
    }
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
