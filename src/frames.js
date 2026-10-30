// Frames (Einzelbilder einer Animation). Alle Frames haben dieselben Ebenen;
// ein neuer Frame bekommt pro Ebene eigene, leere Pixel.

import { createLayer, compositeFrame } from './document.js';

export const DEFAULT_FPS = 8;

function emptyLike(doc, frame) {
  return {
    layers: frame.layers.map((src) => {
      const l = createLayer(doc.width, doc.height, src.name);
      l.visible = src.visible;
      l.opacity = src.opacity;
      if (src.ref) l.ref = { ...src.ref }; // Vorlage samt Position übernehmen
      return l;
    }),
  };
}

/** Leerer Frame hinter dem aktuellen. */
export function addFrame(doc) {
  const frame = emptyLike(doc, doc.frames[doc.frameIndex]);
  doc.frames.splice(doc.frameIndex + 1, 0, frame);
  doc.frameIndex += 1;
}

/** Kopie des aktuellen Frames dahinter. */
export function duplicateFrame(doc) {
  const src = doc.frames[doc.frameIndex];
  const frame = emptyLike(doc, src);
  frame.layers.forEach((l, i) => l.data.set(src.layers[i].data));
  doc.frames.splice(doc.frameIndex + 1, 0, frame);
  doc.frameIndex += 1;
}

export function deleteFrame(doc) {
  if (doc.frames.length <= 1) return false;
  doc.frames.splice(doc.frameIndex, 1);
  doc.frameIndex = Math.min(doc.frameIndex, doc.frames.length - 1);
  return true;
}

/** dir = -1 nach links (früher), +1 nach rechts (später) */
export function moveFrame(doc, dir) {
  const from = doc.frameIndex, to = from + dir;
  if (to < 0 || to >= doc.frames.length) return false;
  const [f] = doc.frames.splice(from, 1);
  doc.frames.splice(to, 0, f);
  doc.frameIndex = to;
  return true;
}

/** Alle Frames nebeneinander in einem Bild (GameMaker "_stripN"). */
export function buildStrip(doc) {
  const { width: w, height: h } = doc;
  const n = doc.frames.length;
  const out = new Uint8ClampedArray(w * n * h * 4);
  doc.frames.forEach((frame, i) => {
    const px = compositeFrame(doc, frame);
    for (let y = 0; y < h; y++) {
      out.set(px.subarray(y * w * 4, (y + 1) * w * 4), (y * w * n + i * w) * 4);
    }
  });
  return { pixels: out, width: w * n, height: h };
}
