// Ebenen: Die Ebenenliste gilt für alle Frames gemeinsam (wie in Aseprite).
// Jeder Frame hat pro Ebene eigene Pixel; Name, Sichtbarkeit und Deckkraft
// werden in allen Frames gleich gehalten.

import { createLayer, compositeFrame } from './document.js';

// ---------- Verlauf für Strukturänderungen ----------

function snapshot(doc) {
  return {
    width: doc.width,
    height: doc.height,
    frameIndex: doc.frameIndex,
    layerIndex: doc.layerIndex,
    frames: doc.frames.map((f) => ({
      f,
      layers: f.layers.map((l) => ({ l, name: l.name, visible: l.visible, opacity: l.opacity, data: l.data })),
    })),
  };
}

function restore(doc, snap) {
  doc.width = snap.width;
  doc.height = snap.height;
  doc.frameIndex = snap.frameIndex;
  doc.layerIndex = snap.layerIndex;
  doc.frames = snap.frames.map(({ f, layers }) => {
    f.layers = layers.map(({ l, name, visible, opacity, data }) => Object.assign(l, { name, visible, opacity, data }));
    return f;
  });
}

/**
 * Führt eine Änderung an Ebenen/Frames aus und liefert einen Verlaufseintrag.
 * Pixel-Arrays dürfen dabei nur ersetzt, nicht verändert werden.
 */
export function change(doc, mutate) {
  const before = snapshot(doc);
  mutate();
  const after = snapshot(doc);
  return { undo: () => restore(doc, before), redo: () => restore(doc, after) };
}

// ---------- Operationen ----------

export function layerCount(doc) {
  return doc.frames[0].layers.length;
}

function nextName(doc) {
  let n = 0;
  for (const l of doc.frames[0].layers) {
    const m = /^Ebene (\d+)$/.exec(l.name);
    if (m) n = Math.max(n, +m[1]);
  }
  return `Ebene ${Math.max(n + 1, layerCount(doc) + 1)}`;
}

export function addLayer(doc) {
  const name = nextName(doc);
  const at = doc.layerIndex + 1;
  for (const f of doc.frames) f.layers.splice(at, 0, createLayer(doc.width, doc.height, name));
  doc.layerIndex = at;
}

export function duplicateLayer(doc) {
  const at = doc.layerIndex;
  for (const f of doc.frames) {
    const src = f.layers[at];
    const copy = createLayer(doc.width, doc.height, `${src.name} Kopie`);
    copy.visible = src.visible;
    copy.opacity = src.opacity;
    copy.data.set(src.data);
    f.layers.splice(at + 1, 0, copy);
  }
  doc.layerIndex = at + 1;
}

export function deleteLayer(doc) {
  if (layerCount(doc) <= 1) return false;
  for (const f of doc.frames) f.layers.splice(doc.layerIndex, 1);
  doc.layerIndex = Math.min(doc.layerIndex, layerCount(doc) - 1);
  return true;
}

/** dir = +1 nach oben, -1 nach unten */
export function moveLayer(doc, dir) {
  const from = doc.layerIndex, to = from + dir;
  if (to < 0 || to >= layerCount(doc)) return false;
  for (const f of doc.frames) {
    const [l] = f.layers.splice(from, 1);
    f.layers.splice(to, 0, l);
  }
  doc.layerIndex = to;
  return true;
}

/** Aktuelle Ebene mit der darunterliegenden verschmelzen. */
export function mergeDown(doc) {
  const at = doc.layerIndex;
  if (at === 0) return false;
  for (const f of doc.frames) {
    const below = f.layers[at - 1], top = f.layers[at];
    const merged = compositeFrame(doc, {
      layers: [
        { ...below, visible: true, opacity: 1 },
        { ...top, visible: true },
      ],
    });
    below.data = merged;
    f.layers.splice(at, 1);
  }
  doc.layerIndex = at - 1;
  return true;
}

export function setLayerProps(doc, index, props) {
  for (const f of doc.frames) Object.assign(f.layers[index], props);
}
