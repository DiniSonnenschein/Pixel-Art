// Automatisches Speichern des aktuellen Bildes im App-Speicher (IndexedDB).

import { createLayer } from './document.js';

const DB_NAME = 'pixel-werkstatt';
const STORE = 'autosave';
const KEY = 'current';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export function serialize(doc, extra = {}) {
  return {
    version: 1,
    width: doc.width,
    height: doc.height,
    frameIndex: doc.frameIndex,
    layerIndex: doc.layerIndex,
    frames: doc.frames.map((f) => ({
      layers: f.layers.map((l) => ({
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        data: l.data.slice().buffer,
      })),
    })),
    ...extra,
  };
}

export function deserialize(saved) {
  const { width, height } = saved;
  const doc = {
    width,
    height,
    frameIndex: saved.frameIndex || 0,
    layerIndex: saved.layerIndex || 0,
    frames: saved.frames.map((f) => ({
      layers: f.layers.map((l) => {
        const layer = createLayer(width, height, l.name);
        layer.visible = l.visible;
        layer.opacity = l.opacity;
        layer.data.set(new Uint8ClampedArray(l.data));
        return layer;
      }),
    })),
  };
  return doc;
}

export async function saveAutosave(doc, extra) {
  await withStore('readwrite', (s) => s.put(serialize(doc, extra), KEY));
}

export async function loadAutosave() {
  try {
    return (await withStore('readonly', (s) => s.get(KEY))) || null;
  } catch {
    return null;
  }
}
