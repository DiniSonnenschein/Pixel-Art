// Datenmodell: Ein Dokument hat eine feste Pixelgröße und eine Liste von
// Frames (Animation). Jeder Frame besteht aus Ebenen mit eigenen RGBA-Pixeln.

export const MIN_SIZE = 1;
export const MAX_SIZE = 1024;

let nextLayerId = 1;

export function createLayer(width, height, name = 'Ebene') {
  return {
    id: nextLayerId++,
    name,
    visible: true,
    opacity: 1,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

export function createDocument(width, height) {
  return {
    width,
    height,
    frames: [{ layers: [createLayer(width, height, 'Ebene 1')] }],
    frameIndex: 0,
    layerIndex: 0,
  };
}

export function currentFrame(doc) {
  return doc.frames[doc.frameIndex];
}

export function currentLayer(doc) {
  return currentFrame(doc).layers[doc.layerIndex];
}

export function allLayers(doc) {
  return doc.frames.flatMap((f) => f.layers);
}

/** Packt eine Farbe als Uint32 passend zu einer Uint32Array-Sicht auf RGBA-Bytes. */
export function packColor({ r, g, b, a }) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * Verrechnet alle sichtbaren Ebenen eines Frames ("source-over") mit
 * Ganzzahl-Mathematik, damit das Ergebnis überall identisch ist.
 * Voll deckende und voll transparente Pixel bleiben exakt erhalten.
 */
export function compositeFrame(doc, frame, out = new Uint8ClampedArray(doc.width * doc.height * 4)) {
  out.fill(0);
  for (const layer of frame.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const src = layer.data;
    const op = Math.round(layer.opacity * 255);
    for (let i = 0; i < src.length; i += 4) {
      let sa = src[i + 3];
      if (sa === 0) continue;
      if (op !== 255) sa = Math.round((sa * op) / 255);
      if (sa === 255) {
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = 255;
        continue;
      }
      const da = out[i + 3];
      if (da === 0) {
        out[i] = src[i];
        out[i + 1] = src[i + 1];
        out[i + 2] = src[i + 2];
        out[i + 3] = sa;
        continue;
      }
      // Allgemeiner Fall mit Alpha auf beiden Seiten
      const saF = sa / 255;
      const daF = da / 255;
      const oa = saF + daF * (1 - saF);
      for (let c = 0; c < 3; c++) {
        out[i + c] = Math.round((src[i + c] * saF + out[i + c] * daF * (1 - saF)) / oa);
      }
      out[i + 3] = Math.round(oa * 255);
    }
  }
  return out;
}

/** Skaliert RGBA-Pixel per "Nearest Neighbor" – keine neuen Mischfarben. */
export function scaleNearest(src, sw, sh, dw, dh) {
  const s32 = new Uint32Array(src.buffer, src.byteOffset, sw * sh);
  const out = new Uint8ClampedArray(dw * dh * 4);
  const d32 = new Uint32Array(out.buffer);
  for (let y = 0; y < dh; y++) {
    const sy = Math.floor((y * sh) / dh);
    for (let x = 0; x < dw; x++) {
      const sx = Math.floor((x * sw) / dw);
      d32[y * dw + x] = s32[sy * sw + sx];
    }
  }
  return out;
}

/** true, wenn die Skalierung jedes Pixel gleichmäßig vervielfacht oder teilt. */
export function isCleanScale(from, to) {
  if (from === to) return true;
  return to > from ? to % from === 0 : from % to === 0;
}
